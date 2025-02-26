'use client'

import { useEffect, useState, useRef } from 'react'

const wsUrl = `ws://localhost:4000/`

export default function Home() {
  const [socket, setSocket] = useState<WebSocket | null>(null)

  const [textWebcam, setTextWebcam] = useState('📷 Share Video')
  const [textScreen, setTextScreen] = useState('🖥️ Share Screen')
  const [textSubscribe, setTextSubscribe] = useState('📡 Subscribe')
  const [device, setDevice] = useState(null)

  const localVideo = useRef<HTMLVideoElement | null>(null)
  const remoteVideo = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const ws = new WebSocket(wsUrl)

    ws.onopen = (socket) => {
      console.log(`✅ Connected to WebSocket`)
      setSocket(ws)
      const msg = {
        type: `getRouterRtpCapabilities`,
      }
      ws.send(JSON.stringify(msg))
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      console.log('📩 WebSocket message:', data)

      switch (data.type) {
        case 'routerCapabilities':
          onRouterCapabilities(data.data)
          break

        default:
          break
      }
    }

    ws.onerror = (error) => console.error('❌ WebSocket error:', error)
    ws.onclose = () => console.log('⚠️ WebSocket disconnected')

    return () => ws.close()
  }, [])

  const onRouterCapabilities = (routerCapabilities) => {
    console.log(`this is routerCapabilities:`, routerCapabilities)
    setDevice(routerCapabilities)
  }

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
        <button className="px-4 py-2 bg-blue-500 rounded-lg hover:bg-blue-600 transition">
          {textWebcam}
        </button>
        <button className="px-4 py-2 bg-green-500 rounded-lg hover:bg-green-600 transition">
          {textScreen}
        </button>
        <button className="px-4 py-2 bg-purple-500 rounded-lg hover:bg-purple-600 transition">
          {textSubscribe}
        </button>
      </div>
    </div>
  )
}
