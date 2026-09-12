// The preview's draw calls do not depend on the size it rasterises at.
//
// Since the display-size raster landed, the backing store follows the canvas
// element's CSS box while every number the preview computes stays in *project*
// space, carried onto that raster by one `setTransform` per frame. The claim
// that makes it a performance fix rather than a behaviour change is exactly
// this: shrink the raster and the same picture is drawn, in the same order,
// out of the same numbers.
//
// The committed suites mostly run at k = 1 — `renderPreview`'s `resize()` is
// opt-in, and a file that never calls it never gives the preview a box — so
// this file is the durable k != 1 evidence. It composites the benchmark scene
// twice, once at k = 1 and once in a 640x360 box (k = 0.5 against the scene's
// 1280x720 project), and compares the two recordings call for call.
//
// Two things are allowed to differ, and nothing else:
//
//   - the frame's own `setTransform`, which *is* the raster scale;
//   - `ctx.filter` blur radii, which are pixels of the output bitmap and are
//     not touched by the current transform, so they have to be asked for in
//     raster pixels (see `MediaDrawOptions.filterScale`). They must come out
//     exactly halved — a blur that did not scale would be the one way the
//     picture could change.
//
// Element arguments (the <video> each clip draws from, the scratch canvas a
// blur shape captures into) are compared by kind rather than identity: the two
// runs are separate mounts, so they own different elements.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { resetStoreForTest, store } from '../../test/fixtures/projectStore'
import {
  EFFECTS_FRAME_TIME,
  SCENE_RESOLUTION,
  SCENE_SOURCE_HEIGHT,
  SCENE_SOURCE_WIDTH,
  TRANSITION_FRAME_TIME,
  buildSceneProject,
  sceneSource,
} from '../../test/fixtures/perfScene'
import {
  FRAME_MS,
  installPreviewDoubles,
  renderPreview,
  settle,
  type PreviewDoubles,
} from '../../test/renderPreview'
import { resetFrameCache } from '../../core/frameCache'
import type { CanvasCall } from '../../test/doubles/canvas'

vi.mock('../../core/storage', async () => (await import('../../test/appDoubles')).storageDouble())

/**
 * The box the halved run lays the canvas out in: exactly half the scene's
 * 1280x720 project on both axes, at a device pixel ratio of 1, so the raster
 * scale is 0.5 and no letterboxing enters the picture.
 */
const HALF_BOX = { width: SCENE_RESOLUTION.width / 2, height: SCENE_RESOLUTION.height / 2 }
const RECT = { left: 0, top: 0, ...HALF_BOX }
const K = 0.5

let doubles: PreviewDoubles

beforeEach(() => {
  vi.useFakeTimers()
  doubles = installPreviewDoubles({
    video: { videoWidth: SCENE_SOURCE_WIDTH, videoHeight: SCENE_SOURCE_HEIGHT, duration: 2 },
  })
  resetStoreForTest()
  resetFrameCache()
})

afterEach(() => {
  cleanup()
  doubles.uninstall()
  resetFrameCache()
  vi.useRealTimers()
  vi.clearAllMocks()
})

/**
 * Composite one steady-state frame of the benchmark scene and return its calls.
 *
 * `box` is what the preview is told its canvas element measures; omitting it
 * leaves the preview with no box at all, which is how it rasterises at the
 * project size. The playhead is parked on `time` and left to settle — those
 * draws are the seeks reporting back, not the frame — then nudged by less than
 * the seek threshold to provoke the measured composite.
 */
async function compositeFrame(
  time: number,
  box?: { width: number; height: number }
): Promise<CanvasCall[]> {
  resetStoreForTest()
  resetFrameCache()
  store().setProject(buildSceneProject())
  store().addSourceVideo(sceneSource)

  const preview = await renderPreview({ rect: RECT })
  if (box) preview.resize(box)

  store().setCurrentTime(time)
  await settle(FRAME_MS * 4)

  preview.clearCalls()
  store().setCurrentTime(time + 0.001)
  await settle(FRAME_MS * 2)

  const frames = preview.frames()
  expect(frames).toHaveLength(1)
  const calls = frames[0].calls
  cleanup()
  return calls
}

/** An argument that is an element or a bitmap, named by kind rather than identity. */
function describeArg(arg: unknown): unknown {
  if (typeof arg !== 'object' || arg === null) return arg
  const tagName = (arg as { tagName?: string }).tagName
  if (typeof tagName === 'string') return `<${tagName.toLowerCase()}>`
  return arg.constructor?.name ?? 'object'
}

const BLUR = /^blur\(([0-9.]+)px\)$/

/** The blur radius in force at each call the frame made under one, in order. */
function blurRadii(calls: CanvasCall[]): number[] {
  return calls
    .map((call) => BLUR.exec(call.state.filter))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]))
}

/**
 * One frame's calls with the raster scale divided back out, so two runs at
 * different scales are directly comparable: blur radii return to project
 * pixels, and the frame's own transform (always the first call — that is how
 * `renderPreview` finds a frame's start) returns to the identity.
 */
function inProjectSpace(calls: CanvasCall[], scale: number) {
  return calls.map((call, index) => {
    const blur = BLUR.exec(call.state.filter)
    return {
      method: call.method,
      args:
        index === 0
          ? call.args.map((arg) => (typeof arg === 'number' ? arg / scale : arg))
          : call.args.map(describeArg),
      filter: blur ? `blur(${Number(blur[1]) / scale}px)` : call.state.filter,
    }
  })
}

describe('preview raster invariance', () => {
  /**
   * @param time the frame to composite
   * @param blurredCalls how many of that frame's calls are made with a
   *   `blur()` filter in force — an exact count, so the blur half of this test
   *   can never pass vacuously
   */
  const invariant = (label: string, time: number, blurredCalls: number) => {
    it(`draws the ${label} frame identically at half the raster size`, async () => {
      const full = await compositeFrame(time)
      const half = await compositeFrame(time, HALF_BOX)

      // The frame's own transform is the raster scale, and it is the only call
      // that carries it.
      expect(full[0].method).toBe('setTransform')
      expect(full[0].args).toEqual([1, 0, 0, 1, 0, 0])
      expect(half[0].args).toEqual([K, 0, 0, K, 0, 0])

      // Blur radii are output-bitmap pixels, so they — and only they — scale.
      expect(blurRadii(full)).toHaveLength(blurredCalls)
      expect(blurRadii(half)).toEqual(blurRadii(full).map((radius) => radius * K))

      // Everything else, call for call and argument for argument.
      expect(inProjectSpace(half, K)).toEqual(inProjectSpace(full, 1))
    })
  }

  // The heaviest media frame: the blurred full-frame V1 clip under the
  // screen-blended picture-in-picture V2 clip, with both overlays on top.
  invariant('effects', EFFECTS_FRAME_TIME, 2)

  // Inside the scene's one transition, where three media draws share a frame.
  invariant('transition', TRANSITION_FRAME_TIME, 2)
})
