// ESCSUITE-299: a WebCodecs take's audio is captured through an AudioWorklet.
//
// ESCSUITE-296 kept long takes in sync inside the ScriptProcessorNode design by
// filling the rise in a baseline deficit — a heuristic, because Chromium works
// out an `AudioProcessingEvent`'s `playbackTime` when the main thread
// dispatches it. An AudioWorklet processor runs on the render thread for every
// quantum without exception, knows its position exactly (`currentFrame`), and
// what it posts is queued, never dropped. So each chunk is stamped with where
// it was rendered — however late the page gets to it — and there is nothing to
// fill and no threshold to tune.
//
// Driven in render order through the AudioWorklet double, which runs the real
// processor source: `context.render()` advances the render thread, and the
// page receives what it posted when the test says (late, in bursts, never
// lost). Video frames go through the track-processor double on a scripted
// `performance.now()` that advances with the render clock.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { WebCodecsRecorder } from './webcodecs-recorder'
import type { RecorderStopCallback, RecordingConfig } from '../store/types'
import {
  installWebCodecsDoubles,
  uninstallWebCodecsDoubles,
  resetWebCodecsDoubles,
  lastVideoEncoder,
  VideoFrameDouble,
  AudioEncoderDouble,
  forgetCreatedFrames,
  getCreatedFrames,
  type EncoderDouble,
} from '../test/doubles/webcodecs'
import { resetMediabunnyDouble, getMediabunnyState } from '../test/doubles/mediabunny'
import {
  installAudioContextDouble,
  uninstallAudioContextDouble,
  enableAudioWorkletDouble,
  lastAudioContext,
  createAudioBufferDouble,
  type AudioContextDoubleControl,
  type AudioWorkletDoubleControl,
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

/** The processor's chunk, per channel. */
const CHUNK = 4096
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
const SEPARATE_TRACKS: RecordingConfig = {
  ...CONFIG,
  webcamEnabled: true,
  systemAudioEnabled: true,
  separateTracks: true,
}

async function flush(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve()
}

/** What one audio pipeline encoded, tallied as it goes (a long take is thousands of chunks). */
interface AudioTally {
  count: number
  /** Chunks that are all zeros — silence nobody captured. */
  zeros: number
  /** Every stamp, in µs, in encode order. */
  stamps: number[]
  /** End of the last chunk: its stamp plus its length at its own rate, µs. */
  endUs: number
  /** The largest distance, µs, between a chunk's stamp and the end of the one before: gap or overlap. */
  maxSeamUs: number
  rates: Set<number>
}

function newTally(): AudioTally {
  return { count: 0, zeros: 0, stamps: [], endUs: 0, maxSeamUs: 0, rates: new Set() }
}

function tallyAudio(encoder: EncoderDouble, tally: AudioTally): void {
  for (const { data } of encoder.encodes) {
    const init = data.init as { timestamp: number; numberOfFrames: number; sampleRate: number }
    tally.count++
    if ((data.source as Float32Array).every(v => v === 0)) tally.zeros++
    tally.stamps.push(init.timestamp)
    if (tally.count > 1) tally.maxSeamUs = Math.max(tally.maxSeamUs, Math.abs(init.timestamp - tally.endUs))
    tally.endUs = init.timestamp + (init.numberOfFrames / init.sampleRate) * 1e6
    tally.rates.add(init.sampleRate)
  }
  encoder.encodes.length = 0
}

let now = 0
let audio: AudioContextDoubleControl
let worklet: AudioWorkletDoubleControl
let processor: TrackProcessorControl
let recorder: WebCodecsRecorder
let callbacks: { onStop: Mock<RecorderStopCallback>; onError: Mock<(error: Error) => void> }
let consoleInfo: ReturnType<typeof vi.spyOn>
let micTrack: TrackDouble

async function initialize(config: RecordingConfig = CONFIG): Promise<void> {
  await recorder.initialize(
    createStreamDouble([
      createTrackDouble('video', { id: 'screen-video' }),
      ...(config.systemAudioEnabled ? [createTrackDouble('audio', { id: 'system' })] : []),
    ]),
    config.separateTracks
      ? createStreamDouble([
          createTrackDouble('video', { id: 'webcam-video', settings: { width: 640, height: 480 } }),
        ])
      : null,
    createStreamDouble([(micTrack = createTrackDouble('audio', { id: 'mic', label: 'Headset' }))]),
    config
  )
}

/** Render `frames` and move the wall clock on by exactly as long. */
function render(frames: number, rate = 48000): void {
  lastAudioContext().render(frames)
  now += (frames / rate) * 1000
}

beforeEach(() => {
  now = 100_000
  installWebCodecsDoubles()
  resetWebCodecsDoubles()
  resetMediabunnyDouble()
  audio = installAudioContextDouble()
  worklet = enableAudioWorkletDouble()
  processor = installTrackProcessorDouble()
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {})
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
  vi.useRealTimers()
})

describe('the capture a take gets', () => {
  it('captures the mix through an AudioWorklet node, not a ScriptProcessorNode', async () => {
    await initialize()
    const context = lastAudioContext()
    expect(context.workletNodes).toHaveLength(1)
    expect(context.scriptProcessors).toHaveLength(0)
    expect(context.workletNodes[0].name).toBe('escapecraft-capture')
  })

  it('decides once per take and says so once, at info level — three audio pipelines, one line', async () => {
    await initialize(SEPARATE_TRACKS)
    const context = lastAudioContext()
    expect(context.workletNodes).toHaveLength(3)
    expect(context.audioWorklet!.addModule).toHaveBeenCalledTimes(1)
    expect(consoleInfo).toHaveBeenCalledTimes(1)
    expect(String(consoleInfo.mock.calls[0][0])).toMatch(/AudioWorklet/)
  })

  it('falls back to the ScriptProcessorNode when the browser has no AudioWorklet — gap filler and all', async () => {
    audio.audioWorklet = null
    await initialize()
    const context = lastAudioContext()
    expect(context.workletNodes).toHaveLength(0)
    expect(context.scriptProcessors).toHaveLength(1)
    expect(String(consoleInfo.mock.calls[0][0])).toMatch(/ScriptProcessorNode/)

    recorder.start()
    const node = context.scriptProcessors[0]
    const buffer = createAudioBufferDouble({ length: CHUNK, sample: () => 0.25 })
    const bufferSeconds = CHUNK / 48000
    for (let k = 0; k < 120; k++) {
      if (k !== 60) node.onaudioprocess!({ inputBuffer: buffer, playbackTime: 1000 + k * bufferSeconds })
    }
    const tally = newTally()
    tallyAudio(AudioEncoderDouble.instances[0], tally)
    // The callback the page never saw is filled — all but the last quantum
    // of it, as ESCSUITE-296's rule does.
    expect(tally.zeros).toBe(1)
    expect(tally.count).toBe(120)
  })

  it('falls back to the ScriptProcessorNode when addModule rejects — gap filler and all', async () => {
    worklet.addModuleError = new DOMException('blob: modules are refused', 'AbortError')
    await initialize(SEPARATE_TRACKS)
    const context = lastAudioContext()
    expect(context.workletNodes).toHaveLength(0)
    expect(context.scriptProcessors).toHaveLength(3)
    expect(consoleInfo).toHaveBeenCalledTimes(1)
    expect(String(consoleInfo.mock.calls[0][0])).toMatch(/ScriptProcessorNode/)

    recorder.start()
    const buffer = createAudioBufferDouble({ length: CHUNK, sample: () => 0.25 })
    const bufferSeconds = CHUNK / 48000
    for (let k = 0; k < 120; k++) {
      for (const [index, node] of context.scriptProcessors.entries()) {
        if (!(index === 1 && k === 60)) {
          node.onaudioprocess!({ inputBuffer: buffer, playbackTime: 1000 + k * bufferSeconds })
        }
      }
    }
    const [mix, mic, system] = AudioEncoderDouble.instances.map(encoder => {
      const tally = newTally()
      tallyAudio(encoder, tally)
      return tally
    })
    expect(mix.zeros).toBe(0)
    expect(mic.zeros).toBe(1)
    expect(system.zeros).toBe(0)
  })
})

describe('a long take', () => {
  it('10 minutes with 1 % of chunks delivered late: the audio ends on the render clock, nothing inserted, every chunk encoded once', async () => {
    await initialize()
    const context = lastAudioContext()
    const node = context.workletNodes[0]
    worklet.holdMessages = true
    // Mid-chunk, the way a real start lands.
    render(CHUNK + 1536)
    node.deliver()
    const startFrame = context.renderedFrames
    const startMs = now
    recorder.start()

    const mix = newTally()
    let nextVideoMs = 0
    let heldUntil = -1
    const seconds = 600
    for (let k = 1; context.renderedFrames - startFrame + CHUNK <= seconds * 48000; k++) {
      render(CHUNK)
      // One chunk in a hundred lands behind a 2.5 s main-thread hang: it and
      // the thirty behind it wait, then all arrive at once, out of real time.
      if (k % 100 === 0) heldUntil = k + 30
      if (k >= heldUntil) node.deliver()
      if (now - startMs >= nextVideoMs) {
        processor.pushFrame(new VideoFrameDouble(`f${nextVideoMs}`, { timestamp: 0 }))
        await flush()
        lastVideoEncoder().encodes.length = 0
        nextVideoMs += 1000
      }
      tallyAudio(AudioEncoderDouble.instances[0], mix)
      forgetCreatedFrames()
    }
    node.deliver()
    tallyAudio(AudioEncoderDouble.instances[0], mix)
    // One last frame, at the end of the take.
    processor.pushFrame(new VideoFrameDouble('last', { timestamp: 0 }))
    await flush()
    const videoEndUs = lastVideoEncoder().encodes.at(-1)!.data.timestamp!

    const renderClockUs = ((context.renderedFrames - startFrame) / 48000) * 1e6
    const chunkUs = (CHUNK / 48000) * 1e6
    // The audio's last sample is where the render clock is, within a chunk.
    expect(Math.abs(mix.endUs - renderClockUs)).toBeLessThanOrEqual(chunkUs)
    // ...and the video, on the same clock, agrees.
    expect(Math.abs(mix.endUs - videoEndUs)).toBeLessThanOrEqual(chunkUs)
    // Nothing made up: every chunk is captured sound.
    expect(mix.zeros).toBe(0)
    // Every chunk rendered since start() encoded exactly once, in order, each
    // one chunk after the last.
    // (the one in progress at start() included, from start() on).
    const rendered = node.posted.filter(p => (p.data as { frame?: number }).frame! + CHUNK > startFrame)
    expect(rendered.length).toBeGreaterThan(7000)
    expect(mix.count).toBe(rendered.length)
    expect(mix.stamps[0]).toBe(0)
    expect(mix.maxSeamUs).toBeLessThanOrEqual(1)
    expect([...mix.rates]).toEqual([48000])
  }, 120_000)

  it('a 44.1 kHz context: AudioData carry 44100, stamped from frame / 44100', async () => {
    audio.contextSampleRate = 44100
    await initialize()
    const context = lastAudioContext()
    recorder.start()
    const mix = newTally()
    for (let k = 0; k < 300; k++) {
      render(CHUNK, 44100)
      await flush(2)
      tallyAudio(AudioEncoderDouble.instances[0], mix)
    }

    expect([...mix.rates]).toEqual([44100])
    expect(AudioEncoderDouble.instances[0].configureCalls[0]).toMatchObject({ sampleRate: 44100 })
    expect(mix.stamps.slice(0, 3)).toEqual([0, 1, 2].map(k => Math.round(((k * CHUNK) / 44100) * 1e6)))
    expect(Math.abs(mix.endUs - (context.renderedFrames / 44100) * 1e6)).toBeLessThanOrEqual(
      (CHUNK / 44100) * 1e6
    )
  })
})

describe('pause and resume', () => {
  it('stamps run on across a pause — the paused render frames subtracted, as the video subtracts its paused time', async () => {
    await initialize()
    recorder.start()
    const mix = newTally()
    const frameAt = async () => {
      processor.pushFrame(new VideoFrameDouble(`f${now}`, { timestamp: 0 }))
      await flush()
    }
    const run = async (chunks: number) => {
      for (let i = 0; i < chunks; i++) {
        render(CHUNK)
        await flush(2)
        tallyAudio(AudioEncoderDouble.instances[0], mix)
      }
    }

    await frameAt()
    await run(30)
    recorder.pause()
    await run(50)
    recorder.resume()
    await run(30)
    await frameAt()

    const chunkUs = (CHUNK / 48000) * 1e6
    // No step the length of the pause anywhere in the audio — no step at all...
    expect(mix.maxSeamUs).toBeLessThanOrEqual(1)
    // ...and the audio ends where the video does: 60 chunks of recording.
    const videoUs = lastVideoEncoder().encodes.at(-1)!.data.timestamp!
    expect(Math.abs(videoUs - 60 * chunkUs)).toBeLessThanOrEqual(1000)
    expect(Math.abs(mix.endUs - videoUs)).toBeLessThanOrEqual(chunkUs)
  })
})

describe('stop()', () => {
  it('flushes the tail into the file and closes the node', async () => {
    await initialize()
    const node = lastAudioContext().workletNodes[0]
    recorder.start()
    now += 40
    processor.pushFrame(new VideoFrameDouble('f', { timestamp: 0 }))
    render(CHUNK + 1000 - (1000 % 128))
    await flush()

    await recorder.stop()

    const frames = getCreatedFrames('AudioData').map(d => (d.init as { numberOfFrames: number }).numberOfFrames)
    expect(frames).toEqual([CHUNK, 1000 - (1000 % 128)])
    expect(AudioEncoderDouble.instances[0].encodes).toHaveLength(2)
    expect(node.disconnect).toHaveBeenCalledTimes(1)
    expect(node.port.close).toHaveBeenCalledTimes(1)
    expect(callbacks.onStop).toHaveBeenCalledTimes(1)
    expect(getMediabunnyState().audioSources[0].packets).toHaveLength(2)
  })

  it('waits for the tail before it flushes the encoder', async () => {
    await initialize()
    const node = lastAudioContext().workletNodes[0]
    worklet.holdMessages = true
    recorder.start()
    now += 40
    processor.pushFrame(new VideoFrameDouble('f', { timestamp: 0 }))
    render(CHUNK * 2 + 512)
    const stopping = recorder.stop()
    await flush(20)
    expect(AudioEncoderDouble.instances[0].flushCalls).toBe(0)

    node.deliver()
    await stopping
    expect(AudioEncoderDouble.instances[0].encodes).toHaveLength(3)
    expect(AudioEncoderDouble.instances[0].flushCalls).toBe(1)
  })

  it('ignores a chunk that arrives after stop()', async () => {
    await initialize()
    const node = lastAudioContext().workletNodes[0]
    recorder.start()
    now += 40
    processor.pushFrame(new VideoFrameDouble('f', { timestamp: 0 }))
    render(CHUNK)
    await recorder.stop()
    const encodes = AudioEncoderDouble.instances[0].encodes.length

    lastAudioContext().render(CHUNK * 2)
    node.deliver()
    await flush()
    expect(AudioEncoderDouble.instances[0].encodes).toHaveLength(encodes)
  })
})

describe('separate tracks', () => {
  it('captures the mix, the microphone and the system audio through a node each, on one render clock', async () => {
    await initialize(SEPARATE_TRACKS)
    recorder.start()
    render(CHUNK * 3)
    await flush()

    const stamps = AudioEncoderDouble.instances.map(encoder =>
      encoder.encodes.map(e => (e.data.init as { timestamp: number }).timestamp)
    )
    expect(stamps).toHaveLength(3)
    expect(stamps[1]).toEqual(stamps[0])
    expect(stamps[2]).toEqual(stamps[0])
    expect(stamps[0]).toHaveLength(3)
  })

  it('a microphone encoder that gives up drops the chunks still queued for it, and the take goes on', async () => {
    await initialize(SEPARATE_TRACKS)
    const context = lastAudioContext()
    worklet.holdMessages = true
    recorder.start()
    now += 40
    processor.pushFrameTo('screen-video', new VideoFrameDouble('s', { timestamp: 0 }))
    processor.pushFrameTo('webcam-video', new VideoFrameDouble('w', { timestamp: 0 }))
    render(CHUNK)
    for (const node of context.workletNodes) node.deliver()
    // Three more chunks rendered; the page is busy and has not seen them.
    render(CHUNK * 3)
    const [, mic, system] = AudioEncoderDouble.instances
    mic.emitError('mic encoder died')
    for (const node of context.workletNodes) node.deliver()
    await flush()

    expect(mic.encodes).toHaveLength(1)
    expect(system.encodes).toHaveLength(4)
    expect(callbacks.onError).not.toHaveBeenCalled()

    worklet.holdMessages = false
    for (const node of context.workletNodes) node.deliver()
    await recorder.stop()
    const parts = callbacks.onStop.mock.calls[0][1] as Array<{ role: string }>
    expect(parts.map(p => p.role)).toEqual(['webcam', 'system'])
  })

  it('a microphone that is unplugged keeps what it rendered before it went: the tail is flushed into its part', async () => {
    await initialize(SEPARATE_TRACKS)
    const context = lastAudioContext()
    recorder.start()
    now += 40
    processor.pushFrameTo('screen-video', new VideoFrameDouble('s', { timestamp: 0 }))
    processor.pushFrameTo('webcam-video', new VideoFrameDouble('w', { timestamp: 0 }))
    render(CHUNK + 640)
    await flush()

    micTrack.end()
    await flush()

    const [, mic] = AudioEncoderDouble.instances
    expect(mic.encodes.map(e => (e.data.init as { numberOfFrames: number }).numberOfFrames)).toEqual([
      CHUNK,
      640,
    ])
    expect(context.workletNodes[1].disconnect).toHaveBeenCalledTimes(1)
    // ...while the mix and the system audio carry on.
    render(CHUNK)
    await flush()
    expect(mic.encodes).toHaveLength(2)
    expect(AudioEncoderDouble.instances[2].encodes).toHaveLength(2)

    await recorder.stop()
    const parts = callbacks.onStop.mock.calls[0][1] as Array<{ role: string }>
    expect(parts.map(p => p.role)).toEqual(['webcam', 'mic', 'system'])
  })
})

describe('a take disposed while the AudioWorklet module is still loading', () => {
  it('closes the capture it finishes building, and resolves', async () => {
    let open!: () => void
    worklet.addModuleGate = new Promise<void>(resolve => (open = resolve))
    const initializing = initialize()
    await flush(40)
    const context = lastAudioContext()
    expect(context.audioWorklet!.addModule).toHaveBeenCalledTimes(1)

    recorder.dispose()
    open()
    await expect(initializing).resolves.toBeUndefined()

    expect(context.workletNodes).toHaveLength(1)
    expect(context.workletNodes[0].disconnect).toHaveBeenCalledTimes(1)
    expect(context.workletNodes[0].port.close).toHaveBeenCalledTimes(1)
  })
})
