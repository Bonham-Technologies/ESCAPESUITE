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
  scriptProcessorPlaybackTime,
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
  /** Frames of made-up silence, all told. */
  zeroFrames: number
  /** End of the last AudioData: its stamp plus its length at its own rate, µs. */
  endUs: number
  /** Every `sampleRate` an AudioData carried. */
  rates: Set<number>
}

function newTally(): AudioTally {
  return { count: 0, zeros: 0, zeroFrames: 0, endUs: 0, rates: new Set() }
}

function tallyAudio(encoder: EncoderDouble, tally: AudioTally): void {
  for (const { data } of encoder.encodes) {
    const init = data.init as { timestamp: number; numberOfFrames: number; sampleRate: number }
    tally.count++
    if ((data.source as Float32Array).every(v => v === 0)) {
      tally.zeros++
      tally.zeroFrames += init.numberOfFrames
    }
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
    createStreamDouble([
      createTrackDouble('video', { id: 'screen' }),
      ...(config.systemAudioEnabled ? [createTrackDouble('audio', { id: 'system' })] : []),
    ]),
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
  /** Drop exactly these callbacks (1-based). */
  drop?: (k: number) => boolean
  /**
   * How late, in seconds, the main thread dispatches callback k — and its
   * `playbackTime` read at dispatch (`scriptProcessorPlaybackTime`). Events
   * queue first in, first out, so one delivered after a hang drags those
   * behind it to the same moment. Unset: every event on time, `playbackTime`
   * the buffer's exact position.
   */
  dispatchDelay?: (k: number) => number
  /**
   * Lose one 128-sample render quantum of content every this many seconds:
   * the delivered count falls behind the engine's render position a quantum
   * at a time, which is how the rig saw a real loss arrive on its jank take.
   */
  creepEvery?: number
  /**
   * Where the event's reference time comes from. `'playbackTime'` (default):
   * the event carries it. `'currentTime'`: it does not, and the context's
   * `currentTime` — read at dispatch, rounded down to a render quantum — is
   * the only clock there is.
   */
  reference?: 'playbackTime' | 'currentTime'
  /** A video frame every this many wall seconds. Default 1. */
  videoEvery?: number
}

/** A seeded uniform [0, 1) — the same jitter on every run. */
function seededRandom(seed = 1): () => number {
  let state = seed
  return () => (state = (state * 16807) % 2147483647) / 2147483647
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
  const quantum = 128 / rate
  /** Content lost by the time buffer n is delivered, in seconds. */
  const creepAt = (n: number) =>
    shape.creepEvery ? Math.floor((n * bufferSeconds) / shape.creepEvery) * quantum : 0
  const audioAt = (n: number) => (((n * bufferSeconds + creepAt(n)) / (1 + clock.skew)) * 1000)
  if (shape.reference === 'currentTime') {
    audio.currentTimeAt = performanceTime =>
      Math.floor(
        ((contextAtStart + ((performanceTime - startMs) / 1000) * (1 + clock.skew)) * rate) / 128 + 1e-9
      ) * quantum
  }
  const isDropped = (n: number) =>
    Boolean((shape.dropEvery && n % shape.dropEvery === 0) || shape.drop?.(n))
  let lastDispatchMs = -Infinity
  /** Wall ms (after start) at which callback n reaches the page, or would have. */
  const dispatchAt = (n: number) => {
    const ready = audioAt(n)
    if (isDropped(n) || !shape.dispatchDelay) return ready
    return Math.max(ready + (shape.dispatchDelay(n) * 1000) / (1 + clock.skew), lastDispatchMs)
  }
  let audioMs = dispatchAt(1)

  while (audioMs <= endMs || nextVideo <= endMs) {
    if (nextVideo <= audioMs) {
      now = startMs + nextVideo
      processor.pushFrame(new VideoFrameDouble(`f${nextVideo}`, { timestamp: 0 }))
      await flush()
      const encodes = lastVideoEncoder().encodes
      videoEndUs = encodes.at(-1)!.data.timestamp!
      encodes.length = 0
      nextVideo += videoPeriodMs
    } else {
      now = startMs + audioMs
      if (isDropped(k)) {
        dropped++
      } else {
        const playbackTime = scriptProcessorPlaybackTime(
          contextAtStart + (k - 1) * bufferSeconds + creepAt(k),
          rate,
          ((audioMs - audioAt(k)) / 1000) * (1 + clock.skew)
        )
        node.onaudioprocess!(
          shape.playbackTime === false || shape.reference === 'currentTime'
            ? { inputBuffer: buffer }
            : { inputBuffer: buffer, playbackTime }
        )
        delivered++
        lastDispatchMs = audioMs
        tallyAudio(AudioEncoderDouble.instances[0], mix)
      }
      k++
      audioMs = dispatchAt(k)
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
    // Losses stop a window before the end, so every one has been judged by then.
    const r = await recordTake({ seconds: 600, drop: k => k % 200 === 0 && k * (BUFFER / 48000) < 590 })
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
      if (k % 200 === 0 && k * bufferSeconds < 590) micDropped++
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

describe('a context at a rate the Opus encoder refuses', () => {
  it('fails the take at initialize() instead of recording it silent', async () => {
    audio.contextSampleRate = 44100
    AudioEncoderDouble.supportPlan = config => (config as { sampleRate: number }).sampleRate === 48000
    await expect(initialize()).rejects.toThrow('44100 Hz')
    // No audio encoder was ever built.
    expect(AudioEncoderDouble.instances).toHaveLength(0)
  })
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
    expect(console.log).toHaveBeenCalledWith('Video stamped in audio-context time')
  })

  it('falls back to performance.now() when the context has no getOutputTimestamp()', async () => {
    expect(await stampsAt([0, 2000, 4000])).toEqual([0, 2_000_000, 4_000_000])
    expect(lastAudioContext().getOutputTimestamp).toBeUndefined()
    expect(console.log).toHaveBeenCalledWith(
      'Video stamped in performance.now() time (no usable audio-context clock)'
    )
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
    deliverUntil(9000)
    // Two seconds after the resume's own reading, so this frame re-reads the
    // context clock rather than extrapolating on performance.now().
    await frameAt(9000)

    // Context time runs 1.5x: 13.5 s elapsed, 7.5 s of it paused.
    expect(lastVideoEncoder().encodes.map(e => e.data.timestamp)).toEqual([0, 6_000_000])
    // The 7.5 s jump in playbackTime at the resume is the pause, not a loss.
    expect(mix.zeros).toBe(0)
    expect(Math.abs(mix.endUs - 6_000_000)).toBeLessThanOrEqual(toleranceUs())
  })

  it('separate tracks: every audio pipeline re-anchors at a resume, so none fills the pause', async () => {
    await initialize(SEPARATE_TRACKS)
    const [mixNode, micNode] = lastAudioContext().scriptProcessors
    const buffer = realBuffer()
    recorder.start()
    const bufferSeconds = BUFFER / 48000
    const mixTally = newTally()
    const micTally = newTally()
    const deliver = (from: number, to: number) => {
      for (let k = from; k < to; k++) {
        const event = { inputBuffer: buffer, playbackTime: 1000 + k * bufferSeconds }
        mixNode.onaudioprocess!(event)
        micNode.onaudioprocess!(event)
      }
      const [mix, mic] = AudioEncoderDouble.instances
      tallyAudio(mix, mixTally)
      tallyAudio(mic, micTally)
    }

    deliver(0, 20)
    recorder.pause()
    deliver(20, 80)
    recorder.resume()
    deliver(80, 100)

    expect(mixTally.zeros).toBe(0)
    expect(micTally.zeros).toBe(0)
    expect(mixTally.count).toBe(40)
    expect(micTally.count).toBe(40)
    expect(micTally.endUs).toBeCloseTo(mixTally.endUs, 6)
  })
})

// Review round 1: Blink and WebKit are recalled to compute `playbackTime` when
// the main thread dispatches the event, not from the buffer's own position. A
// callback that is merely late then reads as a gap, and a burst queued behind a
// hang all read about the same time. Neither is lost audio, and neither may be
// filled; a real loss still must be, exactly once.
describe('playbackTime read at dispatch', () => {
  it('(a) a late callback followed by on-time ones fills nothing (60 ms late every other callback, 60 s)', async () => {
    const r = await recordTake({ seconds: 60, dispatchDelay: k => (k % 2 ? 0.06 : 0) })
    expect(r.dropped).toBe(0)
    expect(r.mix.zeros).toBe(0)
    expect(Math.abs(r.mix.endUs - r.videoEndUs)).toBeLessThanOrEqual(toleranceUs())
  })

  it('(a) uniform 0-60 ms dispatch jank fills nothing (10 min)', async () => {
    const random = seededRandom()
    const r = await recordTake({ seconds: 600, dispatchDelay: () => random() * 0.06 })
    expect(r.mix.zeros).toBe(0)
    expect(Math.abs(r.mix.endUs - r.videoEndUs)).toBeLessThanOrEqual(toleranceUs())
  }, 60_000)

  it('(f) sustained 0-60 ms lateness on every callback, nothing lost, fills nothing (10 min, the rig\'s jank take)', async () => {
    // Modelled on the measurement rig's 60 ms busy loop every 100 ms in
    // headless Chromium: lateness that swings slowly between 0 and 60 ms, so
    // it stays above half a buffer (42.7 ms) for many callbacks in a row —
    // which a half-buffer threshold reads as a loss — while staying below the
    // one full buffer a double-buffered ScriptProcessor needs to lose one.
    const random = seededRandom(11)
    const r = await recordTake({
      seconds: 600,
      dispatchDelay: k => Math.min(0.06, Math.max(0, 0.03 + 0.027 * Math.sin((2 * Math.PI * k) / 40) + (random() - 0.5) * 0.006)),
    })
    expect(r.dropped).toBe(0)
    expect(r.mix.zeros).toBe(0)
    expect(Math.abs(r.mix.endUs - r.videoEndUs)).toBeLessThanOrEqual(toleranceUs())
  }, 60_000)

  it('(e) a loss that arrives as render-quantum creep under 0-60 ms jitter is filled as it comes (10 min)', async () => {
    // The rig's jank take lost its audio 128 samples at a time, never a whole
    // buffer: a whole-buffer filler never fires on it.
    const random = seededRandom(13)
    const r = await recordTake({ seconds: 600, dispatchDelay: () => random() * 0.06, creepEvery: 1.3 })
    const quantum = 128 / 48000
    // Everything lost up to a window (4 s) before the end, within two quanta:
    // the fill judges a window of callbacks, and leaves the last quantum.
    const creepBeforeLastWindow = Math.floor((600 - 4) / 1.3) * quantum
    const filled = r.mix.zeroFrames / 48000
    expect(filled).toBeGreaterThanOrEqual(creepBeforeLastWindow - 2 * quantum)
    expect(filled).toBeLessThanOrEqual(Math.floor(600 / 1.3) * quantum)
    expect(Math.abs(r.mix.endUs - r.videoEndUs)).toBeLessThanOrEqual(toleranceUs())
  }, 60_000)

  it('(e) the rig\'s own creep — about 43 ms in a minute under jank — is filled, where a whole-buffer rule fills nothing', async () => {
    // One quantum every 3.7 s: 16 quanta, 42.7 ms, over 60 s.
    const random = seededRandom(19)
    const r = await recordTake({ seconds: 60, dispatchDelay: () => random() * 0.06, creepEvery: 3.7 })
    const quantum = 128 / 48000
    const filled = r.mix.zeroFrames / 48000
    expect(filled).toBeGreaterThanOrEqual(Math.floor((60 - 4) / 3.7) * quantum - 2 * quantum)
    expect(filled).toBeLessThanOrEqual(16 * quantum)
  })

  it('(h) a constant 30 ms dispatch latency from the first callback fills nothing (10 min)', async () => {
    const r = await recordTake({ seconds: 600, dispatchDelay: () => 0.03 })
    expect(r.mix.zeros).toBe(0)
    expect(Math.abs(r.mix.endUs - r.videoEndUs)).toBeLessThanOrEqual(toleranceUs())
  }, 60_000)

  it('without playbackTime, reads the context\'s currentTime instead: a loss under jitter is filled once', async () => {
    const random = seededRandom(17)
    const r = await recordTake({
      seconds: 60,
      reference: 'currentTime',
      dispatchDelay: () => random() * 0.06,
      drop: k => k === 300,
    })
    expect(r.dropped).toBe(1)
    expect(r.mix.zeros).toBe(1)
    expect(Math.abs(r.mix.endUs - r.videoEndUs)).toBeLessThanOrEqual(toleranceUs())
  })

  it('a burst queued behind a 6 s main-thread hang — longer than the window — fills nothing', async () => {
    const r = await recordTake({ seconds: 60, dispatchDelay: hang(20, 26) })
    expect(r.mix.zeros).toBe(0)
  })

  /** Callbacks that came due during [from, to) seconds are all dispatched at `to`. */
  const hang = (from: number, to: number) => (k: number) => {
    const ready = (k * BUFFER) / 48000
    return ready >= from && ready < to ? to - ready : 0
  }

  it('(b) a burst queued behind a 300 ms main-thread hang fills nothing', async () => {
    const r = await recordTake({ seconds: 60, dispatchDelay: hang(20, 20.3) })
    expect(r.mix.zeros).toBe(0)
    expect(Math.abs(r.mix.endUs - r.videoEndUs)).toBeLessThanOrEqual(toleranceUs())
  })

  it('(b) a burst queued behind a 3 s main-thread hang fills nothing', async () => {
    const r = await recordTake({ seconds: 60, dispatchDelay: hang(20, 23) })
    expect(r.mix.zeros).toBe(0)
    expect(Math.abs(r.mix.endUs - r.videoEndUs)).toBeLessThanOrEqual(toleranceUs())
  })

  it('(c) a real loss under 0-60 ms jitter is filled with exactly one buffer', async () => {
    const random = seededRandom(7)
    const r = await recordTake({
      seconds: 60,
      dispatchDelay: () => random() * 0.06,
      drop: k => k === 300,
    })
    expect(r.dropped).toBe(1)
    expect(r.mix.zeros).toBe(1)
    expect(r.mix.count).toBe(r.delivered + 1)
    expect(Math.abs(r.mix.endUs - r.videoEndUs)).toBeLessThanOrEqual(toleranceUs())
  })

  it('(c) a real loss after a first callback that was itself late is still filled exactly once', async () => {
    // The first event anchors the count; 60 ms late, it would leave a later
    // loss reading as 85 - 60 = 25 ms — under half a buffer — unless the
    // anchor follows the window's minimum down.
    const r = await recordTake({
      seconds: 60,
      dispatchDelay: k => (k === 1 ? 0.06 : 0),
      drop: k => k === 300,
    })
    expect(r.mix.zeros).toBe(1)
    expect(Math.abs(r.mix.endUs - r.videoEndUs)).toBeLessThanOrEqual(toleranceUs())
  })

  it('(d) separate tracks: the mix, the microphone and the system audio lose callbacks independently under jitter (10 min)', async () => {
    await initialize({ ...SEPARATE_TRACKS, systemAudioEnabled: true })
    const nodes = lastAudioContext().scriptProcessors
    expect(nodes).toHaveLength(3)
    const buffer = realBuffer()
    const startMs = now
    recorder.start()

    const bufferSeconds = BUFFER / 48000
    const dropEvery = [150, 200, 170]
    const tallies = [newTally(), newTally(), newTally()]
    const dropped = [0, 0, 0]
    const random = seededRandom(3)
    let lastDispatch = -Infinity
    for (let k = 1; k * bufferSeconds <= 600; k++) {
      // One main thread: every node's event for buffer k is dispatched together.
      const ready = k * bufferSeconds
      const dispatch = Math.max(ready + random() * 0.06, lastDispatch)
      lastDispatch = dispatch
      now = startMs + dispatch * 1000
      const playbackTime = scriptProcessorPlaybackTime(1000 + (k - 1) * bufferSeconds, 48000, dispatch - ready)
      nodes.forEach((node, i) => {
        if (k % dropEvery[i] === 0 && ready < 590) dropped[i]++
        else node.onaudioprocess!({ inputBuffer: buffer, playbackTime })
      })
      AudioEncoderDouble.instances.forEach((encoder, i) => tallyAudio(encoder, tallies[i]))
      forgetCreatedFrames()
    }

    const [mix, mic, system] = tallies
    expect(mix.zeros).toBe(dropped[0])
    expect(mic.zeros).toBe(dropped[1])
    expect(system.zeros).toBe(dropped[2])
    expect(Math.abs(mic.endUs - mix.endUs)).toBeLessThanOrEqual((BUFFER / 48000) * 1e6)
    expect(Math.abs(system.endUs - mix.endUs)).toBeLessThanOrEqual((BUFFER / 48000) * 1e6)
  }, 60_000)
})
