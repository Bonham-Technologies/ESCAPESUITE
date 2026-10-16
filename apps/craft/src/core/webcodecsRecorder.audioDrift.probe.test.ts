// PROBE (hunt/craft-audio-drift): downstream adopters report audio that drifts
// further from the picture the longer a take runs.
//
// `WebCodecsRecorder` stamps its two tracks from two different clocks:
//
// - video: `performance.now()` at the moment a frame is read
//   (`nextFrameTiming`), i.e. the system's monotonic wall clock;
// - audio: a running count of the samples `onaudioprocess` has handed over,
//   divided by a *constant* 48000 (`setupAudioCapture`, and the identical
//   arithmetic in each audio companion) — i.e. the AudioContext's render
//   clock, as seen through however many callbacks actually reached the page.
//
// Those agree only while the render clock runs at exactly 48000 samples per
// wall second and every 4096-sample buffer reaches the main thread. Each case
// below simulates a take with a fixed pattern of real-world audio delivery and
// asserts the one invariant a synced file needs: at the end of the take, the
// audio timeline and the video timeline have advanced by the same amount of
// wall time, within one audio buffer plus one video frame. The control case
// (a perfect clock) is green; every red case is a mechanism by which the
// recorder's arithmetic turns a property of the audio clock into linear drift.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebCodecsRecorder } from './webcodecs-recorder'
import type { RecordingConfig } from '../store/types'
import {
  installWebCodecsDoubles,
  uninstallWebCodecsDoubles,
  resetWebCodecsDoubles,
  lastVideoEncoder,
  lastAudioEncoder,
  VideoFrameDouble,
  AudioEncoderDouble,
} from '../test/doubles/webcodecs'
import { resetMediabunnyDouble } from '../test/doubles/mediabunny'
import {
  installAudioContextDouble,
  uninstallAudioContextDouble,
  lastAudioContext,
  createAudioBufferDouble,
  AudioContextDoubleInstance,
  type AudioBufferDouble,
} from '../test/doubles/audio'
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

const BUFFER = 4096
const CONFIG: RecordingConfig = {
  screenEnabled: true,
  webcamEnabled: false,
  microphoneEnabled: true,
  systemAudioEnabled: false,
  countdownSeconds: 0,
  webcamPosition: 'bottom-right',
  webcamSize: 0.2,
  webcamShape: 'circle',
  separateTracks: false,
}

/** One audio buffer (85.3 ms at 48 kHz) plus one 30 fps frame. */
const TOLERANCE_US = (BUFFER / 48000) * 1e6 + 1e6 / 30

/** End of one encoded AudioData, µs: its stamp plus its length at 48 kHz. */
function audioEnd(init: unknown): number {
  const { timestamp, numberOfFrames } = init as { timestamp: number; numberOfFrames: number }
  return timestamp + (numberOfFrames / 48000) * 1e6
}

async function flush(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve()
}

let now = 0
let processor: TrackProcessorControl
let recorder: WebCodecsRecorder

interface TakeShape {
  /** Wall-clock length of the take, seconds. */
  seconds: number
  /** Samples per *wall* second the AudioContext really renders. */
  renderRate: number
  /** The `sampleRate` the context reports (and its buffers carry). */
  reportedRate?: number
  /** Drop every Nth audio callback (never delivered to the page). */
  dropEvery?: number
  /** A video frame every this many wall seconds. */
  videoEvery?: number
}

/**
 * Drive one take through the recorder in wall-time order and return the last
 * video timestamp and the end of the last audio buffer, both in µs.
 */
async function recordTake(shape: TakeShape): Promise<{ videoEndUs: number; audioEndUs: number; wallUs: number }> {
  const reported = shape.reportedRate ?? 48000
  if (reported !== 48000) {
    // A browser that ignores `new AudioContext({ sampleRate: 48000 })` and
    // runs the context at the device rate instead.
    const g = globalThis as unknown as Record<string, unknown>
    g.AudioContext = class extends AudioContextDoubleInstance {
      constructor(options?: { sampleRate?: number }) {
        super(options)
        ;(this as { sampleRate: number }).sampleRate = reported
      }
    }
  }

  await recorder.initialize(
    createStreamDouble([createTrackDouble('video', { id: 'screen' })]),
    null,
    createStreamDouble([createTrackDouble('audio', { id: 'mic' })]),
    CONFIG
  )
  const node = lastAudioContext().scriptProcessors[0]
  const buffer: AudioBufferDouble = createAudioBufferDouble({
    length: BUFFER,
    sampleRate: reported,
    sample: () => 0,
  })

  const startMs = now
  recorder.start()

  const endMs = shape.seconds * 1000
  const audioPeriodMs = (BUFFER / shape.renderRate) * 1000
  const videoPeriodMs = (shape.videoEvery ?? 1) * 1000
  let nextAudio = audioPeriodMs
  let nextVideo = 0
  let callback = 0

  while (nextAudio <= endMs || nextVideo <= endMs) {
    if (nextVideo <= nextAudio) {
      now = startMs + nextVideo
      processor.pushFrame(new VideoFrameDouble(`f${nextVideo}`, { timestamp: 0 }))
      await flush()
      nextVideo += videoPeriodMs
    } else {
      now = startMs + nextAudio
      callback++
      if (!shape.dropEvery || callback % shape.dropEvery !== 0) {
        node.onaudioprocess!({ inputBuffer: buffer })
      }
      nextAudio += audioPeriodMs
    }
  }

  const videoEncodes = lastVideoEncoder().encodes
  const audioEncodes = lastAudioEncoder().encodes
  return {
    videoEndUs: videoEncodes.at(-1)!.data.timestamp!,
    audioEndUs: audioEnd(audioEncodes.at(-1)!.data.init!),
    wallUs: endMs * 1000,
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

describe('PROBE: audio and video timelines advance together over a long take', () => {
  it('control — a perfect 48 kHz render clock, every callback delivered (10 min)', async () => {
    const r = await recordTake({ seconds: 600, renderRate: 48000 })
    expect(Math.abs(r.audioEndUs - r.videoEndUs)).toBeLessThanOrEqual(TOLERANCE_US)
  }, 60_000)

  it('H1a — one onaudioprocess in 200 never reaches the page (10 min)', async () => {
    const r = await recordTake({ seconds: 600, renderRate: 48000, dropEvery: 200 })
    // Each lost callback is 4096 samples the count never sees: the audio
    // timeline falls behind the wall clock by 85.3 ms per loss, and every
    // later sound is stamped that much earlier than its picture.
    expect(Math.abs(r.audioEndUs - r.videoEndUs)).toBeLessThanOrEqual(TOLERANCE_US)
  }, 60_000)

  it('H1b — the audio device clock runs 100 ppm fast against performance.now() (60 min)', async () => {
    const r = await recordTake({ seconds: 3600, renderRate: 48000 * 1.0001, videoEvery: 10 })
    expect(Math.abs(r.audioEndUs - r.videoEndUs)).toBeLessThanOrEqual(TOLERANCE_US)
  }, 120_000)

  it('H3 — the context runs at 44.1 kHz although 48 kHz was asked for (10 min)', async () => {
    const r = await recordTake({ seconds: 600, renderRate: 44100, reportedRate: 44100 })
    // The count divides 44.1 kHz samples by a constant 48000.
    expect(Math.abs(r.audioEndUs - r.videoEndUs)).toBeLessThanOrEqual(TOLERANCE_US)
  }, 60_000)

  it('H1a, separate tracks — the microphone companion loses callbacks the mix does not (10 min)', async () => {
    // Two ScriptProcessorNodes on one context, each counting its own
    // callbacks: a loss on one is invisible to the other, so the mic file and
    // the primary's mix (and both against the picture) come apart.
    await recorder.initialize(
      createStreamDouble([createTrackDouble('video', { id: 'screen' })]),
      createStreamDouble([
        createTrackDouble('video', { id: 'webcam', settings: { width: 640, height: 480 } }),
      ]),
      createStreamDouble([createTrackDouble('audio', { id: 'mic' })]),
      { ...CONFIG, webcamEnabled: true, separateTracks: true }
    )
    const [mixNode, micNode] = lastAudioContext().scriptProcessors
    const buffer = createAudioBufferDouble({ length: BUFFER, sample: () => 0 })
    const startMs = now
    recorder.start()

    const periodMs = (BUFFER / 48000) * 1000
    let callback = 0
    for (let t = periodMs; t <= 600_000; t += periodMs) {
      now = startMs + t
      callback++
      mixNode.onaudioprocess!({ inputBuffer: buffer })
      if (callback % 200 !== 0) micNode.onaudioprocess!({ inputBuffer: buffer })
    }

    const end = (encoder: AudioEncoderDouble) => audioEnd(encoder.encodes.at(-1)!.data.init!)
    const [mix, mic] = AudioEncoderDouble.instances
    expect(Math.abs(end(mic) - end(mix))).toBeLessThanOrEqual(TOLERANCE_US)
  }, 60_000)
})
