import { WebSocketServer } from 'ws'
import { createWorker } from '../config/worker'

let mediasoupRouter
const WebSocketConnection = async (io: WebSocketServer) => {
  try {
    mediasoupRouter = await createWorker()
  } catch (error) {
    console.log('\n this is error: ', error)
    throw error
  }

  io.on('connection', (socket) => {
    socket.on('message', (data) => {
      console.log(data.toString())
      socket.send('hiiiii')
    })
  })
}

export { WebSocketConnection }
