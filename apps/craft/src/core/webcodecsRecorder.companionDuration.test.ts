// ESCSUITE-318: a separate-tracks audio companion says how long it is.
//
// A companion whose track ends mid-take — a microphone unplugged, a system
// audio share stopped — is finalised early, and its file is right: it holds
// the audio up to the end and no more. But nothing said so. The save stored
// every part at the take's wall-clock length, ESCAPEARTIST placed a clip of
// that length over the shorter file, and the library row showed the take's
// length: measured, a microphone that went at ~1.5 s of a 6.5 s take was
// stored at 6.51 s over a 1.48 s file.
//
// So each audio part the recorder delivers carries `duration`: the end of the
// last `AudioData` its own pipeline encoded — the last stamp plus that
// chunk's length — on the take's recorded clock. Both capture paths stamp
// recorded time (the AudioWorklet from the render position of each recorded
// span, the ScriptProcessorNode fallback from the samples it counted while
// recording), so a pause is out of the figure exactly as it is out of the
// primary's length. Driven through both paths' doubles, the way the worklet
// and audio-clock suites drive them.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { WebCodecsRecorder } from './webcodecs-recorder'
import type { CompanionPart, RecorderStopCallback, RecordingConfig } from '../store/types'
import {
  installWebCodecsDoubles,
  uninstallWebCodecsDoubles,
  resetWebCodecsDoubles,
  VideoFrameDouble,
} from '../test/doubles/webcodecs'
import { resetMediabunnyDouble } from '../test/doubles/mediabunny'
import {
  installAudioContextDouble,
  uninstallAudioContextDouble,
  enableAudioWorkletDouble,
  lastAudioContext,
  createAudioBufferDouble,
  type AudioContextDoubleControl,
} from '../test/doubles/audio'
import {
  createTrackDouble,
  createStreamDouble,
  type TrackDouble,
  installTrackProcessorDouble,
  uninstallTrackProcessorDouble,
  type TrackProcessorControl,
} from '../test/doubles/mediastream'

vi.mock('mediabunny', async () => {
  const { createMediabunnyDouble } = await import('../test/doubles/mediabunny')
  return createMediabunnyDouble()
})

/** Frames per worklet chunk and per ScriptProcessorNode buffer alike. */
const CHUNK = 4096
const CHUNK_SECONDS = CHUNK / 48000
const SEPARATE_TRACKS: RecordingConfig = {
  screenEnabled: true,
  webcamEnabled: true,
  microphoneEnabled: true,
  systemAudioEnabled: true,
  countdownSeconds: 0,
  webcamPosition: 'bottom-right',
  webcamSize: 0.2,
  webcamShape: 'circle',
  separateTracks: true,
}

async function flush(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve()
}

let now = 0
let audio: AudioContextDoubleControl
let processor: TrackProcessorControl
let recorder: WebCodecsRecorder
let callbacks: { onStop: Mock<RecorderStopCallback>; onError: Mock<(error: Error) => void> }
let micTrack: TrackDouble

async function initialize(): Promise<void> {
  await recorder.initialize(
    createStreamDouble([
      createTrackDouble('video', { id: 'screen-video' }),
      createTrackDouble('audio', { id: 'system' }),
    ]),
    createStreamDouble([
      createTrackDouble('video', { id: 'webcam-video', settings: { width: 640, height: 480 } }),
    ]),
    createStreamDouble([(micTrack = createTrackDouble('audio', { id: 'mic', label: 'Headset' }))]),
    SEPARATE_TRACKS
  )
}

function pushFrames(): void {
  processor.pushFrameTo('screen-video', new VideoFrameDouble(`s${now}`, { timestamp: 0 }))
  processor.pushFrameTo('webcam-video', new VideoFrameDouble(`w${now}`, { timestamp: 0 }))
}

/** The parts `onStop` delivered, by role. */
function partsByRole(): Record<string, CompanionPart> {
  expect(callbacks.onStop).toHaveBeenCalledTimes(1)
  const parts = callbacks.onStop.mock.calls[0][1] ?? []
  return Object.fromEntries(parts.map(part => [part.role, part]))
}

/** `actual` is within one chunk of `expected`, both in seconds. */
function expectWithinOneChunk(actual: number | undefined, expected: number, what: string): void {
  expect(actual, `${what}: no duration reported`).toBeTypeOf('number')
  expect(
    Math.abs(actual! - expected),
    `${what}: ${actual}s against ${expected}s`
  ).toBeLessThanOrEqual(CHUNK_SECONDS)
}

beforeEach(() => {
  now = 100_000
  installWebCodecsDoubles()
  resetWebCodecsDoubles()
  resetMediabunnyDouble()
  audio = installAudioContextDouble()
  enableAudioWorkletDouble()
  processor = installTrackProcessorDouble()
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame
  callbacks = { onStop: vi.fn(), onError: vi.fn() }
  recorder = new WebCodecsRecorder(callbacks)
})

afterEach(() => {
  recorder.dispose()
  uninstallTrackProcessorDouble()
  uninstallAudioContextDouble()
  uninstallWebCodecsDoubles()
  vi.restoreAllMocks()
})

describe('the AudioWorklet path', () => {
  /** Render `chunks` whole chunks, moving the wall clock on by exactly as long. */
  async function run(chunks: number): Promise<void> {
    for (let i = 0; i < chunks; i++) {
      lastAudioContext().render(CHUNK)
      now += CHUNK_SECONDS * 1000
      await flush(2)
    }
  }

  it('a microphone unplugged mid-take reports its own length; the system audio, the take\'s', async () => {
    await initialize()
    recorder.start()
    pushFrames()
    await run(12)
    // ...and 640 frames of a thirteenth chunk, then the microphone goes.
    lastAudioContext().render(640)
    now += (640 / 48000) * 1000
    await flush()
    micTrack.end()
    await flush()
    const micSeconds = (12 * CHUNK + 640) / 48000

    await run(60)
    pushFrames()
    const takeSeconds = recorder.getDuration()
    await recorder.stop()

    const parts = partsByRole()
    expectWithinOneChunk(parts.mic.duration, micSeconds, 'the microphone')
    expectWithinOneChunk(parts.system.duration, takeSeconds, 'the system audio')
    expect(parts.mic.duration!).toBeLessThan(takeSeconds / 4)
  })

  it('companions that ran the whole take report the take\'s length', async () => {
    await initialize()
    recorder.start()
    pushFrames()
    await run(80)
    pushFrames()
    const takeSeconds = recorder.getDuration()
    await recorder.stop()

    const parts = partsByRole()
    expectWithinOneChunk(parts.mic.duration, takeSeconds, 'the microphone')
    expectWithinOneChunk(parts.system.duration, takeSeconds, 'the system audio')
  })

  it('a paused take: the pause is out of every companion\'s length, as it is out of the take\'s', async () => {
    await initialize()
    recorder.start()
    pushFrames()
    await run(30)
    recorder.pause()
    await run(50)
    recorder.resume()
    await run(30)
    pushFrames()
    const takeSeconds = recorder.getDuration()
    await recorder.stop()

    const parts = partsByRole()
    expectWithinOneChunk(takeSeconds, 60 * CHUNK_SECONDS, 'the take')
    expectWithinOneChunk(parts.mic.duration, 60 * CHUNK_SECONDS, 'the microphone')
    expectWithinOneChunk(parts.system.duration, 60 * CHUNK_SECONDS, 'the system audio')
  })

  it('the webcam part carries no duration: the save probes its file for one', async () => {
    await initialize()
    recorder.start()
    pushFrames()
    await run(10)
    pushFrames()
    await recorder.stop()

    expect(partsByRole().webcam).not.toHaveProperty('duration')
  })
})

describe('the ScriptProcessorNode fallback', () => {
  /** One buffer to each live processor — [mix, mic, system] — `times` over. */
  function fire(times: number): void {
    const buffer = createAudioBufferDouble({ length: CHUNK, sample: () => 0.25 })
    for (let k = 0; k < times; k++) {
      for (const node of lastAudioContext().scriptProcessors) node.onaudioprocess?.({ inputBuffer: buffer })
      now += CHUNK_SECONDS * 1000
    }
  }

  beforeEach(() => {
    audio.audioWorklet = null
  })

  it('a microphone unplugged mid-take reports the samples it delivered; the system audio, the take\'s', async () => {
    await initialize()
    expect(lastAudioContext().scriptProcessors).toHaveLength(3)
    recorder.start()
    pushFrames()
    fire(20)
    micTrack.end()
    await flush()
    fire(40)
    pushFrames()
    await recorder.stop()

    const parts = partsByRole()
    expect(parts.mic.duration).toBeCloseTo(20 * CHUNK_SECONDS, 6)
    expect(parts.system.duration).toBeCloseTo(60 * CHUNK_SECONDS, 6)
  })

  it('a paused take: what was delivered while paused is not counted', async () => {
    await initialize()
    recorder.start()
    pushFrames()
    fire(30)
    recorder.pause()
    fire(50)
    recorder.resume()
    fire(30)
    pushFrames()
    await recorder.stop()

    const parts = partsByRole()
    expect(parts.mic.duration).toBeCloseTo(60 * CHUNK_SECONDS, 6)
    expect(parts.system.duration).toBeCloseTo(60 * CHUNK_SECONDS, 6)
  })
})
