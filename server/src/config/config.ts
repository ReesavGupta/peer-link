import os from 'os'

export const config = {
  listenIP: '0.0.0.0',
  listenPort: 3125,

  mediasoup: {
    numWorkers: Object.keys(os.cpus()).length,
    worker: {
      rtcMinPort: 10000,
      rtcMaxPort: 10100,
      logLevel: 'debug',
      logTags: [
        
      ]
    },
  },
}
