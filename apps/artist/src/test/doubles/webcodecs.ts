// Doubles for the parts of WebCodecs ESCAPEARTIST touches: VideoFrame
// (identity + close() bookkeeping), the VideoEncoder/VideoDecoder static
// isConfigSupported() probes used for capability detection, and — for the
// export pipeline — working VideoEncoder/AudioEncoder instances plus AudioData.
//
// jsdom implements none of WebCodecs, so `typeof VideoFrame` is 'undefined' and
// every capability probe short-circuits. These doubles record what was asked
// and let a test script the answers, so both the supported and unsupported
// paths are exercised for real.
import { vi } from 'vitest'

export interface FrameDouble {
  readonly displayWidth: number
  readonly displayHeight: number
  readonly timestamp: number
  readonly closed: boolean
  close(): void
}

const liveFrames = new Set<VideoFrameDouble>()

export interface VideoFrameInit {
  displayWidth?: number
  displayHeight?: number
  timestamp?: number
  duration?: number
}

function isFrameInit(value: unknown): value is VideoFrameInit {
  if (value === null || typeof value !== 'object') return false
  // A canvas/image source has none of these; an init bag has at least one.
  return ['displayWidth', 'displayHeight', 'timestamp', 'duration'].some((k) => k in value)
}

export class VideoFrameDouble implements FrameDouble {
  readonly displayWidth: number
  readonly displayHeight: number
  readonly timestamp: number
  readonly duration: number | undefined
  /**
   * The canvas/image the frame was captured from, when constructed the way the
   * exporters do (`new VideoFrame(canvas, { timestamp, duration })`).
   */
  readonly source: unknown
  closed = false
  /** How many times close() was called — a second close is a bug worth catching. */
  closeCalls = 0

  constructor(sourceOrInit: unknown = {}, maybeInit?: VideoFrameInit) {
    const fromSource = maybeInit !== undefined || !isFrameInit(sourceOrInit)
    const init: VideoFrameInit = (fromSource ? maybeInit : sourceOrInit as VideoFrameInit) ?? {}
    this.source = fromSource ? sourceOrInit : undefined

    const canvas = this.source as { width?: number; height?: number } | undefined
    this.displayWidth = init.displayWidth ?? canvas?.width ?? 1920
    this.displayHeight = init.displayHeight ?? canvas?.height ?? 1080
    this.timestamp = init.timestamp ?? 0
    this.duration = init.duration
    liveFrames.add(this)
  }

  close(): void {
    this.closeCalls += 1
    this.closed = true
    liveFrames.delete(this)
  }
}

/** Every VideoFrameDouble created and not yet closed. */
export function openFrames(): VideoFrameDouble[] {
  return [...liveFrames]
}

/** True when every VideoFrameDouble ever created has been closed. */
export function allFramesClosed(): boolean {
  return liveFrames.size === 0
}

export function resetFrameRegistry(): void {
  liveFrames.clear()
}

export interface CodecProbe {
  /** Every config handed to isConfigSupported(), in order. */
  readonly configs: unknown[]
  /** Decide the answer per codec string. Default: everything is supported. */
  answer: (config: { codec: string }) => boolean | Promise<never>
}

/** A chunk the encoder double emits — the shape mediabunny wraps in a packet. */
export interface EncodedChunkDouble {
  type: 'key' | 'delta'
  timestamp: number
  duration: number | undefined
  byteLength: number
}

export interface VideoEncodeCall {
  timestamp: number
  keyFrame: boolean
}

/** One instance of the VideoEncoder double, with everything it was asked to do. */
export interface VideoEncoderRecord {
  readonly configs: unknown[]
  readonly encodes: VideoEncodeCall[]
  readonly emitted: EncodedChunkDouble[]
  readonly flushes: number
  readonly closes: number
  readonly state: 'unconfigured' | 'configured' | 'closed'
}

export interface AudioEncoderRecord {
  readonly configs: unknown[]
  readonly encodes: Array<{ timestamp: number; numberOfFrames: number }>
  readonly emitted: EncodedChunkDouble[]
  readonly flushes: number
  readonly closes: number
  readonly state: 'unconfigured' | 'configured' | 'closed'
}

export interface AudioDataRecord {
  format: string
  sampleRate: number
  numberOfFrames: number
  numberOfChannels: number
  timestamp: number
  data: Float32Array
  closed: boolean
}

export interface EncoderScript {
  /**
   * Throw from videoEncoder.encode() on these zero-based *attempts*, the way a
   * wedged encoder does. The exporter retries a failed encode once as a
   * keyframe, so [0] exercises the retry and [0, 1] the fatal path.
   */
  failVideoEncodeAt: number[]
  /**
   * Report an asynchronous encoder error (the `error:` callback) once this many
   * encode() calls have been made. -1 means never.
   */
  videoErrorAfterEncodes: number
  /** Same, for the audio encoder. */
  audioErrorAfterEncodes: number
  /** Bytes each emitted chunk claims to carry. */
  chunkByteLength: number
}

export interface WebCodecsDoubles {
  readonly encoder: CodecProbe
  readonly decoder: CodecProbe
  /** isConfigSupported() probe for AudioEncoder (the AAC check in MP4 export). */
  readonly audio: CodecProbe
  /** Every VideoEncoder the code under test constructed, in order. */
  readonly videoEncoders: VideoEncoderRecord[]
  readonly audioEncoders: AudioEncoderRecord[]
  /** Every AudioData the code under test constructed, in order. */
  readonly audioData: AudioDataRecord[]
  readonly script: EncoderScript
  uninstall(): void
}

const MISSING = Symbol('missing')

function stash(name: string): unknown {
  const g = globalThis as unknown as Record<string, unknown>
  return name in g ? g[name] : MISSING
}

function restore(name: string, previous: unknown): void {
  const g = globalThis as unknown as Record<string, unknown>
  if (previous === MISSING) delete g[name]
  else g[name] = previous
}

type EncoderInit = {
  output: (chunk: EncodedChunkDouble, meta?: unknown) => void | Promise<void>
  error: (error: DOMException | Error) => void
}

/**
 * Install VideoFrame/VideoEncoder/VideoDecoder/AudioEncoder/AudioData globals.
 * Scope them to the tests that need them: install in beforeEach, uninstall in
 * afterEach.
 *
 * The encoders are working doubles, not stubs: encode() queues a chunk, hands
 * it to the `output` callback asynchronously (as a real encoder does, so the
 * muxer sees packets after the call returns), tracks encodeQueueSize, and
 * flush() resolves only once every queued output callback has settled.
 */
export function installWebCodecsDoubles(): WebCodecsDoubles {
  const previous = {
    VideoFrame: stash('VideoFrame'),
    VideoEncoder: stash('VideoEncoder'),
    VideoDecoder: stash('VideoDecoder'),
    AudioEncoder: stash('AudioEncoder'),
    AudioData: stash('AudioData'),
  }

  const encoder: CodecProbe = { configs: [], answer: () => true }
  const decoder: CodecProbe = { configs: [], answer: () => true }
  const audio: CodecProbe = { configs: [], answer: () => true }

  const videoEncoders: VideoEncoderRecord[] = []
  const audioEncoders: AudioEncoderRecord[] = []
  const audioData: AudioDataRecord[] = []
  const script: EncoderScript = {
    failVideoEncodeAt: [],
    videoErrorAfterEncodes: -1,
    audioErrorAfterEncodes: -1,
    chunkByteLength: 64,
  }

  const g = globalThis as unknown as Record<string, unknown>
  g.VideoFrame = VideoFrameDouble

  class VideoEncoderDouble implements VideoEncoderRecord {
    static isConfigSupported = vi.fn(async (config: { codec: string }) => {
      encoder.configs.push(config)
      const supported = encoder.answer(config)
      return { supported: await supported, config }
    })

    readonly configs: unknown[] = []
    readonly encodes: VideoEncodeCall[] = []
    readonly emitted: EncodedChunkDouble[] = []
    flushes = 0
    closes = 0
    state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured'
    encodeQueueSize = 0

    private readonly init: EncoderInit
    private pending: Promise<void>[] = []
    private attempts = 0

    constructor(init: EncoderInit) {
      this.init = init
      videoEncoders.push(this)
    }

    configure(config: unknown): void {
      this.configs.push(config)
      this.state = 'configured'
    }

    encode(frame: { timestamp?: number; duration?: number }, options?: { keyFrame?: boolean }): void {
      const attempt = this.attempts++
      if (script.failVideoEncodeAt.includes(attempt)) {
        throw new Error(`encode failed on attempt ${attempt}`)
      }
      this.encodes.push({ timestamp: frame.timestamp ?? 0, keyFrame: options?.keyFrame === true })
      const chunk: EncodedChunkDouble = {
        type: options?.keyFrame ? 'key' : 'delta',
        timestamp: frame.timestamp ?? 0,
        duration: frame.duration,
        byteLength: script.chunkByteLength,
      }
      this.emitted.push(chunk)
      this.encodeQueueSize += 1
      // A real encoder delivers output on a later task, never inside encode().
      this.pending.push(
        Promise.resolve()
          .then(() => this.init.output(chunk, { decoderConfig: this.configs[0] }))
          .then(() => {
            this.encodeQueueSize -= 1
          })
      )
      if (
        script.videoErrorAfterEncodes >= 0 &&
        this.encodes.length === script.videoErrorAfterEncodes
      ) {
        this.init.error(new Error('video encoder failed'))
      }
    }

    async flush(): Promise<void> {
      this.flushes += 1
      const inflight = this.pending
      this.pending = []
      await Promise.all(inflight)
    }

    close(): void {
      this.closes += 1
      this.state = 'closed'
    }
  }

  class AudioEncoderDouble implements AudioEncoderRecord {
    static isConfigSupported = vi.fn(async (config: { codec: string }) => {
      audio.configs.push(config)
      const supported = audio.answer(config)
      return { supported: await supported, config }
    })

    readonly configs: unknown[] = []
    readonly encodes: Array<{ timestamp: number; numberOfFrames: number }> = []
    readonly emitted: EncodedChunkDouble[] = []
    flushes = 0
    closes = 0
    state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured'
    encodeQueueSize = 0

    private readonly init: EncoderInit
    private pending: Promise<void>[] = []

    constructor(init: EncoderInit) {
      this.init = init
      audioEncoders.push(this)
    }

    configure(config: unknown): void {
      this.configs.push(config)
      this.state = 'configured'
    }

    encode(data: { timestamp?: number; numberOfFrames?: number }): void {
      this.encodes.push({
        timestamp: data.timestamp ?? 0,
        numberOfFrames: data.numberOfFrames ?? 0,
      })
      const chunk: EncodedChunkDouble = {
        type: 'key',
        timestamp: data.timestamp ?? 0,
        duration: undefined,
        byteLength: script.chunkByteLength,
      }
      this.emitted.push(chunk)
      this.encodeQueueSize += 1
      this.pending.push(
        Promise.resolve()
          .then(() => this.init.output(chunk, { decoderConfig: this.configs[0] }))
          .then(() => {
            this.encodeQueueSize -= 1
          })
      )
      if (
        script.audioErrorAfterEncodes >= 0 &&
        this.encodes.length === script.audioErrorAfterEncodes
      ) {
        this.init.error(new Error('audio encoder failed'))
      }
    }

    async flush(): Promise<void> {
      this.flushes += 1
      const inflight = this.pending
      this.pending = []
      await Promise.all(inflight)
    }

    close(): void {
      this.closes += 1
      this.state = 'closed'
    }
  }

  class AudioDataDouble implements AudioDataRecord {
    format: string
    sampleRate: number
    numberOfFrames: number
    numberOfChannels: number
    timestamp: number
    data: Float32Array
    closed = false

    constructor(init: {
      format: string
      sampleRate: number
      numberOfFrames: number
      numberOfChannels: number
      timestamp: number
      data: Float32Array
    }) {
      this.format = init.format
      this.sampleRate = init.sampleRate
      this.numberOfFrames = init.numberOfFrames
      this.numberOfChannels = init.numberOfChannels
      this.timestamp = init.timestamp
      // Copy: the caller reuses its scratch buffer between chunks.
      this.data = new Float32Array(init.data)
      audioData.push(this)
    }

    close(): void {
      this.closed = true
    }
  }

  g.VideoEncoder = VideoEncoderDouble
  g.AudioEncoder = AudioEncoderDouble
  g.AudioData = AudioDataDouble
  g.VideoDecoder = class {
    static isConfigSupported = vi.fn(async (config: { codec: string }) => {
      decoder.configs.push(config)
      const supported = decoder.answer(config)
      return { supported: await supported, config }
    })
  }

  return {
    encoder,
    decoder,
    audio,
    videoEncoders,
    audioEncoders,
    audioData,
    script,
    uninstall() {
      restore('VideoFrame', previous.VideoFrame)
      restore('VideoEncoder', previous.VideoEncoder)
      restore('VideoDecoder', previous.VideoDecoder)
      restore('AudioEncoder', previous.AudioEncoder)
      restore('AudioData', previous.AudioData)
      resetFrameRegistry()
    },
  }
}

/**
 * Remove the WebCodecs globals entirely, the way a browser without WebCodecs
 * looks. Returns an uninstall function that puts them back.
 */
export function removeWebCodecsGlobals(): () => void {
  const previous = {
    VideoFrame: stash('VideoFrame'),
    VideoEncoder: stash('VideoEncoder'),
    VideoDecoder: stash('VideoDecoder'),
  }
  const g = globalThis as unknown as Record<string, unknown>
  delete g.VideoFrame
  delete g.VideoEncoder
  delete g.VideoDecoder
  return () => {
    restore('VideoFrame', previous.VideoFrame)
    restore('VideoEncoder', previous.VideoEncoder)
    restore('VideoDecoder', previous.VideoDecoder)
  }
}
