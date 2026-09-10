// Recording double for the `mediabunny` muxer.
//
// Mediabunny writes real containers, which is far too heavy (and far too
// opaque) for a unit test. This double keeps the same object graph — an
// Output owning a target and a set of packet sources — and records everything
// the code under test hands it: the tracks it added, the order of
// start()/finalize(), and every packet added to each source. Assertions can
// then be made about *what was muxed*, not merely that a stub was called.
//
// Usage:
//   vi.mock('mediabunny', async () => {
//     const { createMediabunnyDouble } = await import('../test/doubles/mediabunny')
//     return createMediabunnyDouble()
//   })
// and reach the recorded state from the test with getMediabunnyState().
//
// Adapted from apps/craft/src/test/doubles/mediabunny.ts. The two apps mux with
// the same mediabunny surface, so the double is deliberately identical apart
// from this note; see the task report for the hoisting question.
import { vi } from 'vitest'

export interface AddedTrack {
  kind: 'video' | 'audio'
  source: PacketSourceDouble
  options: unknown
}

export interface AddedPacket {
  packet: unknown
  meta: unknown
}

export interface MediabunnyState {
  outputs: OutputDouble[]
  videoSources: PacketSourceDouble[]
  audioSources: PacketSourceDouble[]
  targets: BufferTargetDouble[]
  formats: OutputFormatDouble[]
  /** Ordered log of the lifecycle calls made across every object. */
  callLog: string[]
  /** Bytes the muxer "writes" into the target on finalize. */
  finalizedByteLength: number
  /** Set to false to simulate a muxer that produced nothing. */
  producesBuffer: boolean
  /** Set to make Output.start() reject. */
  startError: Error | null
  /** Set to make Output.finalize() reject. */
  finalizeError: Error | null
}

const state: MediabunnyState = {
  outputs: [],
  videoSources: [],
  audioSources: [],
  targets: [],
  formats: [],
  callLog: [],
  finalizedByteLength: 128,
  producesBuffer: true,
  startError: null,
  finalizeError: null,
}

export class BufferTargetDouble {
  buffer: ArrayBuffer | null = null

  constructor() {
    state.targets.push(this)
  }
}

export class OutputFormatDouble {
  readonly name: 'mp4' | 'webm'
  readonly options: unknown

  constructor(name: 'mp4' | 'webm', options: unknown) {
    this.name = name
    this.options = options
    state.formats.push(this)
  }
}

export class PacketSourceDouble {
  readonly packets: AddedPacket[] = []
  readonly kind: 'video' | 'audio'
  readonly codec: string
  readonly add = vi.fn(async (packet: unknown, meta?: unknown) => {
    this.packets.push({ packet, meta })
  })

  constructor(kind: 'video' | 'audio', codec: string) {
    this.kind = kind
    this.codec = codec
  }
}

export class OutputDouble {
  readonly tracks: AddedTrack[] = []
  readonly format: OutputFormatDouble
  readonly target: BufferTargetDouble
  startCalls = 0
  finalizeCalls = 0

  constructor(options: { format: OutputFormatDouble; target: BufferTargetDouble }) {
    this.format = options.format
    this.target = options.target
    state.outputs.push(this)
  }

  addVideoTrack = vi.fn((source: PacketSourceDouble, options?: unknown) => {
    state.callLog.push('Output.addVideoTrack')
    this.tracks.push({ kind: 'video', source, options })
  })

  addAudioTrack = vi.fn((source: PacketSourceDouble, options?: unknown) => {
    state.callLog.push('Output.addAudioTrack')
    this.tracks.push({ kind: 'audio', source, options })
  })

  start = vi.fn(async () => {
    state.callLog.push('Output.start')
    this.startCalls++
    if (state.startError) throw state.startError
  })

  finalize = vi.fn(async () => {
    state.callLog.push('Output.finalize')
    this.finalizeCalls++
    if (state.finalizeError) throw state.finalizeError
    if (state.producesBuffer) {
      this.target.buffer = new ArrayBuffer(state.finalizedByteLength)
    }
  })
}

/** Stand-in for mediabunny's EncodedPacket wrapper around an encoded chunk. */
export interface EncodedPacketDouble {
  chunk: unknown
  type: unknown
  timestamp: unknown
}

/**
 * The module shape to hand back from a vi.mock('mediabunny', ...) factory.
 * Every call is recorded in the module-level state shared with the test.
 */
export function createMediabunnyDouble() {
  return {
    Output: OutputDouble,
    BufferTarget: BufferTargetDouble,
    Mp4OutputFormat: class Mp4OutputFormat extends OutputFormatDouble {
      constructor(options?: unknown) {
        super('mp4', options)
      }
    },
    WebMOutputFormat: class WebMOutputFormat extends OutputFormatDouble {
      constructor(options?: unknown) {
        super('webm', options)
      }
    },
    EncodedVideoPacketSource: class EncodedVideoPacketSource extends PacketSourceDouble {
      constructor(codec: string) {
        super('video', codec)
        state.videoSources.push(this)
      }
    },
    EncodedAudioPacketSource: class EncodedAudioPacketSource extends PacketSourceDouble {
      constructor(codec: string) {
        super('audio', codec)
        state.audioSources.push(this)
      }
    },
    EncodedPacket: {
      fromEncodedChunk: vi.fn((chunk: { type?: unknown; timestamp?: unknown }): EncodedPacketDouble => ({
        chunk,
        type: chunk?.type,
        timestamp: chunk?.timestamp,
      })),
    },
  }
}

/** Everything the code under test handed to mediabunny since the last reset. */
export function getMediabunnyState(): MediabunnyState {
  return state
}

/** The single Output the code under test created (fails loudly if none). */
export function lastMediabunnyOutput(): OutputDouble {
  const output = state.outputs[state.outputs.length - 1]
  if (!output) throw new Error('No mediabunny Output was constructed')
  return output
}

export function resetMediabunnyDouble(): void {
  state.outputs.length = 0
  state.videoSources.length = 0
  state.audioSources.length = 0
  state.targets.length = 0
  state.formats.length = 0
  state.callLog.length = 0
  state.finalizedByteLength = 128
  state.producesBuffer = true
  state.startError = null
  state.finalizeError = null
}
