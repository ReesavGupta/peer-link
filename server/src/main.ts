import express from 'express'
import * as http from 'http'
import { WebSocketServer } from 'ws'
import { WebSocketConnection } from './lib/ws'
async function main() {
  const app = express()
  const server = http.createServer(app)
  const io = new WebSocketServer({ server })

  WebSocketConnection(io)

  const port = 4000

  server.listen(port, () => {
    console.log(`server is listening on port : ${port}`)
  })
}

export { main }
