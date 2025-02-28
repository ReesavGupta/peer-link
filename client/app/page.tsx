'use client'

import { RtpCapabilities } from 'mediasoup-client/lib/RtpParameters'
import { Producer, Transport } from 'mediasoup-client/lib/types'
import { useEffect, useState, useRef } from 'react'

const wsUrl = `ws://localhost:4000/`

export default function Home() {
  const [socket, setSocket] = useState<WebSocket | null>(null)

  const [textWebcam, setTextWebcam] = useState('📷 Share Video')
  const [textScreen, setTextScreen] = useState('🖥️ Share Screen')
  const [textSubscribe, setTextSubscribe] = useState('📡 Subscribe')
  const [textPublish, setTextPublish] = useState('')
  const [device, setDevice] = useState<RtpCapabilities | null>(null)

  const webcamButtonRef = useRef<HTMLButtonElement>(null)
  const screenButtonRef = useRef<HTMLButtonElement>(null)

  const localVideo = useRef<HTMLVideoElement | null>(null)
  const remoteVideo = useRef<HTMLVideoElement | null>(null)

  const [isWebCam, setIsWebCam] = useState(true)

  const [stream, setStream] = useState<MediaStream | null>(null)

  useEffect(() => {
    const ws = new WebSocket(wsUrl)

    ws.onopen = (socket) => {
      console.log(`Connected to WebSocketServer (we are in)`)
      setSocket(ws)
      const msg = {
        type: `getRouterRtpCapabilities`,
      }
      ws.send(JSON.stringify(msg))
    }

    ws.onmessage = (event) => {
      console.log(`this is the event: ${event}`)

      const data = JSON.parse(event.data)

      console.log('📩 WebSocket message:', data)

      switch (data.type) {
        case 'routerCapabilities':
          onRouterCapabilities(data.data)
          break

        case 'producerTransportCreated':
          onProducerTransportCreated(data.data)
          break

        default:
          break
      }
    }

    ws.onerror = (error) =>
      console.error('aghhhhh shittttt WebSocket error:', error)
    ws.onclose = () => console.log('we lost it. WebSocket disconnected')

    return () => ws.close()
  }, [])

  const onRouterCapabilities = (routerCapabilities: RtpCapabilities) => {
    console.log(`this is routerCapabilities:`, routerCapabilities)
    setDevice(routerCapabilities)
  }

  const onProducerTransportCreated = (data) => {
    console.log('inside onProducerTransportCreated')
    if (!device) {
      return
    }
    const transport = device.createSendTransport(data)

    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      const message = {
        type: 'connectProducerTransport',
        dtlsParameters,
      }

      const strigifiedMessage = JSON.stringify(message)

      socket?.send(strigifiedMessage)
      socket?.addEventListener('producerConnected', (event) => {
        callback()
      })
    })

    // begin tranport on producer
    // mediasoup separates video and audio, hence we need to do another trasport for audio as well
    transport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
      const message = {
        type: 'produce',
        transportId: transport.id,
        kind,
        rtpParameters,
      }

      const stringifiedMessage = JSON.stringify(message)

      socket?.send(stringifiedMessage)

      socket?.addEventListener('produced', (resp) => {
        callback(resp.data.id)
      })
    })

    transport.on('connectionStateChange', (state) => {
      switch (state) {
        case 'connecting':
          setTextPublish('publishing.....')
          break

        case 'connected':
          if (localVideo.current) {
            localVideo.current.srcObject = stream
            setTextPublish('published :D')
          }
          break

        case 'failed':
          transport.close()
          setTextPublish('failed to publish')
          break
      }
    })
  }

  const publish = (e: any) => {
    console.log(`you are publishing`)
    const isWebcam = e.target.id === 'btn_webcam'
    setIsWebCam(isWebcam)
    const textPublish = isWebcam ? textWebcam : textScreen
    setTextPublish(textPublish)
    if (webcamButtonRef.current && screenButtonRef.current) {
      webcamButtonRef.current.disabled = true
      screenButtonRef.current.disabled = true
    }

    if (!device) {
      console.warn('device (router rtp capabilities) is null')
      return
    }
    const message = {
      type: 'createProducerTransport',
      forceTcp: false,
      routerRtpCapabilities: device,
    }

    socket?.send(JSON.stringify(message))
  }

  const getUserMedia = async () => {
    if (device && !device.canProduce('video')) {
      console.error('cannot produce video')
      return
    }
    let localStream
    try {
      if (isWebCam) {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true,
        })
      } else {
        localStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        })
      }
      setStream(localStream)
    } catch (error) {
      console.error('couldnt get the local-video-stream')
      throw error
    }
  }

  useEffect(() => {
    try {
      getUserMedia().then(() => console.log(`captured the user's stream`))
      const track = stream?.getVideoTracks()[0]
      const params = { track }

      producer = await transport.produce(params)
    } catch (error) {
      console.error(error)
      setTextPublish('failed')
    }
  }, [])

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
