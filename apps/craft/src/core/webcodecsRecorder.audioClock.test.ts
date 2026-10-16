// ESCSUITE-296: a WebCodecs take's audio and video advance on one clock.
//
// Downstream users reported audio that drifts further from the picture the
// longer a take runs. The recorder stamped its two tracks from two clocks —
// video from `performance.now()`, audio from a running count of the samples
// `onaudioprocess` delivered divided by a constant 48000 — and nothing
// compared them. Every lost callback took 85.3 ms out of the audio timeline,
// every ppm the audio device's crystal ran fast put the audio further behind,
// and a context that did not run at 48 kHz drifted 8.1 % and mislabelled its
// own samples. (This suite began as the hunt's probe,
// `webcodecsRecorder.audioDrift.probe.test.ts`, which it replaces.)
//
// Each case drives a real `WebCodecsRecorder` through the doubles in wall-time
// order — `performance.now` spied, video frames pushed through the track
// processor double, 4096-sample buffers fired at the simulated render rate with
// the `playbackTime` a real `AudioProcessingEvent` carries — and asserts the
// one invariant a synced file needs: at the end of the take the audio and the
// video timelines have advanced by the same amount, within one audio buffer
// plus one video frame.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebCodecsRecorder } from './webcodecs-recorder'
import type { RecordingConfig } from '../store/types'
import {
  installWebCodecsDoubles,
  uninstallWebCodecsDoubles,
  resetWebCodecsDoubles,
  lastVideoEncoder,
  VideoFrameDouble,
  AudioEncoderDouble,
  forgetCreatedFrames,
  type EncoderDouble,
} from '../test/doubles/webcodecs'
import { resetMediabunnyDouble } from '../test/doubles/mediabunny'
import {
  installAudioContextDouble,
  uninstallAudioContextDouble,
  lastAudioContext,
  createAudioBufferDouble,
  outputClockContextTime,
  type AudioContextDoubleControl,
  type OutputClockDouble,
  type ScriptProcessorDouble,
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
const SEPARATE_TRACKS: RecordingConfig = { ...CONFIG, webcamEnabled: true, separateTracks: true }

/** One audio buffer at `rate`, plus one 30 fps frame, in µs. */
function toleranceUs(rate = 48000): number {
  return (BUFFER / rate) * 1e6 + 1e6 / 30
}

async function flush(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve()
}

/** What one audio pipeline encoded, tallied as it goes (a long take is tens of thousands of buffers). */
interface AudioTally {
  /** AudioData encoded. */
  count: number
  /** Of those, the ones that are silence the recorder made up (every sample 0). */
  zeros: number
  /** End of the last AudioData: its stamp plus its length at its own rate, µs. */
  endUs: number
  /** Every `sampleRate` an AudioData carried. */
  rates: Set<number>
}

function newTally(): AudioTally {
  return { count: 0, zeros: 0, endUs: 0, rates: new Set() }
}

function tallyAudio(encoder: EncoderDouble, tally: AudioTally): void {
  for (const { data } of encoder.encodes) {
    const init = data.init as { timestamp: number; numberOfFrames: number; sampleRate: number }
    tally.count++
    if ((data.source as Float32Array).every(v => v === 0)) tally.zeros++
    tally.endUs = init.timestamp + (init.numberOfFrames / init.sampleRate) * 1e6
    tally.rates.add(init.sampleRate)
  }
  encoder.encodes.length = 0
}

let now = 0
let audio: AudioContextDoubleControl
let processor: TrackProcessorControl
let recorder: WebCodecsRecorder

/** A real buffer: never all-zero, so made-up silence can be told apart. */
function realBuffer(rate = 48000): AudioBufferDouble {
  return createAudioBufferDouble({ length: BUFFER, sampleRate: rate, sample: () => 0.25 })
}

async function initialize(config: RecordingConfig = CONFIG): Promise<void> {
  await recorder.initialize(
    createStreamDouble([createTrackDouble('video', { id: 'screen' })]),
    config.separateTracks
      ? createStreamDouble([
          createTrackDouble('video', { id: 'webcam', settings: { width: 640, height: 480 } }),
        ])
      : null,
    createStreamDouble([createTrackDouble('audio', { id: 'mic' })]),
    config
  )
}

interface TakeShape {
  /** Wall-clock length of the take, seconds. */
  seconds: number
  /** The rate the context really runs at (and its buffers carry). */
  contextRate?: number
  /** ε: the render clock's context seconds per wall second, minus one. */
  skew?: number
  /** Give the context a usable `getOutputTimestamp()`. */
  outputClock?: boolean
  /** Events carry `playbackTime`, as a real AudioProcessingEvent does. Default true. */
  playbackTime?: boolean
  /** Drop every Nth audio callback (never delivered to the page). */
  dropEvery?: number
  /** A video frame every this many wall seconds. Default 1. */
  videoEvery?: number
}

interface TakeResult {
  videoEndUs: number
  mix: AudioTally
  delivered: number
  dropped: number
  /** Context seconds elapsed between start() and the last video frame, µs. */
  contextElapsedUs: number
}

/**
 * Drive one take through the recorder in wall-time order. Buffer k (from 1)
 * covers context time [start + (k-1)·B/rate, start + k·B/rate), carries the
 * first of those as its `playbackTime`, and reaches the page when the render
 * clock gets to its end.
 */
async function recordTake(shape: TakeShape): Promise<TakeResult> {
  const rate = shape.contextRate ?? 48000
  const clock: OutputClockDouble = { skew: shape.skew ?? 0, offsetSeconds: 1000 }
  if (shape.contextRate) audio.contextSampleRate = shape.contextRate
  if (shape.outputClock) audio.outputClock = clock

  await initialize()
  const node = lastAudioContext().scriptProcessors[0]
  const buffer = realBuffer(rate)
  const mix = newTally()
  let videoEndUs = -1

  const startMs = now
  const contextAtStart = outputClockContextTime(clock, startMs)
  recorder.start()

  const endMs = shape.seconds * 1000
  const bufferSeconds = BUFFER / rate
  const videoPeriodMs = (shape.videoEvery ?? 1) * 1000
  let k = 1
  let nextVideo = 0
  let delivered = 0
  let dropped = 0
  const audioAt = (n: number) => ((n * bufferSeconds) / (1 + clock.skew)) * 1000

  while (audioAt(k) <= endMs || nextVideo <= endMs) {
    if (nextVideo <= audioAt(k)) {
      now = startMs + nextVideo
      processor.pushFrame(new VideoFrameDouble(`f${nextVideo}`, { timestamp: 0 }))
      await flush()
      const encodes = lastVideoEncoder().encodes
      videoEndUs = encodes.at(-1)!.data.timestamp!
      encodes.length = 0
      nextVideo += videoPeriodMs
    } else {
      now = startMs + audioAt(k)
      if (shape.dropEvery && k % shape.dropEvery === 0) {
        dropped++
      } else {
        const playbackTime = contextAtStart + (k - 1) * bufferSeconds
        node.onaudioprocess!(
          shape.playbackTime === false ? { inputBuffer: buffer } : { inputBuffer: buffer, playbackTime }
        )
        delivered++
        tallyAudio(AudioEncoderDouble.instances[0], mix)
      }
      k++
    }
    forgetCreatedFrames()
  }

  const lastVideoMs = nextVideo - videoPeriodMs
  return {
    videoEndUs,
    mix,
    delivered,
    dropped,
    contextElapsedUs: (outputClockContextTime(clock, startMs + lastVideoMs) - contextAtStart) * 1e6,
  }
}

/** Every `console.warn` that names a sample rate. */
function rateWarnings(): unknown[][] {
  return vi.mocked(console.warn).mock.calls.filter(args => String(args[0]).includes(' Hz'))
}

beforeEach(() => {
  now = 100_000
  installWebCodecsDoubles()
  resetWebCodecsDoubles()
  resetMediabunnyDouble()
  audio = installAudioContextDouble()
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

describe('audio and video timelines advance together over a long take', () => {
  it('control — a perfect 48 kHz render clock, every callback delivered (10 min)', async () => {
    const r = await recordTake({ seconds: 600 })
    expect(Math.abs(r.mix.endUs - r.videoEndUs)).toBeLessThanOrEqual(toleranceUs())
    expect(r.mix.zeros).toBe(0)
    expect(r.mix.count).toBe(r.delivered)
    // The context ran at the rate it was asked for: nothing to say.
    expect(rateWarnings()).toHaveLength(0)
  }, 60_000)

  it('fills each onaudioprocess the page never saw with silence (one in 200 lost, 10 min)', async () => {
    const r = await recordTake({ seconds: 600, dropEvery: 200 })
    // Each lost callback used to take 4096 samples out of the audio timeline:
    // 85.3 ms per loss, every later sound stamped that much before its picture.
    expect(r.dropped).toBeGreaterThan(30)
    expect(Math.abs(r.mix.endUs - r.videoEndUs)).toBeLessThanOrEqual(toleranceUs())
    // Exactly one buffer of silence per lost callback, and nothing else.
    expect(r.mix.zeros).toBe(r.dropped)
    expect(r.mix.count).toBe(r.delivered + r.dropped)
  }, 60_000)

  it('without playbackTime nothing is filled: one AudioData per callback, as before (the perf law path)', async () => {
    const r = await recordTake({ seconds: 60, dropEvery: 200, playbackTime: false })
    expect(r.dropped).toBeGreaterThan(0)
    expect(r.mix.zeros).toBe(0)
    expect(r.mix.count).toBe(r.delivered)
  }, 60_000)

  it('stamps video in context time: a render clock 100 ppm fast (60 min)', async () => {
    const r = await recordTake({ seconds: 3600, skew: 1e-4, outputClock: true, videoEvery: 10 })
    // The last frame sits at the elapsed *context* time — 3600.36 s, not the
    // 3600 s of performance.now() — which is where the audio count is too.
    expect(Math.abs(r.videoEndUs - r.contextElapsedUs)).toBeLessThanOrEqual(1000)
    expect(Math.abs(r.mix.endUs - r.videoEndUs)).toBeLessThanOrEqual(toleranceUs())
  }, 120_000)

  it('uses the rate the context really runs at: 44.1 kHz although 48 kHz was asked for (10 min)', async () => {
    const r = await recordTake({ seconds: 600, contextRate: 44100 })
    expect([...r.mix.rates]).toEqual([44100])
    expect(lastAudioContext().sampleRate).toBe(44100)
    expect(AudioEncoderDouble.instances[0].configureCalls[0]).toMatchObject({ sampleRate: 44100 })
    expect(Math.abs(r.mix.endUs - r.videoEndUs)).toBeLessThanOrEqual(toleranceUs(44100))
    // The 48 kHz request is still made, and the engine ignoring it is said once.
    const warnings = rateWarnings()
    expect(warnings).toHaveLength(1)
    expect(String(warnings[0][0])).toContain('44100')
  }, 60_000)

  it('separate tracks: the microphone companion loses callbacks the mix does not (10 min)', async () => {
    await initialize(SEPARATE_TRACKS)
    const [mixNode, micNode] = lastAudioContext().scriptProcessors
    const buffer = realBuffer()
    const startMs = now
    recorder.start()

    const bufferSeconds = BUFFER / 48000
    const mixTally = newTally()
    const micTally = newTally()
    let micDropped = 0
    for (let k = 1; k * bufferSeconds <= 600; k++) {
      now = startMs + k * bufferSeconds * 1000
      const event = { inputBuffer: buffer, playbackTime: 1000 + (k - 1) * bufferSeconds }
      mixNode.onaudioprocess!(event)
      if (k % 200 === 0) micDropped++
      else micNode.onaudioprocess!(event)
      const [mix, mic] = AudioEncoderDouble.instances
      tallyAudio(mix, mixTally)
      tallyAudio(mic, micTally)
      forgetCreatedFrames()
    }

    expect(micDropped).toBeGreaterThan(30)
    expect(Math.abs(micTally.endUs - mixTally.endUs)).toBeLessThanOrEqual((BUFFER / 48000) * 1e6)
    expect(micTally.zeros).toBe(micDropped)
    expect(mixTally.zeros).toBe(0)
  }, 60_000)
})

describe('the video clock', () => {
  /** Frames at these wall offsets (ms) after start(); returns their stamps. */
  async function stampsAt(offsetsMs: number[], midTake?: () => void): Promise<number[]> {
    await initialize()
    const startMs = now
    recorder.start()
    for (const [i, offset] of offsetsMs.entries()) {
      if (i === 1) midTake?.()
      now = startMs + offset
      processor.pushFrame(new VideoFrameDouble(`f${offset}`, { timestamp: 0 }))
      await flush()
    }
    return lastVideoEncoder().encodes.map(e => e.data.timestamp!)
  }

  /** A render clock running half again as fast as performance.now(), so the two are easy to tell apart. */
  const FAST: OutputClockDouble = { skew: 0.5, offsetSeconds: 1000 }

  it('reads context time from getOutputTimestamp() when it is usable', async () => {
    audio.outputClock = { ...FAST }
    expect(await stampsAt([0, 2000, 4000])).toEqual([0, 3_000_000, 6_000_000])
    expect(lastAudioContext().getOutputTimestamp).toHaveBeenCalled()
  })

  it('falls back to performance.now() when the context has no getOutputTimestamp()', async () => {
    expect(await stampsAt([0, 2000, 4000])).toEqual([0, 2_000_000, 4_000_000])
    expect(lastAudioContext().getOutputTimestamp).toBeUndefined()
  })

  it('falls back to performance.now() when getOutputTimestamp() reports zeros (the context has not rendered)', async () => {
    audio.outputClock = { ...FAST, report: { contextTime: 0, performanceTime: 0 } }
    expect(await stampsAt([0, 2000, 4000])).toEqual([0, 2_000_000, 4_000_000])
  })

  it('falls back to performance.now() when contextTime is not finite', async () => {
    audio.outputClock = { ...FAST, report: { contextTime: Infinity, performanceTime: 100_000 } }
    expect(await stampsAt([0, 2000, 4000])).toEqual([0, 2_000_000, 4_000_000])
  })

  it('falls back to performance.now() when performanceTime is not finite', async () => {
    audio.outputClock = { ...FAST, report: { contextTime: 1100, performanceTime: NaN } }
    expect(await stampsAt([0, 2000, 4000])).toEqual([0, 2_000_000, 4_000_000])
  })

  it('re-reads the context clock every ~2 s, extrapolating on performance.now() in between', async () => {
    // 1 s after the anchor: extrapolated at wall rate. 3 s: re-read, so the
    // context's own 4.5 s.
    audio.outputClock = { ...FAST }
    expect(await stampsAt([0, 1000, 3000])).toEqual([0, 1_000_000, 4_500_000])
    // start() and the one refresh.
    expect(lastAudioContext().getOutputTimestamp).toHaveBeenCalledTimes(2)
  })

  it('keeps the last good anchor when a refresh is unusable', async () => {
    const clock: OutputClockDouble = { ...FAST }
    audio.outputClock = clock
    const stamps = await stampsAt([0, 1000, 3000], () => {
      clock.report = { contextTime: 0, performanceTime: 0 }
    })
    // The 3 s frame refreshed into zeros and extrapolated from start()'s anchor.
    expect(stamps).toEqual([0, 1_000_000, 3_000_000])
  })
})

describe('pause and resume', () => {
  it('excludes paused context time from the video, fills nothing across the pause, and the tracks agree after', async () => {
    const clock: OutputClockDouble = { skew: 0.5, offsetSeconds: 1000 }
    audio.outputClock = clock
    await initialize()
    const node: ScriptProcessorDouble = lastAudioContext().scriptProcessors[0]
    const buffer = realBuffer()
    const mix = newTally()
    const startMs = now
    const contextAtStart = outputClockContextTime(clock, startMs)
    recorder.start()

    const bufferSeconds = BUFFER / 48000
    /** Deliver every buffer the render clock finishes up to `untilMs` after start. */
    let k = 1
    const deliverUntil = (untilMs: number) => {
      while (((k * bufferSeconds) / 1.5) * 1000 <= untilMs) {
        now = startMs + ((k * bufferSeconds) / 1.5) * 1000
        node.onaudioprocess!({ inputBuffer: buffer, playbackTime: contextAtStart + (k - 1) * bufferSeconds })
        tallyAudio(AudioEncoderDouble.instances[0], mix)
        k++
      }
    }
    const frameAt = async (offsetMs: number) => {
      now = startMs + offsetMs
      processor.pushFrame(new VideoFrameDouble(`f${offsetMs}`, { timestamp: 0 }))
      await flush()
    }

    await frameAt(0)
    deliverUntil(2000)
    now = startMs + 2000
    recorder.pause()
    // The context keeps rendering through the pause; the page drops it all.
    deliverUntil(7000)
    now = startMs + 7000
    recorder.resume()
    deliverUntil(8000)
    await frameAt(8000)

    // Context time runs 1.5x: 12 s elapsed, 7.5 s of it paused.
    expect(lastVideoEncoder().encodes.map(e => e.data.timestamp)).toEqual([0, 4_500_000])
    // The 7.5 s jump in playbackTime at the resume is the pause, not a loss.
    expect(mix.zeros).toBe(0)
    expect(Math.abs(mix.endUs - 4_500_000)).toBeLessThanOrEqual(toleranceUs())
  })
})
