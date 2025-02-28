import type { Router } from 'mediasoup/node/lib/RouterTypes'
import { config } from '../config/config'
import type { WebRtcTransport } from 'mediasoup/node/lib/WebRtcTransportTypes'
import type { AppData } from 'mediasoup/node/lib/types'

const createWebRtcTransport = async (mediasoupRouter: Router) => {
  try {
    const { maxIncomeBitrate, initialAvailableOutgoingBitrate } =
      config.mediasoup.webRtcTransport

    const transport: WebRtcTransport<AppData> =
      await mediasoupRouter.createWebRtcTransport({
        listenIps: config.mediasoup.webRtcTransport.listenIps,
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate,
      })

    if (!transport) {
      throw new Error("transport isn't created")
    }
    await transport.setMaxIncomingBitrate(maxIncomeBitrate)

    return {
      transport,
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      },
    }
  } catch (error) {
    console.error(
      'something went wrong while creating the webRtc transport:',
      error as any
    )
  }
}

export { createWebRtcTransport }
