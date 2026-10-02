// The crop GESTURE's arithmetic, on its own (ESCSUITE-157).
//
// Everything here is numbers over a source frame: no clip, no store, no canvas,
// no pointer. The hook that drives it (`components/Preview/useCropHandleGesture.ts`)
// has its own tests for the writing and the announcing; the numbers live here.
//
// The frame throughout is 400 x 200 — a 2:1 picture, so an aspect lock has
// something to do — drawn at scale 1 into a 1920 x 1080 project unless a case
// says otherwise.
import { describe, it, expect } from 'vitest'
import {
  CROP_HANDLES,
  CROP_HANDLE_LABELS,
  CROP_NUDGE,
  cropAnnouncement,
  cropCentreFor,
  cropCompensatesCentre,
  cropForHandleMove,
  cropRegionAspect,
  cropWriteFor,
  cropsEqual,
  sourceDelta,
  type CropGestureTransform,
} from './cropDrag'
import { makeAnimation } from '../test/fixtures/clipFixtures'
import type { ClipCrop, ClipTransform } from '../store/types'

const SOURCE = { width: 400, height: 200 }
const PROJECT = { width: 1920, height: 1080 }

const crop = (overrides: Partial<ClipCrop> = {}): ClipCrop => ({
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  ...overrides,
})

const transform = (overrides: Partial<CropGestureTransform> = {}): CropGestureTransform => ({
  x: 0.5,
  y: 0.5,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  ...overrides,
})

describe('the handle table', () => {
  it('has eight handles, each with a name of its own', () => {
    expect(CROP_HANDLES).toHaveLength(8)
    const names = CROP_HANDLES.map((handle) => CROP_HANDLE_LABELS[handle])
    expect(new Set(names).size).toBe(8)
  })

  it('nudges one source pixel, or ten with Shift', () => {
    expect(CROP_NUDGE).toEqual({ fine: 1, coarse: 10 })
  })
})

describe('sourceDelta', () => {
  it('is the displacement itself for an unrotated clip at scale 1', () => {
    expect(sourceDelta({ x: 40, y: -10 }, transform())).toEqual({ x: 40, y: -10 })
  })

  it('divides by the clip\'s scale — a 2x clip crops half as fast as the pointer moves', () => {
    expect(sourceDelta({ x: 40, y: 20 }, transform({ scaleX: 2, scaleY: 4 }))).toEqual({
      x: 20,
      y: 5,
    })
  })

  it('un-rotates: dragging DOWN a clip rotated 90° moves along its own x axis', () => {
    // The canvas rotates the clip, so the clip's local +x points down the
    // screen. The same R(-θ) `previewGeometry.ts`'s `toLocalPoint` applies.
    const local = sourceDelta({ x: 0, y: 40 }, transform({ rotation: 90 }))

    expect(local.x).toBeCloseTo(40)
    expect(local.y).toBeCloseTo(0)
  })
})

describe('cropForHandleMove', () => {
  it('turns a rightward drag of the left handle into a left inset', () => {
    expect(cropForHandleMove(undefined, 'w', { x: 100, y: 0 }, SOURCE)).toEqual(
      crop({ left: 0.25 })
    )
  })

  it('reads the right handle the other way round — leftward crops the right', () => {
    expect(cropForHandleMove(undefined, 'e', { x: -100, y: 0 }, SOURCE)).toEqual(
      crop({ right: 0.25 })
    )
  })

  it('moves two insets for a corner, and only those two', () => {
    expect(cropForHandleMove(undefined, 'se', { x: -100, y: -50 }, SOURCE)).toEqual(
      crop({ right: 0.25, bottom: 0.25 })
    )
  })

  it('leaves the other three edges exactly as the gesture found them', () => {
    const start = crop({ left: 0.1, top: 0.2, right: 0.3, bottom: 0.05 })

    const result = cropForHandleMove(start, 'n', { x: 999, y: 20 }, SOURCE)

    // The other three edges are untouched input, so they compare exactly; the
    // moved one is 0.2 + 20 / 200, which IEEE-754 does not round-trip through
    // the literal 0.3 (0.30000000000000004 !== 0.3), so it alone is toBeCloseTo.
    expect(result.left).toBe(start.left)
    expect(result.right).toBe(start.right)
    expect(result.bottom).toBe(start.bottom)
    expect(result.top).toBeCloseTo(0.3)
  })

  it('stops at the edge it started from rather than going negative', () => {
    expect(cropForHandleMove(undefined, 'w', { x: -100, y: 0 }, SOURCE)).toEqual(crop())
  })

  it('keeps one source pixel, and keeps it by clamping the inset that MOVED', () => {
    // 90% is already off the right, so the left can take at most
    // 1 - 1/400 - 0.9 = 0.0975 before the region has no pixel in it. The right
    // inset is the pinned edge and does not move to make room.
    const start = crop({ right: 0.9 })

    expect(cropForHandleMove(start, 'w', { x: 400, y: 0 }, SOURCE)).toEqual({
      ...start,
      left: 1 - 1 / 400 - 0.9,
    })
  })

  describe('with Shift holding the aspect', () => {
    it('derives the height from the width for a side handle, about the region\'s centre', () => {
      // 50% off the right leaves 200x200 at (0,0); held at 2:1 that is 200x100,
      // centred on the region's own centre (100, 100) — so 25% comes off the top
      // and 25% off the bottom.
      expect(cropForHandleMove(undefined, 'e', { x: -200, y: 0 }, SOURCE, 2)).toEqual({
        left: 0,
        top: 0.25,
        right: 0.5,
        bottom: 0.25,
      })
    })

    it('absorbs a corner\'s dependent axis into the edge the corner owns', () => {
      // 25% off the left leaves 300x200 at (100,0); held at 3:1 that is 300x100,
      // and the handle is the NW one — so the BOTTOM stays where it was and the
      // whole 100px comes off the top.
      expect(cropForHandleMove(undefined, 'nw', { x: 100, y: 0 }, SOURCE, 3)).toEqual({
        left: 0.25,
        top: 0.5,
        right: 0,
        bottom: 0,
      })
    })

    it('absorbs it into the BOTTOM for a bottom corner, pinning the top', () => {
      // The mirror of the case above, and the reason the corner arm is written
      // out per edge rather than behind a computed key.
      expect(cropForHandleMove(undefined, 'sw', { x: 100, y: 0 }, SOURCE, 3)).toEqual({
        left: 0.25,
        top: 0,
        right: 0,
        bottom: 0.5,
      })
    })

    it('derives the width from the height for a top or bottom handle', () => {
      // 50% off the top leaves 400x100 at (0,100); held at 1:1 that is 100x100,
      // centred on the region's centre (200, 150) — 150px off each side.
      expect(cropForHandleMove(undefined, 'n', { x: 0, y: 100 }, SOURCE, 1)).toEqual({
        left: 0.375,
        top: 0.5,
        right: 0.375,
        bottom: 0,
      })
    })

    it('leaves a region that already has the aspect alone', () => {
      expect(cropForHandleMove(undefined, 'e', { x: 0, y: 0 }, SOURCE, 2)).toEqual(crop())
    })
  })
})

describe('cropRegionAspect', () => {
  it('is the frame\'s own aspect with no crop', () => {
    expect(cropRegionAspect(undefined, SOURCE)).toBe(2)
  })

  it('is the kept region\'s aspect, not the frame\'s', () => {
    expect(cropRegionAspect(crop({ right: 0.5 }), SOURCE)).toBe(1)
  })
})

describe('cropCentreFor', () => {
  it('leaves the centre alone when the crop did not change', () => {
    expect(
      cropCentreFor({ crop: undefined, transform: transform() }, crop(), SOURCE, PROJECT)
    ).toEqual({ x: 0.5, y: 0.5 })
  })

  it('moves the centre so the edges the drag did not touch stay still', () => {
    // 25% off the left: the kept region's centre moves from source x 200 to 250,
    // so the drawn picture's centre moves 50 project pixels right — which is
    // what holds the right edge at the pixel it was already on.
    const centre = cropCentreFor(
      { crop: undefined, transform: transform() },
      crop({ left: 0.25 }),
      SOURCE,
      PROJECT
    )

    expect(centre.x).toBeCloseTo(0.5 + 50 / 1920)
    expect(centre.y).toBeCloseTo(0.5)
  })

  it('carries the displacement out through the clip\'s scale', () => {
    const centre = cropCentreFor(
      { crop: undefined, transform: transform({ scaleX: 2 }) },
      crop({ left: 0.25 }),
      SOURCE,
      PROJECT
    )

    expect(centre.x).toBeCloseTo(0.5 + 100 / 1920)
  })

  it('rotates it with the clip — a 90° clip\'s left crop moves the centre DOWN', () => {
    const centre = cropCentreFor(
      { crop: undefined, transform: transform({ rotation: 90 }) },
      crop({ left: 0.25 }),
      SOURCE,
      PROJECT
    )

    expect(centre.x).toBeCloseTo(0.5)
    expect(centre.y).toBeCloseTo(0.5 + 50 / 1080)
  })
})

describe('cropCompensatesCentre', () => {
  // Whether a crop write may move the clip's centre to hold the edges the drag
  // is not touching. Not on a clip whose placement is keyframed: a static centre
  // written onto an animated one fights its keyframes, and the keyframes win at
  // playback anyway (operator ruling, 2026-10-02).
  const kf = [{ time: 0, value: 0.5, easing: 'linear' as const }]

  it('compensates a clip with no animation at all', () => {
    expect(cropCompensatesCentre(undefined)).toBe(true)
  })

  it('compensates a clip whose animation carries no keyframes', () => {
    expect(cropCompensatesCentre(makeAnimation())).toBe(true)
  })

  it('does not compensate a clip keyframed on position', () => {
    expect(cropCompensatesCentre(makeAnimation({ keyframes: { x: kf } }))).toBe(false)
    expect(cropCompensatesCentre(makeAnimation({ keyframes: { y: kf } }))).toBe(false)
  })

  it('does not compensate a clip keyframed on scale', () => {
    expect(cropCompensatesCentre(makeAnimation({ keyframes: { scaleX: kf } }))).toBe(false)
    expect(cropCompensatesCentre(makeAnimation({ keyframes: { scaleY: kf } }))).toBe(false)
  })

  it('still compensates a clip keyframed on rotation, opacity or blur alone', () => {
    // Those do not move the clip's centre, so the centre is still the gesture's
    // to write. The rotation case carries a known inexactness — the
    // compensation uses the static rotation — which is documented, not branched
    // on.
    expect(cropCompensatesCentre(makeAnimation({ keyframes: { rotation: kf } }))).toBe(true)
    expect(cropCompensatesCentre(makeAnimation({ keyframes: { opacity: kf } }))).toBe(true)
    expect(cropCompensatesCentre(makeAnimation({ keyframes: { blur: kf } }))).toBe(true)
  })

  it('ignores an empty keyframe list, which is what deleting the last one leaves', () => {
    expect(cropCompensatesCentre(makeAnimation({ keyframes: { x: [] } }))).toBe(true)
  })
})

describe('cropWriteFor', () => {
  const full: ClipTransform = { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.8 }

  it('writes the crop and the compensating transform, carrying the rest of it over', () => {
    const write = cropWriteFor(
      { crop: undefined, transform: full },
      crop({ left: 0.25 }),
      SOURCE,
      PROJECT,
      true
    )

    expect(write.crop).toEqual(crop({ left: 0.25 }))
    expect(write.transform!.x).toBeCloseTo(0.5 + 50 / 1920)
    // Everything the gesture is not changing comes across untouched — the write
    // hands `updateClip` a whole ClipTransform, not a patch.
    expect(write.transform!.opacity).toBe(0.8)
    expect(write.transform!.scaleX).toBe(1)
  })

  it('writes the crop ALONE when the clip\'s placement is keyframed', () => {
    const write = cropWriteFor(
      { crop: undefined, transform: full },
      crop({ left: 0.25 }),
      SOURCE,
      PROJECT,
      false
    )

    expect(write).toEqual({ crop: crop({ left: 0.25 }) })
    expect('transform' in write).toBe(false)
  })

  it('carries an undefined crop through — the clip going back to its whole frame', () => {
    const write = cropWriteFor(
      { crop: crop({ left: 0.25 }), transform: full },
      undefined,
      SOURCE,
      PROJECT,
      true
    )

    expect(write.crop).toBeUndefined()
    // Back to no crop at all, so the centre comes back to where it started.
    expect(write.transform!.x).toBeCloseTo(0.5 - 50 / 1920)
  })
})

describe('cropsEqual', () => {
  it('treats no crop and four zeroes as the same thing', () => {
    expect(cropsEqual(undefined, crop())).toBe(true)
  })

  it('tells one inset apart', () => {
    expect(cropsEqual(crop({ top: 0.1 }), crop({ top: 0.2 }))).toBe(false)
  })

  it('compares all four edges', () => {
    const left = crop({ left: 0.1, top: 0.2, right: 0.3, bottom: 0.4 })

    expect(cropsEqual(left, { ...left })).toBe(true)
    expect(cropsEqual(left, { ...left, bottom: 0.41 })).toBe(false)
  })
})

describe('cropAnnouncement', () => {
  it('names the handle and the one inset a side handle owns, in source pixels', () => {
    // Percentages would round a one-pixel nudge of a wide source to "0%", which
    // is the one thing a nudge announcement must not say.
    expect(cropAnnouncement('w', crop({ left: 1 / 400 }), SOURCE)).toBe('Crop left: left 1 px')
  })

  it('names both insets a corner owns', () => {
    expect(cropAnnouncement('nw', crop({ left: 0.25, top: 0.1 }), SOURCE)).toBe(
      'Crop top left: left 100 px, top 20 px'
    )
  })

  it('reads a clip with no crop as zeroes', () => {
    expect(cropAnnouncement('s', undefined, SOURCE)).toBe('Crop bottom: bottom 0 px')
  })
})
