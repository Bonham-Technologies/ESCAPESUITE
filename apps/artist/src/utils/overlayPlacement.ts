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
import {
  DEFAULT_TRANSFORM,
  type ClipMask,
  type ClipStroke,
  type ClipTransform,
  type OverlayPlacement,
} from '../store/types';

/**
 * The widest the compositor lets its preview canvas be, in pixels.
 *
 * ESCAPECRAFT's `COMPOSITOR_MAX_WIDTH` (`apps/craft/src/core/overlayGeometry.ts`),
 * written out here because ARTIST cannot import craft's modules.
 */
export const COMPOSITOR_MAX_WIDTH = 1280;

/** The inset a take is recorded with: craft's `DEFAULT_OVERLAY_PADDING`. */
export const DEFAULT_OVERLAY_PADDING = 20;

/**
 * The compositor's corner inset as a fraction of the frame's width, for a frame
 * at least `COMPOSITOR_MAX_WIDTH` wide.
 *
 * `Compositor` pads by a flat `DEFAULT_OVERLAY_PADDING` on a canvas it caps
 * **above** `COMPOSITOR_MAX_WIDTH` (`apps/craft/src/core/compositor.ts`), so on
 * a capped preview what the user saw is 20/1280 of the frame. Carrying the
 * *pixel* count across would put the overlay four times closer to the edge on a
 * 4K project than it looked while recording. Below the cap the fraction is the
 * wrong way to read it — see `overlayMarginFor`.
 */
export const OVERLAY_MARGIN_FRACTION = DEFAULT_OVERLAY_PADDING / COMPOSITOR_MAX_WIDTH;

/**
 * ESCAPECRAFT's rounded-rectangle corner, as a fraction of the frame's width.
 *
 * `drawOverlay` rounds the camera's corners by a flat `OVERLAY_CORNER_RADIUS`
 * (8 px) on a canvas capped at `COMPOSITOR_MAX_WIDTH`
 * (`apps/craft/src/core/overlayGeometry.ts`), so what the user saw is 8/1280 of
 * the frame. Stored as a fraction for the same reason the inset is one: ARTIST
 * has a resolution-change dialog, and a pixel count would silently restyle the
 * corners of a clip the user never touched.
 */
export const OVERLAY_CORNER_RADIUS_FRACTION = 8 / COMPOSITOR_MAX_WIDTH;

/**
 * ESCAPECRAFT's border weight, as a fraction of the frame's width.
 *
 * `OVERLAY_BORDER_WIDTH` (3 px) on the same capped canvas. A fraction for the
 * same reason again — and because `clip.stroke.width` is defined as a fraction
 * of the frame, so this is the unit the field is already in.
 */
export const OVERLAY_STROKE_WIDTH_FRACTION = 3 / COMPOSITOR_MAX_WIDTH;

/**
 * ESCAPECRAFT's border colour, spelled exactly as it draws it —
 * `OVERLAY_BORDER_COLOR`. Carried as the CSS string rather than a hex triple
 * because the alpha is part of the look, and `clip.stroke.color` stores whatever
 * it is given.
 */
export const OVERLAY_STROKE_COLOR = 'rgba(255, 255, 255, 0.8)';

/**
 * The inset that reproduces the recorded 20 px inset in a frame this wide.
 *
 * The compositor caps its canvas only **above** `COMPOSITOR_MAX_WIDTH`: it never
 * scales a narrower share up, so a 640-wide share was previewed at 640 with a
 * flat 20 px, and the composited MP4 draws it there too
 * (`overlayPaddingFor` in `apps/craft/src/core/overlayGeometry.ts`, which this
 * mirrors — `20 x frameWidth / min(frameWidth, 1280)`, written the other way
 * round). Reading the inset as a fraction at every width was the bug: it put
 * the camera 10 px from the edge on a 640-wide take, half as far as both the
 * preview and the downloaded file put it.
 *
 * A frame with no width has no corners, and answering the padding keeps this
 * total rather than returning NaN — the same answer craft's guard gives. It is
 * unreachable from here: the frame defaults to the project resolution and
 * `placeTakeOnTimeline` only passes one whose width is positive.
 */
export function overlayMarginFor(frameWidth: number): number {
  return frameWidth <= COMPOSITOR_MAX_WIDTH
    ? DEFAULT_OVERLAY_PADDING
    : frameWidth * OVERLAY_MARGIN_FRACTION;
}

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

/** The overlay's drawn size in frame pixels, and the scale that produces it. */
interface OverlayBox {
  width: number;
  height: number;
  scale: number;
}

/**
 * The rectangle the camera is drawn into, and the scale that gets it there.
 *
 * Extracted so `overlayPlacementToTransform` and `maskForPlacement` measure the
 * same box: the mask's radius is a fraction of the clip's shorter **drawn** side,
 * so a second copy of this arithmetic would be a second place for the two to
 * disagree about what the clip's shorter side is.
 *
 * The **width** is the compositor's exactly (`size` x the frame's width) and the
 * **aspect** is the part's own, because `drawWebcamOverlay` builds a 16:9 box
 * whatever the camera is and stretches a 4:3 picture into it — a bug to leave
 * behind rather than reproduce.
 */
function overlayBoxFor(
  placement: OverlayPlacement,
  frameWidth: number,
  partSize: PixelSize
): OverlayBox {
  const width = frameWidth * placement.size;
  // A part with no dimensions was not written by ESCAPECRAFT. It still belongs
  // in its corner: the box falls back to the compositor's 16:9 and the clip to
  // its native size, which beats a clip zero pixels wide.
  const hasSize = partSize.width > 0 && partSize.height > 0;
  const aspect = hasSize ? partSize.width / partSize.height : FALLBACK_OVERLAY_ASPECT;
  return {
    width,
    height: width / aspect,
    scale: hasSize ? width / partSize.width : DEFAULT_TRANSFORM.scaleX,
  };
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
 * `placement.shape` is no longer ignored: `maskForPlacement` below turns it into
 * the clip's mask (ESCSUITE-65), named against `OVERLAY_CORNER_RADIUS_FRACTION`,
 * and `strokeForPlacement` carries the border across as
 * `OVERLAY_STROKE_COLOR` at `OVERLAY_STROKE_WIDTH_FRACTION`. This function
 * still answers geometry alone — the two are separate properties on the clip,
 * and `store/clipSlice.ts` maps all three side by side.
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
  const box = overlayBoxFor(placement, frame.width, partSize);
  const overlayWidth = box.width;
  const overlayHeight = box.height;
  const margin = overlayMarginFor(frame.width);

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
    scaleX: box.scale,
    scaleY: box.scale,
  };
}

/**
 * The mask a handed-over webcam clip arrives with (ESCSUITE-65, decisions 1 and
 * 2).
 *
 * A `'circle'` placement needs no radius at all: `core/clipMask.ts` inscribes
 * the circle in the drawn box at `min(w, h) / 2`, which is precisely the circle
 * ESCAPECRAFT drew (`overlayGeometry.ts:143-145`).
 *
 * A `'rectangle'` placement becomes a `'rounded'` mask whose radius is stored as
 * a **fraction of the clip's shorter drawn side**, because that is the unit
 * `ClipMask.radius` is in. The conversion is
 * `(frame.width x OVERLAY_CORNER_RADIUS_FRACTION) / min(box.width, box.height)`,
 * which reproduces ESCAPECRAFT's 8 px at the compositor's 1280 cap and 12 px on
 * a 1080p project — and comes out to the *same fraction* at both, since the
 * radius and the box scale with the frame together. That is the property a
 * stored pixel count would have lost the moment a user opened the
 * resolution-change dialog.
 *
 * The three arguments are `overlayPlacementToTransform`'s, in its order, and for
 * the same reasons: `frame` is the rectangle the camera sat in a corner **of**
 * (the take's screen recording as ARTIST draws it, not the canvas), and
 * `partSize` is the camera's own pixels, because ARTIST draws it un-stretched.
 */
export function maskForPlacement(
  placement: OverlayPlacement,
  frame: PixelSize,
  partSize: PixelSize
): ClipMask {
  if (placement.shape === 'circle') return { kind: 'circle' };

  const box = overlayBoxFor(placement, frame.width, partSize);
  const radiusInFramePixels = frame.width * OVERLAY_CORNER_RADIUS_FRACTION;
  return {
    kind: 'rounded',
    radius: radiusInFramePixels / Math.min(box.width, box.height),
  };
}

/**
 * The border a handed-over webcam clip arrives with (ESCSUITE-65, decision 6).
 *
 * Takes nothing, deliberately: `drawOverlay` sets the same `strokeStyle` and the
 * same `lineWidth` in both of its branches, whatever corner the camera is in and
 * whatever shape it is. This exists so the mapping in `store/clipSlice.ts` reads
 * as three properties side by side rather than two calls and an inline object,
 * and so the two literals are named exactly once on this side of the handoff —
 * they are named on the other side too (`OVERLAY_BORDER_COLOR` and
 * `OVERLAY_BORDER_WIDTH`), so the two cannot drift silently.
 */
export function strokeForPlacement(): ClipStroke {
  return { color: OVERLAY_STROKE_COLOR, width: OVERLAY_STROKE_WIDTH_FRACTION };
}
