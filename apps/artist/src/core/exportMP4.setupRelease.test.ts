// ESCSUITE-315: an MP4 export whose setup throws after the media load releases
// the decode worker.
//
// `createFrameManager` and the source-load loop ran well above the `try` whose
// `catch` disposed the frame manager; `output.start()`, both `configure()`
// calls and the caller's own `onProgress` sat between them. A throw there left
// the worker alive, holding up to 512 MB of samples, until the tab closed.
// ESCSUITE-156 moved WebM's and GIF's `try` up to the media load for exactly
// this; MP4's now begins where its ownership does, at `createFrameManager`, and
// its release runs at most once (the ESCSUITE-159 shape).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportToMP4 } from './exportMP4'
import { ExportError } from './exportTypes'
import { storeVideo } from './storage'
import { resetMediabunnyDouble } from '../test/doubles/mediabunny'
import {
  installCanvasDouble,
  installOffscreenCanvasDouble,
  uninstallCanvasDouble,
  type OffscreenCanvasDouble,
} from '../test/doubles/canvas'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import {
  VideoFrameDouble,
  allFramesClosed,
  installWebCodecsDoubles,
  resetFrameRegistry,
  type WebCodecsDoubles,
} from '../test/doubles/webcodecs'
import { makeClip, makeExportOptions, makeSourceVideo, makeTrack } from '../test/fixtures/clipFixtures'
import type { ExportProgress } from '../store/types'

vi.mock('mediabunny', async () => {
  const { createMediabunnyDouble } = await import('../test/doubles/mediabunny')
  return createMediabunnyDouble()
})

vi.mock('./audioMixer', () => ({
  extractAndMixAudio: vi.fn(async () => null),
}))

// jsdom's user agent is not a measured decode-worker engine (ESCSUITE-254).
vi.mock('./workerDecodeEngine', () => ({ isMeasuredWorkerDecodeEngine: () => true }))

const worker = vi.hoisted(() => ({ loaded: [] as string[], terminated: 0 }))

/** A decode worker stand-in that takes every source and answers every frame. */
class AnsweringDecodeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null

  constructor() {
    setTimeout(() => this.reply({ type: 'WORKER_READY' }), 0)
  }

  postMessage(request: { type: string; sourceId: string; timestamp: number; requestId: number }) {
    if (request.type === 'INIT_SOURCE') {
      worker.loaded.push(request.sourceId)
      const info = { sourceId: request.sourceId, duration: 10, width: 640, height: 360, codec: 'avc1.64001f', frameCount: 300, keyframeCount: 10 }
      setTimeout(() => this.reply({ type: 'SOURCE_READY', sourceId: request.sourceId, info }), 0)
    } else if (request.type === 'REQUEST_FRAME') {
      setTimeout(() => {
        const Frame = (globalThis as unknown as { VideoFrame: typeof VideoFrameDouble }).VideoFrame
        const frame = new Frame({ timestamp: request.timestamp * 1e6 })
        this.reply({ type: 'FRAME_READY', requestId: request.requestId, sourceId: request.sourceId, timestamp: request.timestamp, frame })
      }, 0)
    }
  }

  terminate() {
    worker.terminated += 1
  }

  private reply(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data }))
  }
}

let webcodecs: WebCodecsDoubles
let offscreen: OffscreenCanvasDouble
let media: MediaDoubles
let spies: Array<ReturnType<typeof vi.spyOn>>
/** Restored by hand, not with vi.unstubAllGlobals() (ESCSUITE-119). */
const realWorker = globalThis.Worker

beforeEach(async () => {
  worker.loaded = []
  worker.terminated = 0
  globalThis.Worker = AnsweringDecodeWorker as unknown as typeof Worker
  resetMediabunnyDouble()
  resetFrameRegistry()
  installCanvasDouble()
  offscreen = installOffscreenCanvasDouble()
  media = installMediaElementDoubles({ video: { videoWidth: 640, videoHeight: 360 } })
  webcodecs = installWebCodecsDoubles()
  spies = [
    vi.spyOn(console, 'log').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'error').mockImplementation(() => {}),
  ]
  await storeVideo('video1', new Blob([new Uint8Array(8)], { type: 'video/mp4' }), makeSourceVideo({ id: 'video1' }))
  await storeVideo('image1', new Blob([new Uint8Array(8)], { type: 'image/png' }), makeSourceVideo({ id: 'image1', mediaType: 'image' }))
})

afterEach(() => {
  globalThis.Worker = realWorker
  webcodecs.uninstall()
  media.uninstall()
  offscreen.uninstall()
  uninstallCanvasDouble()
  resetFrameRegistry()
  for (const spy of spies) spy.mockRestore()
})

/** Export a video clip with an image clip above it for 0.2 s. */
function exportVideoAndImage(onProgress: (p: ExportProgress) => void = () => {}) {
  const clips = [
    makeClip({ id: 'v', sourceVideoId: 'video1', duration: 0.2, endTime: 0.2 }),
    makeClip({ id: 'i', sourceVideoId: 'image1', trackId: 'track-2', duration: 0.2, endTime: 0.2 }),
  ]
  const tracks = [makeTrack(), makeTrack({ id: 'track-2', index: 1 })]
  return exportToMP4(
    clips,
    [makeSourceVideo({ id: 'video1' }), makeSourceVideo({ id: 'image1', mediaType: 'image' })],
    makeExportOptions(),
    onProgress,
    tracks
  )
}

/** Every revoke of the image element's own object URL. */
function imageRevokes(): number {
  const src = media.images[0].src
  return vi.mocked(URL.revokeObjectURL).mock.calls.filter(([url]) => url === src).length
}

describe('exportToMP4 releases what it loaded when its setup throws (ESCSUITE-315)', () => {
  beforeEach(() => {
    vi.mocked(URL.revokeObjectURL).mockClear()
  })

  it('terminates the decode worker exactly once when VideoEncoder.configure throws after the sources loaded', async () => {
    const Encoder = (globalThis as unknown as { VideoEncoder: { prototype: VideoEncoder } }).VideoEncoder
    vi.spyOn(Encoder.prototype, 'configure').mockImplementation(() => {
      throw new Error('configure failed')
    })

    await expect(exportVideoAndImage()).rejects.toThrow('configure failed')

    expect(worker.loaded).toEqual(['video1'])
    expect(worker.terminated).toBe(1)
    // The encoder built before the throw is closed, and the image's URL freed.
    expect(webcodecs.videoEncoders[0].closes).toBe(1)
    expect(imageRevokes()).toBe(1)
  })

  it('carries the trail on such a throw: an ExportError, as every other failure of the export is', async () => {
    const Encoder = (globalThis as unknown as { VideoEncoder: { prototype: VideoEncoder } }).VideoEncoder
    vi.spyOn(Encoder.prototype, 'configure').mockImplementation(() => {
      throw new Error('configure failed')
    })

    await expect(exportVideoAndImage()).rejects.toBeInstanceOf(ExportError)
  })

  it('still disposes exactly once on the ordinary export', async () => {
    await exportVideoAndImage()

    expect(worker.terminated).toBe(1)
    expect(imageRevokes()).toBe(1)
    expect(allFramesClosed()).toBe(true)
  })

  it('releases once when the caller\'s "complete" report throws after the release already ran', async () => {
    const onProgress = (p: ExportProgress) => {
      if (p.phase === 'complete') throw new Error('host handler failed')
    }

    await expect(exportVideoAndImage(onProgress)).rejects.toThrow('host handler failed')

    expect(worker.terminated).toBe(1)
    expect(imageRevokes()).toBe(1)
    // The encoder the success path already closed is not closed again.
    expect(webcodecs.videoEncoders[0].closes).toBe(1)
  })
})
