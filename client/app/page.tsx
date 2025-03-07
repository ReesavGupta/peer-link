'use client'

import { RtpCapabilities } from 'mediasoup-client/lib/RtpParameters'
import { AppData, Device, Transport } from 'mediasoup-client/lib/types'
import { useEffect, useState, useRef } from 'react'

const wsUrl = `ws://localhost:4000/`

export default function Home() {
  const [socket, setSocket] = useState<WebSocket | null>(null)
  const [device, setDevice] = useState<Device | null>(null)
  const [transport, setTransport] = useState<Transport<AppData> | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)

  const [textWebcam, setTextWebcam] = useState('📷 Share Video')
  const [textScreen, setTextScreen] = useState('🖥️ Share Screen')
  const [textSubscribe, setTextSubscribe] = useState('📡 Subscribe')
  const [textPublish, setTextPublish] = useState('')

  const webcamButtonRef = useRef<HTMLButtonElement>(null)
  const screenButtonRef = useRef<HTMLButtonElement>(null)
  const localVideo = useRef<HTMLVideoElement | null>(null)
  const remoteVideo = useRef<HTMLVideoElement | null>(null)

  const [isWebCam, setIsWebCam] = useState(true)

  useEffect(() => {
    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      console.log(`Connected to WebSocket Server`)
      setSocket(ws)
      ws.send(JSON.stringify({ type: `getRouterRtpCapabilities` }))
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      console.log('📩 WebSocket message:', data)

      switch (data.type) {
        case 'routerCapabilities':
          onRouterCapabilities(data.data)
          break

        case 'producerTransportCreated':
          onProducerTransportCreated(data.data, ws)
          break

        default:
          console.warn('Unknown WebSocket message type:', data.type)
          break
      }
    }

    ws.onerror = (error) => console.error('WebSocket error:', error)
    ws.onclose = () => console.log('WebSocket disconnected')

    return () => ws.close()
  }, [])

  const onRouterCapabilities = async (routerCapabilities: RtpCapabilities) => {
    try {
      const mediaSoupDevice = new Device()
      await mediaSoupDevice.load({ routerRtpCapabilities: routerCapabilities })

      setDevice(() => {
        console.log(`✅ Loaded Mediasoup device successfully`, mediaSoupDevice)
        return mediaSoupDevice
      })
    } catch (error) {
      console.error('Error creating Mediasoup device:', error)
    }
  }

  const onProducerTransportCreated = (data: any, mySocket: WebSocket) => {
    setDevice((currentDevice) => {
      if (!currentDevice) {
        console.error('❌ Device is null inside onProducerTransportCreated!')
        return currentDevice
      }

      console.log('🎯 Using latest device:', currentDevice)

      const createdTransport = currentDevice.createSendTransport(data)

      setTransport(createdTransport)

      createdTransport.on('connect', ({ dtlsParameters }, callback) => {
        console.log('🔹 Connecting producer transport...')
        console.log(`this is the mySocket : ${mySocket}`)
        mySocket?.send(
          JSON.stringify({ type: 'connectProducerTransport', dtlsParameters })
        )

        // Create a one-time event listener for the response
        const messageHandler = (e: any) => {
          const response = JSON.parse(e.data)
          if (response.type === 'producerTransportConnected') {
            callback()
          }
        }

        mySocket?.addEventListener('producerTransportConnected', messageHandler)
      })

      createdTransport.on('produce', ({ kind, rtpParameters }, callback) => {
        mySocket?.send(
          JSON.stringify({
            type: 'produce',
            transportId: createdTransport.id,
            kind,
            rtpParameters,
          })
        )
        mySocket?.addEventListener('message', (event) => {
          const response = JSON.parse(event.data)
          if (response.type === 'produced') callback(response.data.id)
        })
      })

      createdTransport.on('connectionstatechange', (state) => {
        switch (state) {
          case 'connecting':
            setTextPublish('Publishing...')
            break
          case 'connected':
            if (localVideo.current) {
              localVideo.current.srcObject = stream
            }
            setTextPublish('Published ✅')
            break
          case 'failed':
            createdTransport.close()
            setTextPublish('Failed to publish ❌')
            break
        }
      })

      return currentDevice
    })
  }

  const publish = async (e: any) => {
    console.log(`🔹 Publishing...`)
    const isWebcam = e.target.id === 'btn_webcam'
    setIsWebCam(isWebcam) // Update state

    if (webcamButtonRef.current) webcamButtonRef.current.disabled = true
    if (screenButtonRef.current) screenButtonRef.current.disabled = true

    if (!device) {
      console.warn('❌ No device initialized.')
      return
    }

    try {
      const localStream = isWebcam // Use the local variable, not the state
        ? await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: true,
          })
        : await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
          })

      setStream(localStream)

      socket?.send(
        JSON.stringify({
          type: 'createProducerTransport',
          forceTcp: false,
          routerRtpCapabilities: device.rtpCapabilities,
        })
      )
    } catch (error) {
      console.error('Error getting media stream:', error)
      setTextPublish('Failed ❌')
    }
  }

  useEffect(() => {
    if (!stream || !transport) return

    const publishStream = async () => {
      try {
        const track = stream.getVideoTracks()[0]
        const producer = await transport.produce({ track })
        console.log('✅ Producer created:', producer)
      } catch (error) {
        console.error('Error producing stream:', error)
        setTextPublish('Failed ❌')
      }
    }

    publishStream()
  }, [stream, transport])

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-5">
      <h1 className="text-2xl font-bold mb-5">
        🚀 Mediasoup + WebRTC Playground
      </h1>

      <div className="grid grid-cols-2 gap-4 w-full max-w-4xl">
        <video
          ref={localVideo}
          className="w-full rounded-lg border"
          autoPlay
          playsInline
        />
        <video
          ref={remoteVideo}
          className="w-full rounded-lg border"
          autoPlay
          playsInline
        />
      </div>

      <div className="mt-6 flex gap-4">
        <button
          ref={webcamButtonRef}
          id="btn_webcam"
          onClick={publish}
          className="px-4 py-2 bg-blue-500 rounded-lg hover:bg-blue-600 transition"
        >
          {textWebcam}
        </button>
        <button
          ref={screenButtonRef}
          id="btn_screen"
          onClick={publish}
          className="px-4 py-2 bg-green-500 rounded-lg hover:bg-green-600 transition"
        >
          {textScreen}
        </button>
        <button className="px-4 py-2 bg-purple-500 rounded-lg hover:bg-purple-600 transition">
          {textSubscribe}
        </button>
      </div>
    </div>
  )
}
