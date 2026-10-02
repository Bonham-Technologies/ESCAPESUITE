// The crop maths on its own (ESCSUITE-6).
//
// Everything here is arithmetic over a source frame, so it is tested without a
// clip, without a renderer and without a store. The four callers —
// `core/canvasRenderer.ts`, `components/Preview/previewGeometry.ts`,
// `store/projectMigration.ts` and the inspector's `handleCropChange` — each have
// their own tests that they *call* these; the numbers live here.
import { describe, it, expect } from 'vitest'
import {
  MAX_CROP_INSET,
  cropForAspect,
  croppedSourceRect,
  isValidCrop,
  normaliseCrop,
} from './clipCrop'
import type { ClipCrop } from '../store/types'

/** The source frame every case below crops: 400 x 200, so a 2:1 picture. */
const W = 400
const H = 200

const crop = (overrides: Partial<ClipCrop> = {}): ClipCrop => ({
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  ...overrides,
})

describe('croppedSourceRect', () => {
  it('is the whole frame when the clip carries no crop', () => {
    expect(croppedSourceRect(W, H, undefined)).toEqual({ sx: 0, sy: 0, sw: 400, sh: 200 })
  })

  it('turns insets into a rectangle in source pixels', () => {
    // 25% off the left and 10% off the right of 400 leaves 260, starting at 100.
    // 50% off the top of 200 leaves 100, starting at 100.
    expect(croppedSourceRect(W, H, crop({ left: 0.25, right: 0.1, top: 0.5 }))).toEqual({
      sx: 100,
      sy: 100,
      sw: 260,
      sh: 100,
    })
  })

  it('never hands the renderer a region with no pixels in it', () => {
    // `drawImage` throws IndexSizeError on a zero-width source rect, and inside
    // a preview frame a throw kills the whole frame rather than just the clip.
    // A crop this extreme cannot come from the inspector (normaliseCrop refuses
    // it) or from a loaded file (parseProject refuses it), but a session
    // snapshot is restored through neither, so the floor lives here — the one
    // place every pipeline reads.
    expect(croppedSourceRect(W, H, crop({ left: 0.999 }))).toMatchObject({ sw: 1 })
    expect(croppedSourceRect(W, H, crop({ top: 0.999 }))).toMatchObject({ sh: 1 })
  })
})

describe('isValidCrop', () => {
  it('accepts four finite, non-negative insets that leave a region', () => {
    expect(isValidCrop(crop({ left: 0.25, top: 0.1, right: 0.25, bottom: 0.1 }))).toBe(true)
  })

  it('accepts an all-zero crop — it is a shape check, not a tidiness check', () => {
    // parseProject's question is "can the renderer read this", and it can.
    // Turning {0,0,0,0} into `undefined` is the inspector's job, and a file that
    // carries one is not corrupt.
    expect(isValidCrop(crop())).toBe(true)
  })

  it.each([
    ['null', null],
    ['a number', 0.5],
    ['a string', 'half'],
    ['an object missing an edge', { left: 0.1, top: 0.1, right: 0.1 }],
    ['an edge that is not a number', { ...crop(), bottom: '0.1' }],
    ['an edge that is NaN', { ...crop(), left: Number.NaN }],
    ['an edge that is Infinity', { ...crop(), top: Number.POSITIVE_INFINITY }],
    ['a negative edge', { ...crop(), right: -0.1 }],
    ['a left and right that leave no width', { ...crop(), left: 0.5, right: 0.5 }],
    ['a top and bottom that leave no height', { ...crop(), top: 0.6, bottom: 0.4 }],
  ])('rejects %s', (_label, value) => {
    expect(isValidCrop(value)).toBe(false)
  })
})

describe('normaliseCrop', () => {
  it('stores nothing at all for an all-zero crop', () => {
    expect(normaliseCrop(crop(), W, H)).toEqual({ ok: true })
  })

  it('keeps a crop that leaves a region', () => {
    expect(normaliseCrop(crop({ left: 0.25, bottom: 0.1 }), W, H)).toEqual({
      ok: true,
      crop: { left: 0.25, top: 0, right: 0, bottom: 0.1 },
    })
  })

  it('clamps an inset to the 0–90% the inspector offers', () => {
    expect(normaliseCrop(crop({ left: 2, top: -1 }), W, H)).toEqual({
      ok: true,
      crop: { left: MAX_CROP_INSET, top: 0, right: 0, bottom: 0 },
    })
  })

  it('treats an inset that is not a finite number as no inset', () => {
    expect(normaliseCrop({ ...crop({ right: 0.2 }), left: Number.NaN }, W, H)).toEqual({
      ok: true,
      crop: { left: 0, top: 0, right: 0.2, bottom: 0 },
    })
  })

  it('refuses a crop that would leave less than one source pixel across', () => {
    // 90% off each side is what two sliders at their maximum ask for, so this is
    // reachable from the UI and not a defensive branch.
    expect(normaliseCrop(crop({ left: 0.9, right: 0.9 }), W, H)).toEqual({ ok: false })
  })

  it('refuses a crop that would leave less than one source pixel tall', () => {
    expect(normaliseCrop(crop({ top: 0.9, bottom: 0.9 }), W, H)).toEqual({ ok: false })
  })
})

describe('cropForAspect', () => {
  it('takes the width in for a square region of a wide frame', () => {
    // A 1:1 region of 400x200 is 200x200, centred, so 100px comes off each side.
    expect(cropForAspect(W, H, 1)).toEqual({ left: 0.25, top: 0, right: 0.25, bottom: 0 })
  })

  it('takes the height in for a region wider than the frame', () => {
    // A 4:1 region of a 2:1 frame is 400x100, so 50px comes off top and bottom.
    expect(cropForAspect(W, H, 4)).toEqual({ left: 0, top: 0.25, right: 0, bottom: 0.25 })
  })

  it('leaves a frame that already has the target aspect alone', () => {
    expect(cropForAspect(W, H, 2)).toEqual({ left: 0, top: 0, right: 0, bottom: 0 })
  })

  it('works inside the crop the clip already has, not against the whole frame', () => {
    // The clip shows the left half: a 200x200 region at (0, 0), which is already
    // 1:1 — so the insets come back unchanged. That is the whole reason this
    // takes the current crop.
    const existing = crop({ right: 0.5 })

    expect(cropForAspect(W, H, 1, existing)).toEqual(existing)
  })

  it('centres the new region on the region it was given, not on the frame', () => {
    // The clip shows the right half — 200x200 starting at x 200. A 2:1 region of
    // that is 200x100 centred on (300, 100), so 50px comes off the top and the
    // bottom and the left/right insets are untouched.
    expect(cropForAspect(W, H, 2, crop({ left: 0.5 }))).toEqual({
      left: 0.5,
      top: 0.25,
      right: 0,
      bottom: 0.25,
    })
  })
})
