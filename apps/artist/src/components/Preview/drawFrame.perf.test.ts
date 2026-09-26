// Per-frame work ceilings for the preview compositor.
//
// Ordinary tests, not `bench` mode: they measure through the same doubles every
// other preview test uses, then assert the measurement has not grown. That way
// they run in CI and in `test:coverage` like anything else, and a regression
// fails the build instead of moving a number in a report nobody reads.
//
// The scene is the benchmark scene — the 12-clip, two-media-track, two-overlay,
// one-transition timeline `apps/e2e/tests/perf/` plays in a real browser (see
// `src/test/fixtures/perfScene.ts`). The browser benchmark reports what a frame
// costs in milliseconds; these tests pin what it costs in *calls*, which is the
// part that does not depend on the runner's CPU.
//
// How a ceiling is chosen: measure once, set the ceiling at 2x the measurement
// rounded up, and write the measured value and the date beside it. Counts that
// are exact properties rather than budgets — save/restore balance, one cached
// context, no object URLs per frame, one composite per animation frame — are
// asserted exactly. When a fix lands, re-measure and lower the ceiling; never
// raise one without saying why.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { resetStoreForTest, store } from '../../test/fixtures/projectStore'
import {
  EFFECTS_FRAME_TIME,
  MASKED_MEDIA_CLIPS_AT_EFFECTS_FRAME,
  SINGLE_CLIP_FRAME_TIME,
  TRANSITION_FRAME_TIME,
  SCENE_SOURCE_HEIGHT,
  SCENE_SOURCE_WIDTH,
  buildMaskedSceneProject,
  buildSceneProject,
  sceneSource,
} from '../../test/fixtures/perfScene'
import {
  FRAME_MS,
  installPreviewDoubles,
  renderPreview,
  settle,
  type Preview,
  type PreviewDoubles,
} from '../../test/renderPreview'
import { getContextCallCount } from '../../test/doubles/canvas'
import { resetFrameCache } from '../../core/frameCache'
import { useEditorStore } from '../../store/projectStore'
import * as animation from '../../utils/animation'

vi.mock('../../core/storage', async () => (await import('../../test/appDoubles')).storageDouble())

let doubles: PreviewDoubles

beforeEach(() => {
  vi.useFakeTimers()
  doubles = installPreviewDoubles({
    video: { videoWidth: SCENE_SOURCE_WIDTH, videoHeight: SCENE_SOURCE_HEIGHT, duration: 2 },
  })
  resetStoreForTest()
  resetFrameCache()
  store().setProject(buildSceneProject())
  store().addSourceVideo(sceneSource)
})

afterEach(async () => {
  if (store().isPlaying) {
    store().setIsPlaying(false)
    await settle(FRAME_MS * 2)
  }
  cleanup()
  doubles.uninstall()
  resetFrameCache()
  vi.useRealTimers()
  vi.clearAllMocks()
})

/** The canvas is 1280x720; its layout box is that at half scale, unletterboxed. */
const RECT = { left: 0, top: 0, width: 640, height: 360 }

/**
 * save() calls the *plain* effects frame makes — the number the masked variant's
 * tripwire counts up from. Measured 2026-09-12 and re-measured unchanged
 * 2026-09-25; the first case in this file pins the rest of that frame.
 */
const PLAIN_EFFECTS_FRAME_SAVES = 4

interface FrameMeasurement {
  /**
   * Every 2D-context *method* call one composite made. Property assignments
   * (globalAlpha, filter, fillStyle, font) are not calls and are not counted —
   * the recording context records methods only.
   */
  totalCalls: number
  saves: number
  restores: number
  drawImages: number
  measureTexts: number
  /** fill() + fillRect(): the calls that rasterise a region. */
  fills: number
  /** stroke() + strokeRect(). */
  strokes: number
  /** Composites one playhead move settles into. */
  composites: number
  /** getAnimatedValues() calls per composite, counted through the module boundary. */
  animatedValues: number
  /** getContext() calls the measured draws made — the preview caches its context. */
  getContexts: number
  /** URL.createObjectURL() calls the measured draws made — loading is not per-frame. */
  objectUrls: number
}

/**
 * Composite the scene at `time` and count what one frame took.
 *
 * The playhead is first moved to `time` and left to settle: a scrub seeks the
 * active videos and redraws when the seeks report back, and those draws are the
 * seek settling rather than the steady-state frame. The measured draw is then
 * provoked by nudging the playhead by less than the 50 ms seek threshold, which
 * takes the "nothing to seek" branch.
 *
 * How many composites that nudge settles into depends on how many clips are
 * live (see `composites` and the test that pins it), so the per-frame counts
 * come from the first composite and the animation-lookup count is divided by
 * how many composites ran.
 */
async function measureFrame(preview: Preview, time: number): Promise<FrameMeasurement> {
  store().setCurrentTime(time)
  await settle(FRAME_MS * 4)

  const getAnimatedValues = vi.spyOn(animation, 'getAnimatedValues')
  const createObjectURL = vi.mocked(URL.createObjectURL)
  const urlsBefore = createObjectURL.mock.calls.length
  const contextsBefore = getContextCallCount()
  preview.clearCalls()

  store().setCurrentTime(time + 0.001)
  await settle(FRAME_MS * 2)

  const frames = preview.frames()
  const frame = frames[0]
  // Dividing by the composite count is only meaningful if every composite of
  // one playhead move really did draw the same thing.
  expect(frames.map((f) => f.calls.length)).toEqual(frames.map(() => frame.calls.length))
  expect(getAnimatedValues.mock.calls.length % frames.length).toBe(0)

  const measurement: FrameMeasurement = {
    totalCalls: frame.calls.length,
    saves: frame.of('save').length,
    restores: frame.of('restore').length,
    drawImages: frame.of('drawImage').length,
    measureTexts: frame.of('measureText').length,
    fills: frame.of('fill').length + frame.of('fillRect').length,
    strokes: frame.of('stroke').length + frame.of('strokeRect').length,
    composites: frames.length,
    animatedValues: getAnimatedValues.mock.calls.length / frames.length,
    getContexts: getContextCallCount() - contextsBefore,
    objectUrls: createObjectURL.mock.calls.length - urlsBefore,
  }
  getAnimatedValues.mockRestore()
  return measurement
}

describe('preview per-frame work', () => {
  it('composites the effects frame within its ceilings', async () => {
    // The heaviest media frame in the scene: the blurred full-frame V1 clip
    // (6-8 s) under the `screen`-blended picture-in-picture V2 clip (7-9 s),
    // with the text and shape overlays on top.
    const preview = await renderPreview({ rect: RECT })

    const frame = await measureFrame(preview, EFFECTS_FRAME_TIME)

    // Measured 2026-09-12: 25 calls, 2 drawImage, 1 measureText, 3 fills,
    // 1 stroke, 4 getAnimatedValues, 4 save/restore pairs.
    expect(frame.totalCalls).toBeLessThanOrEqual(50)
    expect(frame.drawImages).toBeLessThanOrEqual(4)
    expect(frame.measureTexts).toBeLessThanOrEqual(2)
    expect(frame.fills).toBeLessThanOrEqual(6)
    expect(frame.strokes).toBeLessThanOrEqual(2)
    expect(frame.animatedValues).toBeLessThanOrEqual(8)
    // Exact: every save() the frame makes is matched, or the next frame starts
    // from a context state the last one left behind.
    expect(frame.saves).toBe(frame.restores)
    // Exact: the component looks its 2D context up once and keeps it.
    expect(frame.getContexts).toBe(0)
    // Exact: media loading happens when the timeline changes, never per frame.
    expect(frame.objectUrls).toBe(0)
  })

  it('composites the transition frame within its ceilings', async () => {
    // Inside the scene's one transition: V1's third clip (4-6 s) fades into the
    // fourth over its last half second, with V2's clip and both overlays drawn
    // as usual — three media draws in one frame instead of two.
    const preview = await renderPreview({ rect: RECT })

    const frame = await measureFrame(preview, TRANSITION_FRAME_TIME)

    // Measured 2026-09-12: 28 calls, 3 drawImage, 1 measureText,
    // 5 getAnimatedValues, 5 save/restore pairs.
    expect(frame.totalCalls).toBeLessThanOrEqual(56)
    expect(frame.drawImages).toBeLessThanOrEqual(6)
    expect(frame.measureTexts).toBeLessThanOrEqual(2)
    expect(frame.animatedValues).toBeLessThanOrEqual(10)
    expect(frame.saves).toBe(frame.restores)
    expect(frame.getContexts).toBe(0)
    expect(frame.objectUrls).toBe(0)
  })

  it('composites the masked and stroked effects frame within its ceilings', async () => {
    // The same frame as the first case, with every media clip carrying
    // ESCSUITE-65's circle and ESCAPECRAFT's white border. A *variant* of the
    // scene, never an edit to it: the plain ceilings above have to stay exactly
    // where they are, because they and `apps/e2e/tests/perf/` describe one
    // scene.
    store().setProject(buildMaskedSceneProject())
    const preview = await renderPreview({ rect: RECT })

    const frame = await measureFrame(preview, EFFECTS_FRAME_TIME)

    // Measured 2026-09-25: 41 calls, 2 drawImage, 1 measureText, 3 fills,
    // 3 strokes, 4 getAnimatedValues, 6 save/restore pairs.
    //
    // Derived from `core/canvasRenderer.clips.test.ts`, which pins the per-clip
    // cost exactly: a mask is 3 calls (beginPath + ellipse + clip) and a stroke
    // is 5 (save + beginPath + ellipse + stroke + restore). `lineWidth` and
    // `strokeStyle` are property assignments, which this double does not count
    // as calls — see `FrameMeasurement` above. Two media clips are live here, so
    // the plain frame's 25 calls become 25 + 2 x 8 = 41, which is what was
    // measured. If a later measurement is not 41, do not adjust the number: 57
    // would mean the mask is applied twice, 25 would mean the variant is not
    // reaching the renderer, and 47 would mean the double has started recording
    // property sets and every other ceiling in this file is now understated.
    expect(frame.totalCalls).toBeLessThanOrEqual(82)
    // **Exact, not a ceiling** (measured 2026-09-25: 2). A mask draws no second
    // image, so this is one `drawImage` per live media clip and no cost of this
    // feature's can hide in it — a 2x ceiling here would have absorbed a mask
    // that re-drew the picture to composite itself, which is the most likely way
    // to implement one wrongly.
    expect(frame.drawImages).toBe(MASKED_MEDIA_CLIPS_AT_EFFECTS_FRAME)
    // Still a 2x ceiling (measured 2026-09-25: 4), like the plain frame's:
    // neither field is animated (decision 4), so the lookups are frames x active
    // clips — but that is the *scene's* cost, not this feature's, and the exact
    // form of it is asserted in `exportMP4.perf.test.ts`.
    expect(frame.animatedValues).toBeLessThanOrEqual(8)
    // The scene's shape overlay strokes once; the two masked clips add one each.
    expect(frame.strokes).toBeLessThanOrEqual(6)
    // Exact: the stroke's inner save is the only state operation this feature
    // adds, and an unbalanced one would leak a clip region into the next frame.
    expect(frame.saves).toBe(frame.restores)
    // Exact, and the tripwire the ceilings above cannot be: that inner save is
    // one per stroked media clip, so this count is how many masked clips
    // actually reached the renderer. Every `<=` in this case would pass just as
    // happily on the plain scene, so without this line a variant that never
    // arrived would look like a measurement. Measured 2026-09-25: 6, the plain
    // frame's 4 plus one per masked clip.
    expect(frame.saves).toBe(PLAIN_EFFECTS_FRAME_SAVES + MASKED_MEDIA_CLIPS_AT_EFFECTS_FRAME)
    expect(frame.getContexts).toBe(0)
    expect(frame.objectUrls).toBe(0)
  })

  it('settles a playhead move into one composite when one clip is live', async () => {
    const preview = await renderPreview({ rect: RECT })

    const frame = await measureFrame(preview, SINGLE_CLIP_FRAME_TIME)

    // Exact: with a single media clip live, moving the playhead by less than
    // the seek threshold finds every video already where it should be, takes
    // the "nothing to seek" branch, and paints once.
    expect(frame.composites).toBe(1)
  })

  it('settles a playhead move into one composite when clips share a source', async () => {
    const preview = await renderPreview({ rect: RECT })

    const frame = await measureFrame(preview, EFFECTS_FRAME_TIME)

    // Exact, for the same reason as the single-clip case above: moving the
    // playhead by less than the seek threshold must find every video already
    // where it should be and paint once.
    //
    // All 12 clips in this scene draw from one source, so `usePreviewMedia`
    // gives them one <video> between them. The seek check in
    // `usePreviewRenderLoop.ts` walks *clips* but seeks *elements*, so it used
    // to set that element's currentTime for the first live clip, measure the
    // same element against the second live clip's target — a second away —
    // decide a seek was needed, and take the event-driven branch, which draws
    // immediately and again when `seeked` arrives: two composites for one move.
    // A picture-in-picture arrangement, or the same clip duplicated on two
    // tracks, is exactly this shape.
    expect(frame.composites).toBe(1)
  })
})

describe('preview render loop', () => {
  it('composites exactly one frame per animation frame and throttles the store', async () => {
    const TICKS = 30
    const preview = await renderPreview({ rect: RECT })
    store().setCurrentTime(EFFECTS_FRAME_TIME)
    await settle(FRAME_MS * 4)

    let storeTimeUpdates = 0
    const unsubscribe = useEditorStore.subscribe((state, previous) => {
      if (state.currentTime !== previous.currentTime) storeTimeUpdates += 1
    })
    preview.clearCalls()

    store().setIsPlaying(true)
    await settle(FRAME_MS * TICKS)
    const composites = preview.frames().length

    store().setIsPlaying(false)
    await settle(FRAME_MS * 2)
    unsubscribe()

    // Exact: the rAF loop paints once per animation frame — never twice, and
    // never skipping one. A loop that also redrew on a React render would show
    // up here as more composites than ticks.
    expect(composites).toBe(TICKS)
    // The loop writes the playhead back to the store every 200 ms rather than
    // every frame, so a 480 ms window is 2 store writes and not 30. Measured
    // 2026-09-12: 2. Deliberately exact rather than 2x measured — it is derived
    // from the loop's own 200 ms throttle constant, so slack would only hide
    // that constant changing.
    expect(storeTimeUpdates).toBeLessThanOrEqual(Math.floor((FRAME_MS * TICKS) / 200))
  })
})
