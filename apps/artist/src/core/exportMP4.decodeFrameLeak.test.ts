// ESCSUITE-123: an MP4 export leaks one decoded VideoFrame per frame of every
// transition, because `frameManager`'s cleanup map used to key frames by
// `${sourceId}:${timestamp}` — a key that is not unique when the outgoing clip
// of a whole-clip transition is fetched twice in the same export frame (once
// as an ordinary "active clip", once as the transition's own outgoing side).
//
// `exportMP4.test.ts` drives the same transition shape but never exercises
// this: jsdom has no real `Worker`, so `VideoDecodeManager.isSupported()` is
// false there and every clip falls back to the HTMLVideoElement frame source,
// which `frameManager` never tracks for cleanup at all. This file mocks
// `VideoDecodeManager` the way `frameManager.test.ts` and `frameSource.test.ts`
// do, so the export actually runs the WebCodecs decode path end to end and the
// leak is visible as a `VideoFrameDouble` that `allFramesClosed()` catches.
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
import {
  VideoFrameDouble,
  allFramesClosed,
  installWebCodecsDoubles,
  resetFrameRegistry,
  type WebCodecsDoubles,
} from '../test/doubles/webcodecs'
import { makeClip, makeExportOptions, makeSourceVideo, makeTrack } from '../test/fixtures/clipFixtures'

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

// The decode manager owns a Web Worker running WebCodecs, neither of which
// exists in jsdom. Stand in for it with a recording double that hands out a
// fresh VideoFrameDouble per call — the real bug only shows up when the two
// call sites genuinely get two distinct frames back, as `decodeWorker.ts`'s
// `frame.clone()` guarantees in the browser.
const decoder = vi.hoisted(() => ({
  frames: [] as Array<{ sourceId: string; timestamp: number }>,
}))

vi.mock('./videoDecodeManager', () => ({
  VideoDecodeManager: class {
    static isSupported = () => true

    async initialize() {}

    async loadSource(sourceId: string) {
      return {
        sourceId,
        duration: 10,
        width: 640,
        height: 360,
        codec: 'avc1.640028',
        frameCount: 300,
        keyframeCount: 10,
      }
    }

    async getFrame(sourceId: string, timestamp: number) {
      decoder.frames.push({ sourceId, timestamp })
      const Frame = (globalThis as unknown as { VideoFrame: typeof VideoFrameDouble }).VideoFrame
      return new Frame({ timestamp })
    }

    async disposeSource() {}

    terminate() {}
  },
}))

let webcodecs: WebCodecsDoubles
let offscreen: OffscreenCanvasDouble
let logs: ReturnType<typeof vi.spyOn>
let warns: ReturnType<typeof vi.spyOn>
let errors: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  decoder.frames = []
  resetMediabunnyDouble()
  resetFrameRegistry()
  installCanvasDouble()
  offscreen = installOffscreenCanvasDouble()
  webcodecs = installWebCodecsDoubles()
  logs = vi.spyOn(console, 'log').mockImplementation(() => {})
  warns = vi.spyOn(console, 'warn').mockImplementation(() => {})
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  await storeVideo('video1', new Blob([new Uint8Array(8)], { type: 'video/mp4' }), makeSourceVideo())
  await storeVideo(
    'video2',
    new Blob([new Uint8Array(8)], { type: 'video/mp4' }),
    makeSourceVideo({ id: 'video2' })
  )
})

afterEach(() => {
  webcodecs.uninstall()
  offscreen.uninstall()
  uninstallCanvasDouble()
  resetFrameRegistry()
  logs.mockRestore()
  warns.mockRestore()
  errors.mockRestore()
})

describe('exportToMP4 decoded-frame ownership (ESCSUITE-123)', () => {
  it('closes every decoded VideoFrame across a whole-clip transition, with no survivors', async () => {
    // Clip 'a' is entirely a transition (transition.duration === clip.duration),
    // so it is both an "active clip" in the media pass AND the transition's own
    // outgoing clip at the very same source time — the exact double fetch the
    // finding describes.
    const clips = [
      makeClip({
        id: 'a',
        duration: 0.2,
        endTime: 0.2,
        timelinePosition: 0,
        transition: { type: 'fade', duration: 0.2 },
      }),
      makeClip({
        id: 'b',
        sourceVideoId: 'video2',
        duration: 0.2,
        endTime: 0.2,
        timelinePosition: 0.2,
      }),
    ]
    const sources = [makeSourceVideo(), makeSourceVideo({ id: 'video2' })]

    await exportToMP4(
      clips,
      sources,
      makeExportOptions({ timeRange: { start: 0, end: 0.1 } }),
      vi.fn(),
      [makeTrack()]
    )

    // Every frame fetched from the decoder must have been closed by the time
    // the export finishes — the whole point of the conservation law the
    // *.perf.test.ts files assert elsewhere for the canvas-side frames.
    expect(decoder.frames.length).toBeGreaterThan(0)
    expect(allFramesClosed()).toBe(true)
  })
})
