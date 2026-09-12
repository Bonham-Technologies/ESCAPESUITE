// Per-frame work ceilings for the export pipeline.
//
// The same idea as `components/Preview/drawFrame.perf.test.ts`, one pipeline
// over: run a real export of the benchmark scene through the WebCodecs,
// mediabunny, canvas and media-element doubles, then assert the per-frame cost
// has not grown. Nothing here is mocked that the export pipeline owns — the
// canvas renderer, the frame manager, the animation cache and the exporter's
// own loop all run for real.
//
// Thirty frames of the scene's heaviest second (7-8 s: the blurred full-frame
// V1 clip under the `screen`-blended picture-in-picture V2 clip, with the text
// and shape overlays on top), which is one second of 30 fps output.
//
// Ceilings are 2x the measured value rounded up, with the measurement and its
// date beside them. Frame accounting (created == closed, encode == frames, one
// flush per encoder) is exact: those are conservation laws, not budgets.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportToMP4 } from './exportMP4'
import { storeVideo } from './storage'
import { clearAnimationCache } from '../utils/animation'
import * as animation from '../utils/animation'
import { resetMediabunnyDouble } from '../test/doubles/mediabunny'
import {
  getContextCallCount,
  getLastCanvasContext,
  installCanvasDouble,
  installOffscreenCanvasDouble,
  uninstallCanvasDouble,
  type CanvasCall,
  type OffscreenCanvasDouble,
} from '../test/doubles/canvas'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import {
  allFramesClosed,
  frameCounts,
  installWebCodecsDoubles,
  type WebCodecsDoubles,
} from '../test/doubles/webcodecs'
import {
  SCENE_RESOLUTION,
  SCENE_SOURCE_HEIGHT,
  SCENE_SOURCE_ID,
  SCENE_SOURCE_WIDTH,
  SCENE_TRACKS,
  buildSceneClips,
  sceneSource,
} from '../test/fixtures/perfScene'
import { makeExportOptions } from '../test/fixtures/exportPipeline'
import type { ExportProgress } from '../store/types'

vi.mock('mediabunny', async () => {
  const { createMediabunnyDouble } = await import('../test/doubles/mediabunny')
  return createMediabunnyDouble()
})

vi.mock('./audioMixer', () => ({
  extractAndMixAudioWithWorker: vi.fn(async () => null),
}))

/** The scene's heaviest second, at the exporter's fixed 30 fps. */
const RANGE = { start: 7, end: 8 }
const FRAMES = 30

let media: MediaDoubles
let webcodecs: WebCodecsDoubles
let offscreen: OffscreenCanvasDouble
let logs: ReturnType<typeof vi.spyOn>
let warns: ReturnType<typeof vi.spyOn>
let errors: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  resetMediabunnyDouble()
  clearAnimationCache()
  installCanvasDouble()
  offscreen = installOffscreenCanvasDouble()
  media = installMediaElementDoubles({
    video: { videoWidth: SCENE_SOURCE_WIDTH, videoHeight: SCENE_SOURCE_HEIGHT, duration: 2 },
  })
  webcodecs = installWebCodecsDoubles()
  // The exporter narrates its progress; the ceilings are about work, not noise.
  logs = vi.spyOn(console, 'log').mockImplementation(() => {})
  warns = vi.spyOn(console, 'warn').mockImplementation(() => {})
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  await storeVideo(
    SCENE_SOURCE_ID,
    new Blob([new Uint8Array(8)], { type: 'video/mp4' }),
    sceneSource
  )
})

afterEach(() => {
  webcodecs.uninstall()
  media.uninstall()
  offscreen.uninstall()
  uninstallCanvasDouble()
  logs.mockRestore()
  warns.mockRestore()
  errors.mockRestore()
  clearAnimationCache()
})

/**
 * Split the recorded calls into frames.
 *
 * Every export frame opens by clearing the whole canvas to black, and nothing
 * else fills a rect the size of the output.
 */
function splitFrames(calls: CanvasCall[]): CanvasCall[][] {
  const isClear = (call: CanvasCall) =>
    call.method === 'fillRect' &&
    String(call.args) === String([0, 0, SCENE_RESOLUTION.width, SCENE_RESOLUTION.height])

  const frames: CanvasCall[][] = []
  for (const call of calls) {
    if (isClear(call)) frames.push([])
    frames[frames.length - 1]?.push(call)
  }
  return frames
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

interface ExportMeasurement {
  framesEncoded: number
  /** 2D-context method calls in the median frame. */
  callsPerFrame: number
  drawImagesPerFrame: number
  savesPerFrame: number
  restoresPerFrame: number
  /** getAnimatedValuesCached() calls per frame, through the module boundary. */
  animationLookupsPerFrame: number
  /**
   * Share of those lookups the memo cache answered, detected by identity: a hit
   * hands back the object it stored, a miss computes a fresh one.
   */
  animationCacheHitRatio: number
  /** Distinct values the memo cache stored, per frame — i.e. what it grows by. */
  animationCacheEntriesPerFrame: number
  /** getContext() calls for the whole export — the exporter makes one canvas. */
  getContexts: number
  videoFramesCreated: number
  videoFramesClosed: number
  encodeCalls: number
  videoFlushes: number
}

async function measureExport(): Promise<ExportMeasurement> {
  const clips = buildSceneClips()
  const progress: ExportProgress[] = []
  const getAnimatedValuesCached = vi.spyOn(animation, 'getAnimatedValuesCached')
  const contextsBefore = getContextCallCount()

  await exportToMP4(
    clips,
    [sceneSource],
    makeExportOptions({ format: 'mp4', resolution: 'project', timeRange: RANGE }),
    (p) => progress.push(p),
    SCENE_TRACKS,
    undefined,
    { ...SCENE_RESOLUTION }
  )

  const ctx = getLastCanvasContext()!
  const frames = splitFrames(ctx.calls)
  const encoder = webcodecs.videoEncoders[0]
  const frameTotals = frameCounts()

  const results = getAnimatedValuesCached.mock.results
  const seen = new Set<unknown>()
  let hits = 0
  for (const result of results) {
    if (result.type !== 'return') continue
    if (seen.has(result.value)) hits += 1
    else seen.add(result.value)
  }

  const measurement: ExportMeasurement = {
    framesEncoded: frames.length,
    callsPerFrame: median(frames.map((f) => f.length)),
    drawImagesPerFrame: median(frames.map((f) => f.filter((c) => c.method === 'drawImage').length)),
    savesPerFrame: median(frames.map((f) => f.filter((c) => c.method === 'save').length)),
    restoresPerFrame: median(frames.map((f) => f.filter((c) => c.method === 'restore').length)),
    animationLookupsPerFrame: results.length / frames.length,
    animationCacheHitRatio: results.length === 0 ? 0 : hits / results.length,
    animationCacheEntriesPerFrame: seen.size / frames.length,
    getContexts: getContextCallCount() - contextsBefore,
    videoFramesCreated: frameTotals.created,
    videoFramesClosed: frameTotals.closed,
    encodeCalls: encoder.encodes.length,
    videoFlushes: encoder.flushes,
  }
  getAnimatedValuesCached.mockRestore()
  return measurement
}

describe('export per-frame work', () => {
  it('encodes 30 frames of the scene within its per-frame ceilings', async () => {
    const measured = await measureExport()

    expect(measured.framesEncoded).toBe(FRAMES)

    // Measured 2026-09-12: 24 calls, 2 drawImage, 4 save/restore pairs,
    // 4 animation lookups per frame.
    expect(measured.callsPerFrame).toBeLessThanOrEqual(48)
    expect(measured.drawImagesPerFrame).toBeLessThanOrEqual(4)
    expect(measured.animationLookupsPerFrame).toBeLessThanOrEqual(8)
    // Exact: an export that leaked a save() would drift the whole file.
    expect(measured.savesPerFrame).toBe(measured.restoresPerFrame)
    // Exact: one canvas for the whole export, not one per frame.
    expect(measured.getContexts).toBe(1)
  })

  it('creates and closes exactly one VideoFrame per encoded frame', async () => {
    const measured = await measureExport()

    // Exact: every frame handed to the encoder is closed again. A leak here is
    // the export pipeline's classic out-of-memory bug.
    expect(measured.videoFramesCreated).toBe(FRAMES)
    expect(measured.videoFramesClosed).toBe(measured.videoFramesCreated)
    expect(allFramesClosed()).toBe(true)
    // Exact: one encode() per frame, and one flush() for the whole export.
    expect(measured.encodeCalls).toBe(FRAMES)
    expect(measured.videoFlushes).toBe(1)
  })

  it('never answers an animation lookup from the memo cache', async () => {
    const measured = await measureExport()

    // A finding pinned, not a target met. The scene has no keyframes at all, so
    // every one of these lookups asks for a value that cannot change — and the
    // memo cache answers none of them, because both sites that build a key use
    // `${clip.id}:${<clip time>.toFixed(3)}`, and the clip time is different on
    // every frame:
    //
    //   - `animatedValuesFor` in `core/canvasRenderer.ts`, for media clips;
    //   - `exportMP4.ts` (~495), for overlay clips.
    //
    // During an export the cache is therefore pure overhead: it stores one
    // entry per clip per frame (measured 2026-09-12: 4 per frame, so ~1,560 for
    // the full 13 s scene) and never reads one back.
    //
    // When that is fixed this test fails, which is the point: invert it into a
    // floor on the hit ratio and lower the entries-per-frame ceiling. Both key
    // sites have to change together, or the ratio moves only half way.
    expect(measured.animationCacheHitRatio).toBe(0)
    expect(measured.animationCacheEntriesPerFrame).toBeLessThanOrEqual(8)
  })
})
