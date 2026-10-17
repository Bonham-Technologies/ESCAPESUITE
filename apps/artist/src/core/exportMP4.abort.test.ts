// ESCSUITE-314: Cancel is honoured while the MP4 exporter waits on the decode
// worker.
//
// The source-load loop awaited each `loadFrameSource` with no abort check
// between them, and the decode manager raced nothing against the export's
// signal, which was read only where the frame loop reached it. So a Cancel
// during the loads loaded every remaining source into the worker anyway, and a
// Cancel during a frame request waited for the worker to answer — forever, on a
// worker that keeps reporting progress (ESCSUITE-272). The dialog closes on
// Cancel at once (ESCSUITE-98), so a user who started another export had two
// workers holding sources.
//
// Like exportMP4.decodeFallback.test.ts, this drives the real VideoDecodeManager
// against a scripted stand-in for `workers/decodeWorker.ts`, on real timers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportToMP4 } from './exportMP4'
import { ExportAbortedError } from './exportTypes'
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

const IN_PAGE_NOTICE = 'Decoding in the page; keep this tab in the foreground'

/** What the scripted decode worker does, and what it saw. */
const worker = vi.hoisted(() => ({
  /** How long after INIT_SOURCE the worker answers SOURCE_READY. */
  loadMs: 0,
  /** Called right after a source's SOURCE_READY is delivered, in the same task. */
  afterReady: null as ((sourceId: string) => void) | null,
  /** Called when a message is posted to the worker. */
  onPost: null as ((type: string, sourceId: string) => void) | null,
  /** REQUEST_FRAME is never answered, but FRAME_PROGRESS is posted for it every 50 ms. */
  holdFrames: false,
  /** Every source the manager asked the worker to load, in order. */
  loaded: [] as string[],
  terminated: 0,
}))

class ScriptedDecodeWorker {
  static instances: ScriptedDecodeWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  private timers = new Set<ReturnType<typeof setTimeout>>()

  constructor() {
    ScriptedDecodeWorker.instances.push(this)
    this.later(0, () => this.reply({ type: 'WORKER_READY' }))
  }

  /** Answer after `ms`, unless terminated first — as a real worker's pending work dies with it. */
  private later(ms: number, answer: () => void) {
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      answer()
    }, ms)
    this.timers.add(timer)
  }

  postMessage(request: { type: string; sourceId: string; timestamp: number; requestId: number }) {
    worker.onPost?.(request.type, request.sourceId)
    if (request.type === 'INIT_SOURCE') {
      worker.loaded.push(request.sourceId)
      this.later(worker.loadMs, () => {
        const info = { sourceId: request.sourceId, duration: 10, width: 640, height: 360, codec: 'avc1.64001f', frameCount: 300, keyframeCount: 10 }
        this.reply({ type: 'SOURCE_READY', sourceId: request.sourceId, info })
        worker.afterReady?.(request.sourceId)
      })
    } else if (request.type === 'REQUEST_FRAME') {
      if (worker.holdFrames) {
        const progress = () => this.later(50, () => {
          this.reply({ type: 'FRAME_PROGRESS', requestId: request.requestId })
          progress()
        })
        progress()
        return
      }
      this.later(1, () => {
        const Frame = (globalThis as unknown as { VideoFrame: typeof VideoFrameDouble }).VideoFrame
        const frame = new Frame({ timestamp: request.timestamp * 1e6 })
        this.reply({ type: 'FRAME_READY', requestId: request.requestId, sourceId: request.sourceId, timestamp: request.timestamp, frame })
      })
    }
  }

  terminate() {
    worker.terminated += 1
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
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

const SOURCES = ['video1', 'video2', 'video3']

beforeEach(async () => {
  worker.loadMs = 0
  worker.afterReady = null
  worker.onPost = null
  worker.holdFrames = false
  worker.loaded = []
  worker.terminated = 0
  ScriptedDecodeWorker.instances = []
  globalThis.Worker = ScriptedDecodeWorker as unknown as typeof Worker
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
  for (const id of SOURCES) {
    await storeVideo(id, new Blob([new Uint8Array(8)], { type: 'video/mp4' }), makeSourceVideo({ id }))
  }
})

afterEach(() => {
  // An export a failing case left running must not keep posting into the next one.
  for (const instance of ScriptedDecodeWorker.instances) instance.terminate()
  globalThis.Worker = realWorker
  webcodecs.uninstall()
  media.uninstall()
  offscreen.uninstall()
  uninstallCanvasDouble()
  resetFrameRegistry()
  for (const spy of spies) spy.mockRestore()
})

/** Export three clips, one per source, stacked for 0.2 s, under `signal`. */
function exportThreeSources(signal: AbortSignal, progress: ExportProgress[] = []): Promise<unknown> {
  const clips = SOURCES.map((id, i) =>
    makeClip({ id: `c${i}`, sourceVideoId: id, trackId: `track-${i}`, duration: 0.2, endTime: 0.2 })
  )
  const tracks = SOURCES.map((_, i) => makeTrack({ id: `track-${i}`, index: i }))
  return exportToMP4(
    clips,
    SOURCES.map((id) => makeSourceVideo({ id })),
    makeExportOptions(),
    (p) => progress.push(p),
    tracks,
    signal
  )
}

/** How the export settled, and how long after `since` — or 'pending' once `capMs` passed. */
async function settleWithin(promise: Promise<unknown>, since: () => number, capMs: number) {
  const outcome = await Promise.race([
    promise.then((value) => ({ value }), (error: unknown) => ({ error })),
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), capMs)),
  ])
  return { outcome, elapsed: performance.now() - since() }
}

describe('exportToMP4 honours Cancel while it waits on the decode worker (ESCSUITE-314)', () => {
  it('Cancel while a source is loading loads no further source, terminates the worker at once and rejects with ExportAbortedError', async () => {
    const controller = new AbortController()
    worker.loadMs = 30
    let terminatedAtAbort = -1
    worker.onPost = (type, sourceId) => {
      if (type === 'INIT_SOURCE' && sourceId === 'video1') {
        setTimeout(() => {
          controller.abort()
          terminatedAtAbort = worker.terminated
        }, 5)
      }
    }

    await expect(exportThreeSources(controller.signal)).rejects.toBeInstanceOf(ExportAbortedError)

    expect(worker.loaded).toEqual(['video1'])
    expect(terminatedAtAbort).toBe(1)
    expect(worker.terminated).toBe(1)
    // An aborted load is not a refused source: no <video> stands in for it.
    expect(media.videos).toHaveLength(0)
  })

  it('Cancel between source loads loads no further source and terminates the worker', async () => {
    const controller = new AbortController()
    worker.afterReady = (sourceId) => {
      if (sourceId === 'video1') controller.abort()
    }

    await expect(exportThreeSources(controller.signal)).rejects.toBeInstanceOf(ExportAbortedError)

    expect(worker.loaded).toEqual(['video1'])
    expect(worker.terminated).toBe(1)
    expect(media.videos).toHaveLength(0)
  })

  it('Cancel while a frame request is pending terminates the worker within one tick and settles at once, encoding nothing', async () => {
    const controller = new AbortController()
    worker.holdFrames = true
    let abortedAt = 0
    let terminatedAtAbort = -1
    worker.onPost = (type) => {
      if (type === 'REQUEST_FRAME' && abortedAt === 0) {
        abortedAt = -1
        setTimeout(() => {
          abortedAt = performance.now()
          controller.abort()
          terminatedAtAbort = worker.terminated
        }, 200)
      }
    }
    const progress: ExportProgress[] = []

    const { outcome, elapsed } = await settleWithin(
      exportThreeSources(controller.signal, progress),
      () => abortedAt,
      1_500
    )

    expect(terminatedAtAbort).toBe(1)
    expect(elapsed).toBeLessThan(1_000)
    expect(outcome).toEqual({ error: expect.any(ExportAbortedError) })
    expect(worker.terminated).toBe(1)
    // The cancelled request was not handed to a <video>, and no frame was
    // drawn without it and encoded.
    expect(media.videos).toHaveLength(0)
    expect(progress.filter((p) => p.message === IN_PAGE_NOTICE)).toEqual([])
    expect(webcodecs.videoEncoders[0].encodes).toHaveLength(0)
  })
})
