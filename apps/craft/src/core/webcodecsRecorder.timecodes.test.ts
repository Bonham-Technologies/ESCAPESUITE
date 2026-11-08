// ESCSUITE-417: no two video frames of a take share a WebM timecode.
//
// The recorder declares 30 fps to Mediabunny (`addVideoTrack(…, { frameRate })`),
// and Mediabunny's Matroska muxer snaps every packet's timestamp to that grid
// (`roundToDivisor`). Two frames captured inside one 33 ms slot used to come
// out on one timecode. When the second was a key frame, the muxer could not
// start a Cluster on it — the Cluster in progress already held that timecode —
// so it sat mid-Cluster with no cue, and Chromium never completed a seek past
// it (ESCSUITE-412, `apps/e2e/fixtures/seek-wedge/README.md`).
//
// Every frame is now given a slot of its own: a frame whose slot is taken goes
// into the next one when that is at most one slot past its own, and is dropped
// when it is not, so a run of collisions can never push the video timeline
// ahead of the clock. Driven here through the MediaStreamTrackProcessor path,
// the one a Chrome/Edge take runs on, and — for the key-frame half — through
// the real Mediabunny muxer, whose Clusters and Cues are then read back.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type * as Mediabunny from 'mediabunny'
import { WebCodecsRecorder } from './webcodecs-recorder'
import type { RecordingConfig } from '../store/types'
import {
  installWebCodecsDoubles,
  uninstallWebCodecsDoubles,
  resetWebCodecsDoubles,
  lastVideoEncoder,
  VideoEncoderDouble,
  VideoFrameDouble,
  getCreatedFrames,
} from '../test/doubles/webcodecs'
import { getMediabunnyState, lastMediabunnyOutput, resetMediabunnyDouble } from '../test/doubles/mediabunny'
import { installAudioContextDouble, uninstallAudioContextDouble } from '../test/doubles/audio'
import {
  createTrackDouble,
  createStreamDouble,
  installTrackProcessorDouble,
  uninstallTrackProcessorDouble,
  type TrackProcessorControl,
} from '../test/doubles/mediastream'

vi.mock('mediabunny', async () => {
  const { createMediabunnyDouble } = await import('../test/doubles/mediabunny')
  return createMediabunnyDouble()
})

const SCREEN_ONLY: RecordingConfig = {
  screenEnabled: true,
  webcamEnabled: false,
  microphoneEnabled: false,
  systemAudioEnabled: false,
  countdownSeconds: 0,
  webcamPosition: 'bottom-right',
  webcamSize: 0.2,
  webcamShape: 'circle',
  separateTracks: false,
}

/** One slot of the 30 fps grid the recorder declares, in milliseconds. */
const SLOT_MS = 1000 / 30

/** The slot Mediabunny's muxer puts a timestamp in: its own `roundToDivisor(t, 30)`, as an index. */
function slotOf(timestampUs: number): number {
  return Math.round((timestampUs / 1e6) * 30)
}

async function flush(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve()
}

let now = 0
let startMs = 0
let processor: TrackProcessorControl
let recorder: WebCodecsRecorder

/** Start a screen-only take on the MediaStreamTrackProcessor path. */
async function startTake(): Promise<void> {
  await recorder.initialize(
    createStreamDouble([createTrackDouble('video', { id: 'screen-video' })]),
    null,
    null,
    SCREEN_ONLY
  )
  startMs = now
  recorder.start()
}

/** Deliver one source frame `offsetMs` after start(), on the recording clock. */
async function frameAt(offsetMs: number, trackId?: string): Promise<void> {
  now = startMs + offsetMs
  const frame = new VideoFrameDouble(`f${offsetMs}`, { timestamp: 0 })
  if (trackId) processor.pushFrameTo(trackId, frame)
  else processor.pushFrame(frame)
  await flush()
}

/** Every encode the screen encoder was handed: its stamp and whether it was a key frame. */
function encoded(encoder = lastVideoEncoder()): Array<{ timestamp: number; keyFrame: boolean }> {
  return encoder.encodes.map(e => ({ timestamp: e.data.timestamp!, keyFrame: e.options?.keyFrame === true }))
}

function expectEverySlotItsOwn(stamps: number[]): void {
  const slots = stamps.map(slotOf)
  for (let i = 1; i < slots.length; i++) {
    expect(
      slots[i],
      `frame ${i} (${stamps[i]} us) shares slot ${slots[i]} with frame ${i - 1} (${stamps[i - 1]} us)`
    ).toBeGreaterThan(slots[i - 1])
  }
}

beforeEach(() => {
  now = 100_000
  installWebCodecsDoubles()
  resetWebCodecsDoubles()
  resetMediabunnyDouble()
  installAudioContextDouble()
  processor = installTrackProcessorDouble()
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame
  recorder = new WebCodecsRecorder({})
})

afterEach(() => {
  recorder.dispose()
  uninstallTrackProcessorDouble()
  uninstallAudioContextDouble()
  uninstallWebCodecsDoubles()
  vi.restoreAllMocks()
})

describe('every frame gets a 30 fps slot of its own (ESCSUITE-417)', () => {
  it('moves a frame captured inside the slot of the frame before it into the next slot', async () => {
    await startTake()
    // 50 ms and 77 ms are 27 ms apart — past the 26.7 ms throttle — and both
    // in slot 2 (1.5 and 2.31 slots).
    for (const offset of [0, 50, 77]) await frameAt(offset)

    expect(encoded().map(e => e.timestamp)).toEqual([0, 50_000, 100_000])
    expect(encoded().map(e => slotOf(e.timestamp))).toEqual([0, 2, 3])
  })

  it('gives a key frame its own slot when it is captured inside the slot of the delta before it', async () => {
    await startTake()
    for (let k = 0; k <= 28; k++) await frameAt(k * SLOT_MS)
    // The shape of the CI take ESCSUITE-412 kept: a delta at 983.5 ms and the
    // second's key frame at 1010.5 ms, 27 ms apart and both in slot 30.
    await frameAt(983.5)
    await frameAt(1010.5)

    const [delta, key] = encoded().slice(-2)
    expect(delta).toEqual({ timestamp: 983_500, keyFrame: false })
    expect(key.keyFrame).toBe(true)
    expect(slotOf(delta.timestamp)).toBe(30)
    expect(slotOf(key.timestamp)).toBe(31)
    expect(key.timestamp).toBe(1_033_333)
    expectEverySlotItsOwn(encoded().map(e => e.timestamp))
  })

  it('does not let a run of collisions push the video ahead of the clock', async () => {
    // A source at 36 fps for 20 s: every frame clears the throttle, and there
    // are six frames for every five slots, so a collision every few frames.
    // Moving each colliding frame on a slot without a limit would put the
    // video 1.2 s further ahead of its sound every second.
    await startTake()
    const intervalMs = 1000 / 36
    const captured: number[] = []
    for (let k = 0; k * intervalMs <= 20_000; k++) {
      captured.push(k * intervalMs)
      await frameAt(k * intervalMs)
    }

    const frames = encoded()
    const stamps = frames.map(f => f.timestamp)
    expectEverySlotItsOwn(stamps)
    // No frame is stamped more than one slot past the slot it was captured in
    // (so at most 1.5 slots, 50 ms, after its capture), so the lead can never
    // build, and none before its capture.
    const sources = lastVideoEncoder().encodes.map(e => (e.data.source as VideoFrameDouble).source as string)
    for (const [i, source] of sources.entries()) {
      const capturedUs = Math.round(Number(source.slice(1)) * 1000)
      expect(slotOf(stamps[i]) - slotOf(capturedUs), `frame ${i}`).toBeLessThanOrEqual(1)
      expect(stamps[i], `frame ${i}`).toBeGreaterThanOrEqual(capturedUs)
    }
    // The last frame is within a slot of the clock that captured it: twenty
    // seconds of collisions left no lead behind.
    expect(slotOf(stamps.at(-1)!)).toBeLessThanOrEqual(slotOf(Math.round(captured.at(-1)! * 1000)) + 1)
    // At most one frame a slot made it into the take — slots 0 to 601, the
    // last one a slot past the 20 s capture — and every one that did not was
    // closed.
    expect(frames.length).toBeLessThanOrEqual(20 * 30 + 2)
    expect(frames.length).toBeGreaterThanOrEqual(20 * 30 - 1)
    expect(getCreatedFrames('VideoFrame').every(f => f.closed)).toBe(true)
    // Still a key frame once a second.
    expect(frames.filter(f => f.keyFrame).length).toBeGreaterThanOrEqual(20)
    expect(frames.filter(f => f.keyFrame).length).toBeLessThanOrEqual(21)
    expect(captured.length).toBeGreaterThan(frames.length)
  })

  it("gives the webcam companion's frames slots of their own as well", async () => {
    await recorder.initialize(
      createStreamDouble([createTrackDouble('video', { id: 'screen-video' })]),
      createStreamDouble([createTrackDouble('video', { id: 'webcam-video', settings: { width: 640, height: 480 } })]),
      null,
      { ...SCREEN_ONLY, webcamEnabled: true, separateTracks: true }
    )
    startMs = now
    recorder.start()
    for (const offset of [0, 50, 77]) await frameAt(offset, 'webcam-video')

    const webcam = VideoEncoderDouble.instances.find(e => e !== VideoEncoderDouble.instances[0])!
    expect(encoded(webcam).map(e => slotOf(e.timestamp))).toEqual([0, 2, 3])
  })
})

// ---------------------------------------------------------------------------
// The muxer's half: the packets the recorder hands Mediabunny, written by the
// real Mediabunny with the very track options the recorder gave it, and read
// back as Clusters and Cues.

const CLUSTER_ID = 0x1f43b675
const CUES_ID = 0x1c53bb6b
const SEGMENT_ID = 0x18538067

interface Element {
  id: number
  start: number
  dataStart: number
  end: number
}

function vint(bytes: Uint8Array, at: number, keepMarker: boolean): { value: number; length: number } {
  const first = bytes[at]
  let length = 1
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++
  let value = keepMarker ? first : first & ((0x80 >> (length - 1)) - 1)
  for (let i = 1; i < length; i++) value = value * 256 + bytes[at + i]
  return { value, length }
}

function elementAt(bytes: Uint8Array, at: number): Element {
  const id = vint(bytes, at, true)
  const size = vint(bytes, at + id.length, false)
  const dataStart = at + id.length + size.length
  const unknown = size.value === 2 ** (7 * size.length) - 1
  return { id: id.value, start: at, dataStart, end: unknown ? bytes.length : dataStart + size.value }
}

function childrenOf(bytes: Uint8Array, parent: Element): Element[] {
  const out: Element[] = []
  for (let at = parent.dataStart; at < Math.min(parent.end, bytes.length); ) {
    const child = elementAt(bytes, at)
    out.push(child)
    at = child.end
  }
  return out
}

function uintOf(bytes: Uint8Array, element: Element): number {
  let value = 0
  for (let i = element.dataStart; i < element.end; i++) value = value * 256 + bytes[i]
  return value
}

interface Block {
  track: number
  time: number
  key: boolean
}

/** Every Cluster's offset (from the Segment's data) and SimpleBlocks, and every CuePoint. */
function readClustersAndCues(bytes: Uint8Array) {
  const ebml = elementAt(bytes, 0)
  const segment = elementAt(bytes, ebml.end)
  expect(segment.id).toBe(SEGMENT_ID)
  const clusters: Array<{ position: number; blocks: Block[] }> = []
  const cues: Array<{ time: number; track: number; clusterPosition: number }> = []
  for (const element of childrenOf(bytes, segment)) {
    if (element.id === CLUSTER_ID) {
      let clusterTime = 0
      const blocks: Block[] = []
      for (const child of childrenOf(bytes, element)) {
        if (child.id === 0xe7) clusterTime = uintOf(bytes, child)
        if (child.id === 0xa3) {
          const track = vint(bytes, child.dataStart, false)
          const raw = (bytes[child.dataStart + track.length] << 8) | bytes[child.dataStart + track.length + 1]
          const relative = raw > 0x7fff ? raw - 0x10000 : raw
          const key = (bytes[child.dataStart + track.length + 2] & 0x80) !== 0
          blocks.push({ track: track.value, time: clusterTime + relative, key })
        }
      }
      clusters.push({ position: element.start - segment.dataStart, blocks })
    }
    if (element.id === CUES_ID) {
      for (const point of childrenOf(bytes, element)) {
        const fields = childrenOf(bytes, point)
        const time = uintOf(bytes, fields.find(f => f.id === 0xb3)!)
        for (const positions of fields.filter(f => f.id === 0xb7)) {
          const field = (id: number) => uintOf(bytes, childrenOf(bytes, positions).find(f => f.id === id)!)
          cues.push({ time, track: field(0xf7), clusterPosition: field(0xf1) })
        }
      }
    }
  }
  return { clusters, cues }
}

/**
 * Mux the video packets the recorder handed its (double) Mediabunny output
 * through the real library, with the recorder's own `addVideoTrack` options
 * and output-format options, beside an Opus track of 20 ms packets from 0 the
 * way a take's microphone has one.
 */
async function muxForReal(): Promise<Uint8Array> {
  const real = await vi.importActual<typeof Mediabunny>('mediabunny')
  const output = new real.Output({
    format: new real.WebMOutputFormat(getMediabunnyState().formats[0].options as Mediabunny.WebMOutputFormatOptions),
    target: new real.BufferTarget(),
  })
  const video = new real.EncodedVideoPacketSource('vp9')
  output.addVideoTrack(video, lastMediabunnyOutput().tracks[0].options as Mediabunny.VideoTrackMetadata)
  const audio = new real.EncodedAudioPacketSource('opus')
  output.addAudioTrack(audio)
  await output.start()

  const chunks = getMediabunnyState().videoSources[0].packets.map(
    p => (p.packet as { chunk: { type: 'key' | 'delta'; timestamp: number; duration: number | null } }).chunk
  )
  const endUs = chunks.at(-1)!.timestamp
  const videoPackets = chunks.map(
    c => new real.EncodedPacket(new Uint8Array([1, 2, 3]), c.type, c.timestamp / 1e6, (c.duration ?? 0) / 1e6)
  )
  const audioPackets: Mediabunny.EncodedPacket[] = []
  for (let us = 0; us <= endUs; us += 20_000) {
    audioPackets.push(new real.EncodedPacket(new Uint8Array([4, 5]), 'key', us / 1e6, 0.02))
  }
  // Fed in timestamp order, as the two encoders deliver them live.
  let v = 0
  let a = 0
  while (v < videoPackets.length || a < audioPackets.length) {
    if (a >= audioPackets.length || (v < videoPackets.length && videoPackets[v].timestamp <= audioPackets[a].timestamp)) {
      await video.add(videoPackets[v], v === 0 ? { decoderConfig: { codec: 'vp09.00.10.08', codedWidth: 64, codedHeight: 64 } } : undefined)
      v++
    } else {
      await audio.add(audioPackets[a], a === 0 ? { decoderConfig: { codec: 'opus', numberOfChannels: 2, sampleRate: 48000 } } : undefined)
      a++
    }
  }
  video.close()
  audio.close()
  await output.finalize()
  return new Uint8Array((output.target as Mediabunny.BufferTarget).buffer!)
}

describe("a take's key frames each start a Cluster and have a cue (ESCSUITE-417)", () => {
  it('holds under capture jitter that puts a key frame inside the slot of the delta before it', async () => {
    await startTake()
    // Every second for five seconds, a delta 16 ms before the whole second
    // and the next frame 12 ms after it: 28 ms apart, both in the slot on the
    // second, and the second of them due to be the key frame. Frames 33 ms
    // apart in between.
    await frameAt(0)
    for (let second = 1; second <= 5; second++) {
      const base = second * 1000
      for (let t = base - 1000 + 45; t <= base - 50; t += 33) await frameAt(t)
      await frameAt(base - 16)
      await frameAt(base + 12)
    }
    await frameAt(5045)

    const bytes = await muxForReal()
    const { clusters, cues } = readClustersAndCues(bytes)
    const videoBlocks = clusters.flatMap(c => c.blocks.filter(b => b.track === 1))
    expect(videoBlocks.length).toBe(encoded().length)

    const times = videoBlocks.map(b => b.time)
    expect(new Set(times).size, `video timecodes ${times.join(', ')}`).toBe(times.length)

    const keys = clusters.flatMap(c => c.blocks.filter(b => b.track === 1 && b.key).map(b => ({ cluster: c, block: b })))
    expect(keys.length).toBeGreaterThanOrEqual(6)
    for (const { cluster, block } of keys) {
      const firstVideo = cluster.blocks.find(b => b.track === 1)
      expect(firstVideo, `the key frame at ${block.time} ms is not the first video frame of its Cluster`).toBe(block)
      expect(
        cues.some(c => c.track === 1 && c.time === block.time && c.clusterPosition === cluster.position),
        `the key frame at ${block.time} ms has no cue`
      ).toBe(true)
    }
  })
})
