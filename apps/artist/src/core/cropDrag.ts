// The crop GESTURE's arithmetic (ESCSUITE-157): what dragging or nudging one of
// the eight handles on a clip's kept region does to `clip.crop`.
//
// It sits beside `core/clipCrop.ts`, which owns the crop itself — the region a
// crop names, the shape check, the store's clamps and the aspect presets — and
// is deliberately a separate file: that module is read by the renderer on every
// media clip of every frame, and none of this is.
//
// Pure: numbers in, numbers out. No clip, no store, no canvas, no pointer
// event. The hook that drives the gesture half is
// `components/Preview/useCropHandleGesture.ts`.
//
// The last three functions here are NOT gesture-only, despite the file's name
// (ESCSUITE-171): `cropCentreFor`, `cropCompensatesCentre` and `cropWriteFor`
// decide where a crop leaves the picture, and **every** crop write in the app
// goes through them — the eight on-canvas handles through that hook, and the
// inspector's sliders, number fields, aspect presets and Reset through
// `components/ClipEditor/useClipEditorActions.ts`' `handleCropChange`. They stay
// here rather than moving to `clipCrop.ts` for that module's own stated reason:
// it is read by the renderer on every media clip of every frame, and none of
// this is.
import type { AnimatableProperty, ClipAnimation, ClipCrop, ClipTransform } from '../store/types';
import { MAX_CROP_INSET, croppedSourceRect } from './clipCrop';

/** One of the eight handles, by compass point. */
export type CropHandle = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';

/**
 * The eight handles, in the order the DOM renders them — reading order, so a
 * screen reader walking the group goes along the top, down the sides, along the
 * bottom.
 */
export const CROP_HANDLES: readonly CropHandle[] = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];

/**
 * What each handle is called.
 *
 * Eight distinct names, which is a requirement rather than a nicety: a screen
 * reader lists these as eight buttons with no other context, so "Crop top left"
 * and not "Top left", and never two of the same.
 */
export const CROP_HANDLE_LABELS: Record<CropHandle, string> = {
  nw: 'Crop top left',
  n: 'Crop top',
  ne: 'Crop top right',
  w: 'Crop left',
  e: 'Crop right',
  sw: 'Crop bottom left',
  s: 'Crop bottom',
  se: 'Crop bottom right',
};

/**
 * How far one arrow key moves a handle, in SOURCE pixels.
 *
 * A source pixel is the finest crop that means anything — `croppedSourceRect`
 * floors the region at one — and ten is the step a user reaches for when they
 * know where they are going, the same shape as the keyframe graph's fine and
 * coarse nudges.
 */
export const CROP_NUDGE = { fine: 1, coarse: 10 } as const;

/** No crop at all, as the four insets that say so. */
export const NO_CROP_INSETS: ClipCrop = { left: 0, top: 0, right: 0, bottom: 0 };

/** The source frame a crop is a fraction of. */
export interface SourceSize {
  width: number;
  height: number;
}

/** The clip transform a crop gesture starts from. */
export interface CropGestureTransform {
  /** The clip's normalised centre. */
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  /** Degrees, as `ClipTransform.rotation` holds them. */
  rotation: number;
}

/** Which inset(s) a handle owns, per axis. */
const HANDLE_EDGES: Record<CropHandle, { x?: 'left' | 'right'; y?: 'top' | 'bottom' }> = {
  nw: { x: 'left', y: 'top' },
  n: { y: 'top' },
  ne: { x: 'right', y: 'top' },
  w: { x: 'left' },
  e: { x: 'right' },
  sw: { x: 'left', y: 'bottom' },
  s: { y: 'bottom' },
  se: { x: 'right', y: 'bottom' },
};

/**
 * The floor this function divides a scale by.
 *
 * Not the UI's own 0.1 — `useTransformHandles.ts`'s fifteen `Math.max(0.1, …)`
 * sites and `TransformSection.tsx`'s three `min={0.1}` range inputs — which a
 * drag or a number field can never get past. `updateClipTransform` itself
 * applies no floor at all, so a `.veditor`, a host `LOAD_PROJECT` payload or a
 * headless job spec could still carry a `scaleX`/`scaleY` of 0, negative, or
 * `NaN` (ESCSUITE-173; `parseProject` now refuses all three too, but this
 * function is not the validator and does not trust a project that reached it
 * anyway). The value only has to keep the division finite, not match any UI
 * limit.
 */
const MIN_SCALE = 0.001;

/**
 * A displacement on the canvas, in the clip's own unrotated frame and in SOURCE
 * pixels.
 *
 * Two conversions in one: the clip is drawn rotated about its centre, so the
 * displacement is rotated backwards by the same `R(-θ)`
 * `previewGeometry.ts`'s `toLocalPoint` applies to a point; and the drawn size
 * is the source times the clip's scale, so a 2x clip's handle crops half as
 * fast as the pointer moves.
 *
 * `delta` is in PROJECT pixels — the caller divides the pointer's client
 * displacement by the content box' scale first. The scale is floored at
 * {@link MIN_SCALE} before dividing — a corrupt `scaleX`/`scaleY` of 0,
 * negative, or `NaN` all yield a large-but-finite inset rather than
 * `Infinity`/`NaN` (`Math.max(NaN, MIN_SCALE)` is itself `NaN`, so the
 * finiteness is checked explicitly rather than left to `Math.max` alone).
 */
export function sourceDelta(
  delta: { x: number; y: number },
  transform: Pick<CropGestureTransform, 'scaleX' | 'scaleY' | 'rotation'>
): { x: number; y: number } {
  const rad = (-transform.rotation * Math.PI) / 180;
  const floored = (scale: number): number =>
    Number.isFinite(scale) && scale > 0 ? scale : MIN_SCALE;
  const scaleX = floored(transform.scaleX);
  const scaleY = floored(transform.scaleY);
  return {
    x: (delta.x * Math.cos(rad) - delta.y * Math.sin(rad)) / scaleX,
    y: (delta.x * Math.sin(rad) + delta.y * Math.cos(rad)) / scaleY,
  };
}

/** The most two opposite insets may sum to and still leave one source pixel. */
function axisLimit(dimension: number): number {
  return 1 - 1 / dimension;
}

/**
 * One moved inset, as far as it is allowed to go: never below zero, and never
 * so far that the axis has no pixel left in it.
 *
 * The clamp lands on the inset that MOVED, which is what keeps the opposite
 * edge pinned: the alternative — scaling both — would drag the far edge along
 * with a handle that had run out of room.
 */
function clampMoved(moved: number, opposite: number, dimension: number): number {
  return Math.min(Math.max(moved, 0), Math.max(0, axisLimit(dimension) - opposite));
}

/**
 * The insets `handle` produces, having been moved `delta` source pixels from
 * the crop the gesture **started** with.
 *
 * Always from the start, never from the clip's current crop: a drag writes on
 * every move, and rebasing each move from the previous one's output compounds
 * (ESCSUITE-110's trim bug, in a different gesture).
 *
 * `keepAspect` is Shift: the kept region keeps that width/height ratio, with
 * the axis the pointer set kept and the other derived. The caller decides what
 * the ratio is — {@link cropRegionAspect} at the press, which is the active
 * preset's ratio whenever a preset was the last thing applied, since
 * `CROP_ASPECT_PRESETS` stores insets and remembers nothing.
 */
export function cropForHandleMove(
  start: ClipCrop | undefined,
  handle: CropHandle,
  delta: { x: number; y: number },
  source: SourceSize,
  keepAspect?: number
): ClipCrop {
  const base = start ?? NO_CROP_INSETS;
  const edges = HANDLE_EDGES[handle];
  const next: ClipCrop = { ...base };

  // Written out per edge rather than through `next[edges.x]`: a write behind a
  // union key reads worse than four lines and TypeScript is happier for it. The
  // "no edge on this axis" arm is the side handles — `n` and `s` own no x inset,
  // `w` and `e` no y inset.
  if (edges.x === 'left') {
    next.left = clampMoved(base.left + delta.x / source.width, base.right, source.width);
  } else if (edges.x === 'right') {
    next.right = clampMoved(base.right - delta.x / source.width, base.left, source.width);
  }
  if (edges.y === 'top') {
    next.top = clampMoved(base.top + delta.y / source.height, base.bottom, source.height);
  } else if (edges.y === 'bottom') {
    next.bottom = clampMoved(base.bottom - delta.y / source.height, base.top, source.height);
  }

  if (keepAspect === undefined) return next;
  return withAspect(next, handle, source, keepAspect);
}

/**
 * The same insets, with the dependent axis rewritten so the kept region has the
 * given aspect — and, since every step below is exact arithmetic rather than
 * an independent per-edge clamp, with every inset held at or under
 * `MAX_CROP_INSET` (ruling 2026-10-02, superseding an interim same-day ruling
 * that refused the move instead; ESCSUITE-173).
 *
 * Which axis is INDEPENDENT (set directly from `delta`, already in `crop`
 * going in) and which is DEPENDENT (derived from it, to hold the aspect)
 * follows the handle: a left/right handle or a corner sets the width and the
 * height follows; a top/bottom handle sets the height and the width follows.
 * Where the handle owns an edge on the dependent axis (a corner) the whole
 * adjustment lands on that edge, so the edge the corner is diagonally
 * opposite stays where it was; where it does not (a side handle), the region
 * keeps its own centre on that axis and the change is split between its two
 * edges.
 *
 * The cap: `clampMoved` above bounds a PLAIN move's independent inset only at
 * the one-source-pixel limit (`axisLimit`), which is LOOSER than
 * `MAX_CROP_INSET` — a plain `w` drag past 90% does produce an inset over
 * 0.9, and is still correctly CLAMPED to 0.9 by `normaliseCrop`'s per-edge
 * clamp later, because with no ratio to hold, the clamped value is still the
 * shape the user asked for (just stopped at the wall). Under a RATIO,
 * though, that same per-edge clamp would land the independent and dependent
 * insets at DIFFERENT distances from the limit, breaking the very ratio
 * Shift is holding (NIT 8) — so before deriving the dependent edge(s) here,
 * the region's independent dimension (width for the x-driven handles,
 * height for `n`/`s`) is widened
 * to the LARGEST of: the one the pointer actually asked for, the one that
 * keeps the independent inset itself at the limit, and the one that keeps
 * every dependent inset at the limit — i.e. the smallest region that still
 * satisfies every constraint, so the handle slides to the limit and holds
 * there, the same way an unlocked handle already does at its own
 * single-edge limit, rather than breaking the lock or refusing the move. A
 * request already inside every limit leaves this a no-op: the "largest of"
 * picks the pointer's own (unwidened) value.
 *
 * Can still fall short of the aspect on a source too small or an aspect too
 * extreme for ANY region to satisfy every cap at once (the pathological
 * case `clampMoved`'s own narrow-source guard exists for, one level up) —
 * `Math.max(0, …)` on the independent inset is the floor for that, same as
 * every other defensive floor in this file.
 */
function withAspect(
  crop: ClipCrop,
  handle: CropHandle,
  source: SourceSize,
  aspect: number
): ClipCrop {
  const edges = HANDLE_EDGES[handle];

  if (edges.x) {
    const independent = edges.x === 'left' ? crop.left : crop.right;
    const oppositeX = edges.x === 'left' ? crop.right : crop.left;
    const desiredWidth = source.width * (1 - independent - oppositeX);
    const minFromIndependent = source.width * (1 - MAX_CROP_INSET - oppositeX);

    let minFromDependent: number;
    if (edges.y === 'top') {
      minFromDependent = aspect * source.height * (1 - crop.bottom - MAX_CROP_INSET);
    } else if (edges.y === 'bottom') {
      minFromDependent = aspect * source.height * (1 - crop.top - MAX_CROP_INSET);
    } else {
      const centreY = crop.top * source.height + (source.height * (1 - crop.top - crop.bottom)) / 2;
      const minFromTop = aspect * 2 * (centreY - MAX_CROP_INSET * source.height);
      const minFromBottom = aspect * 2 * ((1 - MAX_CROP_INSET) * source.height - centreY);
      minFromDependent = Math.max(minFromTop, minFromBottom);
    }

    const width = Math.max(desiredWidth, minFromIndependent, minFromDependent);
    const nextIndependent = Math.max(0, 1 - oppositeX - width / source.width);
    const capped: ClipCrop =
      edges.x === 'left' ? { ...crop, left: nextIndependent } : { ...crop, right: nextIndependent };

    const height = width / aspect;
    if (edges.y === 'top') {
      return { ...capped, top: Math.max(0, 1 - capped.bottom - height / source.height) };
    }
    if (edges.y === 'bottom') {
      return { ...capped, bottom: Math.max(0, 1 - capped.top - height / source.height) };
    }
    const centre = capped.top * source.height + (source.height * (1 - capped.top - capped.bottom)) / 2;
    return {
      ...capped,
      top: Math.max(0, (centre - height / 2) / source.height),
      bottom: Math.max(0, 1 - (centre + height / 2) / source.height),
    };
  }

  // `n`/`s`: the symmetric case, axes swapped. Neither owns an x edge, so the
  // dependent pair is always the split-around-centre form — there is no
  // corner-shaped "one edge absorbs it" variant on this side.
  const independent = edges.y === 'top' ? crop.top : crop.bottom;
  const oppositeY = edges.y === 'top' ? crop.bottom : crop.top;
  const desiredHeight = source.height * (1 - independent - oppositeY);
  const minFromIndependent = source.height * (1 - MAX_CROP_INSET - oppositeY);
  const centreX = crop.left * source.width + (source.width * (1 - crop.left - crop.right)) / 2;
  const minFromLeft = (2 * (centreX - MAX_CROP_INSET * source.width)) / aspect;
  const minFromRight = (2 * ((1 - MAX_CROP_INSET) * source.width - centreX)) / aspect;
  const minFromDependent = Math.max(minFromLeft, minFromRight);

  const height = Math.max(desiredHeight, minFromIndependent, minFromDependent);
  const nextIndependent = Math.max(0, 1 - oppositeY - height / source.height);
  const capped: ClipCrop =
    edges.y === 'top' ? { ...crop, top: nextIndependent } : { ...crop, bottom: nextIndependent };

  const width = height * aspect;
  return {
    ...capped,
    left: Math.max(0, (centreX - width / 2) / source.width),
    right: Math.max(0, 1 - (centreX + width / 2) / source.width),
  };
}

/** The width/height ratio of the region a crop keeps. */
export function cropRegionAspect(crop: ClipCrop | undefined, source: SourceSize): number {
  const region = croppedSourceRect(source.width, source.height, crop);
  return region.sw / region.sh;
}

/**
 * The clip's normalised centre, moved so the edges the gesture is **not**
 * dragging stay where they are on screen.
 *
 * `crop` shrinks the drawn picture in place — the drawn size is the cropped
 * region times the scale, anchored on the clip's centre (ESCSUITE-6) — so a
 * crop written on its own moves BOTH edges of the axis, half as far as the
 * pointer, and the handle lags and the pinned edge does not pin. The fix is the
 * displacement of the kept region's centre within the source, carried out
 * through the clip's scale and rotated with it. The same compensation the
 * resize handles already make when they write `x`/`y` beside a scale.
 */
export function cropCentreFor(
  start: { crop: ClipCrop | undefined; transform: CropGestureTransform },
  next: ClipCrop,
  source: SourceSize,
  project: { width: number; height: number }
): { x: number; y: number } {
  const before = croppedSourceRect(source.width, source.height, start.crop);
  const after = croppedSourceRect(source.width, source.height, next);

  const px = (after.sx + after.sw / 2 - (before.sx + before.sw / 2)) * start.transform.scaleX;
  const py = (after.sy + after.sh / 2 - (before.sy + before.sh / 2)) * start.transform.scaleY;

  const rad = (start.transform.rotation * Math.PI) / 180;
  return {
    x: start.transform.x + (px * Math.cos(rad) - py * Math.sin(rad)) / project.width,
    y: start.transform.y + (px * Math.sin(rad) + py * Math.cos(rad)) / project.height,
  };
}

/** The transform properties that decide where the clip's picture sits. */
const PLACEMENT_PROPERTIES: readonly AnimatableProperty[] = ['x', 'y', 'scaleX', 'scaleY'];

/**
 * May a crop write move the clip's centre as well (operator ruling,
 * 2026-10-02)?
 *
 * Not on a clip whose **placement** is keyframed. {@link cropCentreFor}'s whole
 * job is to write a static centre that holds the edges the drag is not touching;
 * on a clip whose `x`, `y`, `scaleX` or `scaleY` is animated, that static value
 * is overridden at every frame the animation covers, so writing it would fight
 * the keyframes and change nothing the user can see. The crop is then written
 * alone and the picture shrinks about its centre as it is cropped — the accepted
 * inexactness, documented in `apps/artist/CLAUDE.md`.
 *
 * Keyframes on `rotation`, `opacity` or `blur` do not turn it off: none of them
 * moves the clip's centre, so the centre is still the gesture's to write. (A
 * rotation-keyframed clip's compensation is computed with the clip's *static*
 * rotation, which is the same family of inexactness one step smaller, and is
 * documented rather than branched on.)
 */
export function cropCompensatesCentre(animation: ClipAnimation | undefined): boolean {
  if (!animation?.keyframes) return true;
  for (const property of PLACEMENT_PROPERTIES) {
    const keyframes = animation.keyframes[property];
    if (keyframes && keyframes.length > 0) return false;
  }
  return true;
}

/**
 * The whole `Partial<Clip>` one crop write hands `updateClip`: the crop, and —
 * only where {@link cropCompensatesCentre} allows it — the compensating centre
 * beside it.
 *
 * One function so there is exactly one place that decides whether a crop write
 * carries a transform, and one `updateClip` either way: one history push, one
 * locked-track check, one re-render per move. `transform` is handed over whole
 * rather than as a patch, built from the transform the gesture started with, so
 * `opacity`, `rotation` and `scaleLocked` come across untouched.
 */
export function cropWriteFor(
  start: { crop: ClipCrop | undefined; transform: ClipTransform },
  next: ClipCrop | undefined,
  source: SourceSize,
  project: { width: number; height: number },
  compensate: boolean
): { crop: ClipCrop | undefined; transform?: ClipTransform } {
  if (!compensate) return { crop: next };

  const centre = cropCentreFor(start, next ?? NO_CROP_INSETS, source, project);
  return { crop: next, transform: { ...start.transform, x: centre.x, y: centre.y } };
}

/**
 * Whether two crops keep the same region. Absent counts as four zeroes, the
 * rule `undefined === no crop` already sets.
 *
 * It is what makes a nudge that cannot move cost nothing: ArrowUp on the left
 * handle, or any arrow on a handle already clamped at the frame's edge,
 * produces the crop the clip already has, and writing that would spend an undo
 * entry on a change of nothing and announce an edit that did not happen.
 */
export function cropsEqual(a: ClipCrop | undefined, b: ClipCrop | undefined): boolean {
  const left = a ?? NO_CROP_INSETS;
  const right = b ?? NO_CROP_INSETS;
  return (
    left.left === right.left &&
    left.top === right.top &&
    left.right === right.right &&
    left.bottom === right.bottom
  );
}

/**
 * What the crop layer's live region says after a nudge that landed: the handle,
 * and the inset(s) it owns, in SOURCE pixels.
 *
 * Pixels rather than the inspector's percentages because the nudge's own step
 * is one source pixel: on a 1920-wide source that is 0.05%, and a percentage
 * would announce the nudge as "0%" — the one thing it must not say. A side
 * handle's message repeats its own name ("Crop left: left 1 px"); the
 * redundancy is the price of one sentence shape for all eight.
 */
export function cropAnnouncement(
  handle: CropHandle,
  crop: ClipCrop | undefined,
  source: SourceSize
): string {
  const insets = crop ?? NO_CROP_INSETS;
  const edges = HANDLE_EDGES[handle];
  const parts: string[] = [];
  if (edges.x) parts.push(`${edges.x} ${Math.round(insets[edges.x] * source.width)} px`);
  if (edges.y) parts.push(`${edges.y} ${Math.round(insets[edges.y] * source.height)} px`);
  return `${CROP_HANDLE_LABELS[handle]}: ${parts.join(', ')}`;
}
