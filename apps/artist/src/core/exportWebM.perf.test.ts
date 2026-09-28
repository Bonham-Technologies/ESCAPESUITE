// Per-frame work ceilings for the WebM export pipeline.
//
// The twin of `exportMP4.perf.test.ts` (ESCSUITE-112): same idea, same scene,
// same splitter, a different pipeline. `exportToWebM` draws media *elements*
// (`<video>` / `<img>`) straight onto the canvas — no decode manager, no
// per-clip `VideoFrame`s, no codec ladder — so its per-frame cost is its own
// and had no ceiling until this file.
//
// Thirty frames of the scene's heaviest second (7-8 s: the blurred full-frame
// V1 clip under the `screen`-blended picture-in-picture V2 clip, with the text
// and shape overlays on top), which is one second of 30 fps output — the same
// range `exportMP4.perf.test.ts` measures, so the two files describe the same
// work under the two pipelines.
//
// Ceilings are 2x the measured value rounded up, with the measurement and its
// date beside them. Frame accounting (created == closed, encode == frames, one
// flush per encoder) is exact: those are conservation laws, not budgets. This
// pipeline still captures one `VideoFrame` from the canvas per encoded frame
// (`new VideoFrame(canvas, { timestamp, duration })`, immediately closed after
// `encode()`) — the same output-capture step `exportMP4.perf.test.ts` pins —
// so that law carries over unchanged even though the *source* side of this
// pipeline never decodes one.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportToWebM } from './exportWebM'
import { storeVideo } from './storage'
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
  MASKED_MEDIA_CLIPS_AT_EFFECTS_FRAME,
  SCENE_RESOLUTION,
  SCENE_SOURCE_HEIGHT,
  SCENE_SOURCE_ID,
  SCENE_SOURCE_WIDTH,
  SCENE_TRACKS,
  buildMaskedSceneClips,
  buildSceneClips,
  sceneSource,
} from '../test/fixtures/perfScene'
import { makeExportOptions } from '../test/fixtures/clipFixtures'
import type { Clip, ExportProgress } from '../store/types'

vi.mock('mediabunny', async () => {
  const { createMediabunnyDouble } = await import('../test/doubles/mediabunny')
  return createMediabunnyDouble()
})

vi.mock('./audioMixer', () => ({
  extractAndMixAudio: vi.fn(async () => null),
}))

/** The scene's heaviest second, at the exporter's fixed 30 fps. */
const RANGE = { start: 7, end: 8 }
const FRAMES = 30
/** Media clips live over that second: the blurred V1 clip and the screen-blended V2 clip. */
const ACTIVE_MEDIA_CLIPS = MASKED_MEDIA_CLIPS_AT_EFFECTS_FRAME
/** Clips live over that second: the two media clips and the two overlays. */
const ACTIVE_CLIPS = 4
/**
 * save() calls the *plain* scene makes per frame — what the masked variant's
 * tripwire counts up from. Measured 2026-09-27 (this file's first
 * measurement); the first case below pins the rest of that frame.
 */
const PLAIN_SAVES_PER_FRAME = 4

let media: MediaDoubles
let webcodecs: WebCodecsDoubles
let offscreen: OffscreenCanvasDouble
let logs: ReturnType<typeof vi.spyOn>
let warns: ReturnType<typeof vi.spyOn>
let errors: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  resetMediabunnyDouble()
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
})

/**
 * Split the recorded calls into frames.
 *
 * Identical to `exportMP4.perf.test.ts`'s splitter: every export frame opens
 * with `openOutputFrame` (`core/outputTransform.ts`), which both pipelines
 * call — the project-to-output transform followed immediately by the
 * full-raster black fill. Nothing else makes those two calls back to back.
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

interface ExportMeasurement {
  framesEncoded: number
  /** 2D-context method calls in the median frame. */
  callsPerFrame: number
  drawImagesPerFrame: number
  /**
   * `setTransform` calls in the median frame — the one that carries project
   * space onto the output raster, and nothing else (ESCSUITE-94).
   */
  setTransformsPerFrame: number
  savesPerFrame: number
  restoresPerFrame: number
  /** getAnimatedValues() calls per frame, through the module boundary. */
  animationLookupsPerFrame: number
  /** getAnimatedValues() calls for the whole export. */
  animationLookups: number
  /** getContext() calls for the whole export — the exporter makes one canvas. */
  getContexts: number
  /**
   * `video.currentTime` assignments (`test/doubles/media.ts`'s `seeks`) for the
   * whole export — the WebM path's own per-frame cost, with no equivalent in
   * the MP4 path's decode-manager pipeline. One of these is a one-time
   * initialisation seek (`video.currentTime = 0` for every loaded video,
   * before the frame loop starts); the rest are the frame loop's own, one per
   * active media clip per frame — this scene's two active clips share one
   * `<video>` element, so each frame reassigns its position twice.
   */
  seeks: number
  /** `(seeks - the one-time initialisation seeks) / framesEncoded`. */
  steadyStateSeeksPerFrame: number
  videoFramesCreated: number
  videoFramesClosed: number
  encodeCalls: number
  videoFlushes: number
}

async function measureExport(clips: Clip[] = buildSceneClips()): Promise<ExportMeasurement> {
  const progress: ExportProgress[] = []
  const getAnimatedValues = vi.spyOn(animation, 'getAnimatedValues')
  const contextsBefore = getContextCallCount()
  const seeksBefore = media.seeks.length

  await exportToWebM(
    clips,
    [sceneSource],
    makeExportOptions({ format: 'webm', resolution: 'project', timeRange: RANGE }),
    (p) => progress.push(p),
    SCENE_TRACKS,
    undefined,
    { ...SCENE_RESOLUTION }
  )

  const ctx = getLastCanvasContext()!
  const frames = splitFrames(ctx.calls)
  const encoder = webcodecs.videoEncoders[0]
  const frameTotals = frameCounts()

  const lookups = getAnimatedValues.mock.calls.length
  const seeks = media.seeks.length - seeksBefore
  // The exporter sets `video.currentTime = 0` once per loaded video element
  // before the frame loop starts (its "initialize all videos as paused"
  // step) — one seek per element that is never part of the per-frame cost.
  const initSeeks = media.videos.length

  const measurement: ExportMeasurement = {
    framesEncoded: frames.length,
    callsPerFrame: median(frames.map((f) => f.length)),
    drawImagesPerFrame: median(frames.map((f) => f.filter((c) => c.method === 'drawImage').length)),
    setTransformsPerFrame: median(frames.map((f) => f.filter((c) => c.method === 'setTransform').length)),
    savesPerFrame: median(frames.map((f) => f.filter((c) => c.method === 'save').length)),
    restoresPerFrame: median(frames.map((f) => f.filter((c) => c.method === 'restore').length)),
    animationLookupsPerFrame: lookups / frames.length,
    animationLookups: lookups,
    getContexts: getContextCallCount() - contextsBefore,
    seeks,
    steadyStateSeeksPerFrame: (seeks - initSeeks) / frames.length,
    videoFramesCreated: frameTotals.created,
    videoFramesClosed: frameTotals.closed,
    encodeCalls: encoder.encodes.length,
    videoFlushes: encoder.flushes,
  }
  getAnimatedValues.mockRestore()
  return measurement
}

describe('WebM export per-frame work', () => {
  it('encodes 30 frames of the scene within its per-frame ceilings', async () => {
    const measured = await measureExport()

    expect(measured.framesEncoded).toBe(FRAMES)

    // Measured 2026-09-27: 25 calls, 2 drawImage, 4 save/restore pairs,
    // 4 animation lookups per frame, 2 seeks per frame. Ceilings are 2x,
    // rounded up.
    expect(measured.callsPerFrame).toBeLessThanOrEqual(50)
    expect(measured.drawImagesPerFrame).toBeLessThanOrEqual(4)
    expect(measured.animationLookupsPerFrame).toBeLessThanOrEqual(8)
    // **Exact, not a ceiling** (measured 2026-09-27: 1), for the same reason
    // as the MP4 twin: the transform is a property of the *frame*, carried
    // through the shared `openOutputFrame` helper, not of a clip.
    //
    // It is 1 for *this* scene rather than for any scene: a shape overlay that
    // blurs its background resets the transform to the identity itself, to
    // hand the capture back in the canvas' own pixels
    // (`drawShapeOverlayToCanvasAnimated`), so a scene carrying one would
    // legitimately measure 2. The benchmark scene's shape does not blur; a
    // future edit that gave it one should raise this number and say so, not
    // delete it.
    expect(measured.setTransformsPerFrame).toBe(1)
    // Exact: an export that leaked a save() would drift the whole file.
    expect(measured.savesPerFrame).toBe(measured.restoresPerFrame)
    // Exact: one canvas for the whole export, not one per frame.
    expect(measured.getContexts).toBe(1)
    // Exact, and specific to this pipeline: two active media clips share one
    // `<video>` element (the scene reuses one source across every clip), so
    // each frame's sync loop reassigns its position exactly once per clip —
    // measured 2026-09-27: 2 per frame in steady state, plus the one
    // initialisation seek the exporter makes before the frame loop starts
    // (61 total for the 30-frame range: 1 + 30 x 2).
    expect(measured.steadyStateSeeksPerFrame).toBe(ACTIVE_MEDIA_CLIPS)
    expect(measured.seeks).toBe(1 + FRAMES * ACTIVE_MEDIA_CLIPS)
  })

  it('encodes the masked and stroked scene within its per-frame ceilings', async () => {
    // The same 30 frames, with every media clip masked and stroked. The plain
    // ceilings above are untouched and must stay that way: this is a variant of
    // the benchmark scene, not an edit to it.
    const measured = await measureExport(buildMaskedSceneClips())

    expect(measured.framesEncoded).toBe(FRAMES)

    // Measured 2026-09-27: 41 calls per frame, 2 drawImage, 6 save/restore
    // pairs, 4 animation lookups per frame.
    //
    // Derived the same way as the MP4 twin: 3 calls for a mask, 5 for a
    // stroke, two media clips live over this second, so the plain 25 calls per
    // frame become 25 + 2 x 8 = 41.
    expect(measured.callsPerFrame).toBeLessThanOrEqual(82)
    // Exact, and unchanged by the masks: still one frame transform per frame.
    expect(measured.setTransformsPerFrame).toBe(1)
    // **Exact, not a ceiling** (measured 2026-09-27: 2): a mask draws no second
    // image, so this is one `drawImage` per live media clip.
    expect(measured.drawImagesPerFrame).toBe(MASKED_MEDIA_CLIPS_AT_EFFECTS_FRAME)
    // Exact, and unchanged: neither field is animated, so the lookup count is
    // still frames x active clips and nothing else.
    expect(measured.animationLookupsPerFrame).toBe(ACTIVE_CLIPS)
    expect(measured.animationLookups).toBe(FRAMES * ACTIVE_CLIPS)
    // Exact: an export that leaked a save() would drift the whole file, and the
    // stroke's inner save is the only one this feature adds.
    expect(measured.savesPerFrame).toBe(measured.restoresPerFrame)
    // Exact, and the tripwire the ceilings above cannot be: that inner save is
    // one per stroked media clip. Measured 2026-09-27: 6, the plain frame's 4
    // plus one per masked clip.
    expect(measured.savesPerFrame).toBe(
      PLAIN_SAVES_PER_FRAME + MASKED_MEDIA_CLIPS_AT_EFFECTS_FRAME
    )
    expect(measured.getContexts).toBe(1)
    // Exact, and unmoved by the mask/stroke feature: neither touches how the
    // video elements are synced.
    expect(measured.steadyStateSeeksPerFrame).toBe(ACTIVE_MEDIA_CLIPS)
  })

  it('creates and closes exactly one VideoFrame per encoded frame with masks on', async () => {
    const measured = await measureExport(buildMaskedSceneClips())

    // The classic out-of-memory bug, asked again with the mask on: a clip
    // region is context state, and a feature that leaked one could plausibly
    // leak a frame too. This pipeline captures one `VideoFrame` from the
    // canvas per encoded frame for the encoder — the same output-capture step
    // the MP4 pipeline has, even though this one never decodes a source
    // `VideoFrame` to draw with.
    expect(measured.videoFramesCreated).toBe(FRAMES)
    expect(measured.videoFramesClosed).toBe(measured.videoFramesCreated)
    expect(allFramesClosed()).toBe(true)
  })

  it('creates and closes exactly one VideoFrame per encoded frame', async () => {
    const measured = await measureExport()

    // Exact: every frame handed to the encoder is closed again.
    expect(measured.videoFramesCreated).toBe(FRAMES)
    expect(measured.videoFramesClosed).toBe(measured.videoFramesCreated)
    expect(allFramesClosed()).toBe(true)
    // Exact: one encode() per frame, and one flush() for the whole export.
    expect(measured.encodeCalls).toBe(FRAMES)
    expect(measured.videoFlushes).toBe(1)
  })

  it('computes every live clip\'s animated values exactly once per frame', async () => {
    const measured = await measureExport()

    // Exact, and a conservation law rather than a budget, for the same reason
    // as the MP4 twin: an export draws each clip time exactly once, so the
    // lookup count is frames x active clips and nothing else.
    //
    // Measured 2026-09-27: 4 active clips over this second of the scene (the
    // full-frame V1 clip, the picture-in-picture V2 clip, and the text and
    // shape overlays), so 4 per frame and 120 for the 30-frame range.
    expect(measured.animationLookupsPerFrame).toBe(ACTIVE_CLIPS)
    expect(measured.animationLookups).toBe(FRAMES * ACTIVE_CLIPS)
  })
})
