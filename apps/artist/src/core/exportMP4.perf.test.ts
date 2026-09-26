// Per-frame work ceilings for the export pipeline.
//
// The same idea as `components/Preview/drawFrame.perf.test.ts`, one pipeline
// over: run a real export of the benchmark scene through the WebCodecs,
// mediabunny, canvas and media-element doubles, then assert the per-frame cost
// has not grown. Nothing here is mocked that the export pipeline owns — the
// canvas renderer, the frame manager, the animation engine and the exporter's
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
  extractAndMixAudioWithWorker: vi.fn(async () => null),
}))

/** The scene's heaviest second, at the exporter's fixed 30 fps. */
const RANGE = { start: 7, end: 8 }
const FRAMES = 30
/** Clips live over that second: two media clips and the two overlays. */
const ACTIVE_CLIPS = 4
/**
 * save() calls the *plain* scene makes per frame — what the masked variant's
 * tripwire counts up from. Measured 2026-09-12 and re-measured unchanged
 * 2026-09-25; the first case below pins the rest of that frame.
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
  /** getAnimatedValues() calls per frame, through the module boundary. */
  animationLookupsPerFrame: number
  /** getAnimatedValues() calls for the whole export. */
  animationLookups: number
  /** getContext() calls for the whole export — the exporter makes one canvas. */
  getContexts: number
  videoFramesCreated: number
  videoFramesClosed: number
  encodeCalls: number
  videoFlushes: number
}

async function measureExport(clips: Clip[] = buildSceneClips()): Promise<ExportMeasurement> {
  const progress: ExportProgress[] = []
  const getAnimatedValues = vi.spyOn(animation, 'getAnimatedValues')
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

  const lookups = getAnimatedValues.mock.calls.length

  const measurement: ExportMeasurement = {
    framesEncoded: frames.length,
    callsPerFrame: median(frames.map((f) => f.length)),
    drawImagesPerFrame: median(frames.map((f) => f.filter((c) => c.method === 'drawImage').length)),
    savesPerFrame: median(frames.map((f) => f.filter((c) => c.method === 'save').length)),
    restoresPerFrame: median(frames.map((f) => f.filter((c) => c.method === 'restore').length)),
    animationLookupsPerFrame: lookups / frames.length,
    animationLookups: lookups,
    getContexts: getContextCallCount() - contextsBefore,
    videoFramesCreated: frameTotals.created,
    videoFramesClosed: frameTotals.closed,
    encodeCalls: encoder.encodes.length,
    videoFlushes: encoder.flushes,
  }
  getAnimatedValues.mockRestore()
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

  it('encodes the masked and stroked scene within its per-frame ceilings', async () => {
    // The same 30 frames, with every media clip masked and stroked. The plain
    // ceilings above are untouched and must stay that way: this is a variant of
    // the benchmark scene, not an edit to it.
    const measured = await measureExport(buildMaskedSceneClips())

    expect(measured.framesEncoded).toBe(FRAMES)

    // Measured 2026-09-25: 40 calls per frame, 2 drawImage, 6 save/restore
    // pairs, 4 animation lookups per frame.
    //
    // Derived the same way as the preview ceiling: 3 calls for a mask, 5 for a
    // stroke, two media clips live over this second, so the plain 24 calls per
    // frame become 24 + 2 x 8 = 40, which is what was measured.
    expect(measured.callsPerFrame).toBeLessThanOrEqual(80)
    // Exact, and unchanged: a mask draws no second image.
    expect(measured.drawImagesPerFrame).toBeLessThanOrEqual(4)
    // Exact, and unchanged: neither field is animated, so the lookup count is
    // still frames x active clips and nothing else (decision 4).
    expect(measured.animationLookupsPerFrame).toBe(ACTIVE_CLIPS)
    expect(measured.animationLookups).toBe(FRAMES * ACTIVE_CLIPS)
    // Exact: an export that leaked a save() would drift the whole file, and the
    // stroke's inner save is the only one this feature adds.
    expect(measured.savesPerFrame).toBe(measured.restoresPerFrame)
    // Exact, and the tripwire the ceilings above cannot be: that inner save is
    // one per stroked media clip, so this count is how many masked clips
    // actually reached the renderer — every `<=` in this case would pass just as
    // happily on the plain scene. Measured 2026-09-25: 6, the plain frame's 4
    // plus one per masked clip.
    expect(measured.savesPerFrame).toBe(
      PLAIN_SAVES_PER_FRAME + MASKED_MEDIA_CLIPS_AT_EFFECTS_FRAME
    )
    expect(measured.getContexts).toBe(1)
  })

  it('creates and closes exactly one VideoFrame per encoded frame with masks on', async () => {
    const measured = await measureExport(buildMaskedSceneClips())

    // The classic out-of-memory bug, asked again with the mask on: a clip region
    // is context state, and a feature that leaked one could plausibly leak a
    // frame too.
    expect(measured.videoFramesCreated).toBe(FRAMES)
    expect(measured.videoFramesClosed).toBe(measured.videoFramesCreated)
    expect(allFramesClosed()).toBe(true)
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

  it('computes every live clip\'s animated values exactly once per frame', async () => {
    const measured = await measureExport()

    // Exact, and a conservation law rather than a budget: there is no memo
    // cache between the exporter and the animation engine any more, so the
    // lookup count is frames x active clips and nothing else. There used to be
    // one — keyed `${clip.id}:${<clip time>.toFixed(3)}` at both sites that
    // build a key — but an export draws each clip time exactly once, so the key
    // never came round again: the cache answered none of these lookups and
    // stored one entry per clip per frame for the whole export.
    //
    // Measured 2026-09-12: 4 active clips over this second of the scene (the
    // full-frame V1 clip, the picture-in-picture V2 clip, and the text and
    // shape overlays), so 4 per frame and 120 for the 30-frame range.
    expect(measured.animationLookupsPerFrame).toBe(ACTIVE_CLIPS)
    expect(measured.animationLookups).toBe(FRAMES * ACTIVE_CLIPS)
  })
})
