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
// with `padding` 20 on a canvas capped at 1280 wide. This helper has to put the
// clip in the same place, so every case below reconstructs the drawn rectangle
// from the transform and compares it with those literals. ARTIST cannot import
// craft's compositor (different app), so the numbers are written out here with
// the formula that produced them; slice 4 extracts a shared `drawOverlay` and
// this is the test that will be pointed at it.
import { describe, it, expect } from 'vitest'
import { overlayPlacementToTransform, OVERLAY_MARGIN_FRACTION } from './overlayPlacement'
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

  it('leaves rotation, opacity and the aspect lock at their defaults', () => {
    const transform = overlayPlacementToTransform(
      placement('bottom-right'),
      COMPOSITOR_FRAME,
      SIXTEEN_BY_NINE_CAMERA
    )

    // The shape is ignored (ESCSUITE-65): a circle placement produces an
    // ordinary rectangular clip, so nothing here says anything about masking.
    expect(transform.rotation).toBe(DEFAULT_TRANSFORM.rotation)
    expect(transform.opacity).toBe(DEFAULT_TRANSFORM.opacity)
    expect(transform.scaleLocked).toBe(DEFAULT_TRANSFORM.scaleLocked)
  })
})
