// A clip mask as a CSS `clip-path` for the timeline's thumbnail (ESCSUITE-65).
//
// Every number here is checked twice over: once against the string the DOM will
// carry, and once — for the circle — against `core/clipMask.ts`'s own answer for
// the same box, because "the thumbnail shows the same shape the frame draws" is
// this module's entire reason to exist and a second copy of the geometry is the
// way it would stop being true.
import { describe, it, expect } from 'vitest'
import { CLIP_THUMB_ASPECT, maskClipPathFor } from './maskClipPath'
import { maskPathFor } from '../core/clipMask'
import type { ClipMask } from '../store/types'

/** The thumbnail on a default 60px track: `.clip` is that height less 8. */
const H = 52

describe('maskClipPathFor', () => {
  it('inscribes a circle of half the thumb’s height, centred', () => {
    // The thumb is 16:9, so its shorter side is its height and the inscribed
    // circle is h/2 — the same rule `core/clipMask.ts` applies to a drawn box.
    expect(maskClipPathFor({ kind: 'circle' }, H)).toBe('circle(26px at 50% 50%)')
  })

  it('is the same circle core/clipMask.ts draws for the same box', () => {
    const path = maskPathFor('circle', undefined, 0, 0, H * CLIP_THUMB_ASPECT, H)
    // Not a restatement of the assertion above: this one fails if the two ever
    // stop sharing an implementation, which is the only way they can drift.
    expect(path.shape).toBe('circle')
    expect(maskClipPathFor({ kind: 'circle' }, H)).toBe(
      `circle(${path.shape === 'circle' ? path.radius : NaN}px at 50% 50%)`
    )
  })

  it('carries a half-pixel radius rather than rounding a shape away', () => {
    // An odd row height is reachable: track heights are stored numbers.
    expect(maskClipPathFor({ kind: 'circle' }, 45)).toBe('circle(22.5px at 50% 50%)')
  })

  it.each([
    // radius (fraction of the shorter side) → the string, at h = 52
    [0.05, 'inset(0 round 2.6px)'],
    [0.25, 'inset(0 round 13px)'],
    // 0.35 x 52 is 18.200000000000003 in IEEE 754. The DOM must not carry that.
    [0.35, 'inset(0 round 18.2px)'],
    // Clamped to half the shorter side: past that a real roundRect throws.
    [0.5, 'inset(0 round 26px)'],
    [0.9, 'inset(0 round 26px)'],
  ])('rounds the corners by %s of the thumb’s height', (radius, expected) => {
    expect(maskClipPathFor({ kind: 'rounded', radius }, H)).toBe(expected)
  })

  it.each<[string, ClipMask | undefined]>([
    ['no mask at all', undefined],
    ['an explicit none', { kind: 'none' }],
    ['a rounded mask with square corners', { kind: 'rounded', radius: 0 }],
    ['a rounded mask with no radius', { kind: 'rounded' }],
    ['a negative radius', { kind: 'rounded', radius: -1 }],
  ])('clips nothing for %s', (_label, mask) => {
    // `undefined`, not `'none'`: React drops an undefined style property, so the
    // element carries no clip-path at all — which is what an unmasked clip's
    // thumbnail has to look like in the DOM.
    expect(maskClipPathFor(mask, H)).toBeUndefined()
  })

  it.each([0, -4])('clips nothing for a thumb of %s pixels', (height) => {
    // A row collapsed to nothing has no shape. `maskPathFor` answers its
    // degenerate-box arm here and this is the reader that makes it reachable
    // from the timeline.
    expect(maskClipPathFor({ kind: 'circle' }, height)).toBeUndefined()
  })
})

describe('CLIP_THUMB_ASPECT', () => {
  it('is 16:9, the aspect the thumbnail box is laid out at', () => {
    // Exported rather than repeated in the component: the width the <img> is
    // given and the box this module resolves the clip-path against have to be
    // the same box.
    expect(CLIP_THUMB_ASPECT).toBeCloseTo(16 / 9, 10)
  })
})
