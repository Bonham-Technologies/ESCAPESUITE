// ESCSUITE-254: the WebCodecs decode worker threw "No keyframes found in
// video" for every source from the day it shipped, and FrameSourceFactory
// caught that with a console.warn — so every MP4 export decoded in the page
// while the log said "Using WebCodecs" and the dialog promised background-tab
// encoding. The ESCSUITE-153 notice ("Decoding in the page; keep this tab in
// the foreground") only covered a worker that could not *start*.
//
// It now covers a worker that started but could not take a source, or gave
// up on one mid-export: the exporter says so once per export, however many
// sources fall back. jsdom has no Worker or VideoDecoder, so — like
// exportMP4.decodeFrameLeak.test.ts — this file stands in for the decode
// manager to make the export take the WebCodecs path at all.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportToMP4 } from './exportMP4'
import { storeVideo } from './storage'
import { elementSeekTarget } from './elementSeek'
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
  for (const id of ['video1', 'video2']) {
    await storeVideo(id, new Blob([new Uint8Array(8)], { type: 'video/mp4' }), makeSourceVideo({ id }))
  }
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

/** Export two clips, one from each of two MP4 sources, side by side for 0.2 s. */
async function exportTwoSources(): Promise<ExportProgress[]> {
  const progress: ExportProgress[] = []
  const clips = [
    makeClip({ id: 'a', sourceVideoId: 'video1', duration: 0.2, endTime: 0.2 }),
    makeClip({ id: 'b', sourceVideoId: 'video2', trackId: 'track-2', duration: 0.2, endTime: 0.2 }),
  ]
  const tracks = [makeTrack(), makeTrack({ id: 'track-2', index: 1 })]
  await exportToMP4(
    clips,
    [makeSourceVideo(), makeSourceVideo({ id: 'video2' })],
    makeExportOptions(),
    (p) => progress.push(p),
    tracks
  )
  return progress
}

const notices = (progress: ExportProgress[]) => progress.filter((p) => p.message === IN_PAGE_NOTICE)

describe('exportToMP4 says when the decode worker hands sources back to the page (ESCSUITE-254)', () => {
  it('reports the in-page notice exactly once when two sources fall back', async () => {
    worker.refuse = 'Unsupported display matrix'

    const progress = await exportTwoSources()

    expect(notices(progress)).toEqual([{ phase: 'preparing', progress: 12, message: IN_PAGE_NOTICE }])
    // Both sources were decoded by <video> elements instead.
    expect(media.videos).toHaveLength(2)
  })

  it('reports nothing when the worker takes every source', async () => {
    const progress = await exportTwoSources()

    expect(notices(progress)).toEqual([])
    expect(media.videos).toHaveLength(0)
    expect(allFramesClosed()).toBe(true)
  })

  it('reports once, at the current encoding progress, when the worker gives up on one source mid-export', async () => {
    worker.failAfter = 2 // video2's third frame fails

    const progress = await exportTwoSources()

    const said = notices(progress)
    expect(said).toHaveLength(1)
    expect(said[0].phase).toBe('encoding')
    // It does not move the progress bar backwards.
    const index = progress.indexOf(said[0])
    expect(said[0].progress).toBeGreaterThanOrEqual(progress[index - 1].progress)
    expect(progress[index + 1].progress).toBeGreaterThanOrEqual(said[0].progress)
    // Every frame of the 0.2 s export still reached the encoder.
    expect(webcodecs.videoEncoders[0].encodes).toHaveLength(6)
  })

  // Fix round 1, M2: handing one source over must not hand over the others.
  it('hands over only the failing source: the other keeps decoding in the worker, and every frame is closed', async () => {
    worker.failAfter = 2

    await exportTwoSources()

    // One <video>, for video2 — not one for each source.
    expect(media.videos).toHaveLength(1)
    // video1 was asked for all six export frames through the worker...
    expect(worker.requests.filter((r) => r.sourceId === 'video1')).toHaveLength(6)
    // ...and video2 for its first three only (the third failed).
    expect(worker.requests.filter((r) => r.sourceId === 'video2')).toHaveLength(3)
    // Every VideoFrame the worker sent back was closed. (No frame arrives late
    // here — the other source's requests are no longer rejected; closing an
    // orphaned frame is pinned in videoDecodeManager.test.ts.)
    expect(allFramesClosed()).toBe(true)
    // MINOR 7: the <video> resumed at the failing request's own time.
    const failed = worker.requests.filter((r) => r.sourceId === 'video2')[2]
    expect(media.seeks[0]).toBeCloseTo(elementSeekTarget(failed.timestamp), 6)
  })

  // Fix round 2, NIT 4 (MD2 at the exporter): the <video> the failing source
  // is handed to never loads. Its clip is skipped from then on, as the oracle
  // skips a source it cannot load, and the export still finishes.
  it('finishes the export when the <video> a source is handed to never loads', async () => {
    worker.failAfter = 2
    media.script({ video: { fail: true } })

    const progress = await exportTwoSources()

    expect(progress[progress.length - 1]).toMatchObject({ phase: 'complete' })
    expect(notices(progress)).toHaveLength(1)
    expect(webcodecs.videoEncoders[0].encodes).toHaveLength(6)
    expect(worker.requests.filter((r) => r.sourceId === 'video1')).toHaveLength(6)
    expect(allFramesClosed()).toBe(true)
  })
})
