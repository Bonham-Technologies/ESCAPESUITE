// A media clip's mask as a CSS `clip-path`, for the thumbnail the timeline draws
// on the clip (ESCSUITE-65, decision 5).
//
// It exists so the shape the user sees on the timeline is the shape the renderer
// draws in the frame, and so that is true by construction rather than by two
// pieces of arithmetic agreeing: `core/clipMask.ts`'s `maskPathFor` answers what
// shape a mask describes inside a box, and this module only says that answer in
// CSS. The inscribed-circle rule (decision 1), the clamp to half the shorter
// side (decision 2) and "a rounded rectangle with square corners is a
// rectangle" therefore have exactly one implementation each.
//
// DOM and CSS, never canvas. The timeline drew no picture at all before this,
// and a canvas per clip would put a second rasteriser on the gesture path that
// `timelineGestures.perf.test.ts` and the `timeline-interaction` benchmark exist
// to protect.
import { maskPathFor } from '../core/clipMask';
import type { ClipMask } from '../store/types';

/**
 * The thumbnail's aspect ratio — the box a `clip-path` percentage or centre is
 * resolved against, and the width the `<img>` is given for a height.
 *
 * Exported so `TimelineTrack` sizes the element with the same number this module
 * measures against; a second `16 / 9` in the component would be a second box.
 * 16:9 is the thumbnail's own frame, not the clip's drawn box — a masked clip
 * whose media is 4:3 is still *drawn* masked to its own box by
 * `core/canvasRenderer.ts`, and the thumbnail is an indication of shape rather
 * than a preview of composition. The source thumbnail itself is cropped into
 * this box by `object-fit: cover`.
 */
export const CLIP_THUMB_ASPECT = 16 / 9;

/**
 * A pixel length as CSS, rounded to a hundredth of a pixel.
 *
 * `0.35 * 52` is `18.200000000000003` in IEEE 754 and an inline style is a
 * string: without this the DOM would carry that, and so would every test that
 * reads it. A hundredth of a pixel is below anything a screen or a user can
 * tell apart.
 */
function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

/**
 * The `clip-path` for a mask on a thumbnail `thumbHeightPx` tall, or
 * `undefined` when there is nothing to clip.
 *
 * The thumb is 16:9, so its **shorter side is its height** — which is why one
 * number is enough, and why the stored radius (a fraction of the clip's shorter
 * side, decision 2) resolves here against exactly what it resolves against in
 * the frame.
 *
 * The circle is **hugged to the thumbnail's left edge** — `at <h/2>px 50%`, and
 * not centred in the box. A clip is as wide as its duration, and `.clip` is
 * `overflow: hidden`, so a short clip shows only the thumbnail's first few
 * pixels: 0.2s at the default 50px/s is a 10px clip. Centred in the 91px box a
 * standard row gives, the circle would span x 20-71 and that clip would show an
 * empty rectangle where an unmasked clip shows its picture. Against the left
 * edge the circle's own leftmost pixel is x 0, so the shape is visible from the
 * first pixel of any clip. It is the *centre* that moves, never the radius, so this is a placement
 * choice and not a second piece of geometry — `inset(0 round r)` already starts
 * at the left edge and needs no equivalent.
 *
 * `undefined` rather than `'none'` for the no-mask case: React omits an
 * undefined style property, so an unmasked clip's thumbnail carries no
 * `clip-path` at all and is byte-identical in the DOM to one from before this
 * feature existed.
 *
 * The **stroke is deliberately not drawn here** (v1): the thumbnail shows the
 * shape, and the border stays in the frame. This function takes no stroke, and
 * nothing else writes to the element's style.
 */
export function maskClipPathFor(
  mask: ClipMask | undefined,
  thumbHeightPx: number
): string | undefined {
  const path = maskPathFor(
    mask?.kind ?? 'none',
    mask?.radius,
    0,
    0,
    thumbHeightPx * CLIP_THUMB_ASPECT,
    thumbHeightPx
  );

  if (path.shape === 'circle') {
    // Centre and radius are the same length: a circle whose leftmost pixel is
    // x 0 is centred exactly its own radius from the left edge.
    const r = px(path.radius);
    return `circle(${r} at ${r} 50%)`;
  }
  if (path.shape === 'rounded') return `inset(0 round ${px(path.radius)})`;
  // `'rect'` is `maskPathFor`'s way of saying there is nothing to mask — a
  // rectangle the size of the box is the box. It covers `kind: 'none'`, a
  // rounded mask with a zero or absent radius, and a box with no area, so this
  // one line is the whole "no mask" rule and there is no second copy of it.
  return undefined;
}
