// The crop GESTURE's arithmetic (ESCSUITE-157): what dragging or nudging one of
// the eight handles on a clip's kept region does to `clip.crop`.
//
// It sits beside `core/clipCrop.ts`, which owns the crop itself — the region a
// crop names, the shape check, the store's clamps and the aspect presets — and
// is deliberately a separate file: that module is read by the renderer on every
// media clip of every frame, and none of this is.
//
// Pure: numbers in, numbers out. No clip, no store, no canvas, no pointer
// event. The hook that drives it is `components/Preview/useCropHandleGesture.ts`.
import type { AnimatableProperty, ClipAnimation, ClipCrop, ClipTransform } from '../store/types';
import { croppedSourceRect } from './clipCrop';

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
 * displacement by the content box' scale first. A clip at scale 0 yields a
 * non-finite inset, which `normaliseCrop`'s own clamp reads as no inset; no
 * guard is coded for a scale no caller can produce (`updateClipTransform`
 * floors every scale at 0.1).
 */
export function sourceDelta(
  delta: { x: number; y: number },
  transform: Pick<CropGestureTransform, 'scaleX' | 'scaleY' | 'rotation'>
): { x: number; y: number } {
  const rad = (-transform.rotation * Math.PI) / 180;
  return {
    x: (delta.x * Math.cos(rad) - delta.y * Math.sin(rad)) / transform.scaleX,
    y: (delta.x * Math.sin(rad) + delta.y * Math.cos(rad)) / transform.scaleY,
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
 * given aspect.
 *
 * Which axis is dependent follows the handle: a left/right handle or a corner
 * sets the width and the height follows; a top/bottom handle sets the height
 * and the width follows. Where the handle owns an edge on the dependent axis
 * (a corner) the whole adjustment lands on that edge, so the edge the corner is
 * diagonally opposite stays where it was; where it does not, the region keeps
 * its own centre on that axis and the change is split between the two edges.
 *
 * The result can ask for a region with no pixel in it — an aspect-locked drag
 * derives rather than clamps — which `cropUpdateFor` refuses, so the drag
 * simply stops.
 */
function withAspect(
  crop: ClipCrop,
  handle: CropHandle,
  source: SourceSize,
  aspect: number
): ClipCrop {
  const region = croppedSourceRect(source.width, source.height, crop);
  const edges = HANDLE_EDGES[handle];

  if (edges.x) {
    const height = region.sw / aspect;
    if (edges.y === 'top') {
      return { ...crop, top: Math.max(0, 1 - crop.bottom - height / source.height) };
    }
    if (edges.y === 'bottom') {
      return { ...crop, bottom: Math.max(0, 1 - crop.top - height / source.height) };
    }
    const centre = region.sy + region.sh / 2;
    return {
      ...crop,
      top: Math.max(0, (centre - height / 2) / source.height),
      bottom: Math.max(0, 1 - (centre + height / 2) / source.height),
    };
  }

  const width = region.sh * aspect;
  const centre = region.sx + region.sw / 2;
  return {
    ...crop,
    left: Math.max(0, (centre - width / 2) / source.width),
    right: Math.max(0, 1 - (centre + width / 2) / source.width),
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
