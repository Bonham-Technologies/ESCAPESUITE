// The webcam overlay's geometry: where the camera sits inside a frame, and the
// one function that draws it there.
//
// It lives on its own because two things draw the same overlay and must not
// drift apart. `Compositor` draws it live, at the take's target frame rate,
// into the canvas the user watches — and, for a composited PiP take, into the
// canvas MediaRecorder captures. `convertToMP4` draws it again, offline, when it
// re-composites a separate-tracks take into one MP4 (ESCSUITE-14 decision 3):
// the camera is a second *file* there, and this is the geometry that puts it
// back where it was recorded. Two copies of the arc, the centre-crop and the
// clip would be two places for a rounding difference to live, and the
// difference would only ever be visible in a file somebody downloaded.
//
// Pure: it reads its arguments and calls the context. No element lookup, no
// canvas creation, no state, no `this`.
import type { OverlayPlacement } from '@escapesuite/shared/types';
import type { WebcamPosition, WebcamShape } from '../store/types';

/**
 * The widest the compositor lets its canvas be, in pixels.
 *
 * The live preview is capped here (`Compositor`'s constructor), which is why
 * `overlayPaddingFor` needs the number: a padding measured in pixels of the
 * *preview* is a different fraction of a 1920-wide recording.
 */
export const COMPOSITOR_MAX_WIDTH = 1280;

/** The inset a take is recorded with unless a caller asks for another. */
export const DEFAULT_OVERLAY_PADDING = 20;

/**
 * The camera's border, drawn on the mask's own outline after the webcam image.
 *
 * Named because ESCAPEARTIST now reproduces it: a handed-over webcam clip
 * arrives with `clip.stroke` set to this colour at
 * `OVERLAY_STROKE_WIDTH_FRACTION` of the frame width
 * (`apps/artist/src/utils/overlayPlacement.ts`, ESCSUITE-65). Both sides name
 * the same two numbers so a change to the border here cannot silently stop
 * matching what the editor draws.
 *
 * The width, and `OVERLAY_CORNER_RADIUS` below, are pixels of *this* frame,
 * unlike the padding, which `overlayPaddingFor` scales — the border and the
 * corner are the weight and the radius the compositor has always drawn, and this
 * commit changes neither.
 */
export const OVERLAY_BORDER_COLOR = 'rgba(255, 255, 255, 0.8)';
export const OVERLAY_BORDER_WIDTH = 3;

/**
 * The rounded overlay's corner radius, in pixels of this frame.
 *
 * Was a function-local in `drawOverlay`; lifted out unchanged for the same
 * reason as the border — ARTIST stores it as `OVERLAY_CORNER_RADIUS_FRACTION`
 * (8/1280) and the two should be readable side by side.
 */
export const OVERLAY_CORNER_RADIUS = 8;

/**
 * Where the camera goes in a frame, and what shape it is.
 *
 * Field names are the recording config's (`webcamPosition`, `webcamSize`,
 * `webcamShape`) rather than the stored `OverlayPlacement`'s (`position`,
 * `size`, `shape`) for one reason: `Compositor` calls `drawOverlay` on every
 * animation frame for the whole length of a take and passes `this.config`
 * straight through, so the hot loop allocates nothing. `overlayGeometryFor()`
 * is the adapter the converter calls, once per conversion, to come the other
 * way.
 */
export interface OverlayGeometry {
  webcamPosition: WebcamPosition;
  /** Fraction of the frame's width the overlay occupies, 0.1 to 0.4. */
  webcamSize: number;
  webcamShape: WebcamShape;
  /** Inset from the frame's edges, in pixels **of this frame**. */
  padding: number;
}

/**
 * The inset that reproduces the recorded 20 px inset in a frame this wide.
 *
 * `webcamSize` is a fraction of the width, so the overlay's *size* reproduces
 * itself at any resolution for free. The padding does not: it is 20 pixels, and
 * the compositor measured it against a canvas capped at `COMPOSITOR_MAX_WIDTH`.
 * A separate-tracks take records the **raw** screen, so a 1920-wide composite
 * drawn with a flat 20 px would put the camera visibly closer to the edge than
 * the preview the user watched did. Scaling by
 * `frameWidth / min(frameWidth, cap)` is exactly 1 for any frame the preview
 * was not capped for, and 1.5 at 1920.
 *
 * A frame with no width has no corners; the conversion fails on its own 0x0
 * encoder configuration a moment later, and answering the default here keeps
 * this total rather than handing NaN coordinates to a canvas.
 */
export function overlayPaddingFor(frameWidth: number): number {
  if (frameWidth <= 0) return DEFAULT_OVERLAY_PADDING;
  return (DEFAULT_OVERLAY_PADDING * frameWidth) / Math.min(frameWidth, COMPOSITOR_MAX_WIDTH);
}

/**
 * The geometry a take's stored `overlayPlacement` describes, in a frame this
 * wide — what `convertToMP4` builds once, before it starts encoding.
 */
export function overlayGeometryFor(
  placement: OverlayPlacement,
  frameWidth: number
): OverlayGeometry {
  return {
    webcamPosition: placement.position,
    webcamSize: placement.size,
    webcamShape: placement.shape,
    padding: overlayPaddingFor(frameWidth),
  };
}

/**
 * Draw `webcam` into the corner of `frame` that `geometry` names, clipped to
 * its shape and given its border.
 *
 * `frame` is `{ width, height }` rather than a canvas so the caller may pass
 * its canvas element (both do) without this module knowing what a canvas is.
 * `webcam` is an `HTMLVideoElement` because the circular crop needs the
 * source's intrinsic size, which only a media element carries.
 */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  webcam: HTMLVideoElement,
  frame: { readonly width: number; readonly height: number },
  geometry: OverlayGeometry
): void {
  const { width, height } = frame;
  const { webcamPosition, webcamSize, webcamShape, padding } = geometry;

  // Calculate webcam dimensions
  const webcamWidth = width * webcamSize;
  const webcamHeight = (webcamWidth * 9) / 16; // 16:9 aspect ratio

  // Calculate position
  let x: number, y: number;

  switch (webcamPosition) {
    case 'top-left':
      x = padding;
      y = padding;
      break;
    case 'top-right':
      x = width - webcamWidth - padding;
      y = padding;
      break;
    case 'bottom-left':
      x = padding;
      y = height - webcamHeight - padding;
      break;
    case 'bottom-right':
    default:
      x = width - webcamWidth - padding;
      y = height - webcamHeight - padding;
      break;
  }

  // Save context state. Each branch below restores it again once the webcam
  // frame is drawn, so the border is stroked outside the clip path — that
  // restore is the only one, and the pair stays balanced. An extra restore()
  // on the way out is a no-op on a real canvas, but it is a stack operation
  // per frame for nothing and it would silently undo a save() made by any
  // future caller that wrapped this draw.
  ctx.save();

  if (webcamShape === 'circle') {
    // Draw circular webcam overlay
    const radius = Math.min(webcamWidth, webcamHeight) / 2;
    const centerX = x + webcamWidth / 2;
    const centerY = y + webcamHeight / 2;

    // Create circular clip path
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    // Draw webcam video (centered and cropped to circle)
    const videoAspect = webcam.videoWidth / webcam.videoHeight;
    let srcWidth = webcam.videoWidth;
    let srcHeight = webcam.videoHeight;
    let srcX = 0;
    let srcY = 0;

    // Center crop to square for circle
    if (videoAspect > 1) {
      srcWidth = srcHeight;
      srcX = (webcam.videoWidth - srcWidth) / 2;
    } else {
      srcHeight = srcWidth;
      srcY = (webcam.videoHeight - srcHeight) / 2;
    }

    ctx.drawImage(
      webcam,
      srcX,
      srcY,
      srcWidth,
      srcHeight,
      centerX - radius,
      centerY - radius,
      radius * 2,
      radius * 2
    );

    // Draw border
    ctx.restore();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.strokeStyle = OVERLAY_BORDER_COLOR;
    ctx.lineWidth = OVERLAY_BORDER_WIDTH;
    ctx.stroke();
  } else {
    // Draw rectangular webcam overlay
    // Create rounded rectangle clip path
    const borderRadius = OVERLAY_CORNER_RADIUS;
    ctx.beginPath();
    ctx.roundRect(x, y, webcamWidth, webcamHeight, borderRadius);
    ctx.closePath();
    ctx.clip();

    // Draw webcam video
    ctx.drawImage(webcam, x, y, webcamWidth, webcamHeight);

    // Draw border
    ctx.restore();
    ctx.beginPath();
    ctx.roundRect(x, y, webcamWidth, webcamHeight, borderRadius);
    ctx.strokeStyle = OVERLAY_BORDER_COLOR;
    ctx.lineWidth = OVERLAY_BORDER_WIDTH;
    ctx.stroke();
  }
}
