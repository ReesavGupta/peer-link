import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { mediasoupRouter, producer } from './ws'

export async function setupRecordingForProducer() {
  if (!producer) {
    console.error('No producer available for recording.')
    return null
  }

  // Create a plain transport for FFmpeg to connect to
  const plainTransport = await mediasoupRouter.createPlainTransport({
    listenIp: { ip: '127.0.0.1', announcedIp: '127.0.0.1' },
    rtcpMux: false, // Disable RTCP muxing to get separate RTCP port
  })

  const { localIp, localPort } = plainTransport.tuple
  const rtcpTuple = plainTransport.rtcpTuple

  console.log(
    `Created plain transport with local RTP port: ${localPort}, RTCP port: ${
      rtcpTuple!.localPort
    }`
  )

  // Connect the transport
  const MIN_PORT = 20000
  const MAX_PORT = 30000

  function getRandomPort(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min
  }

  const remoteRtpPort = getRandomPort(MIN_PORT, MAX_PORT)
  const remoteRtcpPort = getRandomPort(MIN_PORT, MAX_PORT)

  plainTransport.connect({
    ip: '127.0.0.1',
    port: remoteRtpPort,
    rtcpPort: remoteRtcpPort,
  })

  // Debug packet flow - use the correct event
  plainTransport.on('trace', (trace) => {
    console.log(`Transport trace: ${JSON.stringify(trace)}`)
  })

  // Consume audio from the producer
  const rtpCapabilities = mediasoupRouter.rtpCapabilities
  const consumer = await plainTransport.consume({
    producerId: producer.id,
    rtpCapabilities,
    paused: false,
  })

  consumer.on('transportclose', () => {
    console.log('Transport closed for consumer')
  })

  consumer.on('producerclose', () => {
    console.log('Producer closed for consumer')
  })

  // Get codec info
  const audioCodec = producer.rtpParameters.codecs.find((c) =>
    c.mimeType.toLowerCase().startsWith('audio/')
  )
  if (!audioCodec) {
    console.error('No audio codec found in producer RTP parameters.')
    return null
  }

  const payloadType = audioCodec.payloadType
  const codecName = audioCodec.mimeType.split('/')[1].toLowerCase()
  const clockRate = audioCodec.clockRate
  const channels = audioCodec.channels || 2

  // Get RTP parameters for proper SSRC mapping
  const rtpParams = consumer.rtpParameters
  const encodings = rtpParams.encodings || [{ ssrc: 1000 }] // Default SSRC if not specified
  const ssrc = encodings[0].ssrc

  console.log(
    `Audio codec: ${codecName}, PT: ${payloadType}, Clock: ${clockRate}, Channels: ${channels}, SSRC: ${ssrc}`
  )

  // Generate a more complete SDP with SSRC information
  const sdpContent = `
v=0
o=- 0 0 IN IP4 ${localIp}
s=MediaSoup Recording
c=IN IP4 ${localIp}
t=0 0
m=audio ${localPort} RTP/AVP ${payloadType}
a=rtcp:${rtcpTuple!.localPort}
a=rtpmap:${payloadType} ${codecName}/${clockRate}/${channels}
a=ssrc:${ssrc} cname:mediasoup
a=recvonly
`.trim()

  console.log('Generated SDP:', sdpContent)

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

  // Allow some time for the transport to be ready
  await new Promise((resolve) => setTimeout(resolve, 1000))

  // Use correct FFmpeg parameters for RTP reception
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
    '-y', // Overwrite output file
    outputPath,
  ])

  // Set a reasonable timeout (e.g., 5 minutes)
  const ffmpegTimeout = setTimeout(() => {
    console.log('FFmpeg timeout reached, stopping recording')
    ffmpeg.kill('SIGINT')
  }, 5 * 60 * 1000)

  ffmpeg.stderr.on('data', (data) => {
    console.log(`FFmpeg stderr: ${data.toString()}`)
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
