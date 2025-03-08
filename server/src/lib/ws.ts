import WebSocket, { WebSocketServer } from 'ws'
import { createWorker } from '../config/worker'
import type { Router } from 'mediasoup/node/lib/RouterTypes'
import { createWebRtcTransport } from './createWebRtcTransport'
import type {
  Consumer,
  DtlsParameters,
  Producer,
  RtpCapabilities,
  Transport,
} from 'mediasoup/node/lib/types'

let mediasoupRouter: Router
let producerTransport: Transport
let consumerTransport: Transport
let producer: Producer
let consumer: Consumer
const WebSocketConnection = async (io: WebSocketServer) => {
  try {
    mediasoupRouter = await createWorker()
  } catch (error) {
    console.log('\n this is error: ', error)
    throw error
  }

  io.on('connection', (socket) => {
    socket.on('message', (data) => {
      console.log('Received message:', data.toString())

      try {
        const message = JSON.parse(data.toString())
        console.log('Parsed message type:', message.type)

        switch (message.type) {
          case 'getRouterRtpCapabilities':
            console.log('Processing getRouterRtpCapabilities')
            onGetRouterRtpCapability(socket)
            break

          case 'createProducerTransport':
            console.log('Processing createProducerTransport')
            onCreateProducerTransport(socket)
            break

          case 'connectProducerTransport':
            console.log('Processing connectProducerTransport')
            onConnectProducerTransport(socket, message)
            break

          case 'produce':
            console.log('Processing produce')
            onProduce(socket, message, io)
            break
          case 'createConsumerTransport':
            console.log('we are inside createConsumerTransport')
            onCreateConsumerTransport(socket)
            break
          case 'connectConsumerTransport':
            onConnectConsumerTransport(socket, message)
            break
          case 'resume':
            onResume(socket)
            break
          case 'consume':
            onConsume(socket, message)
            break
          default:
            console.log('Unknown message type:', message.type)
            break
        }
      } catch (error) {
        console.error('Error processing message:', error)
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
    console.log(
      '\nConnecting producer transport with DTLS params:',
      message.dtlsParameters
    )

    try {
      await producerTransport.connect({
        dtlsParameters: message.dtlsParameters,
      })
      console.log('Producer transport connected successfully')
      send(socket, 'producerTransportConnected', { success: true })
    } catch (error) {
      console.error('Failed to connect producer transport:', error)
      send(socket, 'error', {
        message: 'Failed to connect producer transport',
        details: (error as any).message,
      })
    }
  }

  const onConsume = async (socket: WebSocket, message: any) => {
    const res = await createConsumer(producer, message.rtpCapabilities)
    send(socket, 'subscribed', res)
  }

  const onResume = async (socket: WebSocket) => {
    await consumer.resume()
    send(socket, 'resumed', 'resumed')
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

  const onCreateConsumerTransport = async (socket: WebSocket) => {
    try {
      const result = await createWebRtcTransport(mediasoupRouter)
      const { params, transport } = result!
      consumerTransport = transport

      send(socket, 'subTransportCreated', params)
    } catch (error) {
      console.error(`some error occured when creating the consumer transport`)
      return
    }
  }

  const onConnectConsumerTransport = async (
    socket: WebSocket,
    message: {
      type: string
      dtlsParameters: DtlsParameters
    }
  ) => {
    await consumerTransport.connect({ dtlsParameters: message.dtlsParameters })
    send(socket, 'subConnected', 'consumer transport connected')
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

  const createConsumer = async (
    producer: Producer,
    rtpCapabilities: RtpCapabilities
  ) => {
    if (
      !mediasoupRouter.canConsume({ rtpCapabilities, producerId: producer.id })
    ) {
      console.error('can not consume')
      return
    }

    try {
      consumer = await consumerTransport.consume({
        producerId: producer.id,
        rtpCapabilities,
        paused: producer.kind === 'video',
      })
    } catch (error) {
      console.error(`consumer creation error : ${error}`)
      return
    }
    // simulcast thingy is coming here {bandwidth is saved here}
    return {
      producerId: producer.id,
      id: consumer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      type: consumer.type,
      producerPaused: consumer.producerPaused,
    }
  }
}

export { WebSocketConnection }
