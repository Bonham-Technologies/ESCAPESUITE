// ESCSUITE-254: the decode worker's frame engine, against a scripted decoder.
//
// The scripted decoder behaves like a real one where it matters: it takes
// chunks in decode order and emits frames in presentation order, holding
// `reorderDelay` frames back the way an H.264 decoder with B-frames does
// until later chunks (or a flush) push them out; it consumes chunks and
// emits frames asynchronously, firing `dequeue` as it goes; and after a flush
// it accepts only a keyframe. Each case can make it misbehave — stall, drop a
// frame, fail — to prove the engine settles every request instead of hanging.
import { describe, it, expect, afterEach } from 'vitest'
import { FrameDecoder, MAX_IN_FLIGHT, TIME_TOLERANCE_US, type FrameLike } from './frameDecoder'
import type { DemuxedSample } from './mp4Demux'

const FRAME_US = 40_000

class FakeFrame implements FrameLike {
  static created: FakeFrame[] = []
  closed = false
  constructor(readonly timestamp: number) {
    FakeFrame.created.push(this)
  }
  clone(): FakeFrame {
    if (this.closed) throw new Error('clone of a closed frame')
    return new FakeFrame(this.timestamp)
  }
  close() {
    this.closed = true
  }
}

interface FakeOptions {
  reorderDelay?: number
  /** Consume chunks but never emit anything (a hung decoder). */
  stall?: boolean
  /** Never emit the frame with this timestamp. */
  drop?: number
  /** Emit a frame this many ms after its chunk is consumed. */
  outputDelayMs?: number
  /** flush() never settles. */
  hangFlush?: boolean
  /** flush() rejects with this error. */
  rejectFlush?: Error
  /** No dequeue events (an older browser): the engine has to poll. */
  noDequeue?: boolean
}

interface Chunk {
  type: 'key' | 'delta'
  timestamp: number
}

class FakeDecoder {
  decodeQueueSize = 0
  readonly decoded: Chunk[] = []
  resets = 0
  flushes = 0
  configures = 0
  closed = false
  private held: number[] = []
  private keyRequired = true
  /** Bumped by reset(), which discards work already queued, as a real decoder does. */
  private generation = 0
  private listeners: Array<() => void> = []

  private rejectFlush: ((error: Error) => void) | null = null

  constructor(
    private readonly output: (frame: FakeFrame) => void,
    private readonly error: (error: Error) => void,
    private readonly options: FakeOptions
  ) {}

  /**
   * A decoding error, the way WebCodecs closes a decoder on one: a pending
   * flush is rejected with the error, then the error callback runs.
   */
  fail(error: Error) {
    this.rejectFlush?.(error)
    this.error(error)
  }

  configure() {
    this.configures++
    this.keyRequired = true
  }

  addEventListener(_type: 'dequeue', listener: () => void) {
    if (!this.options.noDequeue) this.listeners.push(listener)
  }

  decode(chunk: Chunk) {
    if (this.keyRequired && chunk.type !== 'key') throw new Error('A key frame is required')
    this.keyRequired = false
    this.decoded.push(chunk)
    this.decodeQueueSize++
    const generation = this.generation
    setTimeout(() => {
      if (generation !== this.generation) return
      this.decodeQueueSize--
      for (const listener of this.listeners) listener()
      if (this.options.stall) return
      this.held.push(chunk.timestamp)
      this.held.sort((a, b) => a - b)
      while (this.held.length > (this.options.reorderDelay ?? 0)) this.emit(this.held.shift()!)
    }, 0)
  }

  async flush() {
    this.flushes++
    if (this.options.hangFlush) {
      return new Promise<void>((_resolve, reject) => {
        this.rejectFlush = reject
      })
    }
    if (this.options.rejectFlush) throw this.options.rejectFlush
    await new Promise((resolve) => setTimeout(resolve, 0))
    while (this.held.length > 0) this.emit(this.held.shift()!)
    await new Promise((resolve) => setTimeout(resolve, (this.options.outputDelayMs ?? 0) + 1))
    this.keyRequired = true
  }

  reset() {
    this.resets++
    this.generation++
    this.held = []
    this.decodeQueueSize = 0
  }

  close() {
    if (this.closed) throw new Error('InvalidStateError: decoder closed')
    this.closed = true
  }

  private emit(timestamp: number) {
    if (timestamp === this.options.drop) return
    const delay = this.options.outputDelayMs
    if (delay) setTimeout(() => this.output(new FakeFrame(timestamp)), delay)
    else this.output(new FakeFrame(timestamp))
  }
}

/**
 * `gops` groups of `perGop` frames at 25 fps, in decode order the way x264
 * writes them with two B-frames: the IDR, then each P frame ahead of the two
 * B frames shown before it.
 */
function samples(gops = 2, perGop = 12): DemuxedSample[] {
  const out: DemuxedSample[] = []
  for (let g = 0; g < gops; g++) {
    const base = g * perGop
    const push = (index: number, isKeyframe = false) =>
      out.push({ timestampUs: index * FRAME_US, durationUs: FRAME_US, isKeyframe, data: new Uint8Array(1) })
    push(base, true)
    for (let k = base + 1; k < base + perGop; k += 3) {
      const p = Math.min(k + 2, base + perGop - 1)
      push(p)
      for (let b = k; b < p; b++) push(b)
    }
  }
  return out
}

let decoders: FakeDecoder[] = []
const engines: FrameDecoder<FakeFrame>[] = []

function engine(options: FakeOptions & { maxCachedFrames?: number; stallTimeoutMs?: number; samples?: DemuxedSample[] } = {}) {
  const frameDecoder = new FrameDecoder<FakeFrame>({
    samples: options.samples ?? samples(),
    config: { codec: 'avc1.64000a' },
    createDecoder: (output, error) => {
      const decoder = new FakeDecoder(output, error, { reorderDelay: 2, ...options })
      decoders.push(decoder)
      return decoder as never
    },
    createChunk: (init) => ({ type: init.type, timestamp: init.timestamp }) as never,
    maxCachedFrames: options.maxCachedFrames,
    stallTimeoutMs: options.stallTimeoutMs,
  })
  engines.push(frameDecoder)
  return { frameDecoder, decoder: decoders[decoders.length - 1] }
}

/** Ask for `seconds`, assert the frame shown there came back, and close it the way the exporter does. */
async function expectFrameAt(frameDecoder: FrameDecoder<FakeFrame>, seconds: number, timestampUs: number) {
  const frame = await frameDecoder.getFrame(seconds)
  expect(frame.timestamp).toBe(timestampUs)
  frame.close()
}

afterEach(() => {
  for (const frameDecoder of engines.splice(0)) frameDecoder.dispose()
  // Every frame the decoder emitted and every clone handed out is closed:
  // nothing the engine owns outlives dispose().
  expect(FakeFrame.created.filter((frame) => !frame.closed)).toEqual([])
  FakeFrame.created = []
  decoders = []
})

describe('FrameDecoder', () => {
  it('returns every frame of an in-order export, feeding each chunk exactly once', async () => {
    const { frameDecoder, decoder } = engine()

    for (let index = 0; index < 24; index++) {
      await expectFrameAt(frameDecoder, (index * FRAME_US) / 1e6, index * FRAME_US)
    }

    expect(decoder.decoded).toHaveLength(24)
    expect(decoder.resets).toBe(0)
  })

  it('returns the frame on screen at a time between frames, the way a seeked <video> does', async () => {
    const { frameDecoder } = engine()

    await expectFrameAt(frameDecoder, 0.05, FRAME_US) // 50 ms: the 40 ms frame is showing
    await expectFrameAt(frameDecoder, 0.079, FRAME_US)
    // A float a hair under a frame boundary is that frame.
    await expectFrameAt(frameDecoder, 0.08 - (TIME_TOLERANCE_US - 1) / 1e6, 2 * FRAME_US)
  })

  it('clamps a time before the first frame or after the last', async () => {
    const { frameDecoder } = engine()

    await expectFrameAt(frameDecoder, -1, 0)
    await expectFrameAt(frameDecoder, 99, 23 * FRAME_US)
  })

  it('serves a repeated request from its cache, as a fresh clone', async () => {
    const { frameDecoder, decoder } = engine()

    const first = await frameDecoder.getFrame(0.2)
    const fed = decoder.decoded.length
    const second = await frameDecoder.getFrame(0.2)

    expect(second).not.toBe(first)
    expect(second.timestamp).toBe(first.timestamp)
    expect(decoder.decoded).toHaveLength(fed)
    first.close()
    second.close()
  })

  it('starts over from the keyframe, after a reset, for a frame behind the decoder', async () => {
    const { frameDecoder, decoder } = engine({ maxCachedFrames: 2 })

    await expectFrameAt(frameDecoder, 0.4, 10 * FRAME_US)
    await expectFrameAt(frameDecoder, 0.04, FRAME_US)

    expect(decoder.resets).toBe(1)
    expect(decoder.decoded[decoder.decoded.length - 4]).toMatchObject({ type: 'key', timestamp: 0 })
  })

  it('jumps straight to the keyframe of a later group without decoding the frames between', async () => {
    const { frameDecoder, decoder } = engine()

    await expectFrameAt(frameDecoder, 0, 0)
    const fed = decoder.decoded.length
    await expectFrameAt(frameDecoder, 0.52, 13 * FRAME_US) // second group: IDR at 12

    expect(decoder.resets).toBe(0)
    expect(decoder.decoded[fed]).toMatchObject({ type: 'key', timestamp: 12 * FRAME_US })
  })

  it('flushes for the frames a reordering decoder holds back at the end of the stream', async () => {
    const { frameDecoder, decoder } = engine({ samples: samples(1, 12) })

    await expectFrameAt(frameDecoder, 0.44, 11 * FRAME_US)

    expect(decoder.flushes).toBe(1)
  })

  it('after a flush, restarts a later request from its keyframe', async () => {
    const { frameDecoder, decoder } = engine({ samples: samples(1, 12), maxCachedFrames: 1 })

    await expectFrameAt(frameDecoder, 0.44, 11 * FRAME_US)
    await expectFrameAt(frameDecoder, 0.4, 10 * FRAME_US)

    // No reset needed: a flush leaves the decoder waiting for a keyframe.
    expect(decoder.resets).toBe(0)
    expect(decoder.decoded.filter((chunk) => chunk.type === 'key')).toHaveLength(2)
  })

  it('drains on an explicit flush, so the next request starts from a keyframe', async () => {
    const { frameDecoder, decoder } = engine({ maxCachedFrames: 1 })

    await expectFrameAt(frameDecoder, 0.12, 3 * FRAME_US)
    await frameDecoder.flush()
    // Frame 1 is behind the playhead and out of the one-frame cache.
    await expectFrameAt(frameDecoder, 0.04, FRAME_US)

    expect(decoder.flushes).toBe(1)
    expect(decoder.resets).toBe(0)
    expect(decoder.decoded.filter((chunk) => chunk.type === 'key')).toHaveLength(2)
  })

  it('keeps no more than maxCachedFrames decoded frames behind the one last handed out', async () => {
    const { frameDecoder } = engine({ maxCachedFrames: 3 })

    for (let index = 0; index < 10; index++) {
      await expectFrameAt(frameDecoder, (index * FRAME_US) / 1e6, index * FRAME_US)
      const behind = frameDecoder.cachedFrames.filter((frame) => frame.timestamp < index * FRAME_US)
      expect(behind.length).toBeLessThanOrEqual(3)
    }
  })

  it('feeds a slow decoder no further ahead than MAX_IN_FLIGHT chunks while it waits', async () => {
    // Every chunk is consumed at once but its frame takes 300 ms to come out.
    const { frameDecoder, decoder } = engine({ reorderDelay: 0, outputDelayMs: 300, stallTimeoutMs: 1_000 })

    await expectFrameAt(frameDecoder, 0, 0)

    expect(decoder.decoded).toHaveLength(MAX_IN_FLIGHT)
  })

  it('keeps the frames a slow decoder delivered ahead of the export, so nothing is decoded twice', async () => {
    // Fed ahead while waiting, a slow decoder's frames arrive beyond the one
    // asked for; closing them would send every later request back to the keyframe.
    const { frameDecoder, decoder } = engine({ reorderDelay: 0, outputDelayMs: 30, stallTimeoutMs: 500, maxCachedFrames: 2 })

    for (let index = 0; index < 24; index++) {
      await expectFrameAt(frameDecoder, (index * FRAME_US) / 1e6, index * FRAME_US)
    }

    expect(decoder.resets).toBe(0)
    expect(decoder.decoded).toHaveLength(24)
  })

  it('makes progress without dequeue events', async () => {
    const { frameDecoder } = engine({ noDequeue: true })

    await expectFrameAt(frameDecoder, 0.2, 5 * FRAME_US)
  })

  it('runs concurrent requests one at a time', async () => {
    const { frameDecoder } = engine()

    const frames = await Promise.all([frameDecoder.getFrame(0.2), frameDecoder.getFrame(0.04)])

    expect(frames.map((frame) => frame.timestamp)).toEqual([5 * FRAME_US, FRAME_US])
    for (const frame of frames) frame.close()
  })

  // ESCSUITE-272: the worker turns each call into a FRAME_PROGRESS for the
  // request, so the main thread's deadline measures silence rather than age.
  describe('reports each decoder output to the requests waiting on it', () => {
    it('once per output while a request is served, and never after it settles', async () => {
      const { frameDecoder } = engine({ reorderDelay: 0 })
      let first = 0
      // The keyframe alone: one chunk fed, one output, one call.
      const frame = await frameDecoder.getFrame(0, () => first++)
      frame.close()
      expect(first).toBe(1)

      let second = 0
      const before = FakeFrame.created.length
      const later = await frameDecoder.getFrame(0.2, () => second++)
      const emitted = FakeFrame.created.length - before - 1 // less the clone handed back
      later.close()

      expect(emitted).toBe(6) // 3, 1, 2, 6, 4, 5 in decode order
      expect(second).toBe(emitted)
      // The first request's listener went when it settled.
      expect(first).toBe(1)
    })

    it('says nothing to a request served from the cache', async () => {
      const { frameDecoder } = engine()
      await expectFrameAt(frameDecoder, 0.2, 5 * FRAME_US)
      let calls = 0

      const frame = await frameDecoder.getFrame(0.2, () => calls++)
      frame.close()

      expect(calls).toBe(0)
    })

    it('tells a request queued behind another about the outputs serving that one: its answer depends on them', async () => {
      const { frameDecoder } = engine({ reorderDelay: 0 })
      let served = 0
      let queued = 0

      const frames = await Promise.all([
        frameDecoder.getFrame(0.2, () => served++),
        frameDecoder.getFrame(0.24, () => queued++), // decoded on the way to 0.2: no outputs of its own
      ])
      for (const frame of frames) frame.close()

      expect(served).toBe(6)
      expect(queued).toBe(6)
    })
  })

  it('replaces a cached frame that is decoded again, closing the old copy', async () => {
    const { frameDecoder, decoder } = engine({ maxCachedFrames: 30 })
    for (let index = 0; index < 6; index++) {
      await expectFrameAt(frameDecoder, (index * FRAME_US) / 1e6, index * FRAME_US)
    }
    const cachedFirst = frameDecoder.cachedFrames.find((frame) => frame.timestamp === 0)!

    // Frame 1 is no longer held, so asking for it decodes 0 and 1 again.
    frameDecoder.release(0.04)
    await expectFrameAt(frameDecoder, 0.04, FRAME_US)

    expect(decoder.resets).toBe(1)
    expect(cachedFirst.closed).toBe(true)
    expect(frameDecoder.cachedFrames.filter((frame) => frame.timestamp === 0)).toHaveLength(1)
  })

  it('closes a cached frame on release, and ignores a release of one it does not hold', async () => {
    const { frameDecoder } = engine()
    await expectFrameAt(frameDecoder, 0, 0)

    frameDecoder.release(0)
    frameDecoder.release(0)

    expect(frameDecoder.cachedFrames.map((frame) => frame.timestamp)).not.toContain(0)
  })

  describe('settles every request when the decoder misbehaves', () => {
    it('fails the request, and every later one, on a decoder error', async () => {
      const { frameDecoder, decoder } = engine()
      await expectFrameAt(frameDecoder, 0, 0)

      decoder.fail(new Error('EncodingError: decode failed'))

      await expect(frameDecoder.getFrame(0.4)).rejects.toThrow('Decoder error: EncodingError: decode failed')
      await expect(frameDecoder.getFrame(0)).rejects.toThrow('Decoder error: EncodingError: decode failed')
    })

    it('fails a request whose wait the decoder errors out of', async () => {
      const { frameDecoder, decoder } = engine({ stall: true, stallTimeoutMs: 5_000 })

      const request = frameDecoder.getFrame(0.2)
      setTimeout(() => decoder.fail(new Error('OperationError')), 20)

      await expect(request).rejects.toThrow('Decoder error: OperationError')
    })

    it('fails a request when the decoder stops producing anything', async () => {
      const { frameDecoder } = engine({ stall: true, stallTimeoutMs: 50 })

      await expect(frameDecoder.getFrame(0.2)).rejects.toThrow('Decoder stalled: no output for 50ms')
    })

    it('fails a request when a flush never finishes', async () => {
      const { frameDecoder } = engine({ samples: samples(1, 12), hangFlush: true, stallTimeoutMs: 50 })

      await expect(frameDecoder.getFrame(0.44)).rejects.toThrow(
        'Decoder stalled: flush did not finish within 50ms'
      )
    })

    it("fails a request with the flush's own error, or the decoder's when it reported one first", async () => {
      const flushError = engine({ samples: samples(1, 12), rejectFlush: new Error('AbortError: flush aborted') })
      await expect(flushError.frameDecoder.getFrame(0.44)).rejects.toThrow('AbortError: flush aborted')

      const decoderError = engine({ samples: samples(1, 12), hangFlush: true, stallTimeoutMs: 5_000 })
      const request = decoderError.frameDecoder.getFrame(0.44)
      setTimeout(() => decoderError.decoder.fail(new Error('OperationError')), 20)
      await expect(request).rejects.toThrow('Decoder error: OperationError')
    })

    it('fails a request for a frame the decoder never emits', async () => {
      const { frameDecoder } = engine({ drop: 5 * FRAME_US })

      await expect(frameDecoder.getFrame(0.2)).rejects.toThrow('Decoder produced no frame at 0.2s')
    })

    it('rejects requests queued behind a dispose, and closes what arrives after it', async () => {
      const { frameDecoder, decoder } = engine({ outputDelayMs: 20 })

      const request = frameDecoder.getFrame(0.2)
      await new Promise((resolve) => setTimeout(resolve, 5))
      frameDecoder.dispose()

      await expect(request).rejects.toThrow('Source disposed')
      await expect(frameDecoder.getFrame(0)).rejects.toThrow('Source disposed')
      await new Promise((resolve) => setTimeout(resolve, 40)) // the delayed outputs land, and are closed
      expect(decoder.closed).toBe(true)
    })
  })
})
