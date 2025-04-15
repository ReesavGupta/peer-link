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
    rtcpMux: true, // Changed to true for simplicity
    comedia: true, // FFmpeg will initiate the connection
  })

  console.log(
    `Created plain transport with local ports - RTP: ${plainTransport.tuple.localPort}, RTCP: ${plainTransport.rtcpTuple?.localPort}`
  )

  // Add debug listeners
  // plainTransport.on('rtcptuple', () => {
  //   console.log('RTCP packet received on plain transport')
  // })

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

  const { localIp, localPort } = plainTransport.tuple
  const rtcpPort = plainTransport.rtcpTuple?.localPort || localPort + 1

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

  console.log(
    `Audio codec: ${codecName}, PT: ${payloadType}, Clock: ${clockRate}, Channels: ${channels}`
  )

  // Generate improved SDP
  const sdpContent = `
v=0
o=- 0 0 IN IP4 ${localIp}
s=MediaSoup Recording
c=IN IP4 ${localIp}
t=0 0
m=audio ${localPort} RTP/AVP ${payloadType}
c=IN IP4 ${localIp}
a=rtpmap:${payloadType} ${codecName}/${clockRate}/${channels}
a=recvonly
a=rtcp:${rtcpPort}
`.trim()

  console.log('Generated SDP:', sdpContent)

  const sdpFilePath = path.join(os.tmpdir(), `${producer.id}.sdp`)
  fs.writeFileSync(sdpFilePath, sdpContent)
  console.log(`SDP file written to ${sdpFilePath}`)

  const outputDir = path.resolve(__dirname, '../../public/recordings')
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }
  const outputPath = path.join(outputDir, `${producer.id}_${Date.now()}.mp3`)

  // Improved FFmpeg command
  const ffmpeg = spawn('ffmpeg', [
    '-loglevel',
    'debug',
    '-protocol_whitelist',
    'file,udp,rtp',
    '-i',
    sdpFilePath,
    '-map',
    '0:a',
    '-c:a',
    'libmp3lame',
    '-q:a',
    '2',
    '-ar',
    '48000', // Ensure correct sample rate
    '-ac',
    '2', // Set channels explicitly
    '-b:a',
    '128k', // Set bitrate
    '-flush_packets',
    '1', // Flush packets more frequently
    outputPath,
  ])

  // Set a timeout to ensure FFmpeg runs for at least some time
  const ffmpegTimeout = setTimeout(() => {
    console.log('FFmpeg timeout reached, stopping recording')
    ffmpeg.kill('SIGTERM')
  }, 30000) // 30 seconds

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

    // Clean up SDP file
    if (fs.existsSync(sdpFilePath)) {
      fs.unlinkSync(sdpFilePath)
    }

    // Check if the output file was created and has content
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath)
      console.log(`Output file size: ${stats.size} bytes`)
      if (stats.size === 0) {
        console.error('Output file is empty, recording failed')
        fs.unlinkSync(outputPath)
      }
    } else {
      console.error('Output file was not created')
    }
  })

  return {
    plainTransport,
    consumer,
    ffmpeg,
    outputPath,
  }
}
