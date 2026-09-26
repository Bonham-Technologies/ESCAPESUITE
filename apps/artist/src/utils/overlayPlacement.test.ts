// Where the webcam clip lands when a take is handed over (ESCSUITE-14,
// decision 8).
//
// The numbers are the live compositor's. ESCAPECRAFT draws the overlay in
// `Compositor.drawWebcamOverlay` (apps/craft/src/core/compositor.ts) as
//
//   webcamWidth  = canvasWidth * webcamSize
//   webcamHeight = webcamWidth * 9 / 16
//   x            = padding                              (left corners)
//                = canvasWidth - webcamWidth - padding  (right corners)
//   y            = padding                              (top corners)
//                = canvasHeight - webcamHeight - padding (bottom corners)
//
// with `padding` 20 on a canvas it caps only *above* 1280 wide, so a narrower
// share keeps the flat 20 (craft's `overlayPaddingFor`). This helper has to put
// the clip in the same place, so every case below reconstructs the drawn
// rectangle from the transform and compares it with those literals. ARTIST
// cannot import craft's compositor (different app), so the numbers are written
// out here with the formula that produced them; slice 4 extracts a shared
// `drawOverlay` and this is the test that will be pointed at it.
import { describe, it, expect } from 'vitest'
import {
  maskForPlacement,
  overlayMarginFor,
  overlayPlacementToTransform,
  strokeForPlacement,
  OVERLAY_CORNER_RADIUS_FRACTION,
  OVERLAY_MARGIN_FRACTION,
  OVERLAY_STROKE_COLOR,
  OVERLAY_STROKE_WIDTH_FRACTION,
} from './overlayPlacement'
import { maskPathFor } from '../core/clipMask'
import { DEFAULT_TRANSFORM } from '../store/types'
import type { OverlayPlacement } from '@escapesuite/shared/types'

/** The rectangle `canvasRenderer` will draw for this transform, in project pixels. */
function drawnRect(
  transform: { x: number; y: number; scaleX: number; scaleY: number },
  project: { width: number; height: number },
  part: { width: number; height: number }
) {
  const width = part.width * transform.scaleX
  const height = part.height * transform.scaleY
  return {
    left: transform.x * project.width - width / 2,
    top: transform.y * project.height - height / 2,
    width,
    height,
  }
}

const placement = (position: OverlayPlacement['position'], size = 0.2): OverlayPlacement => ({
  position,
  size,
  shape: 'circle',
})

/** The compositor's own canvas for a 16:9 take: 1280 wide, padding 20. */
const COMPOSITOR_FRAME = { width: 1280, height: 720 }
/** A 16:9 camera, so the compositor's 9/16 box and the part's own aspect agree. */
const SIXTEEN_BY_NINE_CAMERA = { width: 1280, height: 720 }

describe('overlayPlacementToTransform', () => {
  it.each([
    // position, the compositor's x, its y — webcamWidth 256, webcamHeight 144
    ['top-left', 20, 20],
    ['top-right', 1280 - 256 - 20, 20],
    ['bottom-left', 20, 720 - 144 - 20],
    ['bottom-right', 1280 - 256 - 20, 720 - 144 - 20],
  ] as const)('puts the clip where the compositor drew it: %s', (position, expectedX, expectedY) => {
    const transform = overlayPlacementToTransform(
      placement(position),
      COMPOSITOR_FRAME,
      SIXTEEN_BY_NINE_CAMERA
    )

    const rect = drawnRect(transform, COMPOSITOR_FRAME, SIXTEEN_BY_NINE_CAMERA)
    expect(rect.left).toBeCloseTo(expectedX, 6)
    expect(rect.top).toBeCloseTo(expectedY, 6)
    expect(rect.width).toBeCloseTo(256, 6)
    expect(rect.height).toBeCloseTo(144, 6)
  })

  it('keeps the overlay the same fraction of the frame at any project resolution', () => {
    // The compositor's 20px padding is 20/1280 of its canvas, so on a 1080p
    // project the inset is 30px — the same *proportion* of the frame the user
    // saw, rather than the same number of pixels four times closer to the edge.
    const project = { width: 1920, height: 1080 }
    const transform = overlayPlacementToTransform(placement('bottom-right'), project, {
      width: 1280,
      height: 720,
    })

    const rect = drawnRect(transform, project, { width: 1280, height: 720 })
    expect(rect.width).toBeCloseTo(1920 * 0.2, 6)
    expect(rect.left).toBeCloseTo(1920 - 384 - 30, 6)
    expect(rect.top).toBeCloseTo(1080 - 216 - 30, 6)
    expect(OVERLAY_MARGIN_FRACTION).toBe(20 / 1280)
  })

  it('takes the aspect from the camera, not from the compositor 16:9 box', () => {
    // drawWebcamOverlay always makes a 16:9 box and stretches a 4:3 camera into
    // it. The separate-tracks part is the camera's real frame and ARTIST draws
    // it un-stretched, so a 4:3 part is 4:3 on the timeline. Its *width* is
    // still the compositor's — size x frame width — so it is the size the user
    // chose while recording.
    const project = { width: 1920, height: 1080 }
    const transform = overlayPlacementToTransform(placement('bottom-right', 0.25), project, {
      width: 640,
      height: 480,
    })

    const rect = drawnRect(transform, project, { width: 640, height: 480 })
    expect(rect.width).toBeCloseTo(480, 6)
    expect(rect.height).toBeCloseTo(360, 6)
    expect(transform.scaleX).toBeCloseTo(0.75, 6)
    expect(transform.scaleY).toBeCloseTo(0.75, 6)
  })

  it('falls back to a 16:9 box at native size when the part has no dimensions', () => {
    // A stored part with no width or height was not written by ESCAPECRAFT.
    // Corner-right at native size beats a clip 0 pixels wide or no clip at all.
    const project = { width: 1920, height: 1080 }
    const transform = overlayPlacementToTransform(placement('top-left'), project, {
      width: 0,
      height: 0,
    })

    expect(transform.scaleX).toBe(DEFAULT_TRANSFORM.scaleX)
    expect(transform.scaleY).toBe(DEFAULT_TRANSFORM.scaleY)
    // The overlay box is still 0.2 x 1920 = 384 wide and 216 high (16:9), so
    // the centre sits one margin plus half a box in from the top-left corner.
    expect(transform.x).toBeCloseTo((30 + 192) / 1920, 10)
    expect(transform.y).toBeCloseTo((30 + 108) / 1080, 10)
  })

  it('measures the corner from the frame it is given, not from the canvas', () => {
    // The screen recording is what the camera sat in a corner *of*, and ARTIST
    // places it at native pixels centred on the canvas (scale 1). So a 1280x720
    // take in a 1920x1080 project is drawn in a 1280x720 rectangle inset
    // (1920-1280)/2 = 320 across and (1080-720)/2 = 180 down — and the overlay
    // belongs in THAT rectangle's bottom-right corner, not the canvas's, or the
    // camera lands over the middle of the picture the user recorded.
    const project = { width: 1920, height: 1080 }
    const frame = { left: 320, top: 180, width: 1280, height: 720 }
    const camera = { width: 1280, height: 720 }

    const transform = overlayPlacementToTransform(placement('bottom-right'), project, camera, frame)

    const rect = drawnRect(transform, project, camera)
    // Every number is the frame's: 1280 x 0.2 = 256 wide, 20px inset (the
    // compositor's own, because the frame is the compositor's own width).
    expect(rect.width).toBeCloseTo(256, 6)
    expect(rect.height).toBeCloseTo(144, 6)
    expect(rect.left).toBeCloseTo(frame.left + frame.width - 20 - 256, 6)
    expect(rect.top).toBeCloseTo(frame.top + frame.height - 20 - 144, 6)
    // x/y stay fractions of the CANVAS, which is how canvasRenderer reads them.
    expect(transform.x).toBeCloseTo(1452 / 1920, 10)
    expect(transform.y).toBeCloseTo(808 / 1080, 10)
    expect(transform.scaleX).toBeCloseTo(0.2, 10)
  })

  it('insets a frame narrower than the compositor cap by the flat 20px it was recorded with', () => {
    // The compositor caps its canvas *above* 1280 and never scales a narrower
    // share up, so a 640-wide share is previewed at 640 with a flat 20px
    // padding — `overlayPaddingFor` (apps/craft/src/core/overlayGeometry.ts) is
    // 20 x 640 / min(640, 1280) = 20, and the composited MP4 draws it there
    // too. Reading the inset as 20/1280 of the frame put the camera 10px from
    // the edge instead: half as far as both of the things the user saw.
    const project = { width: 640, height: 360 }
    const camera = { width: 640, height: 360 }

    const transform = overlayPlacementToTransform(placement('bottom-right'), project, camera)

    const rect = drawnRect(transform, project, camera)
    expect(rect.width).toBeCloseTo(128, 6)
    expect(rect.height).toBeCloseTo(72, 6)
    expect(rect.left).toBeCloseTo(640 - 128 - 20, 6)
    expect(rect.top).toBeCloseTo(360 - 72 - 20, 6)
  })

  // The same arithmetic ESCAPECRAFT's `overlayPaddingFor` does, at the widths
  // that separate the two arms of it: below and at the cap the preview was not
  // capped at all, so the inset is the 20px the user saw; above it the padding
  // is that same fraction of a wider frame.
  it.each([
    // A frame with no width has no corners. Unreachable here — the frame
    // defaults to the project resolution and `placeTakeOnTimeline` only passes
    // one whose width is positive — but answered the way CRAFT answers it
    // rather than with NaN.
    [0, 20],
    [640, 20],
    [1280, 20],
    [1920, 30],
    [3840, 60],
  ])('insets a %ipx-wide frame by %ipx, exactly as the compositor did', (frameWidth, expected) => {
    expect(overlayMarginFor(frameWidth)).toBe(expected)
  })

  it('leaves rotation, opacity and the aspect lock at their defaults', () => {
    const transform = overlayPlacementToTransform(
      placement('bottom-right'),
      COMPOSITOR_FRAME,
      SIXTEEN_BY_NINE_CAMERA
    )

    // The shape is ignored by the transform; the mask reads it (ESCSUITE-65).
    // A circle placement still produces an ordinary rectangular *transform*, so
    // nothing here says anything about masking — `maskForPlacement` below is
    // where the shape is answered.
    expect(transform.rotation).toBe(DEFAULT_TRANSFORM.rotation)
    expect(transform.opacity).toBe(DEFAULT_TRANSFORM.opacity)
    expect(transform.scaleLocked).toBe(DEFAULT_TRANSFORM.scaleLocked)
  })
})

// What shape the handed-over webcam clip arrives in (ESCSUITE-65, decisions 1,
// 2 and 6).
//
// The numbers are ESCAPECRAFT's, from `drawOverlay`
// (apps/craft/src/core/overlayGeometry.ts): an inscribed circle at
// min(webcamWidth, webcamHeight) / 2, a rounded rectangle at a flat 8 px, and a
// border of `rgba(255, 255, 255, 0.8)` at 3 px — all of them pixels of a canvas
// capped at 1280 wide. ARTIST stores fractions, so every case below converts
// back through `maskPathFor` and compares with those literals.
describe('maskForPlacement', () => {
  it('maps a circle placement to a circle mask', () => {
    // Decision 1: `maskPathFor` inscribes the circle in the drawn box, which is
    // exactly what ESCAPECRAFT drew, so the mask needs no radius of its own.
    expect(maskForPlacement(placement('bottom-right'), COMPOSITOR_FRAME, SIXTEEN_BY_NINE_CAMERA))
      .toEqual({ kind: 'circle' })
  })

  it('reproduces craft 8px corner at the compositor cap', () => {
    const placement: OverlayPlacement = { position: 'bottom-right', size: 0.2, shape: 'rectangle' }

    const mask = maskForPlacement(placement, COMPOSITOR_FRAME, SIXTEEN_BY_NINE_CAMERA)

    expect(mask.kind).toBe('rounded')
    // The drawn box at 1280 x 0.2 is 256 x 144, and the stored fraction has to
    // put 8 canvas pixels on its corners — `ctx.roundRect(x, y, w, h, 8)`,
    // overlayGeometry.ts:193.
    expect(maskPathFor('rounded', mask.radius, 0, 0, 256, 144)).toMatchObject({ radius: 8 })
    expect(OVERLAY_CORNER_RADIUS_FRACTION).toBe(8 / 1280)
  })

  it('scales the corner with the frame rather than freezing it at 8 pixels', () => {
    const placement: OverlayPlacement = { position: 'bottom-right', size: 0.2, shape: 'rectangle' }
    const project = { width: 1920, height: 1080 }

    const mask = maskForPlacement(placement, project, SIXTEEN_BY_NINE_CAMERA)

    // 1920 x 8/1280 = 12 px on a 384 x 216 box. The fraction is the same one as
    // at 1280 — both the radius and the box scale with the frame — which is the
    // whole reason it is stored as a fraction: ARTIST has a resolution-change
    // dialog, and a pixel count would silently change the rounding under a clip.
    expect(maskPathFor('rounded', mask.radius, 0, 0, 384, 216)).toMatchObject({ radius: 12 })
    expect(mask.radius).toBeCloseTo(
      maskForPlacement(placement, COMPOSITOR_FRAME, SIXTEEN_BY_NINE_CAMERA).radius!,
      12
    )
  })

  it('measures the corner against the clip shorter side, camera aspect and all', () => {
    const placement: OverlayPlacement = { position: 'bottom-right', size: 0.25, shape: 'rectangle' }
    const project = { width: 1920, height: 1080 }

    const mask = maskForPlacement(placement, project, { width: 640, height: 480 })

    // A 4:3 camera at size 0.25 of a 1920 frame is drawn 480 x 360, not the
    // compositor's 480 x 270: ARTIST draws the part un-stretched. The shorter
    // side is 360, and the radius still has to come out at 1920 x 8/1280 = 12.
    expect(maskPathFor('rounded', mask.radius, 0, 0, 480, 360)).toMatchObject({ radius: 12 })
  })

  it('falls back to the compositor 16:9 box for a part with no dimensions', () => {
    const placement: OverlayPlacement = { position: 'top-left', size: 0.2, shape: 'rectangle' }

    const mask = maskForPlacement(placement, COMPOSITOR_FRAME, { width: 0, height: 0 })

    // Nothing ESCAPECRAFT writes, but IndexedDB is not type-checked. The box
    // falls back to 16:9 — 256 x 144 — the same fallback the transform makes,
    // rather than dividing by zero into a NaN radius.
    expect(Number.isFinite(mask.radius)).toBe(true)
    expect(maskPathFor('rounded', mask.radius, 0, 0, 256, 144)).toMatchObject({ radius: 8 })
  })
})

// The border's weight travels the same road the *inset* does, not the road the
// corner radius does.
//
// The radius comes out frame-independent because its numerator and the box it
// divides by both scale with the frame, so the `frameWidth` cancels. Nothing
// cancels for the border: ESCAPECRAFT's 3 px is 3 px of its *capture* canvas,
// which it caps only **above** `COMPOSITOR_MAX_WIDTH` — exactly the two arms
// `overlayPaddingFor` has for the padding (`3 x frameWidth / min(frameWidth,
// 1280)`) — while `clip.stroke.width` is read as a fraction of the **project**
// width. The two widths are the same number only by coincidence, so both have
// to be asked for.
describe('strokeForPlacement', () => {
  it('is craft white 3px border at the compositor cap', () => {
    // A 1280-wide capture in a 1280-wide project: CRAFT drew a flat 3 px, and
    // ARTIST draws that picture at native size, so the border is 3 px of a
    // 1280-wide canvas. The one case where the stored fraction and the named
    // constant are the same number.
    expect(strokeForPlacement(COMPOSITOR_FRAME, COMPOSITOR_FRAME)).toEqual({
      color: 'rgba(255, 255, 255, 0.8)',
      width: 3 / 1280,
    })
    expect(OVERLAY_STROKE_COLOR).toBe('rgba(255, 255, 255, 0.8)')
    expect(OVERLAY_STROKE_WIDTH_FRACTION).toBe(3 / 1280)
  })

  it('measures the border in craft pixels and stores it against the project', () => {
    // The same 1280-wide capture, now in a 1080p project. CRAFT still drew a
    // flat 3 px and ARTIST still draws the capture at native size, so the border
    // is still 3 px — but 3 px of a 1920-wide canvas is 3/1920, not 3/1280.
    // Storing the flat 3/1280 here would have drawn a 4.5 px border on a
    // recording whose border was 3 px.
    expect(strokeForPlacement(COMPOSITOR_FRAME, { width: 1920, height: 1080 }).width).toBe(
      3 / 1920
    )
  })

  it('scales the border above the cap, exactly as craft scales its padding', () => {
    // A 2560-wide capture is previewed at the 1280 cap, so CRAFT's 3 px is
    // 3/1280 of what the user saw — 6 px once the capture is drawn at its own
    // 2560 pixels. In a 1080p project that is 6/1920.
    expect(
      strokeForPlacement({ width: 2560, height: 1440 }, { width: 1920, height: 1080 }).width
    ).toBe(6 / 1920)
    // And the case the handoff actually hits most often — a 1920-wide capture in
    // a 1920-wide project — is 4.5 px, which *is* 3/1280 of the frame. That the
    // two coincide here is why the flat fraction looked right for so long.
    expect(
      strokeForPlacement({ width: 1920, height: 1080 }, { width: 1920, height: 1080 }).width
    ).toBe(3 / 1280)
    expect(3 / 1280).toBeCloseTo(4.5 / 1920, 15)
  })

  it('keeps the flat 3px below the cap, which is what craft drew there', () => {
    // The compositor never scales a narrower share *up*, so a 640-wide capture
    // was previewed at 640 with a flat 3 px border — the same arm of
    // `overlayPaddingFor` that keeps the inset at a flat 20 px. 3 px of the
    // 1280-wide project it is drawn into is 3/1280.
    expect(strokeForPlacement({ width: 640, height: 360 }, COMPOSITOR_FRAME).width).toBe(3 / 1280)
  })

  it('depends on the two widths and nothing else', () => {
    // It takes no placement, deliberately: `drawOverlay` sets the same
    // strokeStyle and the same lineWidth in both of its branches
    // (overlayGeometry.ts:185-186 and 204-205), whatever corner the camera is in
    // and whatever shape it is. So this exists to name the two literals exactly
    // once on this side of the handoff and to read as a mapping beside the other
    // two in `clipSlice.ts` — and its two arguments are the two things the
    // border genuinely does depend on, neither of which is the placement.
    expect(strokeForPlacement(COMPOSITOR_FRAME, COMPOSITOR_FRAME)).toEqual(
      strokeForPlacement(COMPOSITOR_FRAME, COMPOSITOR_FRAME)
    )
    expect(strokeForPlacement.length).toBe(2)
    // Neither height is read: the border is a width against a width.
    expect(strokeForPlacement({ width: 1280, height: 720 }, { width: 1920, height: 1080 })).toEqual(
      strokeForPlacement({ width: 1280, height: 9999 }, { width: 1920, height: 1 })
    )
  })
})
