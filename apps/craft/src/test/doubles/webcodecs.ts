// Test doubles for the WebCodecs APIs (VideoEncoder, AudioEncoder,
// VideoDecoder, VideoFrame, AudioData).
//
// jsdom implements none of WebCodecs, so anything that encodes has to be given
// stand-ins. These are *recording* doubles rather than bare stubs: they honour
// the real lifecycle (configure -> encode -> flush -> close), keep the `state`
// machine, emit synthetic EncodedVideoChunk/EncodedAudioChunk objects through
// the caller's `output` callback, and report failures through the caller's
// `error` callback the way the real encoders do. Every VideoFrame/AudioData
// handed out records whether it was close()d, so tests can prove the code under
// test never leaks a frame — on success, on abort, and on error.
import { vi } from 'vitest'

export type EncoderFailStep = 'configure' | 'encode' | 'encodeThrow' | 'flush'

export interface SyntheticEncodedChunk {
  type: 'key' | 'delta'
  timestamp: number
  duration: number | null
  byteLength: number
  copyTo(destination: Uint8Array | ArrayBuffer): void
}

export interface RecordedEncode {
  /** The VideoFrame/AudioData double handed to encode(). */
  data: FrameDouble
  options: { keyFrame?: boolean } | undefined
  /** The chunk this encode() produced, as delivered to the output callback. */
  chunk: SyntheticEncodedChunk
}

export interface EncoderInitLike {
  output: (chunk: SyntheticEncodedChunk, meta?: unknown) => void
  error: (error: Error) => void
}

/** Shared ordered log so tests can assert cross-object sequencing (e.g. that
 *  both encoders flush before the muxer is finalized). */
export const webcodecsCallLog: string[] = []

function makeChunk(type: 'key' | 'delta', timestamp: number, duration: number | null, size: number): SyntheticEncodedChunk {
  return {
    type,
    timestamp,
    duration,
    byteLength: size,
    copyTo(destination) {
      const view = destination instanceof ArrayBuffer ? new Uint8Array(destination) : destination
      for (let i = 0; i < Math.min(view.length, size); i++) view[i] = i % 256
    },
  }
}

/** Base for the two encoder doubles — they differ only in name and chunk shape. */
class EncoderDouble {
  static readonly label: string = 'Encoder'
  state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured'
  encodeQueueSize = 0

  readonly configureCalls: unknown[] = []
  readonly encodes: RecordedEncode[] = []
  flushCalls = 0
  closeCalls = 0

  /** Set to make the next call at that step fail. */
  failAt: EncoderFailStep | null = null
  /** Queue depths handed back by encodeQueueSize; each read pops one. */
  private queueScript: number[] = []

  readonly init: EncoderInitLike
  private chunkTimestamp = 0

  constructor(init: EncoderInitLike) {
    this.init = init
  }

  private get label(): string {
    return (this.constructor as typeof EncoderDouble).label
  }

  /** Script the encodeQueueSize backpressure the caller will observe. */
  setQueueScript(depths: number[]): void {
    this.queueScript = [...depths]
    Object.defineProperty(this, 'encodeQueueSize', {
      configurable: true,
      get: () => (this.queueScript.length > 0 ? this.queueScript.shift()! : 0),
    })
  }

  configure(config: unknown): void {
    webcodecsCallLog.push(`${this.label}.configure`)
    this.configureCalls.push(config)
    if (this.failAt === 'configure') {
      this.state = 'closed'
      throw new Error(`${this.label} configuration failed`)
    }
    this.state = 'configured'
  }

  encode(data: FrameDouble, options?: { keyFrame?: boolean }): void {
    webcodecsCallLog.push(`${this.label}.encode`)
    if (this.failAt === 'encodeThrow') {
      throw new Error(`${this.label} encode failed`)
    }
    const chunk = makeChunk(
      options?.keyFrame ? 'key' : 'delta',
      data.timestamp ?? this.chunkTimestamp,
      data.duration ?? null,
      64
    )
    this.chunkTimestamp += 1000
    this.encodes.push({ data, options, chunk })
    if (this.failAt === 'encode') {
      this.state = 'closed'
      this.init.error(new Error(`${this.label} encoding error`))
      return
    }
    this.init.output(chunk, { decoderConfig: { codec: 'test' } })
  }

  async flush(): Promise<void> {
    webcodecsCallLog.push(`${this.label}.flush`)
    this.flushCalls++
    if (this.failAt === 'flush') {
      throw new Error(`${this.label} flush failed`)
    }
  }

  close(): void {
    webcodecsCallLog.push(`${this.label}.close`)
    this.closeCalls++
    this.state = 'closed'
  }

  /** Report an asynchronous encoder failure, as the real API does. */
  emitError(message: string): void {
    this.state = 'closed'
    this.init.error(new Error(message))
  }
}

export type ConfigSupportPlan = boolean | 'throw' | ((config: unknown) => boolean | 'throw')

function resolveSupport(plan: ConfigSupportPlan, config: unknown): boolean {
  const outcome = typeof plan === 'function' ? plan(config) : plan
  if (outcome === 'throw') throw new Error('isConfigSupported failed')
  return outcome
}

export class VideoEncoderDouble extends EncoderDouble {
  static readonly label = 'VideoEncoder'
  static readonly instances: VideoEncoderDouble[] = []
  /** Programmable answer for the static isConfigSupported(). */
  static supportPlan: ConfigSupportPlan = true

  constructor(init: EncoderInitLike) {
    super(init)
    VideoEncoderDouble.instances.push(this)
  }

  static async isConfigSupported(config: unknown): Promise<{ supported: boolean; config: unknown }> {
    return { supported: resolveSupport(VideoEncoderDouble.supportPlan, config), config }
  }
}

export class AudioEncoderDouble extends EncoderDouble {
  static readonly label = 'AudioEncoder'
  static readonly instances: AudioEncoderDouble[] = []
  static supportPlan: ConfigSupportPlan = true

  constructor(init: EncoderInitLike) {
    super(init)
    AudioEncoderDouble.instances.push(this)
  }

  static async isConfigSupported(config: unknown): Promise<{ supported: boolean; config: unknown }> {
    return { supported: resolveSupport(AudioEncoderDouble.supportPlan, config), config }
  }
}

export class VideoDecoderDouble {
  static readonly instances: VideoDecoderDouble[] = []
  static supportPlan: ConfigSupportPlan = true

  state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured'
  decodeQueueSize = 0
  readonly configureCalls: unknown[] = []
  readonly decodedChunks: SyntheticEncodedChunk[] = []
  flushCalls = 0
  closeCalls = 0
  failAt: EncoderFailStep | null = null

  private readonly init: EncoderInitLike

  constructor(init: EncoderInitLike) {
    this.init = init
    VideoDecoderDouble.instances.push(this)
  }

  static async isConfigSupported(config: unknown): Promise<{ supported: boolean; config: unknown }> {
    return { supported: resolveSupport(VideoDecoderDouble.supportPlan, config), config }
  }

  configure(config: unknown): void {
    this.configureCalls.push(config)
    if (this.failAt === 'configure') {
      this.state = 'closed'
      throw new Error('VideoDecoder configuration failed')
    }
    this.state = 'configured'
  }

  decode(chunk: SyntheticEncodedChunk): void {
    this.decodedChunks.push(chunk)
    if (this.failAt === 'encode') {
      this.state = 'closed'
      this.init.error(new Error('VideoDecoder decoding error'))
      return
    }
    this.init.output(chunk)
  }

  async flush(): Promise<void> {
    this.flushCalls++
    if (this.failAt === 'flush') throw new Error('VideoDecoder flush failed')
  }

  close(): void {
    this.closeCalls++
    this.state = 'closed'
  }
}

/** Shared shape of the VideoFrame / AudioData doubles. */
export interface FrameDouble {
  readonly kind: 'VideoFrame' | 'AudioData'
  readonly source: unknown
  readonly init: Record<string, unknown> | undefined
  readonly timestamp: number | undefined
  readonly duration: number | null
  closed: boolean
  close(): void
}

const frameRegistry: FrameDouble[] = []

class FrameBase implements FrameDouble {
  closed = false
  readonly kind: 'VideoFrame' | 'AudioData'
  readonly source: unknown
  readonly init: Record<string, unknown> | undefined
  readonly close = vi.fn(() => {
    this.closed = true
  })

  constructor(
    kind: 'VideoFrame' | 'AudioData',
    source: unknown,
    init: Record<string, unknown> | undefined
  ) {
    this.kind = kind
    this.source = source
    this.init = init
    frameRegistry.push(this)
  }

  get timestamp(): number | undefined {
    return this.init?.timestamp as number | undefined
  }

  get duration(): number | null {
    return (this.init?.duration as number | undefined) ?? null
  }
}

export class VideoFrameDouble extends FrameBase {
  constructor(source: unknown, init?: Record<string, unknown>) {
    super('VideoFrame', source, init)
  }
}

export class AudioDataDouble extends FrameBase {
  constructor(init: Record<string, unknown>) {
    super('AudioData', init.data, init)
  }
}

/** Every VideoFrame/AudioData the code under test constructed, oldest first. */
export function getCreatedFrames(kind?: 'VideoFrame' | 'AudioData'): FrameDouble[] {
  return kind ? frameRegistry.filter(f => f.kind === kind) : [...frameRegistry]
}

/** True when every frame constructed so far has been close()d. */
export function allFramesClosed(): boolean {
  return frameRegistry.every(f => f.closed)
}

let originalGlobals: Record<string, unknown> | null = null

const GLOBAL_NAMES = ['VideoEncoder', 'AudioEncoder', 'VideoDecoder', 'VideoFrame', 'AudioData'] as const

/**
 * Install the doubles as the WebCodecs globals. Uses plain assignment rather
 * than vi.stubGlobal so uninstalling restores exactly what was there before,
 * independently of any other stubbing in the same file.
 */
export function installWebCodecsDoubles(): void {
  if (originalGlobals) return
  const g = globalThis as unknown as Record<string, unknown>
  originalGlobals = {}
  for (const name of GLOBAL_NAMES) originalGlobals[name] = g[name]
  g.VideoEncoder = VideoEncoderDouble
  g.AudioEncoder = AudioEncoderDouble
  g.VideoDecoder = VideoDecoderDouble
  g.VideoFrame = VideoFrameDouble
  g.AudioData = AudioDataDouble
}

export function uninstallWebCodecsDoubles(): void {
  if (!originalGlobals) return
  const g = globalThis as unknown as Record<string, unknown>
  for (const name of GLOBAL_NAMES) {
    if (originalGlobals[name] === undefined) delete g[name]
    else g[name] = originalGlobals[name]
  }
  originalGlobals = null
}

/** Clear every recorded call, instance and frame. Call between tests. */
export function resetWebCodecsDoubles(): void {
  VideoEncoderDouble.instances.length = 0
  AudioEncoderDouble.instances.length = 0
  VideoDecoderDouble.instances.length = 0
  VideoEncoderDouble.supportPlan = true
  AudioEncoderDouble.supportPlan = true
  VideoDecoderDouble.supportPlan = true
  frameRegistry.length = 0
  webcodecsCallLog.length = 0
}

/** The single VideoEncoder the code under test created (fails loudly if none). */
export function lastVideoEncoder(): VideoEncoderDouble {
  const enc = VideoEncoderDouble.instances[VideoEncoderDouble.instances.length - 1]
  if (!enc) throw new Error('No VideoEncoder was constructed')
  return enc
}

export function lastAudioEncoder(): AudioEncoderDouble {
  const enc = AudioEncoderDouble.instances[AudioEncoderDouble.instances.length - 1]
  if (!enc) throw new Error('No AudioEncoder was constructed')
  return enc
}
