// Per-frame work ceilings for the GIF export pipeline.
//
// The third of the trio (`exportMP4.perf.test.ts` ESCSUITE-112's twin,
// `exportWebM.perf.test.ts`), over the same scene and split into frames by the
// same `openOutputFrame` marker. This pipeline shares `core/elementFrames.ts`
// with the WebM one, so its drawing cost is that file's cost; what is its own is
// the read-back and the encode: one `getImageData` over the whole raster per
// frame, and one `addFrame` — which is one `quantize`, one `applyPalette` and
// one `writeFrame` behind `core/gifEncoder.ts`.
//
// The scene's heaviest second (7-8 s) at the default 15 fps, which is 15 output
// frames. Ceilings are 2x the measured value rounded up, with the measurement
// and its date beside them. The conservation laws — one read-back per frame, one
// encoded frame per read-back, one `getContext` for the whole export, balanced
// save/restore, and **no `VideoFrame` at all** — are exact.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportToGIF } from './exportGIF'
import { storeVideo } from './storage'
import * as animation from '../utils/animation'
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
import { frameCounts, installWebCodecsDoubles, type WebCodecsDoubles } from '../test/doubles/webcodecs'
import {
  MASKED_MEDIA_CLIPS_AT_EFFECTS_FRAME,
  SCENE_RESOLUTION,
  SCENE_SOURCE_HEIGHT,
  SCENE_SOURCE_ID,
  SCENE_SOURCE_WIDTH,
  SCENE_TRACKS,
  buildSceneClips,
  sceneSource,
} from '../test/fixtures/perfScene'
import { makeExportOptions } from '../test/fixtures/clipFixtures'
import type { ExportProgress } from '../store/types'

const { gifFrames, gifWriterCount, createGifWriter } = vi.hoisted(() => {
  const gifFrames: { width: number; height: number; rgbaLength: number }[] = []
  const gifWriterCount = { value: 0 }
  const createGifWriter = vi.fn(() => {
    gifWriterCount.value += 1
    return {
      addFrame(rgba: Uint8ClampedArray, width: number, height: number) {
        gifFrames.push({ width, height, rgbaLength: rgba.length })
      },
      bytesWritten: () => gifFrames.length * 64,
      finish: () => new Uint8Array(gifFrames.length * 64),
    }
  })
  return { gifFrames, gifWriterCount, createGifWriter }
})

// The encoder is counted, not run: `gifEncoder.test.ts` exercises the real one.
// What this file measures is how many times the pipeline asks for it.
vi.mock('./gifEncoder', () => ({ createGifWriter, GIF_MAX_COLORS: 256 }))

/** The scene's heaviest second, at the GIF export's default frame rate. */
const RANGE = { start: 7, end: 8 }
const FPS = 15
const FRAMES = 15
/** Media clips live over that second: the blurred V1 clip and the screen-blended V2 clip. */
const ACTIVE_MEDIA_CLIPS = MASKED_MEDIA_CLIPS_AT_EFFECTS_FRAME
/** Clips live over that second: the two media clips and the two overlays. */
const ACTIVE_CLIPS = 4

let media: MediaDoubles
let webcodecs: WebCodecsDoubles
let offscreen: OffscreenCanvasDouble
let logs: ReturnType<typeof vi.spyOn>
let warns: ReturnType<typeof vi.spyOn>
let errors: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  gifFrames.length = 0
  gifWriterCount.value = 0
  createGifWriter.mockClear()
  installCanvasDouble()
  offscreen = installOffscreenCanvasDouble()
  media = installMediaElementDoubles({
    video: { videoWidth: SCENE_SOURCE_WIDTH, videoHeight: SCENE_SOURCE_HEIGHT, duration: 2 },
  })
  // Installed only so `frameCounts()` can prove this pipeline creates no
  // VideoFrame at all — it never constructs an encoder or a decoder.
  webcodecs = installWebCodecsDoubles()
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
})

/**
 * Split the recorded calls into frames.
 *
 * Byte-for-byte the splitter `exportWebM.perf.test.ts` and
 * `exportMP4.perf.test.ts` use, and valid here for the same reason: every
 * export frame opens with `openOutputFrame` (`core/outputTransform.ts`) — the
 * project-to-output transform followed immediately by the full-raster black
 * fill — and nothing else makes those two calls back to back. Since ESCSUITE-34
 * that call is made by `core/elementFrames.ts` on all three pipelines' behalf.
 */
function splitFrames(calls: CanvasCall[]): CanvasCall[][] {
  const isFrameTransform = (args: unknown[]) =>
    args.length === 6 && args[1] === 0 && args[2] === 0 && args[4] === 0 && args[5] === 0
  const isClear = (call: CanvasCall | undefined) =>
    call?.method === 'fillRect' &&
    String(call.args) === String([0, 0, SCENE_RESOLUTION.width, SCENE_RESOLUTION.height])

  const frames: CanvasCall[][] = []
  for (const [index, call] of calls.entries()) {
    if (call.method === 'setTransform' && isFrameTransform(call.args) && isClear(calls[index + 1])) {
      frames.push([])
    }
    frames[frames.length - 1]?.push(call)
  }
  return frames
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

interface GifMeasurement {
  framesDrawn: number
  /** 2D-context method calls in the median frame. */
  callsPerFrame: number
  drawImagesPerFrame: number
  setTransformsPerFrame: number
  savesPerFrame: number
  restoresPerFrame: number
  getImageDataPerFrame: number
  animationLookupsPerFrame: number
  animationLookups: number
  /** getContext() calls for the whole export — the exporter makes one canvas. */
  getContexts: number
  seeks: number
  steadyStateSeeksPerFrame: number
  /** GIF writers constructed for the whole export. */
  writers: number
  /** Frames handed to the encoder. */
  framesEncoded: number
  /** WebCodecs VideoFrames created anywhere. This pipeline creates none. */
  videoFramesCreated: number
}

async function measureExport(): Promise<GifMeasurement> {
  const progress: ExportProgress[] = []
  const getAnimatedValues = vi.spyOn(animation, 'getAnimatedValues')
  const contextsBefore = getContextCallCount()
  const seeksBefore = media.seeks.length

  await exportToGIF(
    buildSceneClips(),
    [sceneSource],
    makeExportOptions({ format: 'gif', resolution: 'project', fps: FPS, timeRange: RANGE }),
    (p) => progress.push(p),
    SCENE_TRACKS,
    undefined,
    { ...SCENE_RESOLUTION }
  )

  const ctx = getLastCanvasContext()!
  const frames = splitFrames(ctx.calls)
  const lookups = getAnimatedValues.mock.calls.length
  const seeks = media.seeks.length - seeksBefore
  // One `video.currentTime = 0` per loaded element before the frame loop
  // starts (`rewindElementSources`) — never part of the per-frame cost.
  const initSeeks = media.videos.length

  const measurement: GifMeasurement = {
    framesDrawn: frames.length,
    callsPerFrame: median(frames.map((f) => f.length)),
    drawImagesPerFrame: median(frames.map((f) => f.filter((c) => c.method === 'drawImage').length)),
    setTransformsPerFrame: median(frames.map((f) => f.filter((c) => c.method === 'setTransform').length)),
    savesPerFrame: median(frames.map((f) => f.filter((c) => c.method === 'save').length)),
    restoresPerFrame: median(frames.map((f) => f.filter((c) => c.method === 'restore').length)),
    getImageDataPerFrame: median(frames.map((f) => f.filter((c) => c.method === 'getImageData').length)),
    animationLookupsPerFrame: lookups / frames.length,
    animationLookups: lookups,
    getContexts: getContextCallCount() - contextsBefore,
    seeks,
    steadyStateSeeksPerFrame: (seeks - initSeeks) / frames.length,
    writers: gifWriterCount.value,
    framesEncoded: gifFrames.length,
    videoFramesCreated: frameCounts().created,
  }
  getAnimatedValues.mockRestore()
  return measurement
}

describe('GIF export per-frame work', () => {
  it('encodes 15 frames of the scene within its per-frame ceilings', async () => {
    const measured = await measureExport()

    expect(measured.framesDrawn).toBe(FRAMES)

    // Measured 2026-10-01: 26 calls, 2 drawImage, 4 save/restore pairs, 4
    // animation lookups, 1 getImageData and 2 seeks per frame. Ceilings are 2x,
    // rounded up.
    //
    // The 26 is exactly `exportWebM.perf.test.ts`'s 25 for this same scene
    // (measured 2026-09-27) plus this pipeline's one read-back, which is the
    // whole claim that lifting `core/elementFrames.ts` changed no drawing: the
    // two exporters make identical canvas calls per frame, and the GIF one adds
    // a `getImageData`.
    expect(measured.callsPerFrame).toBeLessThanOrEqual(52)
    expect(measured.drawImagesPerFrame).toBeLessThanOrEqual(4)
    expect(measured.animationLookupsPerFrame).toBeLessThanOrEqual(8)

    // **Exact, not a ceiling.** The transform is a property of the frame,
    // carried through the shared `openOutputFrame` helper, not of a clip — the
    // same reason it is exact in both twins. (It is 1 for *this* scene rather
    // than for any scene: a shape overlay that blurs its background resets the
    // transform itself, so a scene carrying one would legitimately measure 2.
    // The benchmark scene's shape does not blur.)
    expect(measured.setTransformsPerFrame).toBe(1)
    // Exact: an export that leaked a save() would drift the whole file.
    expect(measured.savesPerFrame).toBe(measured.restoresPerFrame)
    // Exact: one canvas for the whole export, not one per frame.
    expect(measured.getContexts).toBe(1)
    // Exact, and this pipeline's own law: one full-raster read-back per frame.
    // Two would double the most expensive thing a GIF export does.
    expect(measured.getImageDataPerFrame).toBe(1)
    // Exact: the two active media clips share one `<video>` element, so each
    // frame reassigns its position once per clip, plus the one rewind before
    // the loop.
    expect(measured.steadyStateSeeksPerFrame).toBe(ACTIVE_MEDIA_CLIPS)
    expect(measured.seeks).toBe(1 + FRAMES * ACTIVE_MEDIA_CLIPS)
  })

  it('encodes exactly one frame per drawn frame, through one writer', async () => {
    const measured = await measureExport()

    // Conservation: one `addFrame` per frame drawn — which is one `quantize`,
    // one `applyPalette` and one `writeFrame` behind `core/gifEncoder.ts`, so a
    // double-quantised frame cannot hide here.
    expect(measured.framesEncoded).toBe(FRAMES)
    // One encoder for the whole export: a writer per frame would write a GIF
    // header per frame.
    expect(measured.writers).toBe(1)
  })

  it('creates no VideoFrame at all', async () => {
    const measured = await measureExport()

    // The law that separates this pipeline from the other two. GIF export
    // constructs no `VideoEncoder`, no `VideoDecoder` and no `VideoFrame` — it
    // is why the format works in a browser with no WebCodecs, and a regression
    // that reintroduced one would quietly break exactly that browser.
    expect(measured.videoFramesCreated).toBe(0)
    expect(webcodecs.videoEncoders).toHaveLength(0)
  })

  it('computes every live clip’s animated values exactly once per frame', async () => {
    const measured = await measureExport()

    // Exact, and a conservation law rather than a budget, for the same reason as
    // both twins: an export draws each clip time exactly once, so the lookup
    // count is frames x active clips and nothing else. 4 active clips over this
    // second of the scene (the full-frame V1 clip, the picture-in-picture V2
    // clip, and the text and shape overlays).
    expect(measured.animationLookupsPerFrame).toBe(ACTIVE_CLIPS)
    expect(measured.animationLookups).toBe(FRAMES * ACTIVE_CLIPS)
  })
})
