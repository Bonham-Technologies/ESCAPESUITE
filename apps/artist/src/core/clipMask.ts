// A media clip's mask and its stroke: the geometry, and the only two functions
// that issue either to a canvas context (ESCSUITE-65).
//
// It lives on its own because two near-duplicate functions draw every media
// clip in this editor — `drawClipToCanvas` and `drawImageToCanvasWithModifiers`
// in `core/canvasRenderer.ts` — and a mask added to one and not the other would
// give videos a mask and images none. Every pipeline funnels through those two
// (the preview, both exports, both transition paths and the headless renderer),
// so the mask written twice there is the mask drawn everywhere, and the maths
// written once here is the maths tested once here.
//
// Pure: it reads its arguments and calls the context. No clip, no store, no
// element lookup, and no allocation in the hot path beyond the small path object
// — numbers are passed to the context rather than built into a `Path2D`.
import type { ClipMask, ClipMaskKind, ClipStroke } from '../store/types';

/**
 * A mask outline for a drawn box, in canvas pixels.
 *
 * `'rect'` is how this says **there is nothing to mask**: a rectangle the size
 * of the drawn box is the drawn box. It is also exactly the outline a stroke on
 * an *unmasked* clip needs (decision 6), so one function answers both questions
 * and there is no second "is there a mask" rule to keep in step.
 */
export type MaskPath =
  | { shape: 'rect'; x: number; y: number; width: number; height: number }
  | { shape: 'circle'; centreX: number; centreY: number; radius: number }
  | { shape: 'rounded'; x: number; y: number; width: number; height: number; radius: number };

/**
 * The drawn box itself — this module's way of saying **there is nothing to
 * mask**, built only where it is actually returned.
 *
 * A function rather than one `const` at the top of `maskPathFor`, because that
 * const allocated a `MaskPath` every circle and every rounded mask threw away,
 * and Task 3 calls `maskPathFor` twice per clip per frame (once for the mask,
 * once for the stroke).
 */
function rectPath(x: number, y: number, width: number, height: number): MaskPath {
  return { shape: 'rect', x, y, width, height };
}

/**
 * The outline a mask of this kind describes inside the box `(x, y, width,
 * height)` — the rectangle the clip's picture is about to be drawn into.
 *
 * The circle is **inscribed**: `min(width, height) / 2`, centred on the box.
 * That is the circle a user saw in ESCAPECRAFT (`drawOverlay`,
 * `apps/craft/src/core/overlayGeometry.ts:143-145`) and what decision 1 fixes;
 * a box-filling ellipse would be a different feature and can be a `kind` of its
 * own if it is ever wanted.
 *
 * The rounded radius arrives as a **fraction of the shorter side** and comes
 * back in canvas pixels, clamped to half the shorter side — past that a real
 * `roundRect` throws `IndexSizeError`, and inside a preview frame that kills the
 * whole frame rather than just the mask.
 */
export function maskPathFor(
  kind: ClipMaskKind,
  radius: number | undefined,
  x: number,
  y: number,
  width: number,
  height: number
): MaskPath {
  // A clip at scale 0 has no outline. A circle of radius 0 would clip the whole
  // frame away, which looks like the renderer breaking rather than like a clip
  // nobody can see.
  if (width <= 0 || height <= 0) return rectPath(x, y, width, height);

  const shorter = Math.min(width, height);

  if (kind === 'circle') {
    return {
      shape: 'circle',
      centreX: x + width / 2,
      centreY: y + height / 2,
      radius: shorter / 2,
    };
  }

  if (kind === 'rounded') {
    const corner = Math.min((radius ?? 0) * shorter, shorter / 2);
    // A rounded rectangle with square corners is a rectangle: nothing to mask,
    // and nothing for a stroke to trace but the box itself.
    return corner > 0
      ? { shape: 'rounded', x, y, width, height, radius: corner }
      : rectPath(x, y, width, height);
  }

  return rectPath(x, y, width, height);
}

/**
 * The rounded rectangle, from `arcTo` when the browser has no `roundRect`.
 *
 * Safari gained `roundRect` in 16.4 and the e2e suite runs WebKit
 * (`pnpm test:e2e:browsers`). ESCAPECRAFT calls it unconditionally, but only in
 * a Chromium-favoured recording path; here a throw would take out the whole
 * preview frame. Clockwise from the top edge, each corner turning into the
 * next; the fourth `arcTo` lands back where `moveTo` started, so no closing
 * `lineTo` is needed.
 *
 * Five calls rather than one, which is why the per-frame ceilings in
 * `drawFrame.perf.test.ts` and `exportMP4.perf.test.ts` are measured with
 * `roundRect` present — as all three engines the e2e suite runs have it.
 */
function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, width, height, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
}

/**
 * Trace `path` into the current path. Two calls for a circle or a rectangle:
 * `beginPath` and the shape.
 *
 * `ellipse` rather than `arc` for the circle: it takes the same numbers, and a
 * future `'ellipse'` kind would need no second code path.
 */
function traceMaskPath(ctx: CanvasRenderingContext2D, path: MaskPath): void {
  ctx.beginPath();
  if (path.shape === 'circle') {
    ctx.ellipse(path.centreX, path.centreY, path.radius, path.radius, 0, 0, Math.PI * 2);
  } else if (path.shape === 'rounded') {
    traceRoundedRect(ctx, path.x, path.y, path.width, path.height, path.radius);
  } else {
    ctx.rect(path.x, path.y, path.width, path.height);
  }
}

/**
 * The stroke a clip really draws, or `undefined`.
 *
 * One definition of "visible", read by `applyClipStroke` and by the two draw
 * functions — which need the answer *before* the image, because the inner
 * `save()`/`restore()` pair that lets the stroke escape the clip region is the
 * only extra state operation this feature adds and it exists for the stroke
 * alone. A masked, unstroked clip pays no save and no restore.
 */
export function visibleClipStroke(stroke: ClipStroke | undefined): ClipStroke | undefined {
  return stroke !== undefined && stroke.width > 0 ? stroke : undefined;
}

/**
 * Clip the context to `mask` over the box the clip's picture is about to fill.
 *
 * Three recorded calls when there is a mask — `beginPath`, the shape, `clip` —
 * and **none at all** when there is not, which is what keeps a clip with no
 * mask recording exactly what it recorded before this feature existed.
 *
 * No `closePath()`: `clip()` closes the path implicitly, so it would be a fourth
 * call per masked clip per frame for nothing.
 *
 * Called *inside* the two draw functions' existing `save()`/`restore()` pair and
 * *after* their rotation block, so the mask rotates with the clip and needs no
 * save of its own. A wipe transition's own `clip()` is still in effect, and the
 * two clip regions intersect, which is the correct composition.
 */
export function applyClipMask(
  ctx: CanvasRenderingContext2D,
  mask: ClipMask | undefined,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const path = maskPathFor(mask?.kind ?? 'none', mask?.radius, x, y, width, height);
  // The box clipped to its own rectangle is the box: nothing to do, and nothing
  // recorded.
  if (path.shape === 'rect') return;
  traceMaskPath(ctx, path);
  ctx.clip();
}

/**
 * Stroke the mask's own outline — or the picture's rectangle when there is no
 * mask (decision 6).
 *
 * Called **after** the image and after the clip region has been dropped, so no
 * half of the line is eaten by the mask. ESCAPECRAFT does the same thing the
 * same way (`overlayGeometry.ts:182-187` restores, re-traces the path and
 * strokes it), which is why a handed-over webcam clip looks like the recording.
 *
 * `strokeStyle` is the stored colour as given, including the `rgba()` the
 * handoff carries. The line width is `stroke.width x frameWidth`: the export
 * canvas *is* the project resolution and the preview canvas scales uniformly
 * through the CTM, so one number serves both. (Unlike `ctx.filter`, whose
 * lengths the CTM does not reach — see `MediaDrawOptions.filterScale`.)
 */
export function applyClipStroke(
  ctx: CanvasRenderingContext2D,
  stroke: ClipStroke | undefined,
  mask: ClipMask | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  frameWidth: number
): void {
  const visible = visibleClipStroke(stroke);
  if (!visible) return;

  // A clip the user cannot see gets no outline either: a zero-area box would
  // otherwise be stroked into a visible line across nothing.
  if (width <= 0 || height <= 0) return;

  const path = maskPathFor(mask?.kind ?? 'none', mask?.radius, x, y, width, height);
  traceMaskPath(ctx, path);
  ctx.lineWidth = visible.width * frameWidth;
  ctx.strokeStyle = visible.color;
  ctx.stroke();
}
