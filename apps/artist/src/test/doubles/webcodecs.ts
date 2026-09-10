// Doubles for the parts of WebCodecs ESCAPEARTIST's pure logic touches:
// VideoFrame (identity + close() bookkeeping) and the VideoEncoder/VideoDecoder
// static isConfigSupported() probes used for capability detection.
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

export class VideoFrameDouble implements FrameDouble {
  readonly displayWidth: number
  readonly displayHeight: number
  readonly timestamp: number
  closed = false
  /** How many times close() was called — a second close is a bug worth catching. */
  closeCalls = 0

  constructor(init: { displayWidth?: number; displayHeight?: number; timestamp?: number } = {}) {
    this.displayWidth = init.displayWidth ?? 1920
    this.displayHeight = init.displayHeight ?? 1080
    this.timestamp = init.timestamp ?? 0
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

export interface WebCodecsDoubles {
  readonly encoder: CodecProbe
  readonly decoder: CodecProbe
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

/**
 * Install VideoFrame/VideoEncoder/VideoDecoder globals. Scope to the tests that
 * need them: install in beforeEach, uninstall in afterEach.
 */
export function installWebCodecsDoubles(): WebCodecsDoubles {
  const previous = {
    VideoFrame: stash('VideoFrame'),
    VideoEncoder: stash('VideoEncoder'),
    VideoDecoder: stash('VideoDecoder'),
  }

  const encoder: CodecProbe = { configs: [], answer: () => true }
  const decoder: CodecProbe = { configs: [], answer: () => true }

  const g = globalThis as unknown as Record<string, unknown>
  g.VideoFrame = VideoFrameDouble
  g.VideoEncoder = class {
    static isConfigSupported = vi.fn(async (config: { codec: string }) => {
      encoder.configs.push(config)
      const supported = encoder.answer(config)
      return { supported: await supported, config }
    })
  }
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
    uninstall() {
      restore('VideoFrame', previous.VideoFrame)
      restore('VideoEncoder', previous.VideoEncoder)
      restore('VideoDecoder', previous.VideoDecoder)
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
