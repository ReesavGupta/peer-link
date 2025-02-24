import { WebSocketServer } from 'ws'
const WebSocketConnection = async (io: WebSocketServer) => {
  io.on('connection', (socket) => {
    socket.on('message', (data) => {
      console.log(data.toString())
      socket.send('hiiiii')
    })
  })
}

export { WebSocketConnection }
