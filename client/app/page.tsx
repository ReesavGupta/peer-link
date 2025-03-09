'use client'

import { RtpCapabilities } from 'mediasoup-client/lib/RtpParameters'
import {
  AppData,
  Device,
  Transport,
  TransportOptions,
} from 'mediasoup-client/lib/types'
import { useEffect, useState, useRef } from 'react'

const wsUrl = `ws://localhost:4000/`

export default function Home() {
  // WebSocket and Mediasoup device states
  const [socket, setSocket] = useState<WebSocket | null>(null)
  const [device, setDevice] = useState<Device | null>(null)
  const [transport, setTransport] = useState<Transport<AppData> | null>(null)
  const [consumerTransport, setConsumerTransport] = useState<
    Transport<AppData> | undefined
  >(undefined)
  const deviceRef = useRef<Device | null>(null)

  // Media stream states
  const [stream, setStream] = useState<MediaStream | null>(null)
  const streamRef = useRef<MediaStream | null>(null) // Holds stream reference
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)

  // UI states for button texts
  const [textWebcam, setTextWebcam] = useState('📷 Share Video')
  const [textScreen, setTextScreen] = useState('🖥️ Share Screen')
  const [textSubscribe, setTextSubscribe] = useState('📡 Subscribe')
  const [textPublish, setTextPublish] = useState('')

  // Button and video element references
  const webcamButtonRef = useRef<HTMLButtonElement>(null)
  const screenButtonRef = useRef<HTMLButtonElement>(null)
  const localVideo = useRef<HTMLVideoElement | null>(null)
  const remoteVideo = useRef<HTMLVideoElement | null>(null)
  const subButtonRef = useRef<HTMLButtonElement | null>(null)
  // Track whether user is sharing webcam or screen
  const [isWebCam, setIsWebCam] = useState(true)

  /**
   * Establish WebSocket connection and fetch router RTP capabilities
   */
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
        case 'subTransportCreated':
          onSubTransportCreated(data)
          break
        case 'resumed':
          console.log(data.data)
          break
        case 'subscribed':
          onSubsribed(data.data)
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

  /**
   * Initialize Mediasoup device with router RTP capabilities
   */
  const onRouterCapabilities = async (routerCapabilities: RtpCapabilities) => {
    try {
      const mediaSoupDevice = new Device()
      await mediaSoupDevice.load({ routerRtpCapabilities: routerCapabilities })

      setDevice(() => {
        console.log(`✅ Loaded Mediasoup device successfully`, mediaSoupDevice)
        return mediaSoupDevice
      })
      deviceRef.current = mediaSoupDevice
    } catch (error) {
      console.error('Error creating Mediasoup device:', error)
    }
  }

  const onSubsribed = async (data: any) => {
    const { producerId, id, kind, rtpParameters } = data.data

    // let codecOptions = {}

    const consumer = await consumerTransport?.consume({
      id,
      rtpParameters,
      kind,
      producerId,
      // codecOptions,
    })
    const stream = new MediaStream()
    if (consumer) {
      stream.addTrack(consumer.track)
      setRemoteStream(stream)
    }
  }

  /**
   * Create a consumer transport for recieving media
   */

  const onSubTransportCreated = (data: { type: string; data: any }) => {
    console.log(`this is the data.data:`, data.data)
    const transport = deviceRef.current?.createRecvTransport(data.data)
    setConsumerTransport(transport)
    console.log(`this is the recv-transport:`, transport)
    if (transport) {
      console.log(`this is the connectoin state: `, transport.connectionState)
      transport.on('connect', ({ dtlsParameters }, callback, errback) => {
        console.log(`connecting the sub transport ...`)
        const msg = {
          type: 'connectConsumerTransport',
          transportId: transport.id,
          dtlsParameters,
        }
        const message = JSON.stringify(msg)

        socket?.send(message)
        // subConnected

        const messageHandler = (event: MessageEvent) => {
          const msg = JSON.parse(event.data)
          if (msg.type === 'subConnected') {
            console.log(`✅ Consumer transport connected successfully`)
            callback()
            socket?.removeEventListener('message', messageHandler)
            // we consume only after sucessfull connection

            consumer()
          }
        }
        socket?.addEventListener('message', messageHandler)
      })

      transport.on('connectionstatechange', (state) => {
        console.log(`this is the state of the transport : ${state}`)

        switch (state) {
          case 'new':
            console.log(`new connection instantiated :thumbsup:`)
            break
          case 'connecting':
            console.log(`we are getting connected...`)
            break
          case 'connected':
            console.log('we are in !!! :D')
            if (remoteVideo.current) {
              remoteVideo.current.srcObject = remoteStream
              socket?.send(
                JSON.stringify({
                  type: 'resume',
                })
              )
            }
            break
          case 'failed':
            console.error('connection failed :(')
            transport.close()
            break
          default:
            console.warn('unpredicted state')
            break
        }
      })
      console.log(`this is the events after: `, transport?.eventNames())
    } else {
      console.error('no transport')
      return
    }
  }

  const consumer = async () => {
    const rtpCapabilities = deviceRef.current?.rtpCapabilities

    const msg = {
      type: 'consume',
      rtpCapabilities,
    }
    socket?.send(JSON.stringify(msg))
    // callback here
  }

  /**
   * Create producer transport for sending media
   */
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
        mySocket?.send(
          JSON.stringify({ type: 'connectProducerTransport', dtlsParameters })
        )

        const messageHandler = (e: any) => {
          const response = JSON.parse(e.data)
          if (response.type === 'producerTransportConnected') {
            callback()
            mySocket.removeEventListener('message', messageHandler) // Cleanup
          }
        }

        mySocket.addEventListener('message', messageHandler)
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

        const messageHandler = (event: any) => {
          const response = JSON.parse(event.data)
          if (response.type === 'produced') {
            callback(response.data.id)
            mySocket.removeEventListener('message', messageHandler) // Cleanup
          }
        }

        mySocket.addEventListener('message', messageHandler)
      })

      createdTransport.on('connectionstatechange', (state) => {
        switch (state) {
          case 'connecting':
            setTextPublish('Publishing...')
            break
          case 'connected':
            if (localVideo.current && streamRef.current) {
              localVideo.current.srcObject = streamRef.current
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

  /**
   * Start publishing webcam or screen share
   */
  const publish = async (e: any) => {
    console.log(`🔹 Publishing...`)
    const isWebcam = e.target.id === 'btn_webcam'
    setIsWebCam(isWebcam)

    if (webcamButtonRef.current) webcamButtonRef.current.disabled = true
    if (screenButtonRef.current) screenButtonRef.current.disabled = true

    if (!device) {
      console.warn('❌ No device initialized.')
      return
    }

    try {
      const localStream = isWebcam
        ? await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: true,
          })
        : await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
          })

      setStream(localStream)
      streamRef.current = localStream

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
  /**
   * Start subscribing on button click
   */

  const subscribe = () => {
    // disable the button
    if (subButtonRef.current) subButtonRef.current.disabled = true

    const message = {
      type: 'createConsumerTransport',
      forceTcp: false,
    }
    socket?.send(JSON.stringify(message))
  }

  /**
   * Handle stream production when stream or transport changes
   */
  useEffect(() => {
    if (!stream || !transport) return

    const publishStream = async () => {
      try {
        const track = stream.getVideoTracks()[0]
        const producer = await transport.produce({ track })
        console.log('✅ Producer created:', producer)
        await localVideo.current?.play()
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
        <button
          onClick={subscribe}
          ref={subButtonRef}
          className="px-4 py-2 bg-purple-500 rounded-lg hover:bg-purple-600 transition"
        >
          {textSubscribe}
        </button>
      </div>
    </div>
  )
}
