import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
import {
  Output,
  StreamTarget,
  WebMOutputFormat,
  EncodedVideoPacketSource,
  EncodedAudioPacketSource,
  EncodedPacket,
  Input,
  BufferSource,
  WEBM,
  EncodedPacketSink,
  type StreamTargetChunk,
} from 'mediabunny'
import { fixWebMMetadata } from './converter'
import { trimToWholeBlocks } from './webmTrim'
import { buildWebM, PIP_SPEC, readCues, bytesOf } from '../test/webmFixture'

/**
 * The whole recovery repair over REAL containers (ESCSUITE-466): Mediabunny's
 * own WebM muxer writing through a `StreamTarget` exactly as the WebCodecs
 * recorder does, cut off before `finalize()` as a crash would leave it, then
 * `trimToWholeBlocks()` and the real `fixWebMMetadata()`, read back with
 * Mediabunny's demuxer. No `vi.mock` here.
 *
 * Node's Blob and an unpooled Buffer for the reason `webmRepair.test.ts`
 * gives: the real `webm-duration-fix` needs both.
 */
const jsdomBlob = globalThis.Blob
const poolSize = Buffer.poolSize
beforeAll(() => {
  globalThis.Blob = NodeBlob as unknown as typeof Blob
  Buffer.poolSize = 0
})
afterAll(() => {
  globalThis.Blob = jsdomBlob
  Buffer.poolSize = poolSize
})

/** A file that a StreamTarget writes into, at positions, the way OPFS does. */
class DiskDouble {
  bytes = new Uint8Array(0)
  writable(): WritableStream<StreamTargetChunk> {
    return new WritableStream<StreamTargetChunk>({
      write: (chunk) => {
        const end = chunk.position + chunk.data.byteLength
        if (end > this.bytes.length) {
          const grown = new Uint8Array(end)
          grown.set(this.bytes)
          this.bytes = grown
        }
        this.bytes.set(chunk.data, chunk.position)
      },
    })
  }
  snapshot(): Uint8Array<ArrayBuffer> {
    return this.bytes.slice()
  }
}

const FPS = 30
const VIDEO_CONFIG = { codec: 'vp09.00.10.08', codedWidth: 64, codedHeight: 36 }
const AUDIO_CONFIG = { codec: 'opus', sampleRate: 48000, numberOfChannels: 2 }

/**
 * Record `seconds` of fake VP9 (a keyframe every second) and 20 ms Opus
 * packets through Mediabunny, and return the bytes on "disk" at `crashAt`
 * seconds (before finalize) plus the finalized file.
 */
async function muxTake(seconds: number, crashAt: number, withAudio = true) {
  const disk = new DiskDouble()
  const output = new Output({ format: new WebMOutputFormat(), target: new StreamTarget(disk.writable()) })
  const video = new EncodedVideoPacketSource('vp9')
  output.addVideoTrack(video, { frameRate: FPS })
  const audio = new EncodedAudioPacketSource('opus')
  if (withAudio) output.addAudioTrack(audio)
  await output.start()
  let crashed: Uint8Array<ArrayBuffer> | null = null
  const frameCount = seconds * FPS
  let audioTime = 0
  for (let i = 0; i < frameCount; i++) {
    const t = i / FPS
    const payload = new Uint8Array(200).fill(i % 256)
    await video.add(
      new EncodedPacket(payload, i % FPS === 0 ? 'key' : 'delta', t, 1 / FPS),
      i === 0 ? { decoderConfig: VIDEO_CONFIG } : undefined
    )
    while (withAudio && audioTime < t + 1 / FPS) {
      await audio.add(
        new EncodedPacket(new Uint8Array(40).fill(7), 'key', audioTime, 0.02),
        audioTime === 0 ? { decoderConfig: AUDIO_CONFIG } : undefined
      )
      audioTime += 0.02
    }
    if (crashed === null && t >= crashAt) crashed = disk.snapshot()
  }
  await output.finalize()
  return { crashed: crashed ?? disk.snapshot(), finalized: disk.snapshot() }
}

async function demux(blob: Blob) {
  // A view: Mediabunny's `instanceof ArrayBuffer` fails across jsdom's realm, `isView` does not.
  const bytes = Buffer.from(await blob.arrayBuffer())
  const input = new Input({ source: new BufferSource(bytes), formats: [WEBM] })
  const duration = await input.computeDuration()
  const videoTrack = (await input.getPrimaryVideoTrack())!
  let videoPackets = 0
  for await (const packet of new EncodedPacketSink(videoTrack).packets()) {
    void packet
    videoPackets++
  }
  const audioTrack = await input.getPrimaryAudioTrack()
  return { duration, videoPackets, hasAudio: audioTrack !== null }
}

describe('recovering a Mediabunny take cut off before finalize', () => {
  it('trims, repairs and reads back with video, audio, Duration and Cues', async () => {
    const { crashed } = await muxTake(6, 4)
    const trimmed = await trimToWholeBlocks(new Blob([crashed], { type: 'video/webm' }))
    expect(trimmed).not.toBeNull()
    expect(trimmed!.lastBlockSeconds).toBeGreaterThan(2.5)
    expect(trimmed!.lastBlockSeconds).toBeLessThanOrEqual(4.1)

    const repaired = await fixWebMMetadata(trimmed!.blob)
    const out = await bytesOf(repaired)
    const cues = readCues(out)
    expect(cues.hasDuration).toBe(true)
    expect(cues.points.length).toBeGreaterThan(0)

    const read = await demux(repaired)
    expect(read.hasAudio).toBe(true)
    expect(read.videoPackets).toBeGreaterThan(60)
    expect(Math.abs(read.duration - trimmed!.lastBlockSeconds)).toBeLessThan(0.2)
  })

  it('recovers whatever whole blocks remain when the cut lands inside a cluster', async () => {
    const { crashed } = await muxTake(4, 3)
    // A power cut: the last flush never landed, so the file stops mid-cluster.
    const cut = crashed.slice(0, crashed.length - 37)
    const trimmed = await trimToWholeBlocks(new Blob([cut], { type: 'video/webm' }))
    expect(trimmed).not.toBeNull()
    const read = await demux(await fixWebMMetadata(trimmed!.blob))
    expect(read.videoPackets).toBeGreaterThan(0)
    expect(read.duration).toBeGreaterThan(1)
  })

  it('treats a finalized file the same way, dropping its trailing Cues for the repair to rewrite', async () => {
    const { finalized } = await muxTake(3, 99)
    const trimmed = await trimToWholeBlocks(new Blob([finalized], { type: 'video/webm' }))
    const repaired = await fixWebMMetadata(trimmed!.blob)
    const read = await demux(repaired)
    expect(read.videoPackets).toBe(90)
    expect(read.duration).toBeGreaterThan(2.9)
  })

  it('recovers a video-only take and an audio-only one', async () => {
    const { crashed } = await muxTake(3, 2, false)
    const trimmed = await trimToWholeBlocks(new Blob([crashed], { type: 'video/webm' }))
    const read = await demux(await fixWebMMetadata(trimmed!.blob))
    expect(read.hasAudio).toBe(false)
    expect(read.videoPackets).toBeGreaterThan(0)
  })
})

describe('recovering a MediaRecorder-shaped stream cut off mid-take', () => {
  it('cuts a live (unknown-size) stream at every length and repairs what is whole', async () => {
    const fixture = buildWebM({ ...PIP_SPEC, cues: 'none' })
    let recovered = 0
    for (let length = 0; length <= fixture.bytes.length; length += 7) {
      const trimmed = await trimToWholeBlocks(
        new Blob([fixture.bytes.slice(0, length)], { type: 'video/webm' })
      )
      if (!trimmed) continue
      recovered++
      const repaired = await bytesOf(await fixWebMMetadata(trimmed.blob))
      expect(readCues(repaired).hasDuration).toBe(true)
    }
    expect(recovered).toBeGreaterThan(0)
  })
})
