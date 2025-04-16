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
function createSdpText(
  producer: Producer,
  plainTransport: PlainTransport,
  ffmpegPort: number
) {
  const { localIp } = plainTransport.tuple

  // Use a specific port for FFmpeg to receive on, different from the MediaSoup port
  const rtpPort = ffmpegPort

  // Get the actual payload type from the producer's parameters
  const audioCodecInfo = getCodecInfoFromRtpParameters(
    'audio',
    producer.rtpParameters
  )

  console.log(
    'Producer RTP parameters:',
    JSON.stringify(producer.rtpParameters, null, 2)
  )
  console.log('Using audio codec:', JSON.stringify(audioCodecInfo, null, 2))

  // Create SDP for audio only
  return `v=0
o=- 0 0 IN IP4 0.0.0.0
s=MediaSoup Recording
c=IN IP4 ${localIp}
t=0 0
m=audio ${rtpPort} RTP/AVP ${audioCodecInfo.payloadType}
a=rtpmap:${audioCodecInfo.payloadType} ${audioCodecInfo.codecName}/${audioCodecInfo.clockRate}/${audioCodecInfo.channels}
a=recvonly`
}

// Function to find an available UDP port
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const dgram = require('dgram')
    const server = dgram.createSocket('udp4')

    server.on('error', () => {
      resolve(false)
      server.close()
    })

    server.bind(port, () => {
      server.close()
      resolve(true)
    })
  })
}

// Find an available port in a range
async function findAvailablePort(start: number, end: number): Promise<number> {
  for (let port = start; port <= end; port++) {
    if (await isPortAvailable(port)) {
      return port
    }
  }
  throw new Error(`No available ports in range ${start}-${end}`)
}

export async function setupRecordingForProducer() {
  if (!producer) {
    console.error('No producer available for recording.')
    return null
  }

  // Create a unique ID for this recording session
  const sessionId = Date.now()

  try {
    // Find an available port for FFmpeg to receive RTP packets on
    const ffmpegPort = await findAvailablePort(50000, 50100)
    console.log(`Found available port for FFmpeg: ${ffmpegPort}`)

    // Create a plain transport for MediaSoup
    const plainTransport = await mediasoupRouter.createPlainTransport({
      listenIp: { ip: '0.0.0.0', announcedIp: '127.0.0.1' },
      rtcpMux: true, // Enable RTCP multiplexing to simplify setup
    })

    console.log(`Created plain transport: ${plainTransport.id}`)

    // Create a consumer to pipe the producer's audio to our plainTransport
    const consumer = await plainTransport.consume({
      producerId: producer.id,
      rtpCapabilities: mediasoupRouter.rtpCapabilities,
      paused: false,
    })

    console.log(
      'Consumer created with RTP parameters:',
      JSON.stringify(consumer.rtpParameters, null, 2)
    )

    // Connect the plainTransport to send RTP to the FFmpeg port
    await plainTransport.connect({
      ip: '127.0.0.1',
      port: ffmpegPort,
    })

    console.log(
      `Connected plain transport to send RTP to 127.0.0.1:${ffmpegPort}`
    )

    // Create an SDP file for FFmpeg using our selected port and the ACTUAL consumer payload type
    const consumerCodecInfo = getCodecInfoFromRtpParameters(
      'audio',
      consumer.rtpParameters
    )

    // Override the producer's payload type with the consumer's payload type
    // This ensures the SDP matches what's actually being sent
    producer.rtpParameters.codecs[0].payloadType = consumerCodecInfo.payloadType

    const sdpContent = createSdpText(producer, plainTransport, ffmpegPort)
    console.log('Generated SDP:', sdpContent)

    // Setup directories and files
    const outputDir = path.resolve(__dirname, '../../public/recordings')
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    // Create a unique filename
    const outputPath = path.join(outputDir, `recording_${sessionId}.mp3`)
    const sdpFilePath = path.join(os.tmpdir(), `recording_${sessionId}.sdp`)

    // Write SDP to file
    fs.writeFileSync(sdpFilePath, sdpContent)
    console.log(`SDP file written to ${sdpFilePath}`)

    // Give a short delay to ensure everything is setup
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // FFmpeg command - using the SDP file instead of direct RTP parameters
    // This is more reliable as it includes all the codec details
    const ffmpeg = spawn('ffmpeg', [
      '-loglevel',
      'debug',
      '-protocol_whitelist',
      'file,udp,rtp',
      '-i',
      sdpFilePath, // Use the SDP file instead of direct RTP connection
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
      const message = data.toString()
      console.error(`FFmpeg stderr: ${message}`)

      // If we see a connection error, we can log more details
      if (message.includes('bind failed') || message.includes('Error number')) {
        console.error(
          'FFmpeg connection error detected. Make sure no other process is using port:',
          ffmpegPort
        )
      }
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
      try {
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
      } catch (err) {
        console.error('Cleanup error:', err)
      }

      // Close the transport and consumer if they haven't been closed yet
      if (plainTransport && !plainTransport.closed) {
        plainTransport.close()
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
        if (plainTransport && !plainTransport.closed) plainTransport.close()
      },
    }
  } catch (error) {
    console.error('Error setting up recording:', error)
    return null
  }
}
