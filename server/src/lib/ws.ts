import WebSocket, { WebSocketServer } from 'ws'
import { createWorker } from '../config/worker'
import type { Router } from 'mediasoup/node/lib/RouterTypes'
import { createWebRtcTransport } from './createWebRtcTransport'
import type {
  DtlsParameters,
  Producer,
  Transport,
} from 'mediasoup/node/lib/types'

let mediasoupRouter: Router
let producerTransport: Transport
let producer: Producer

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

        case 'createProducerTransport':
          onCreateProducerTransport(socket)
          break

        case 'connectProducerTransport':
          onConnectProducerTransport(socket, message)
          break

        case 'produce':
          onProduce(socket, message, io)
          break
        default:
          break
      }
    })
  })

  const onGetRouterRtpCapability = (socket: WebSocket) => {
    send(socket, 'routerCapabilities', mediasoupRouter.rtpCapabilities)
  }

  const onCreateProducerTransport = async (socket: WebSocket) => {
    try {
      const result = await createWebRtcTransport(mediasoupRouter)

      if (result) {
        const { transport, params } = result
        producerTransport = transport
        send(socket, 'producerTransportCreated', params)
      } else {
        throw new Error('Failed to create WebRTC transport')
      }
    } catch (e) {
      console.error('Failed to create WebRTC transport')
      send(socket, 'error', e)
    }
  }

  const onConnectProducerTransport = async (
    socket: WebSocket,
    message: {
      type: string
      dtlsParameters: DtlsParameters
    }
  ) => {
    await producerTransport.connect({ dtlsParameters: message.dtlsParameters })
    send(socket, 'producerConnected', 'producer connected!!!')
  }

  const onProduce = async (
    socket: WebSocket,
    message: any,
    io: WebSocketServer
  ) => {
    const { kind, rtpParameters } = message
    producer = await producerTransport.produce({ kind, rtpParameters })

    const response = {
      id: producer.id,
    }
    send(socket, 'produced', response)
    broadcast(io, 'newProducer', 'new user')
  }

  const send = (socket: WebSocket, type: string, data: any) => {
    const message = {
      type,
      data,
    }
    socket.send(JSON.stringify(message))
  }

  const broadcast = (ws: WebSocketServer, type: string, message: any) => {
    const resp = JSON.stringify({
      type,
      data: message,
    })

    ws.clients.forEach((client) => client.send(resp))
  }
}

export { WebSocketConnection }
