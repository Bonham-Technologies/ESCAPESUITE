// Doubles for AudioContext / OfflineAudioContext and the AudioBuffer they
// decode to.
//
// jsdom has no Web Audio at all, and the global stub in src/test/setup.ts
// returns undefined from decodeAudioData(), so waveform extraction can only be
// exercised against something that hands back real sample data. This double
// decodes to an AudioBuffer carrying the Float32Array channels the test
// supplies, records the buffers it was asked to decode, and can be scripted to
// reject the way a file with no decodable audio track does.
import { vi } from 'vitest'

export interface AudioBufferDouble {
  readonly numberOfChannels: number
  readonly length: number
  readonly sampleRate: number
  readonly duration: number
  getChannelData(channel: number): Float32Array
}

export function createAudioBufferDouble(
  channels: Float32Array[],
  sampleRate = 48000
): AudioBufferDouble {
  const length = channels[0]?.length ?? 0
  return {
    numberOfChannels: channels.length,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (channel: number) => channels[channel],
  }
}

export interface AudioContextDoubles {
  /** Every ArrayBuffer handed to decodeAudioData(), in order. */
  readonly decodeCalls: ArrayBuffer[]
  /** How many AudioContexts the code under test created. */
  readonly created: number
  /** How many of them it close()d — a leak here means a leaked hardware context. */
  readonly closed: number
  /** What decodeAudioData() resolves to. Set to null to make it reject. */
  buffer: AudioBufferDouble | null
  uninstall(): void
}

const MISSING = Symbol('missing')

/**
 * Install an AudioContext double that decodes to `buffer`. Scope to the tests
 * that need it: install in beforeEach, uninstall in afterEach (it restores
 * whatever global was there before, including setup.ts's stub).
 */
export function installAudioContextDouble(buffer: AudioBufferDouble | null): AudioContextDoubles {
  const g = globalThis as unknown as Record<string, unknown>
  const previous = 'AudioContext' in g ? g.AudioContext : MISSING

  const state = {
    decodeCalls: [] as ArrayBuffer[],
    created: 0,
    closed: 0,
    buffer,
  }

  g.AudioContext = class AudioContextDouble {
    constructor() {
      state.created += 1
    }

    decodeAudioData = vi.fn(async (data: ArrayBuffer) => {
      state.decodeCalls.push(data)
      if (!state.buffer) throw new Error('Unable to decode audio data')
      return state.buffer as unknown as AudioBuffer
    })

    close = vi.fn(async () => {
      state.closed += 1
    })

    destination = {}
    createGain = vi.fn(() => ({ connect: vi.fn(), gain: { value: 1 } }))
    createBufferSource = vi.fn(() => ({ connect: vi.fn(), start: vi.fn(), stop: vi.fn() }))
  }

  return {
    get decodeCalls() {
      return state.decodeCalls
    },
    get created() {
      return state.created
    },
    get closed() {
      return state.closed
    },
    get buffer() {
      return state.buffer
    },
    set buffer(next: AudioBufferDouble | null) {
      state.buffer = next
    },
    uninstall() {
      if (previous === MISSING) delete g.AudioContext
      else g.AudioContext = previous
    },
  }
}

export interface OfflineContextConstruction {
  numberOfChannels: number
  length: number
  sampleRate: number
}

export interface OfflineAudioContextDoubles {
  /** The (channels, length, sampleRate) of every OfflineAudioContext created. */
  readonly constructions: OfflineContextConstruction[]
  /** Every ArrayBuffer handed to decodeAudioData(), in order. */
  readonly decodeCalls: ArrayBuffer[]
  /**
   * What each decode resolves to, by call index. Returning null rejects the
   * decode the way a file with no decodable audio track does.
   */
  decode: (data: ArrayBuffer, index: number) => AudioBufferDouble | null
  uninstall(): void
}

const OFFLINE_MISSING = Symbol('missing')

/**
 * Install an OfflineAudioContext double for the export audio mixer.
 *
 * src/test/setup.ts's global stub returns undefined from decodeAudioData(),
 * so the mixer cannot get past its first clip against it. This double decodes
 * to whatever the test scripts and records the context geometry the mixer asked
 * for, which is what proves the output buffer was sized from the timeline
 * duration rather than the source.
 */
export function installOfflineAudioContextDouble(
  decode: (data: ArrayBuffer, index: number) => AudioBufferDouble | null
): OfflineAudioContextDoubles {
  const g = globalThis as unknown as Record<string, unknown>
  const previous = 'OfflineAudioContext' in g ? g.OfflineAudioContext : OFFLINE_MISSING

  const constructions: OfflineContextConstruction[] = []
  const decodeCalls: ArrayBuffer[] = []
  const state = { decode }

  g.OfflineAudioContext = class OfflineAudioContextDouble {
    constructor(numberOfChannels: number, length: number, sampleRate: number) {
      constructions.push({ numberOfChannels, length, sampleRate })
    }

    decodeAudioData = vi.fn(async (data: ArrayBuffer) => {
      const index = decodeCalls.length
      decodeCalls.push(data)
      const buffer = state.decode(data, index)
      if (!buffer) throw new Error('Unable to decode audio data')
      return buffer as unknown as AudioBuffer
    })
  }

  return {
    constructions,
    decodeCalls,
    get decode() {
      return state.decode
    },
    set decode(next) {
      state.decode = next
    },
    uninstall() {
      if (previous === OFFLINE_MISSING) delete g.OfflineAudioContext
      else g.OfflineAudioContext = previous
    },
  }
}
