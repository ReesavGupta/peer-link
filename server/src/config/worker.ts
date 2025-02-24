import * as mediasoup from 'mediasoup'
import { config } from './config'
import type { Worker } from 'mediasoup/node/lib/WorkerTypes'
import type { Router } from 'mediasoup/node/lib/RouterTypes'

const workers: Array<{
  worker: Worker
  router: Router
}> = []

let nextMediaSoupWorkerIndex = 0

const createWorker = async (): Promise<void> => {
  const worker = await mediasoup.createWorker({
    logLevel: config.mediasoup.worker.logLevel,
    logTags: config.mediasoup.worker.logTags,
  })

  worker.on('died', () => {
    console.error(
      'mediasoup worker died, exiting in 2 seconds ... [pid: &d]',
      worker.pid
    )
    setTimeout(() => {
      process.exit(1)
    }, 2000)
  })
}

export { createWorker }
