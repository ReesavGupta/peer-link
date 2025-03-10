import WebSocket, { WebSocketServer } from 'ws'
import { createWorker } from '../config/worker'
import type { Router } from 'mediasoup/node/lib/RouterTypes'
import { createWebRtcTransport } from './createWebRtcTransport'
import type {
  Consumer,
  DtlsParameters,
  MediaKind,
  Producer,
  RtpCapabilities,
  Transport,
} from 'mediasoup/node/lib/types'

let mediasoupRouter: Router
let producerTransport: Transport | null = null
let consumerTransport: Transport | null = null
let producer: Producer | null = null
let consumer: Consumer | null = null

const WebSocketConnection = async (io: WebSocketServer) => {
  try {
    mediasoupRouter = await createWorker()
  } catch (error) {
    console.error('Error creating Mediasoup worker:', error)
    throw error
  }

  io.on('connection', (socket) => {
    console.log('New WebSocket connection')

    socket.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString())

        switch (message.type) {
          case 'getRouterRtpCapabilities':
            send(socket, 'routerCapabilities', mediasoupRouter.rtpCapabilities)
            break

          case 'createProducerTransport':
            await onCreateProducerTransport(socket)
            break

          case 'connectProducerTransport':
            await onConnectProducerTransport(socket, message)
            break

          case 'produce':
            await onProduce(socket, message, io)
            break

          case 'createConsumerTransport':
            await onCreateConsumerTransport(socket)
            break

          case 'connectConsumerTransport':
            await onConnectConsumerTransport(socket, message)
            break

          case 'consume':
            console.log(`\n we are in consume switch\n`)
            await onConsume(socket, message)
            break

          case 'resume':
            await onResume(socket)
            break

          default:
            console.log('Unknown message type:', message.type)
            break
        }
      } catch (error) {
        console.error('Error processing message:', error)
      }
    })

    // socket.on('close', () => {
    //   console.log('Socket disconnected, cleaning up transports...')

    //   if (producer) {
    //     console.log('Closing producer transport...')
    //     producerTransport?.close()
    //     producerTransport = null
    //     producer = null
    //   }

    //   if (consumer) {
    //     console.log('Closing consumer transport...')
    //     consumerTransport?.close()
    //     consumerTransport = null
    //     consumer = null
    //   }
    // })
  })
}

// ---------------------- HANDLER FUNCTIONS ----------------------

const onCreateProducerTransport = async (socket: WebSocket) => {
  try {
    const result = await createWebRtcTransport(mediasoupRouter)

    if (result) {
      const { transport, params } = result
      producerTransport = transport
      send(socket, 'producerTransportCreated', params)
    } else {
      throw new Error('Failed to create producer transport')
    }
  } catch (error) {
    console.error('Error creating producer transport:', error)
    send(socket, 'error', { message: 'Producer transport creation failed' })
  }
}

const onConnectProducerTransport = async (
  socket: WebSocket,
  message: { dtlsParameters: DtlsParameters }
) => {
  try {
    if (!producerTransport) throw new Error('Producer transport not found')

    await producerTransport.connect({ dtlsParameters: message.dtlsParameters })
    send(socket, 'producerTransportConnected', { success: true })
  } catch (error) {
    console.error('Failed to connect producer transport:', error)
    send(socket, 'error', { message: 'Failed to connect producer transport' })
  }
}

const onProduce = async (
  socket: WebSocket,
  message: { kind: string; rtpParameters: any },
  io: WebSocketServer
) => {
  try {
    if (!producerTransport)
      throw new Error('Producer transport is not connected')

    console.log(
      'Producing with RTP Parameters:',
      JSON.stringify(message.rtpParameters, null, 2)
    )

    producer = await producerTransport.produce({
      kind: message.kind as MediaKind,
      rtpParameters: message.rtpParameters,
    })

    send(socket, 'produced', { id: producer.id })
    broadcast(io, 'newProducer', producer.id)
  } catch (error) {
    console.error('Error in producing:', error)
    send(socket, 'error', { message: 'Failed to start producing' })
  }
}

const onCreateConsumerTransport = async (socket: WebSocket) => {
  try {
    const result = await createWebRtcTransport(mediasoupRouter)
    if (!result) throw new Error('Failed to create consumer transport')

    const { transport, params } = result
    consumerTransport = transport
    send(socket, 'subTransportCreated', params)
  } catch (error) {
    console.error('Error creating consumer transport:', error)
    send(socket, 'error', { message: 'Consumer transport creation failed' })
  }
}

const onConnectConsumerTransport = async (
  socket: WebSocket,
  message: { dtlsParameters: DtlsParameters }
) => {
  try {
    if (!consumerTransport) throw new Error('Consumer transport not found')

    await consumerTransport.connect({ dtlsParameters: message.dtlsParameters })
    send(socket, 'subConnected', { success: true })
  } catch (error) {
    console.error('Failed to connect consumer transport:', error)
    send(socket, 'error', { message: 'Failed to connect consumer transport' })
  }
}

const onConsume = async (
  socket: WebSocket,
  message: { rtpCapabilities: RtpCapabilities }
) => {
  try {
    console.log(`\n we are inside the on consume methods \n`)
    if (!producer) {
      console.error('No producer available to consume')
      return send(socket, 'error', { message: 'No producer available' })
    }

    console.log('Creating consumer for producer:', producer.id)

    if (
      !mediasoupRouter.canConsume({
        rtpCapabilities: message.rtpCapabilities,
        producerId: producer.id,
      })
    ) {
      throw new Error('Cannot consume this producer')
    }

    consumer = await consumerTransport!.consume({
      producerId: producer.id,
      rtpCapabilities: message.rtpCapabilities,
      paused: producer.kind === 'video',
    })

    send(socket, 'subscribed', {
      producerId: producer.id,
      id: consumer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      type: consumer.type,
      producerPaused: consumer.producerPaused,
    })
  } catch (error) {
    console.error('Error in consuming:', error)
    send(socket, 'error', { message: 'Failed to start consuming' })
  }
}

const onResume = async (socket: WebSocket) => {
  try {
    if (!consumer) throw new Error('No consumer found')

    await consumer.resume()
    send(socket, 'resumed', { success: true })
  } catch (error) {
    console.error('Failed to resume consumer:', error)
    send(socket, 'error', { message: 'Failed to resume consumer' })
  }
}

// ---------------------- UTILITIES ----------------------

const send = (socket: WebSocket, type: string, data: any) => {
  socket.send(JSON.stringify({ type, data }))
}

const broadcast = (ws: WebSocketServer, type: string, message: any) => {
  const resp = JSON.stringify({ type, data: message })
  ws.clients.forEach((client) => client.send(resp))
}

export { WebSocketConnection }
