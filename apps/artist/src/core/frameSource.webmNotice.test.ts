// ESCSUITE-261: the decode worker is MP4-only, so a WebM source (every
// ESCAPECRAFT recording) always decodes in a <video> element, but only an MP4
// that *fell back* raised the once-per-export "Decoding in the page" notice.
// An export that includes a WebM source now says so too, at creation, through
// the same channel and the same once-per-export latch.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportToMP4 } from './exportMP4'
import { FrameSourceFactory } from './frameSource'
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

// The decode worker is admitted only in an engine whose worker output was
// measured against its own <video> (ESCSUITE-254 fix round 1, B1); jsdom's
// user agent is not one, so this file, which exists to drive the WebCodecs
// path, says it is.
vi.mock('./workerDecodeEngine', () => ({ isMeasuredWorkerDecodeEngine: () => true }))

const IN_PAGE_NOTICE = 'Decoding in the page; keep this tab in the foreground'

/** What the scripted decode worker does with each source. */
const worker = vi.hoisted(() => ({
  /** INIT_SOURCE is answered with this error, for every source. */
  refuse: null as string | null,
  /** REQUEST_FRAME for `failSource` is answered with an error once it has served this many frames. */
  failSource: 'video2',
  failAfter: Infinity,
  failure: 'Decoder stalled: no output for 5000ms',
  served: new Map<string, number>(),
  /** Every REQUEST_FRAME, in order. */
  requests: [] as Array<{ sourceId: string; timestamp: number }>,
}))

/**
 * Stands in for `workers/decodeWorker.ts` behind the real VideoDecodeManager,
 * so the manager's own bookkeeping — which requests a dispose rejects, what
 * it does with a frame that arrives for a request it already settled — is
 * what the export runs through (fix round 1, M2: a stand-in for the manager
 * itself could not see either). Answers are asynchronous, the failing
 * source's first: so the other source's request is still in flight when the
 * failing source is handed over and disposed.
 */
class ScriptedDecodeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  private timers = new Set<ReturnType<typeof setTimeout>>()

  constructor() {
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
    if (request.type === 'INIT_SOURCE') {
      this.later(0, () => {
        if (worker.refuse) {
          this.reply({ type: 'ERROR', error: worker.refuse, fatal: true, sourceId: request.sourceId })
          return
        }
        const info = { sourceId: request.sourceId, duration: 10, width: 640, height: 360, codec: 'avc1.64001f', frameCount: 300, keyframeCount: 10 }
        this.reply({ type: 'SOURCE_READY', sourceId: request.sourceId, info })
      })
    } else if (request.type === 'REQUEST_FRAME') {
      worker.requests.push({ sourceId: request.sourceId, timestamp: request.timestamp })
      const served = worker.served.get(request.sourceId) ?? 0
      if (request.sourceId === worker.failSource && served >= worker.failAfter) {
        this.later(0, () => this.reply({ type: 'ERROR', error: worker.failure, fatal: false, sourceId: request.sourceId, requestId: request.requestId }))
        return
      }
      worker.served.set(request.sourceId, served + 1)
      this.later(5, () => {
        const Frame = (globalThis as unknown as { VideoFrame: typeof VideoFrameDouble }).VideoFrame
        const frame = new Frame({ timestamp: request.timestamp * 1e6 })
        this.reply({ type: 'FRAME_READY', requestId: request.requestId, sourceId: request.sourceId, timestamp: request.timestamp, frame })
      })
    }
  }

  terminate() {
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
/** Restored by hand, not with vi.unstubAllGlobals(), which would drop src/test/setup.ts's stubs too (ESCSUITE-119). */
const realWorker = globalThis.Worker

beforeEach(async () => {
  worker.refuse = null
  worker.failAfter = Infinity
  worker.served = new Map()
  worker.requests = []
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

async function store(types: Record<string, string>) {
  for (const [id, type] of Object.entries(types)) {
    await storeVideo(id, new Blob([new Uint8Array(8)], { type }), makeSourceVideo({ id }))
  }
}

/** Export one 0.2 s clip per source, each on its own track. */
async function exportSources(ids: string[]): Promise<ExportProgress[]> {
  const progress: ExportProgress[] = []
  const clips = ids.map((id, i) =>
    makeClip({ id: `clip-${id}`, sourceVideoId: id, trackId: `track-${i}`, duration: 0.2, endTime: 0.2 })
  )
  const tracks = ids.map((_, i) => makeTrack({ id: `track-${i}`, index: i }))
  await exportToMP4(
    clips,
    ids.map((id) => makeSourceVideo({ id })),
    makeExportOptions(),
    (p) => progress.push(p),
    tracks
  )
  return progress
}

const notices = (progress: ExportProgress[]) => progress.filter((p) => p.message === IN_PAGE_NOTICE)

describe('an MP4 export says when a source the worker cannot take decodes in the page (ESCSUITE-261)', () => {
  it('says so once, at export start, for a project with one WebM source', async () => {
    await store({ video1: 'video/webm' })

    const progress = await exportSources(['video1'])

    expect(notices(progress)).toEqual([{ phase: 'preparing', progress: 12, message: IN_PAGE_NOTICE }])
    // The WebM source still took the <video> path, as before.
    expect(media.videos).toHaveLength(1)
    expect(worker.requests).toHaveLength(0)
  })

  it('says so once for a WebM source beside an MP4, and the MP4 stays in the worker', async () => {
    await store({ video1: 'video/webm', video2: 'video/mp4' })

    const progress = await exportSources(['video1', 'video2'])

    expect(notices(progress)).toHaveLength(1)
    expect(media.videos).toHaveLength(1)
    expect(worker.requests.filter((r) => r.sourceId === 'video2')).toHaveLength(6)
    expect(worker.requests.filter((r) => r.sourceId === 'video1')).toHaveLength(0)
  })

  it('says so once for two WebM sources', async () => {
    await store({ video1: 'video/webm', video2: 'video/webm;codecs=vp9,opus' })

    const progress = await exportSources(['video1', 'video2'])

    expect(notices(progress)).toHaveLength(1)
    expect(media.videos).toHaveLength(2)
  })

  it('says nothing for an export whose sources are all MP4', async () => {
    await store({ video1: 'video/mp4', video2: 'video/mp4' })

    const progress = await exportSources(['video1', 'video2'])

    expect(notices(progress)).toEqual([])
    expect(media.videos).toHaveLength(0)
    expect(allFramesClosed()).toBe(true)
  })

  it('says it once when a WebM source is joined by a mid-export handover of an MP4', async () => {
    await store({ video1: 'video/webm', video2: 'video/mp4' })
    worker.failAfter = 2

    const progress = await exportSources(['video1', 'video2'])

    expect(notices(progress)).toHaveLength(1)
    // The one notice is the start-of-export one, not the encoding-phase one.
    expect(notices(progress)[0].phase).toBe('preparing')
    // The handover really happened: video2 asked the worker three times, then moved to a <video>.
    expect(worker.requests.filter((r) => r.sourceId === 'video2')).toHaveLength(3)
    expect(media.videos).toHaveLength(2)
  })

  it('does not double-report a refused MP4 beside a WebM source', async () => {
    await store({ video1: 'video/webm', video2: 'video/mp4' })
    worker.refuse = 'Unsupported display matrix'

    const progress = await exportSources(['video1', 'video2'])

    expect(notices(progress)).toHaveLength(1)
  })
})

describe('the reason a non-MP4 source reports (ESCSUITE-261)', () => {
  it('names the source\'s MIME type', async () => {
    const factory = new FrameSourceFactory(true, { measuredEngine: true })
    await factory.initialize()
    const onFallback = vi.fn()

    await factory.createSource('v', new Blob([new Uint8Array(8)], { type: 'video/webm' }), 'video/webm', undefined, onFallback)

    expect(onFallback).toHaveBeenCalledTimes(1)
    expect(onFallback).toHaveBeenCalledWith('v', 'video/webm sources decode in the page; only MP4 sources use the decode worker')
    factory.dispose()
  })
})
