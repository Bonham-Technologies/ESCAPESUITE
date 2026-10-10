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

/** What the stand-in decode manager does with each source. */
const worker = vi.hoisted(() => ({
  /** loadSource rejects with this, for every source. */
  refuse: null as Error | null,
  /** getFrame rejects with this once this many frames have been served. */
  failAfter: Infinity,
  failure: new Error('Decoder stalled: no output for 5000ms'),
  served: 0,
}))

vi.mock('./videoDecodeManager', () => ({
  VideoDecodeManager: class {
    static isSupported = () => true

    async initialize() {}

    async loadSource(sourceId: string) {
      if (worker.refuse) throw worker.refuse
      return { sourceId, duration: 10, width: 640, height: 360, codec: 'avc1.64001f', frameCount: 300, keyframeCount: 10 }
    }

    async getFrame(_sourceId: string, timestamp: number) {
      if (worker.served >= worker.failAfter) throw worker.failure
      worker.served++
      const Frame = (globalThis as unknown as { VideoFrame: typeof VideoFrameDouble }).VideoFrame
      return new Frame({ timestamp })
    }

    async disposeSource() {}

    terminate() {}
  },
}))

let webcodecs: WebCodecsDoubles
let offscreen: OffscreenCanvasDouble
let media: MediaDoubles
let spies: Array<ReturnType<typeof vi.spyOn>>

beforeEach(async () => {
  worker.refuse = null
  worker.failAfter = Infinity
  worker.served = 0
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
    worker.refuse = new Error('Unsupported display matrix')

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

  it('reports once, at the current encoding progress, when the worker gives up mid-export, and still draws every frame', async () => {
    worker.failAfter = 4 // two export frames of two sources each

    const progress = await exportTwoSources()

    const said = notices(progress)
    expect(said).toHaveLength(1)
    expect(said[0].phase).toBe('encoding')
    // It does not move the progress bar backwards.
    const index = progress.indexOf(said[0])
    expect(said[0].progress).toBeGreaterThanOrEqual(progress[index - 1].progress)
    expect(progress[index + 1].progress).toBeGreaterThanOrEqual(said[0].progress)
    // The rest of the export was decoded by <video> elements, which were seeked.
    expect(media.videos).toHaveLength(2)
    expect(media.seeks.length).toBeGreaterThan(0)
    // Every frame of the 0.2 s export still reached the encoder.
    expect(webcodecs.videoEncoders[0].encodes).toHaveLength(6)
    expect(allFramesClosed()).toBe(true)
  })
})
