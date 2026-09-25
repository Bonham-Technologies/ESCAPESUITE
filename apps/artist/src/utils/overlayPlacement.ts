// Where a handed-over webcam part lands on the timeline (ESCSUITE-14,
// decision 8).
//
// ESCAPECRAFT records the camera into a corner of the frame; a separate-tracks
// take stores that corner and that size on the take's primary part
// (`SourceVideo.overlayPlacement`) because the picture no longer carries it.
// This is the one place that turns it back into a clip transform, so the import
// looks like what the user saw while recording — and stays editable, which is
// the whole point of the separate track.
//
// Pure, and deliberately not in the store: the arithmetic is the half worth
// testing on its own, against the live compositor's numbers.
import { DEFAULT_TRANSFORM, type ClipTransform, type OverlayPlacement } from '../store/types';

/**
 * The compositor's corner inset, as a fraction of the frame's width.
 *
 * `Compositor` pads by a flat 20 px on a canvas capped at 1280 px wide
 * (`apps/craft/src/core/compositor.ts`), so what the user saw is 20/1280 of the
 * frame. Carrying the *pixel* count across would put the overlay four times
 * closer to the edge on a 4K project than it looked while recording.
 */
export const OVERLAY_MARGIN_FRACTION = 20 / 1280;

/**
 * The aspect used when a part's stored dimensions are unusable — the
 * compositor's own box, so an unknown camera still lands in the right corner at
 * the right width.
 */
const FALLBACK_OVERLAY_ASPECT = 16 / 9;

/** A width and a height in pixels: a project's resolution, or a part's frame. */
export interface PixelSize {
  width: number;
  height: number;
}

/**
 * A rectangle in canvas pixels: the picture the overlay sat in a corner of.
 *
 * Not the canvas. ARTIST imports the take's screen recording at **native
 * pixels centred on the canvas** (scale 1 — `core/canvasRenderer.ts`), so the
 * picture the user recorded is only the whole canvas when the two happen to
 * match. Measuring the corner from the canvas instead would put the camera over
 * the middle of that picture on every take whose capture is not the project's
 * own size.
 */
export interface PixelFrame extends PixelSize {
  left: number;
  top: number;
}

/**
 * The transform a webcam clip is imported with.
 *
 * The overlay's **width** is the compositor's exactly (`size` x the frame's
 * width), so the clip is the size the user chose. Its **aspect** is the part's
 * own: `drawWebcamOverlay` builds a 16:9 box whatever the camera is and
 * stretches a 4:3 picture into it, and reproducing that here would be
 * reproducing a bug — the separate-tracks part is the camera's real frame.
 *
 * `x`/`y` are the clip's **centre** as a fraction of the canvas and `scaleX` is
 * the drawn width over the part's native width, because that is how
 * `core/canvasRenderer.ts` reads them: scale 1 means native pixels in ARTIST.
 *
 * `frame` is the rectangle the overlay sat in a corner **of** — the take's
 * screen recording as it is drawn, which is what the camera was actually
 * positioned against. It defaults to the whole canvas, which is what the frame
 * *is* whenever the capture and the project are the same size. Both the inset
 * and the overlay's width are fractions of `frame.width`, and the corners are
 * the frame's corners; `x`/`y` still come back as fractions of the canvas,
 * because that is the only thing a transform can be expressed in.
 *
 * `placement.shape` is read and **ignored** — a mask on every clip is
 * ESCSUITE-65, and when it exists the circle maps onto it here.
 */
export function overlayPlacementToTransform(
  placement: OverlayPlacement,
  projectResolution: PixelSize,
  partSize: PixelSize,
  frame: PixelFrame = {
    left: 0,
    top: 0,
    width: projectResolution.width,
    height: projectResolution.height,
  }
): ClipTransform {
  const overlayWidth = frame.width * placement.size;
  const margin = frame.width * OVERLAY_MARGIN_FRACTION;

  // A part with no dimensions was not written by ESCAPECRAFT. It still belongs
  // in its corner: the box falls back to the compositor's 16:9 and the clip to
  // its native size, which beats a clip zero pixels wide.
  const hasSize = partSize.width > 0 && partSize.height > 0;
  const aspect = hasSize ? partSize.width / partSize.height : FALLBACK_OVERLAY_ASPECT;
  const scale = hasSize ? overlayWidth / partSize.width : DEFAULT_TRANSFORM.scaleX;
  const overlayHeight = overlayWidth / aspect;

  const isLeft = placement.position === 'top-left' || placement.position === 'bottom-left';
  const isTop = placement.position === 'top-left' || placement.position === 'top-right';

  const centreX = isLeft
    ? frame.left + margin + overlayWidth / 2
    : frame.left + frame.width - margin - overlayWidth / 2;
  const centreY = isTop
    ? frame.top + margin + overlayHeight / 2
    : frame.top + frame.height - margin - overlayHeight / 2;

  return {
    ...DEFAULT_TRANSFORM,
    x: centreX / projectResolution.width,
    y: centreY / projectResolution.height,
    scaleX: scale,
    scaleY: scale,
  };
}
