import { useEffect, useState, useRef } from 'react'
import WebSocket from 'ws'
export default function Home() {
  const wsUrl = 'ws://localhost:3000/'
  const [socket, setSocket] = useState<WebSocket | null>(null)

  const [textPublish, setTextPublish] = useState('Publish')
  const [textWebcam, setTextWebcam] = useState('Share Video')
  const [textScreen, setTextScreen] = useState('Share Screen')
  const [textSubscribe, setTextSubscribe] = useState('Subscribe')

  const localVideo = useRef(null)
  const remoteVideo = useRef(null)
  const [remoteStream, setRemoteStream] = useState(null)
  const [device, setDevice] = useState(null)
  const [producer, setProducer] = useState(null)
  const [consumeTransport, setConsumeTransport] = useState(null)
  const [userId, setUserId] = useState(null)
  const [isWebcam, setIsWebcam] = useState(true)

  const produceCallback = () => console.log('Producing stream...')
  const produceErrback = (error: Error) =>
    console.error('Error producing:', error)
  const consumerCallback = () => console.log('Consuming stream...')
  const consumerErrback = (error: Error) =>
    console.error('Error consuming:', error)

  useEffect(() => {
    // Connect WebSocket
    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      console.log('Connected to WebSocket')
      setSocket(ws)
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data.toLocaleString())
      console.log('WebSocket message:', data)
    }

    ws.onerror = (error) => console.error('WebSocket error:', error)
    ws.onclose = () => console.log('WebSocket disconnected')

    return () => ws.close()
  }, [])

  return (
    <div>
      <div>this is sample WebRTC using Mediasoup</div>
      <div>
        <video
          ref={localVideo}
          playsInline
          autoPlay
        ></video>
      </div>
      <div>
        <video
          ref={remoteVideo}
          playsInline
          autoPlay
        ></video>
      </div>

      <button id="btnCam">{textWebcam}</button>
      <button id="btnScreen">{textScreen}</button>
      <button id="btnSub">{textSubscribe}</button>
    </div>
  )
}
