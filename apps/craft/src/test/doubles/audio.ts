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
  /**
   * Opt-in `currentTime`, as a function of `performance.now()`. Null (the
   * default): a context reads `currentTime` as `undefined`, so every suite
   * written before ESCSUITE-296's quantum rule gives the recorder's gap filler
   * no clock at all and keeps the old path.
   */
  currentTimeAt: ((performanceTime: number) => number) | null
  /**
   * Opt-in AudioWorklet (ESCSUITE-299). Null (the default): new contexts have
   * **no** `audioWorklet`, which is what a browser without one looks like — so
   * every suite written before ESCSUITE-299 keeps the recorder on its
   * ScriptProcessorNode capture. Read when a context is constructed (present or
   * absent) and on every call (its values). See `enableAudioWorkletDouble()`.
   */
  audioWorklet: AudioWorkletDoubleControl | null
}

/**
 * How the AudioWorklet double behaves (ESCSUITE-299).
 *
 * jsdom has no Web Audio at all, so this is the render thread in miniature:
 * `addModule()` evaluates the module the page handed it — the `Blob` behind the
 * last `URL.createObjectURL()` call — in a stand-in `AudioWorkletGlobalScope`
 * (`registerProcessor`, `AudioWorkletProcessor`, `currentFrame`, `sampleRate`),
 * so the processor that runs here is the real source text, not a copy of it.
 * `context.render(frames)` then calls every live processor's `process()` once
 * per 128-frame render quantum, advancing `currentFrame` — and the context's
 * own `currentTime` — exactly as the engine does.
 *
 * What a processor posts reaches the page the way a real `MessagePort`
 * delivers it: as a `{ data }` event on `port.onmessage`, structured-cloned
 * with its transfer list (so a transferred buffer is detached on the processor
 * side), first in first out, and never dropped while the port is open — but
 * possibly late: with `holdMessages` set it waits in the node's `inbox` until
 * the test calls `deliver()`. A closed port delivers nothing more, as a real
 * one does.
 */
export interface AudioWorkletDoubleControl {
  /** What `addModule()` rejects with; null (the default) resolves. */
  addModuleError: unknown
  /** Held open to park `addModule()` mid-flight. Null resolves at once. */
  addModuleGate: Promise<void> | null
  /**
   * Keep every message a processor posts in its node's `inbox` until the test
   * calls `deliver()`. False (the default) delivers each on a microtask.
   */
  holdMessages: boolean
  /**
   * The render thread never handles what the page posts to a processor — a
   * stalled or suspended engine. False (the default) hands each message to the
   * processor on a microtask.
   */
  processorDeaf: boolean
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
  currentTimeAt: null,
  audioWorklet: null,
}

/** Turn the AudioWorklet double on for every context constructed from now on. */
export function enableAudioWorkletDouble(
  overrides: Partial<AudioWorkletDoubleControl> = {}
): AudioWorkletDoubleControl {
  control.audioWorklet = {
    addModuleError: null,
    addModuleGate: null,
    holdMessages: false,
    processorDeaf: false,
    ...overrides,
  }
  return control.audioWorklet
}

/** One render quantum, in frames — what `process()` is handed each call. */
export const RENDER_QUANTUM_FRAMES = 128

/** A processor class as `registerProcessor()` receives it. */
type ProcessorConstructor = new (options?: unknown) => {
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, never>): boolean
}

/** The processor-side end of a node's port, as `AudioWorkletProcessor.port`. */
interface ProcessorPortDouble {
  onmessage: ((event: { data: unknown }) => void) | null
  postMessage(data: unknown, transfer?: Transferable[]): void
}

/** Handed to the processor base class while its node is constructing it. */
let constructingPort: ProcessorPortDouble | null = null

/** `AudioWorkletProcessor`: all it gives a subclass is its port. */
class AudioWorkletProcessorDouble {
  readonly port: ProcessorPortDouble
  constructor() {
    if (!constructingPort) throw new TypeError('Illegal constructor')
    this.port = constructingPort
  }
}

/**
 * Evaluate a worklet module's source text in a stand-in global scope. `with`
 * is what lets the module read `currentFrame` as a bare global, the way it
 * does in a real `AudioWorkletGlobalScope`; the class bodies inside are strict
 * mode either way.
 */
function evaluateWorkletModule(source: string, scope: object): void {
  new Function('scope', `with (scope) {\n${source}\n}`)(scope)
}

/** The Blob the page handed `URL.createObjectURL()` last — what `url` names. */
function lastObjectUrlBlob(): Blob {
  const calls = (URL.createObjectURL as unknown as { mock?: { calls: unknown[][] } }).mock?.calls
  const blob = calls?.at(-1)?.[0]
  if (!(blob instanceof Blob)) {
    throw new Error('AudioWorklet double: addModule() was not handed a URL.createObjectURL(Blob)')
  }
  return blob
}

/**
 * `AudioWorkletNode`, running the processor its context registered under
 * `name`. Installed as the global by `installAudioContextDouble()`.
 */
export class AudioWorkletNodeDouble {
  readonly context: AudioContextDoubleInstance
  readonly name: string
  readonly options: Record<string, unknown> | undefined
  readonly connect = vi.fn()
  readonly disconnect = vi.fn()
  /** The page's end of the port. */
  readonly port: {
    onmessage: ((event: { data: unknown }) => void) | null
    postMessage: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
  }
  /** Posted by the processor, not yet handed to the page — oldest first. */
  readonly inbox: unknown[] = []
  /** Every message the processor posted, as it posted it (before cloning). */
  readonly posted: Array<{ data: unknown; transfer: Transferable[] }> = []
  /** Set when `process()` returned false: the engine stops calling it. */
  finished = false
  private portClosed = false
  private readonly processor: InstanceType<ProcessorConstructor>
  private readonly processorPort: ProcessorPortDouble
  private readonly inputs: Float32Array[] = [
    new Float32Array(RENDER_QUANTUM_FRAMES),
    new Float32Array(RENDER_QUANTUM_FRAMES),
  ]
  private readonly outputs: Float32Array[][] = [
    [new Float32Array(RENDER_QUANTUM_FRAMES), new Float32Array(RENDER_QUANTUM_FRAMES)],
  ]
  private inputSample = Number.NaN

  constructor(context: AudioContextDoubleInstance, name: string, options?: Record<string, unknown>) {
    const Processor = context.registeredProcessors.get(name)
    if (!Processor) {
      throw new DOMException(`The node name '${name}' is not defined in AudioWorkletGlobalScope.`, 'InvalidStateError')
    }
    this.context = context
    this.name = name
    this.options = options
    this.port = {
      onmessage: null,
      postMessage: vi.fn((data: unknown) => {
        if (this.portClosed || control.audioWorklet?.processorDeaf) return
        queueMicrotask(() => this.processorPort.onmessage?.({ data }))
      }),
      close: vi.fn(() => {
        this.portClosed = true
      }),
    }
    this.processorPort = {
      onmessage: null,
      postMessage: (data: unknown, transfer: Transferable[] = []) => {
        this.posted.push({ data, transfer })
        this.inbox.push(structuredClone(data, { transfer }))
        if (!control.audioWorklet?.holdMessages) queueMicrotask(() => this.deliver())
      },
    }
    constructingPort = this.processorPort
    try {
      this.processor = new Processor(options)
    } finally {
      constructingPort = null
    }
    context.workletNodes.push(this)
  }

  /**
   * Hand the page up to `count` of the oldest messages the processor posted,
   * in order. A closed port hands over nothing — and stops mid-way if the page
   * closes it from inside a handler. Returns how many were handed over.
   */
  deliver(count = Infinity): number {
    let delivered = 0
    while (delivered < count && this.inbox.length > 0 && !this.portClosed) {
      const data = this.inbox.shift()
      delivered++
      this.port.onmessage?.({ data })
    }
    return delivered
  }

  /**
   * One render quantum: `input(channel, frame)` for each of `channelCount`
   * input channels (none at all models an input with nothing connected), or a
   * constant 0.25 when no function is given.
   */
  renderQuantum(
    frame: number,
    input: ((channel: number, frame: number) => number) | undefined,
    channelCount: number
  ): void {
    if (this.finished) return
    if (input) {
      for (let c = 0; c < this.inputs.length; c++) {
        for (let i = 0; i < RENDER_QUANTUM_FRAMES; i++) this.inputs[c][i] = input(c, frame + i)
      }
      this.inputSample = Number.NaN
    } else if (this.inputSample !== 0.25) {
      for (const channel of this.inputs) channel.fill(0.25)
      this.inputSample = 0.25
    }
    this.context.renderingFrame = frame
    const inputs = [this.inputs.slice(0, channelCount)]
    if (!this.processor.process(inputs, this.outputs, {})) this.finished = true
  }
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
  /**
   * `control.currentTimeAt` at the current `performance.now()` when set; else,
   * on a context with the AudioWorklet double, the render position — frames
   * rendered so far over the rate, which is what a real context reports;
   * else undefined.
   */
  get currentTime(): number | undefined {
    if (control.currentTimeAt) return control.currentTimeAt(performance.now())
    return this.audioWorklet ? this.renderedFrames / this.sampleRate : undefined
  }
  /** Present only when `control.audioWorklet` was set at construction. */
  audioWorklet?: { addModule: ReturnType<typeof vi.fn<(url: string) => Promise<void>>> }
  /** What the evaluated worklet modules registered, by name. */
  readonly registeredProcessors = new Map<string, ProcessorConstructor>()
  /** Every AudioWorkletNode built on this context, in creation order. */
  readonly workletNodes: AudioWorkletNodeDouble[] = []
  /** Frames rendered so far — the worklet scope's `currentFrame` between quanta. */
  renderedFrames = 0
  /** `currentFrame` as the processor being called sees it. */
  renderingFrame = 0
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
    if (control.audioWorklet) {
      const scope = {
        registerProcessor: (name: string, processor: ProcessorConstructor) => {
          this.registeredProcessors.set(name, processor)
        },
        AudioWorkletProcessor: AudioWorkletProcessorDouble,
      }
      Object.defineProperties(scope, {
        currentFrame: { get: () => this.renderingFrame },
        sampleRate: { get: () => this.sampleRate },
      })
      this.audioWorklet = {
        addModule: vi.fn(async () => {
          const blob = lastObjectUrlBlob()
          const worklet = control.audioWorklet!
          if (worklet.addModuleGate) await worklet.addModuleGate
          if (worklet.addModuleError !== null) throw worklet.addModuleError
          evaluateWorkletModule(await blob.text(), scope)
        }),
      }
    }
    control.contexts.push(this)
  }

  /**
   * Render `frames` (a whole number of quanta) through every AudioWorkletNode
   * on this context, in creation order, advancing the render position.
   * `input(channel, frame)` supplies the samples; `channelCount` 0 is an input
   * with nothing connected.
   */
  render(
    frames: number,
    input?: (channel: number, frame: number) => number,
    channelCount = 2
  ): void {
    if (frames % RENDER_QUANTUM_FRAMES !== 0) {
      throw new Error(`render(): ${frames} is not a whole number of ${RENDER_QUANTUM_FRAMES}-frame quanta`)
    }
    for (let done = 0; done < frames; done += RENDER_QUANTUM_FRAMES) {
      for (const node of this.workletNodes) node.renderQuantum(this.renderedFrames, input, channelCount)
      this.renderedFrames += RENDER_QUANTUM_FRAMES
    }
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
let originalAudioWorkletNode: unknown
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
    originalAudioWorkletNode = g.AudioWorkletNode
    g.AudioContext = AudioContextDoubleInstance
    g.AudioWorkletNode = AudioWorkletNodeDouble
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
  if (originalAudioWorkletNode === undefined) delete g.AudioWorkletNode
  else g.AudioWorkletNode = originalAudioWorkletNode
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
  control.currentTimeAt = null
  control.audioWorklet = null
}

/** The single AudioContext the code under test created (fails loudly if none). */
export function lastAudioContext(): AudioContextDoubleInstance {
  const ctx = control.contexts[control.contexts.length - 1]
  if (!ctx) throw new Error('No AudioContext was constructed')
  return ctx
}
