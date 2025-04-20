import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import type { ChildProcessWithoutNullStreams } from 'child_process'
import { mediasoupRouter, producer } from './ws'
import type {
  MediaKind,
  RtpParameters,
} from 'mediasoup/node/lib/rtpParametersTypes'
import type {
  PlainTransport,
  Producer,
  Consumer,
} from 'mediasoup/node/lib/types'

// Enhanced port management system
const usedPorts = new Map<
  number,
  { inUse: boolean; releaseTimer?: NodeJS.Timeout }
>()
const PORT_RANGE_START = 50000
const PORT_RANGE_END = 51000
const PORT_RELEASE_DELAY = 2000 // ms to wait before reusing a port

// Track active recordings by producer ID
const activeRecordings = new Map<
  string,
  {
    plainTransport: PlainTransport
    consumer: Consumer
    ffmpeg: ChildProcessWithoutNullStreams
    outputPath: string
    port: number
    cleanup: () => void
  }
>()

// Check if a port is available at the OS level
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const dgram = require('dgram')
    const server = dgram.createSocket('udp4')

    server.on('error', () => {
      resolve(false)
      server.close()
    })

    // Use a timeout to prevent hanging
    const timeout = setTimeout(() => {
      resolve(false)
      try {
        server.close()
      } catch (e) {}
    }, 500)

    server.bind(port, () => {
      clearTimeout(timeout)
      server.close()
      resolve(true)
    })
  })
}

// Function to find an available UDP port with better validation
async function findAvailablePort(start: number, end: number): Promise<number> {
  for (let port = start; port <= end; port++) {
    // Skip if port is already marked as in use
    if (usedPorts.get(port)?.inUse) continue

    // Check if port is available at OS level
    if (await isPortAvailable(port)) {
      // Mark port as in use before returning
      usedPorts.set(port, { inUse: true })
      console.log(`Reserved port ${port} for recording`)
      return port
    }
  }
  throw new Error(`No available ports in range ${start}-${end}`)
}

// Release a port with proper cleanup
function releasePort(port: number) {
  const portInfo = usedPorts.get(port)
  if (!portInfo) return

  // Clear any existing release timer
  if (portInfo.releaseTimer) {
    clearTimeout(portInfo.releaseTimer)
  }

  // Set a new release timer
  const releaseTimer = setTimeout(() => {
    usedPorts.delete(port)
    console.log(`Released port ${port}`)
  }, PORT_RELEASE_DELAY)

  // Mark port as preparing for release
  usedPorts.set(port, {
    inUse: true,
    releaseTimer: releaseTimer as NodeJS.Timeout,
  })
  console.log(`Marked port ${port} for release`)
}

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

// Improved FFmpeg spawning with better error handling
function spawnFFmpeg(sdpFilePath: string, outputPath: string, port: number) {
  console.log(`Starting FFmpeg process to record from port ${port}`)

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

  // Improved error handling
  let startupCompleted = false
  const startupTimeout = setTimeout(() => {
    if (!startupCompleted) {
      console.error('FFmpeg startup timeout, process might be hanging')
      ffmpeg.kill('SIGKILL')
    }
  }, 10000) // 10 seconds startup timeout

  ffmpeg.stderr.on('data', (data) => {
    const message = data.toString()

    // Check for successful startup indicators
    if (message.includes('Output #0') || message.includes('encoder setup')) {
      startupCompleted = true
      clearTimeout(startupTimeout)
    }

    // Check for binding errors
    if (message.includes('bind failed') || message.includes('Error number')) {
      console.error(`FFmpeg port ${port} binding error: ${message}`)
      // Consider this a fatal error
      ffmpeg.kill('SIGKILL')
    }

    // Log only if debug enabled or error
    if (
      message.includes('Error') ||
      message.includes('error') ||
      process.env.DEBUG
    ) {
      console.error(`FFmpeg stderr: ${message}`)
    }
  })

  // Handle process termination
  ffmpeg.on('exit', (code, signal) => {
    clearTimeout(startupTimeout)
    console.log(`FFmpeg exited with code ${code}, signal ${signal}`)
  })

  return ffmpeg
}

export async function setupRecordingForProducer(specifiedProducer?: Producer) {
  // Use the specified producer or the global one
  const targetProducer = specifiedProducer || producer

  if (!targetProducer) {
    console.error('No producer available for recording.')
    return null
  }

  // Check if this producer is already being recorded
  if (activeRecordings.has(targetProducer.id)) {
    console.log(`Producer ${targetProducer.id} is already being recorded`)
    return activeRecordings.get(targetProducer.id)
  }

  // Create a unique ID for this recording session
  const sessionId = `${targetProducer.id}_${Date.now()}_${Math.floor(
    Math.random() * 1000
  )}`

  try {
    // Try multiple ports if necessary
    let ffmpegPort: number | undefined
    let attempts = 0
    const maxAttempts = 5

    while (attempts < maxAttempts) {
      try {
        ffmpegPort = await findAvailablePort(PORT_RANGE_START, PORT_RANGE_END)
        console.log(`this is the available port : ${ffmpegPort}`)
        break // If we get here, we found a port
      } catch (err) {
        attempts++
        console.warn(
          `Port finding attempt ${attempts} failed: ${(err as any).message}`
        )
        if (attempts >= maxAttempts) throw err
        await new Promise((r) => setTimeout(r, 200)) // Short delay before retry
      }
    }
    // console.log(`Found available port for FFmpeg: ${ffmpegPort}`)
    // @ts-ignore
    if (ffmpegPort !== undefined) {
      console.log(`Found available port for FFmpeg: ${ffmpegPort}`)
    }
    // Create a plain transport for MediaSoup
    const plainTransportPort = await findAvailablePort(
      PORT_RANGE_START,
      PORT_RANGE_END
    )
    const plainTransport = await mediasoupRouter.createPlainTransport({
      listenIp: { ip: '127.0.0.1', announcedIp: '127.0.0.1' },
      rtcpMux: true, // Enable RTCP multiplexing to simplify setup
      port: plainTransportPort,
    })

    console.log(`Created plain transport: ${plainTransport.id}`)

    // Create a consumer to pipe the producer's audio to our plainTransport
    const consumer = await plainTransport.consume({
      producerId: targetProducer.id,
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
      port: ffmpegPort ?? -1, // Use a default value or handle undefined
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
    const producerCopy = {
      ...targetProducer,
      rtpParameters: { ...targetProducer.rtpParameters },
    }
    producerCopy.rtpParameters.codecs = [...targetProducer.rtpParameters.codecs] // Deep copy the codecs array
    producerCopy.rtpParameters.codecs[0] = {
      ...producerCopy.rtpParameters.codecs[0],
      payloadType: consumerCodecInfo.payloadType,
    }

    const sdpContent = createSdpText(
      producerCopy as Producer,
      plainTransport,
      ffmpegPort!
    )
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

    // Start FFmpeg with enhanced error handling
    const ffmpeg = spawnFFmpeg(sdpFilePath, outputPath, ffmpegPort!)

    // Set a timeout for the recording
    const ffmpegTimeout = setTimeout(() => {
      console.log('FFmpeg timeout reached, stopping recording')
      ffmpeg.kill('SIGINT')
    }, 10 * 60 * 1000) // 10 minutes

    // Setup cleanup function
    const cleanup = () => {
      clearTimeout(ffmpegTimeout)
      ffmpeg.kill('SIGINT')

      // Remove from active recordings
      activeRecordings.delete(targetProducer.id)

      // Close transport if not already closed
      if (plainTransport && !plainTransport.closed) {
        plainTransport.close()
      }

      // Release the port
      releasePort(ffmpegPort!)

      // Clean up SDP file
      try {
        if (fs.existsSync(sdpFilePath)) {
          fs.unlinkSync(sdpFilePath)
        }
      } catch (err) {
        console.error('Error deleting SDP file:', err)
      }
    }

    // Add exit handler
    ffmpeg.on('exit', (code, signal) => {
      // Try to check if the file was created successfully
      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath)
        console.log(`Output file size: ${stats.size} bytes`)
        if (stats.size === 0) {
          console.error('Output file is empty, recording failed')
          try {
            fs.unlinkSync(outputPath)
          } catch (err) {
            console.error('Error deleting empty output file:', err)
          }
        } else {
          console.log(`Recording saved to ${outputPath}`)
        }
      } else {
        console.error('Output file was not created')
      }

      // Clean up
      cleanup()
    })

    console.log(`Recording started for producer ${targetProducer.id}`)

    // Create recording info object
    const recordingInfo = {
      plainTransport,
      consumer,
      ffmpeg,
      outputPath,
      port: ffmpegPort!,
      cleanup,
    }

    // Store in active recordings map
    activeRecordings.set(targetProducer.id, recordingInfo)

    return recordingInfo
  } catch (error) {
    console.error('Error setting up recording:', error)

    // Make sure to clean up any allocated resources on error
    // if (ffmpegPort !== undefined) {
    //   releasePort(ffmpegPort)
    // }

    return null
  }
}
