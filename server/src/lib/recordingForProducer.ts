import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { mediasoupRouter, producer } from './ws'
import type {
  MediaKind,
  RtpParameters,
} from 'mediasoup/node/lib/rtpParametersTypes'
import type { PlainTransport, Producer } from 'mediasoup/node/lib/types'

// Utility function to get codec info (similar to what's in utils.js in the demo)
function getCodecInfoFromRtpParameters(
  kind: MediaKind,
  rtpParameters: RtpParameters
) {
  let codecInfo: {
    payloadType: number
    codecName: string
    clockRate: number
    channels: number
  } = {
    payloadType: 0,
    codecName: '',
    clockRate: 0,
    channels: 0,
  }

  // Find the first codec of matching kind
  const codec = rtpParameters.codecs.find((c) =>
    kind === 'audio'
      ? c.mimeType.toLowerCase().includes('audio')
      : c.mimeType.toLowerCase().includes('video')
  )

  if (!codec) {
    throw new Error(`No ${kind} codec found`)
  }

  codecInfo.payloadType = codec.payloadType
  codecInfo.codecName = codec.mimeType.split('/')[1].toLowerCase()
  codecInfo.clockRate = codec.clockRate

  if (kind === 'audio') {
    codecInfo.channels = codec.channels || 2
  }

  return codecInfo
}

// Create SDP text (similar to sdp.js in the demo)
function createSdpText(producer: Producer, plainTransport: PlainTransport) {
  const { localIp, localPort } = plainTransport.tuple

  // Audio codec info
  const audioCodecInfo = getCodecInfoFromRtpParameters(
    'audio',
    producer.rtpParameters
  )

  // Create SDP for audio only
  return `v=0
o=- 0 0 IN IP4 127.0.0.1
s=MediaSoup Recording
c=IN IP4 127.0.0.1
t=0 0
m=audio ${localPort} RTP/AVP ${audioCodecInfo.payloadType}
a=rtpmap:${audioCodecInfo.payloadType} ${audioCodecInfo.codecName}/${audioCodecInfo.clockRate}/${audioCodecInfo.channels}
a=recvonly`
}

export async function setupRecordingForProducer() {
  if (!producer) {
    console.error('No producer available for recording.')
    return null
  }

  // Create a plain transport for FFmpeg to receive from
  const plainTransport = await mediasoupRouter.createPlainTransport({
    listenIp: { ip: '0.0.0.0', announcedIp: '127.0.0.1' },
    rtcpMux: true,
    comedia: false,
  })

  const { localIp, localPort } = plainTransport.tuple
  console.log(`Created plain transport with local RTP port: ${localPort}`)

  // Create an SDP file for FFmpeg
  const sdpContent = createSdpText(producer, plainTransport)
  console.log('Generated SDP:', sdpContent)

  // Create a consumer to pipe the producer's audio to our plainTransport
  const consumer = await plainTransport.consume({
    producerId: producer.id,
    rtpCapabilities: mediasoupRouter.rtpCapabilities,
    paused: false,
  })

  // Connect the plain transport to where FFmpeg will be sending RTP
  // We're not actually using this connection since FFmpeg is receiving only
  await plainTransport.connect({
    ip: '127.0.0.1',
    port: localPort,
  })

  // Setup directories and files
  const outputDir = path.resolve(__dirname, '../../public/recordings')
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  // Create a unique filename
  const timestamp = Date.now()
  const outputPath = path.join(outputDir, `recording_${timestamp}.mp3`)
  const sdpFilePath = path.join(os.tmpdir(), `recording_${timestamp}.sdp`)

  // Write SDP to file
  fs.writeFileSync(sdpFilePath, sdpContent)
  console.log(`SDP file written to ${sdpFilePath}`)

  // Wait for the transport to be ready
  await new Promise((resolve) => setTimeout(resolve, 1000))

  // FFmpeg command
  const ffmpeg = spawn('ffmpeg', [
    '-loglevel',
    'debug',
    '-protocol_whitelist',
    'file,udp,rtp',
    '-i',
    sdpFilePath,
    '-acodec',
    'libmp3lame',
    '-b:a',
    '128k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-y',
    outputPath,
  ])

  // Set a timeout
  const ffmpegTimeout = setTimeout(() => {
    console.log('FFmpeg timeout reached, stopping recording')
    ffmpeg.kill('SIGINT')
  }, 10 * 60 * 1000) // 10 minutes

  ffmpeg.stderr.on('data', (data) => {
    console.error(`FFmpeg stderr: ${data.toString()}`)
  })

  ffmpeg.stdout.on('data', (data) => {
    console.log(`FFmpeg stdout: ${data.toString()}`)
  })

  ffmpeg.on('error', (error) => {
    console.error('FFmpeg process error:', error)
    clearTimeout(ffmpegTimeout)
  })

  ffmpeg.on('exit', (code, signal) => {
    clearTimeout(ffmpegTimeout)
    console.log(`FFmpeg exited with code ${code}, signal ${signal}`)

    // Clean up
    if (fs.existsSync(sdpFilePath)) {
      fs.unlinkSync(sdpFilePath)
    }

    // Check if recording was successful
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath)
      console.log(`Output file size: ${stats.size} bytes`)
      if (stats.size === 0) {
        console.error('Output file is empty, recording failed')
        fs.unlinkSync(outputPath)
      } else {
        console.log(`Recording saved to ${outputPath}`)
      }
    } else {
      console.error('Output file was not created')
    }
  })

  console.log(`Recording started for producer ${producer.id}`)

  return {
    plainTransport,
    consumer,
    ffmpeg,
    outputPath,
    cleanup: () => {
      clearTimeout(ffmpegTimeout)
      ffmpeg.kill('SIGINT')
      if (plainTransport) plainTransport.close()
    },
  }
}
