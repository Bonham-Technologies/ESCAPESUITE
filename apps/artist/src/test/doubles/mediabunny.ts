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
// the same mediabunny surface and the two doubles are deliberately close, but
// they are **not** identical: ESCSUITE-159 ported craft's `state` model and its
// state-aware `cancel`/`finalize` over here (so the exporter can read
// `output.state` the way craft's `cleanup()` does), while craft's own copy
// carries a `startGate` this app has no use for and logs its `finalize()` into
// the encoders' shared list where this one logs its `cancel()`. Keep the
// lifecycle semantics in step; do not assume the files match line for line.
import { vi } from 'vitest'
import { webcodecsCallLog } from './webcodecs'

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
  /** Set to make Output.cancel() reject — a muxer that will not let go. */
  cancelError: Error | null
  /**
   * Packets a source refused because its output had already been cancelled
   * (ESCSUITE-159).
   *
   * The real `EncodedVideoPacketSource.add()` throws `'Output has been
   * canceled.'`, and the exporter hands it to the muxer from inside an
   * `output: async (chunk, meta) => …` callback nobody awaits — so one late
   * packet is an unhandled rejection, not a silent write. Counting them is how a
   * test asks whether the encoders were closed before the muxer was cancelled.
   */
  lateAdds: number
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
  cancelError: null,
  lateAdds: 0,
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
  /** The output this source was added to, set by `addVideoTrack`/`addAudioTrack`. */
  output: OutputDouble | null = null
  readonly add = vi.fn(async (packet: unknown, meta?: unknown) => {
    // What the real source does once its output has been cancelled.
    if (this.output?.state === 'canceled') {
      state.lateAdds += 1
      throw new Error('Output has been canceled.')
    }
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
  cancelCalls = 0
  /**
   * The real Output's own lifecycle state, mirrored faithfully because
   * `exportWebM.ts` reads it: its catch cancels exactly the outputs still
   * sitting at `'started'`, as ESCAPECRAFT's recorder `cleanup()` does.
   * `finalize()` moves to `'finalizing'` and then either `'finalized'` or —
   * when it throws — `'canceled'`, as the library does
   * (`mediabunny/dist/modules/src/output.js`).
   */
  state: 'pending' | 'started' | 'canceled' | 'finalizing' | 'finalized' = 'pending'

  constructor(options: { format: OutputFormatDouble; target: BufferTargetDouble }) {
    this.format = options.format
    this.target = options.target
    state.outputs.push(this)
  }

  addVideoTrack = vi.fn((source: PacketSourceDouble, options?: unknown) => {
    state.callLog.push('Output.addVideoTrack')
    source.output = this
    this.tracks.push({ kind: 'video', source, options })
  })

  addAudioTrack = vi.fn((source: PacketSourceDouble, options?: unknown) => {
    state.callLog.push('Output.addAudioTrack')
    source.output = this
    this.tracks.push({ kind: 'audio', source, options })
  })

  start = vi.fn(async () => {
    state.callLog.push('Output.start')
    this.startCalls++
    if (state.startError) throw state.startError
    this.state = 'started'
  })

  /**
   * Mediabunny's own cancellation call (ESCSUITE-159): it closes the output's
   * unfinalised target and force-closes every packet source, which is what an
   * export that threw after `start()` owes the muxer it opened. Idempotent and a
   * no-op on an output that is `'canceled'`, `'finalizing'` or `'finalized'`,
   * exactly as the real one is — a second cancel is not an error, and a finished
   * file has nothing left to release (the real library only logs a warning).
   *
   * Logged into the encoders' shared list as well, because the question "were
   * the encoders closed before the muxer was cancelled" is an ordering one and
   * only one ordered list can answer it.
   */
  cancel = vi.fn(async () => {
    if (this.state === 'canceled' || this.state === 'finalizing' || this.state === 'finalized') {
      return
    }
    state.callLog.push('Output.cancel')
    webcodecsCallLog.push('Output.cancel')
    this.cancelCalls++
    this.state = 'canceled'
    if (state.cancelError) throw state.cancelError
  })

  finalize = vi.fn(async () => {
    state.callLog.push('Output.finalize')
    this.finalizeCalls++
    this.state = 'finalizing'
    if (state.finalizeError) {
      // The library's own catch: a rejected finalize leaves the output
      // `'canceled'`, having already closed its targets in its `finally`.
      this.state = 'canceled'
      throw state.finalizeError
    }
    if (state.producesBuffer) {
      this.target.buffer = new ArrayBuffer(state.finalizedByteLength)
    }
    this.state = 'finalized'
  })
}

/** Stand-in for mediabunny's EncodedPacket wrapper around an encoded chunk. */
export interface EncodedPacketDouble {
  chunk: unknown
  type: unknown
  timestamp: unknown
}

/**
 * Every chunk wrapped for the muxer, in order. Module-level so
 * resetMediabunnyDouble() can clear its call history between tests.
 */
export const fromEncodedChunk = vi.fn(
  (chunk: { type?: unknown; timestamp?: unknown }): EncodedPacketDouble => ({
    chunk,
    type: chunk?.type,
    timestamp: chunk?.timestamp,
  })
)

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
    EncodedPacket: { fromEncodedChunk },
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
  fromEncodedChunk.mockClear()
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
  state.cancelError = null
  state.lateAdds = 0
}
