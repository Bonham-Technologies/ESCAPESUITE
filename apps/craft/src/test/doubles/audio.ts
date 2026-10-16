// Test double for AudioContext and the nodes the recorder/converter build on
// it. jsdom ships no Web Audio implementation at all.
//
// src/test/setup.ts installs a minimal always-on AudioContext stub that most
// tests are happy with. This double is the configurable version: install it in
// the tests that need to steer decodeAudioData(), the mixed-destination track
// list, or the analyser's frequency data, and uninstall it afterwards to hand
// the global back to the setup stub.
import { vi } from 'vitest'

/** AudioBuffer-shaped object: enough of the interface for real code to read it. */
export interface AudioBufferDouble {
  numberOfChannels: number
  length: number
  sampleRate: number
  duration: number
  getChannelData(channel: number): Float32Array
}

export interface AudioBufferOptions {
  numberOfChannels?: number
  /** Samples per channel. */
  length?: number
  sampleRate?: number
  /** Per-channel sample generator; defaults to a deterministic ramp. */
  sample?: (channel: number, index: number) => number
}

export function createAudioBufferDouble(options: AudioBufferOptions = {}): AudioBufferDouble {
  const numberOfChannels = options.numberOfChannels ?? 2
  const length = options.length ?? 4800
  const sampleRate = options.sampleRate ?? 48000
  const sample = options.sample ?? ((channel: number, index: number) => (channel + 1) * (index % 10) / 10)

  const channels: Float32Array[] = []
  for (let c = 0; c < numberOfChannels; c++) {
    const data = new Float32Array(length)
    for (let i = 0; i < length; i++) data[i] = sample(c, i)
    channels.push(data)
  }

  return {
    numberOfChannels,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData(channel: number) {
      const data = channels[channel]
      if (!data) throw new Error(`AudioBuffer has no channel ${channel}`)
      return data
    },
  }
}

/**
 * What a test hands `onaudioprocess`. `playbackTime` is opt-in: a real
 * `AudioProcessingEvent` always carries it (the context time, in seconds, of
 * the buffer), but every suite written before ESCSUITE-296 dispatches
 * `{ inputBuffer }` alone — and the recorder's gap filler is a no-op for such
 * an event, which is what keeps those suites' counts exactly as they were.
 */
export interface AudioProcessEventDouble {
  inputBuffer: AudioBufferDouble
  playbackTime?: number
}

export interface ScriptProcessorDouble {
  bufferSize: number
  onaudioprocess: ((event: AudioProcessEventDouble) => void) | null
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

/**
 * A `MediaStreamAudioSourceNode` stand-in. `disconnect` is recorded as well as
 * `connect` because a source node is only released when the AudioContext
 * closes, so "every source this take connected was disconnected" is a law the
 * recorder's teardown has to keep on its own.
 */
export interface MediaStreamSourceDouble {
  readonly stream: MediaStream
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

export interface AnalyserDouble {
  fftSize: number
  readonly frequencyBinCount: number
  connect: ReturnType<typeof vi.fn>
  getByteFrequencyData: ReturnType<typeof vi.fn>
}

/**
 * The context's render clock, for `getOutputTimestamp()` (ESCSUITE-296).
 *
 * `contextTime = offsetSeconds + performanceTime / 1000 × (1 + skew)` — a
 * render clock that runs `skew` fast (ε, positive) or slow against
 * `performance.now()`, the way an output device's crystal does.
 */
export interface OutputClockDouble {
  /** ε: context seconds per `performance.now()` second, minus one. */
  skew: number
  /** `contextTime` at `performance.now() === 0`, in seconds. */
  offsetSeconds: number
  /**
   * When set, `getOutputTimestamp()` reports exactly this instead — zeros, as
   * a context that has not rendered yet does, or a non-finite value. Read on
   * every call, so a test can change it mid-take.
   */
  report?: { contextTime: number; performanceTime: number }
}

/** The context time `clock` reads at this `performance.now()`, in seconds. */
export function outputClockContextTime(clock: OutputClockDouble, performanceTime: number): number {
  return clock.offsetSeconds + (performanceTime / 1000) * (1 + clock.skew)
}

/**
 * The `playbackTime` an `onaudioprocess` event carries for the buffer that
 * starts at context time `bufferStart`, in seconds.
 *
 * With no `dispatchDelay` it is that position exactly — the reading the
 * recorder's gap filler was first written against. With one, it is what Blink
 * and WebKit are recalled to compute (ESCSUITE-296's review; not measured):
 * the context time at the moment the main thread *dispatches* the event — the
 * buffer's position plus how late the dispatch is — rounded down to a
 * 128-frame render quantum. A late callback then reads as a gap that is not
 * one, and a burst of callbacks queued behind a hang all read about the same
 * time.
 */
export function scriptProcessorPlaybackTime(
  bufferStart: number,
  sampleRate: number,
  dispatchDelay = 0
): number {
  if (dispatchDelay === 0) return bufferStart
  // The epsilon keeps a position that is a whole quantum from flooring one
  // quantum short on a float that lands a hair under it.
  return (Math.floor(((bufferStart + dispatchDelay) * sampleRate) / 128 + 1e-9) * 128) / sampleRate
}

export interface AudioContextDoubleControl {
  /** Every AudioContext the code under test constructed. */
  readonly contexts: AudioContextDoubleInstance[]
  /** What decodeAudioData resolves with. Null makes it reject. */
  decodeResult: AudioBufferDouble | null
  /** Make `new AudioContext()` throw, to exercise the outer failure path. */
  constructorThrows: boolean
  /** Initial state reported by new contexts. */
  initialState: 'running' | 'suspended'
  /** Number of audio tracks on the mixed destination stream. */
  destinationTrackCount: number
  /** Byte value every analyser bin reports. */
  analyserLevel: number
  /**
   * Held open to park `resume()` mid-flight, so a test can land a `dispose()`
   * inside the await the code under test is sitting on and then resolve it.
   * Null (the default) resumes immediately. Pair it with
   * `initialState: 'suspended'`, which is the only state the recorder resumes
   * from — and the state Chrome hands out without a user gesture.
   */
  resumeGate: Promise<void> | null
  /**
   * The rate every new context runs at whatever it was asked for — an engine
   * that ignores `new AudioContext({ sampleRate })`. Null (the default)
   * honours the option, falling back to 48000.
   */
  contextSampleRate: number | null
  /**
   * Opt-in render clock. Null (the default): new contexts have **no**
   * `getOutputTimestamp` at all, so every suite written before ESCSUITE-296
   * keeps the recorder on its `performance.now()` path. Read when a context is
   * constructed (present or absent) and on every call (its values).
   */
  outputClock: OutputClockDouble | null
}

const control: AudioContextDoubleControl = {
  contexts: [],
  decodeResult: null,
  constructorThrows: false,
  initialState: 'running',
  destinationTrackCount: 1,
  analyserLevel: 0,
  resumeGate: null,
  contextSampleRate: null,
  outputClock: null,
}

function makeAudioTrack(index: number): MediaStreamTrack {
  return {
    id: `mixed-audio-${index}`,
    kind: 'audio',
    label: 'Mixed destination audio track',
    enabled: true,
    readyState: 'live',
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getSettings: vi.fn(() => ({})),
  } as unknown as MediaStreamTrack
}

export class AudioContextDoubleInstance {
  state: 'running' | 'suspended' | 'closed'
  readonly sampleRate: number
  readonly destination = {} as AudioDestinationNode
  readonly analysers: AnalyserDouble[] = []
  readonly scriptProcessors: ScriptProcessorDouble[] = []
  readonly mediaStreamSources: MediaStream[] = []
  /** The source nodes themselves, in creation order. */
  readonly mediaStreamSourceNodes: MediaStreamSourceDouble[] = []
  readonly resume = vi.fn(async () => {
    if (control.resumeGate) await control.resumeGate
    // A context closed while this was parked stays closed — resume() cannot
    // reopen one. (A real browser is stricter still and rejects; this is
    // deliberately lenient, so a test can assert what the *caller* does after a
    // resume that landed too late rather than what the platform said.)
    if (this.state === 'closed') return
    this.state = 'running'
  })
  readonly close = vi.fn(async () => {
    this.state = 'closed'
  })
  readonly decodeAudioData = vi.fn(async (data: ArrayBuffer) => {
    this.decodedByteLengths.push(data.byteLength)
    if (!control.decodeResult) {
      throw new Error('Unable to decode audio data')
    }
    return control.decodeResult as unknown as AudioBuffer
  })
  readonly decodedByteLengths: number[] = []
  /** Present only when `control.outputClock` was set at construction. */
  getOutputTimestamp?: ReturnType<typeof vi.fn<() => { contextTime: number; performanceTime: number }>>

  constructor(options?: { sampleRate?: number }) {
    if (control.constructorThrows) throw new Error('AudioContext is unavailable')
    this.state = control.initialState
    this.sampleRate = control.contextSampleRate ?? options?.sampleRate ?? 48000
    if (control.outputClock) {
      this.getOutputTimestamp = vi.fn(() => {
        const clock = control.outputClock!
        if (clock.report) return { ...clock.report }
        const performanceTime = performance.now()
        return { contextTime: outputClockContextTime(clock, performanceTime), performanceTime }
      })
    }
    control.contexts.push(this)
  }

  createAnalyser(): AnalyserDouble {
    const analyser: AnalyserDouble = {
      fftSize: 2048,
      get frequencyBinCount() {
        return this.fftSize / 2
      },
      connect: vi.fn(),
      getByteFrequencyData: vi.fn((array: Uint8Array) => {
        array.fill(control.analyserLevel)
      }),
    }
    this.analysers.push(analyser)
    return analyser
  }

  createMediaStreamSource(stream: MediaStream): MediaStreamSourceDouble {
    this.mediaStreamSources.push(stream)
    const node: MediaStreamSourceDouble = { stream, connect: vi.fn(), disconnect: vi.fn() }
    this.mediaStreamSourceNodes.push(node)
    return node
  }

  createMediaStreamDestination() {
    const tracks = Array.from({ length: control.destinationTrackCount }, (_, i) => makeAudioTrack(i))
    return {
      stream: {
        getAudioTracks: () => tracks,
        getTracks: () => tracks,
        getVideoTracks: () => [],
      },
    }
  }

  createScriptProcessor(bufferSize: number): ScriptProcessorDouble {
    const node: ScriptProcessorDouble = {
      bufferSize,
      onaudioprocess: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
    }
    this.scriptProcessors.push(node)
    return node
  }
}

let originalAudioContext: unknown
let installed = false

/**
 * Replace the global AudioContext with the configurable double. Uses plain
 * assignment (not vi.stubGlobal) so uninstall restores exactly the stub that
 * setup.ts installed.
 */
export function installAudioContextDouble(): AudioContextDoubleControl {
  if (!installed) {
    const g = globalThis as unknown as Record<string, unknown>
    originalAudioContext = g.AudioContext
    g.AudioContext = AudioContextDoubleInstance
    installed = true
  }
  resetAudioContextDouble()
  return control
}

export function uninstallAudioContextDouble(): void {
  if (!installed) return
  const g = globalThis as unknown as Record<string, unknown>
  if (originalAudioContext === undefined) delete g.AudioContext
  else g.AudioContext = originalAudioContext
  installed = false
  resetAudioContextDouble()
}

export function resetAudioContextDouble(): void {
  control.contexts.length = 0
  control.decodeResult = null
  control.constructorThrows = false
  control.initialState = 'running'
  control.destinationTrackCount = 1
  control.analyserLevel = 0
  control.resumeGate = null
  control.contextSampleRate = null
  control.outputClock = null
}

/** The single AudioContext the code under test created (fails loudly if none). */
export function lastAudioContext(): AudioContextDoubleInstance {
  const ctx = control.contexts[control.contexts.length - 1]
  if (!ctx) throw new Error('No AudioContext was constructed')
  return ctx
}
