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

export interface ScriptProcessorDouble {
  bufferSize: number
  onaudioprocess: ((event: { inputBuffer: AudioBufferDouble }) => void) | null
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

export interface AnalyserDouble {
  fftSize: number
  readonly frequencyBinCount: number
  connect: ReturnType<typeof vi.fn>
  getByteFrequencyData: ReturnType<typeof vi.fn>
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
}

const control: AudioContextDoubleControl = {
  contexts: [],
  decodeResult: null,
  constructorThrows: false,
  initialState: 'running',
  destinationTrackCount: 1,
  analyserLevel: 0,
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
  readonly resume = vi.fn(async () => {
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

  constructor(options?: { sampleRate?: number }) {
    if (control.constructorThrows) throw new Error('AudioContext is unavailable')
    this.state = control.initialState
    this.sampleRate = options?.sampleRate ?? 48000
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

  createMediaStreamSource(stream: MediaStream) {
    this.mediaStreamSources.push(stream)
    return { connect: vi.fn() }
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
}

/** The single AudioContext the code under test created (fails loudly if none). */
export function lastAudioContext(): AudioContextDoubleInstance {
  const ctx = control.contexts[control.contexts.length - 1]
  if (!ctx) throw new Error('No AudioContext was constructed')
  return ctx
}
