import WebSocket, { WebSocketServer } from 'ws'
import { createWorker } from '../config/worker'
import type { Router } from 'mediasoup/node/lib/RouterTypes'

let mediasoupRouter: Router
const WebSocketConnection = async (io: WebSocketServer) => {
  try {
    mediasoupRouter = await createWorker()
  } catch (error) {
    console.log('\n this is error: ', error)
    throw error
  }

  io.on('connection', (socket) => {
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString())

      switch (message.type) {
        case 'getRouterRtpCapabilities':
          onGetRouterRtpCapability(socket)
          break

        default:
          break
      }
    })
  })

  const onGetRouterRtpCapability = (socket: WebSocket) => {
    send(socket, 'routerCapabilities', mediasoupRouter.rtpCapabilities)
  }
  const send = (socket: WebSocket, type: string, data: any) => {
    const message = {
      type,
      data,
    }
    socket.send(JSON.stringify(message))
  }
}

export { WebSocketConnection }
