// Zoom to region (ESCSUITE-475): the pure planner the preview's form calls.
//
// The acceptance checks are the ones the ticket names: at the hold's midpoint
// the region fills the frame (within 1 px at 1080p) and is centred; before and
// after the zoom the clip renders exactly as it did; a region at the video's
// edge is clamped so nothing outside the video shows; existing keyframes
// outside the span are kept and an overlap is refused with a reason. The
// renderer-level case at the end is the "preview and every export agree"
// check: they all draw a media clip through `drawClipToCanvas`, which reads the
// same `getAnimatedValues` the planner was checked against.
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ZOOM_SETTINGS,
  MAX_ZOOM_FACTOR,
  defaultZoomRegion,
  dragZoomRect,
  fitZoomRegion,
  planZoomToRegion,
  zoomBounds,
  zoomedPlacement,
  type ZoomPlan,
  type ZoomRect,
  type ZoomRequest,
} from './zoomToRegion'
import { getAnimatedValues } from './animation'
import { drawClipToCanvas } from '../core/canvasRenderer'
import { croppedSourceRect } from '../core/clipCrop'
import { createRecordingContext, destBox, sourceBox } from '../test/doubles/canvas'
import { VideoFrameDouble } from '../test/doubles/webcodecs'
import { makeAnimation, makeClip } from '../test/fixtures/clipFixtures'
import type { Clip, ClipAnimation } from '../store/types'
import type { DrawableMediaSource } from '../core/exportTypes'

const PROJECT = { width: 1920, height: 1080 }
const SOURCE = { width: 1920, height: 1080 }

function request(overrides: Partial<ZoomRequest> = {}): ZoomRequest {
  return {
    clip: makeClip({ duration: 10 }),
    source: SOURCE,
    project: PROJECT,
    clipTime: 2,
    region: { x: 1000, y: 100, width: 640, height: 360 },
    settings: DEFAULT_ZOOM_SETTINGS,
    ...overrides,
  }
}

function applied(clip: Clip, plan: ZoomPlan): Clip {
  if (!plan.ok) throw new Error(plan.reason)
  const animation: ClipAnimation = clip.animation ?? makeAnimation()
  return { ...clip, animation: { ...animation, keyframes: { ...animation.keyframes, ...plan.tracks } } }
}

function valuesAt(clip: Clip, t: number) {
  return getAnimatedValues(t, clip.duration, clip.animation, clip.transform, clip.effects)
}

/**
 * Where the picture's point `p` (in the frame as it was at the zoom's start)
 * lands at clip time `t`: the drawn box's centre moves and its size scales, so
 * every point of the picture moves with them.
 */
function mapped(before: Clip, after: Clip, start: number, t: number, p: { x: number; y: number }) {
  const a = valuesAt(before, start)
  const b = valuesAt(after, t)
  return {
    x: b.x * PROJECT.width + (p.x - a.x * PROJECT.width) * (b.scaleX / a.scaleX),
    y: b.y * PROJECT.height + (p.y - a.y * PROJECT.height) * (b.scaleY / a.scaleY),
  }
}

function expectFillsFrame(before: Clip, plan: ZoomPlan) {
  if (!plan.ok) throw new Error(plan.reason)
  const after = applied(before, plan)
  const mid = (plan.start + plan.end) / 2
  const { region } = plan
  const topLeft = mapped(before, after, plan.start, mid, region)
  const bottomRight = mapped(before, after, plan.start, mid, {
    x: region.x + region.width,
    y: region.y + region.height,
  })
  expect(Math.abs(topLeft.x)).toBeLessThan(1)
  expect(Math.abs(topLeft.y)).toBeLessThan(1)
  expect(Math.abs(bottomRight.x - PROJECT.width)).toBeLessThan(1)
  expect(Math.abs(bottomRight.y - PROJECT.height)).toBeLessThan(1)
  // Centred: the region's own centre is the frame's.
  const centre = mapped(before, after, plan.start, mid, {
    x: region.x + region.width / 2,
    y: region.y + region.height / 2,
  })
  expect(centre.x).toBeCloseTo(PROJECT.width / 2, 6)
  expect(centre.y).toBeCloseTo(PROJECT.height / 2, 6)
}

describe('planZoomToRegion', () => {
  it('fills the frame with the region, centred, at the hold midpoint', () => {
    const req = request()
    const plan = planZoomToRegion(req)

    expect(plan.ok).toBe(true)
    expectFillsFrame(req.clip, plan)
  })

  it('writes four keyframes per property: ease in, hold, ease out', () => {
    const plan = planZoomToRegion(request({ settings: { hold: 2, transition: 1, easing: 'ease-in-cubic' } }))
    if (!plan.ok) throw new Error(plan.reason)

    expect(plan.start).toBe(2)
    expect(plan.end).toBe(6)
    expect(plan.tracks.scaleX).toEqual([
      { time: 2, value: 1, easing: 'ease-in-cubic' },
      { time: 3, value: 3, easing: 'linear' },
      { time: 5, value: 3, easing: 'ease-in-cubic' },
      { time: 6, value: 1, easing: 'linear' },
    ])
    expect(plan.tracks.scaleY.map((kf) => kf.value)).toEqual([1, 3, 3, 1])
    expect(plan.tracks.x.map((kf) => kf.time)).toEqual([2, 3, 5, 6])
  })

  it('handles a cropped clip with a non-default transform', () => {
    const clip = makeClip({
      duration: 10,
      transform: { x: 0.45, y: 0.55, scaleX: 1.2, scaleY: 1.1, rotation: 0, opacity: 1 },
      crop: { left: 0.1, top: 0.05, right: 0.2, bottom: 0 },
    })
    const req = request({ clip, region: { x: 300, y: 250, width: 480, height: 270 } })
    const plan = planZoomToRegion(req)

    expect(plan.ok).toBe(true)
    expectFillsFrame(clip, plan)
  })

  it('starts from a value the clip already holds through the span, not its base transform', () => {
    // Position X moved to 0.4 at 1 s and stays there; the zoom starts there.
    const clip = makeClip({
      duration: 10,
      animation: makeAnimation({
        keyframes: { x: [{ time: 0, value: 0.5, easing: 'linear' }, { time: 1, value: 0.4, easing: 'linear' }] },
      }),
    })
    const plan = planZoomToRegion(request({ clip, region: { x: 200, y: 200, width: 640, height: 360 } }))
    if (!plan.ok) throw new Error(plan.reason)

    expect(plan.tracks.x[2]).toEqual({ time: 2, value: 0.4, easing: 'ease-in-out' })
    expect(plan.tracks.x[5]).toEqual({ time: 6, value: 0.4, easing: 'linear' })
    expectFillsFrame(clip, plan)
  })

  it('leaves the clip exactly as it was before and after the zoom, keeping its other keyframes', () => {
    const own = {
      x: [
        { time: 0, value: 0.5, easing: 'linear' as const },
        { time: 1, value: 0.4, easing: 'ease-out' as const },
      ],
      scaleX: [{ time: 8, value: 1, easing: 'ease-in' as const }, { time: 9.5, value: 1.5, easing: 'linear' as const }],
      opacity: [{ time: 3, value: 0.5, easing: 'linear' as const }],
    }
    const clip = makeClip({
      duration: 10,
      animation: makeAnimation({ in: { type: 'fade', duration: 0.5, easing: 'linear' }, keyframes: own }),
    })
    const plan = planZoomToRegion(request({ clip }))
    if (!plan.ok) throw new Error(plan.reason)
    const after = applied(clip, plan)

    for (let t = 0; t <= 10; t += 0.05) {
      if (t >= plan.start && t <= plan.end) continue
      expect(valuesAt(after, t)).toEqual(valuesAt(clip, t))
    }
    // Every keyframe the clip had is still there, unchanged.
    expect(after.animation!.keyframes.x).toEqual(expect.arrayContaining(own.x))
    expect(after.animation!.keyframes.scaleX).toEqual(expect.arrayContaining(own.scaleX))
    expect(after.animation!.keyframes.opacity).toBe(own.opacity)
    expect(plan.tracks.x).toHaveLength(6)
  })

  describe('clamps the region so nothing outside the video shows', () => {
    it('at the edge of a full-frame clip', () => {
      const plan = planZoomToRegion(request({ region: { x: 1700, y: 900, width: 640, height: 360 } }))
      if (!plan.ok) throw new Error(plan.reason)

      expect(plan.region).toEqual({ x: 1280, y: 720, width: 640, height: 360 })
      expectFillsFrame(request().clip, plan)
    })

    it('inside a picture-in-picture clip smaller than the frame', () => {
      // A 1920x1080 source at half size, centred: drawn over (480, 270)-(1440, 810).
      const clip = makeClip({
        duration: 10,
        transform: { x: 0.5, y: 0.5, scaleX: 0.5, scaleY: 0.5, rotation: 0, opacity: 1 },
      })
      const plan = planZoomToRegion(request({ clip, region: { x: 0, y: 0, width: 1920, height: 1080 } }))
      if (!plan.ok) throw new Error(plan.reason)

      expect(plan.region).toEqual({ x: 480, y: 270, width: 960, height: 540 })
      expectFillsFrame(clip, plan)
    })

    it('inside a cropped clip, and to the output aspect ratio', () => {
      // The right half of the source, kept where it was: drawn over (960, 0)-(1920, 1080) less the crop.
      const clip = makeClip({ duration: 10, crop: { left: 0.5, top: 0, right: 0, bottom: 0 } })
      const bounds = zoomBounds(clip, SOURCE, PROJECT, 2)!
      expect(bounds).toEqual({ x: 480, y: 0, width: 960, height: 1080 })

      const plan = planZoomToRegion(request({ clip, region: { x: 0, y: 0, width: 300, height: 1000 } }))
      if (!plan.ok) throw new Error(plan.reason)

      expect(plan.region.width / plan.region.height).toBeCloseTo(16 / 9, 9)
      expect(plan.region.x).toBeGreaterThanOrEqual(480)
      expect(plan.region.x + plan.region.width).toBeLessThanOrEqual(1440 + 1e-9)
      expectFillsFrame(clip, plan)
    })
  })

  describe('refuses, with a reason, a zoom that would overlap the clip’s own animation', () => {
    it('names a keyframe inside the span', () => {
      const clip = makeClip({
        duration: 10,
        animation: makeAnimation({ keyframes: { scaleY: [{ time: 3.25, value: 1.2, easing: 'linear' }] } }),
      })
      const plan = planZoomToRegion(request({ clip }))

      expect(plan).toEqual({
        ok: false,
        reason:
          'Scale Y has a keyframe at 3.25 s, inside the zoom (2.00 s to 6.00 s). Move or delete it, or start the zoom somewhere else.',
      })
    })

    it('names an Animate In preset point inside the span', () => {
      const clip = makeClip({
        duration: 10,
        animation: makeAnimation({ in: { type: 'slide-left', duration: 2.5, easing: 'linear' } }),
      })
      const plan = planZoomToRegion(request({ clip }))

      expect(plan.ok).toBe(false)
      if (!plan.ok) expect(plan.reason).toMatch(/^Position X has an Animate In preset point at 2\.50 s/)
    })

    it('names an Animate Out preset point inside the span', () => {
      const clip = makeClip({
        duration: 10,
        animation: makeAnimation({ out: { type: 'scale', duration: 5, easing: 'linear' } }),
      })
      const plan = planZoomToRegion(request({ clip }))

      expect(plan.ok).toBe(false)
      if (!plan.ok) expect(plan.reason).toMatch(/^Scale X has an Animate Out preset point at 5\.00 s/)
    })

    it('names an animation that runs across the span', () => {
      const clip = makeClip({
        duration: 10,
        animation: makeAnimation({
          keyframes: { y: [{ time: 1, value: 0.5, easing: 'linear' }, { time: 8, value: 0.6, easing: 'linear' }] },
        }),
      })
      const plan = planZoomToRegion(request({ clip }))

      expect(plan.ok).toBe(false)
      if (!plan.ok) {
        expect(plan.reason).toBe(
          'Position Y animates between its keyframes at 1.00 s and 8.00 s, across the zoom (2.00 s to 6.00 s). Start the zoom where it holds still.'
        )
      }
    })

    it('accepts keyframes on either side that hold the same value across it', () => {
      const clip = makeClip({
        duration: 10,
        animation: makeAnimation({
          keyframes: { y: [{ time: 1, value: 0.5, easing: 'ease-in' }, { time: 8, value: 0.5, easing: 'linear' }] },
        }),
      })

      expect(planZoomToRegion(request({ clip })).ok).toBe(true)
    })
  })

  describe('refuses what it cannot zoom', () => {
    const reasonFor = (overrides: Partial<ZoomRequest>) => {
      const plan = planZoomToRegion(request(overrides))
      return plan.ok ? null : plan.reason
    }

    it('a playhead off the clip', () => {
      expect(reasonFor({ clipTime: -0.1 })).toMatch(/^Move the playhead onto the clip/)
      expect(reasonFor({ clipTime: 10 })).toMatch(/^Move the playhead onto the clip/)
    })

    it('a zoom longer than what is left of the clip', () => {
      expect(reasonFor({ clipTime: 7 })).toBe(
        'The zoom takes 4.00 s, but the clip ends 3.00 s after the playhead. Move the playhead earlier, or shorten the hold or the transition.'
      )
      // Ending exactly at the clip's end is fine.
      expect(reasonFor({ clipTime: 6 })).toBeNull()
    })

    it('a hold or a transition too short to be two keyframes', () => {
      expect(reasonFor({ settings: { ...DEFAULT_ZOOM_SETTINGS, hold: 0 } })).toMatch(/at least 0\.05 s/)
      expect(reasonFor({ settings: { ...DEFAULT_ZOOM_SETTINGS, transition: Number.NaN } })).toMatch(/at least/)
    })

    it('a source whose size is not known', () => {
      expect(reasonFor({ source: { width: 0, height: 0 } })).toMatch(/size is not known/)
    })

    it('a masked clip, but not one whose mask is none', () => {
      expect(reasonFor({ clip: makeClip({ duration: 10, mask: { kind: 'circle', radius: 0 } }) })).toMatch(/mask/)
      expect(reasonFor({ clip: makeClip({ duration: 10, mask: { kind: 'none', radius: 0 } }) })).toBeNull()
    })

    it('a rotated clip, and one whose rotation animates in the span', () => {
      expect(
        reasonFor({ clip: makeClip({ duration: 10, transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 10, opacity: 1 } }) })
      ).toMatch(/unrotated/)
      const animated = makeClip({
        duration: 10,
        animation: makeAnimation({ keyframes: { rotation: [{ time: 0, value: 0, easing: 'linear' }, { time: 4, value: 0, easing: 'linear' }] } }),
      })
      expect(reasonFor({ clip: animated })).toMatch(/^Rotation has a keyframe at 4\.00 s/)
    })

    it('a clip that is not in the frame', () => {
      const clip = makeClip({ duration: 10, transform: { x: 2, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } })
      expect(reasonFor({ clip })).toBe('The clip is not in the frame at the playhead.')
    })

    it('a clip that covers too little of the frame', () => {
      const clip = makeClip({ duration: 10, transform: { x: 0.5, y: 0.5, scaleX: 0.05, scaleY: 0.05, rotation: 0, opacity: 1 } })
      expect(reasonFor({ clip })).toBe('The clip covers too little of the frame to zoom into.')
    })
  })
})

describe('the region helpers', () => {
  const frame: ZoomRect = { x: 0, y: 0, width: 1920, height: 1080 }

  it('dragZoomRect grows from the start corner towards the pointer, at the output aspect', () => {
    expect(dragZoomRect({ x: 100, y: 100 }, { x: 420, y: 120 }, PROJECT)).toEqual({ x: 100, y: 100, width: 320, height: 180 })
    expect(dragZoomRect({ x: 500, y: 500 }, { x: 480, y: 320 }, PROJECT)).toEqual({ x: 180, y: 320, width: 320, height: 180 })
  })

  it('fitZoomRegion takes the output aspect, the smallest zoom and the bounds', () => {
    expect(fitZoomRegion({ x: 10, y: 10, width: 100, height: 300 }, frame, PROJECT)).toEqual({
      x: 10,
      y: 10,
      width: 300 * (16 / 9),
      height: 300,
    })
    expect(fitZoomRegion({ x: 10, y: 10, width: 1, height: 1 }, frame, PROJECT)!.width).toBe(1920 / MAX_ZOOM_FACTOR)
    expect(fitZoomRegion({ x: 10, y: 10, width: Number.NaN, height: 1 }, frame, PROJECT)!.width).toBe(1920 / MAX_ZOOM_FACTOR)
    expect(fitZoomRegion({ x: -50, y: 2000, width: 5000, height: 10 }, frame, PROJECT)).toEqual(frame)
    expect(fitZoomRegion({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 100, height: 100 }, PROJECT)).toBeNull()
  })

  it('defaultZoomRegion is half the frame, centred on the picture', () => {
    expect(defaultZoomRegion(frame, PROJECT)).toEqual({ x: 480, y: 270, width: 960, height: 540 })
    expect(defaultZoomRegion({ x: 0, y: 0, width: 960, height: 540 }, PROJECT)).toEqual({ x: 0, y: 0, width: 960, height: 540 })
  })

  it('zoomBounds is the drawn picture cut to the frame, or null off it', () => {
    const clip = makeClip({ transform: { x: 0.25, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } })
    expect(zoomBounds(clip, SOURCE, PROJECT, 0)).toEqual({ x: 0, y: 0, width: 1440, height: 1080 })
    expect(zoomBounds(makeClip({ transform: { x: -1, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } }), SOURCE, PROJECT, 0)).toBeNull()
  })

  it('zoomedPlacement of the whole frame is the placement itself', () => {
    const from = { x: 0.3, y: 0.6, scaleX: 1.5, scaleY: 0.75 }
    const to = zoomedPlacement(from, frame, PROJECT)
    expect(to.x).toBeCloseTo(0.3, 12)
    expect(to.y).toBeCloseTo(0.6, 12)
    expect(to.scaleX).toBe(1.5)
    expect(to.scaleY).toBe(0.75)
  })
})

describe('the renderer every pipeline draws through', () => {
  // The preview (`drawFrame.ts`), the MP4 exporter and the WebM and GIF
  // exporters (`elementFrames.ts`) all draw a media clip with
  // `drawClipToCanvas`, so this is what each of them puts on the frame at the
  // hold's midpoint.
  it('draws the region of the source over the whole frame at the hold midpoint', () => {
    const clip = makeClip({
      duration: 10,
      transform: { x: 0.5, y: 0.5, scaleX: 3, scaleY: 3, rotation: 0, opacity: 1 },
      crop: { left: 0.25, top: 0, right: 0, bottom: 0.1 },
    })
    const source = { width: 640, height: 360 }
    const req = request({ clip, source, region: { x: 600, y: 300, width: 480, height: 270 } })
    const plan = planZoomToRegion(req)
    if (!plan.ok) throw new Error(plan.reason)
    const zoomed = applied(clip, plan)
    const mid = (plan.start + plan.end) / 2

    const ctx = createRecordingContext()
    const drawAt = (c: Clip, t: number) => {
      ctx.calls.length = 0
      drawClipToCanvas(
        ctx as unknown as CanvasRenderingContext2D,
        new VideoFrameDouble({ displayWidth: 640, displayHeight: 360 }) as unknown as DrawableMediaSource,
        c,
        t,
        PROJECT.width,
        PROJECT.height
      )
      const args = ctx.argsFor('drawImage')[0]
      const [sx, sy, sw, sh] = sourceBox(args) as number[]
      const [dx, dy, dw, dh] = destBox(args) as number[]
      // The source point drawn at frame point (px, py).
      return (px: number, py: number) => ({ x: sx + ((px - dx) * sw) / dw, y: sy + ((py - dy) * sh) / dh })
    }

    const before = drawAt(clip, plan.start)
    const regionTopLeft = before(plan.region.x, plan.region.y)
    const regionBottomRight = before(plan.region.x + plan.region.width, plan.region.y + plan.region.height)

    const during = drawAt(zoomed, mid)
    const frameTopLeft = during(0, 0)
    const frameBottomRight = during(PROJECT.width, PROJECT.height)
    // Within a hundredth of a source pixel, which is far under 1 px of output.
    expect(frameTopLeft.x).toBeCloseTo(regionTopLeft.x, 2)
    expect(frameTopLeft.y).toBeCloseTo(regionTopLeft.y, 2)
    expect(frameBottomRight.x).toBeCloseTo(regionBottomRight.x, 2)
    expect(frameBottomRight.y).toBeCloseTo(regionBottomRight.y, 2)
    // And the region lies inside what the crop keeps.
    const kept = croppedSourceRect(640, 360, clip.crop)
    expect(regionTopLeft.x).toBeGreaterThanOrEqual(kept.sx)
    expect(regionBottomRight.y).toBeLessThanOrEqual(kept.sy + kept.sh + 1e-9)

    // Outside the zoom, the very same draw as without it.
    for (const t of [0, plan.start - 0.01, plan.end + 0.01, 10]) {
      ctx.calls.length = 0
      drawClipToCanvas(ctx as unknown as CanvasRenderingContext2D, new VideoFrameDouble({ displayWidth: 640, displayHeight: 360 }) as unknown as DrawableMediaSource, clip, t, PROJECT.width, PROJECT.height)
      const plain = ctx.argsFor('drawImage')[0]
      ctx.calls.length = 0
      drawClipToCanvas(ctx as unknown as CanvasRenderingContext2D, new VideoFrameDouble({ displayWidth: 640, displayHeight: 360 }) as unknown as DrawableMediaSource, zoomed, t, PROJECT.width, PROJECT.height)
      expect(ctx.argsFor('drawImage')[0]).toEqual(plain)
    }
  })
})
