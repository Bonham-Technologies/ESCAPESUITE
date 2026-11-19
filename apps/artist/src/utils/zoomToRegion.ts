// Zoom to region (ESCSUITE-475): a box drawn on the preview becomes ordinary
// x / y / scaleX / scaleY keyframes on a video clip — ease in to the box, hold,
// ease back out.
//
// Pure: numbers and clips in, numbers and keyframes out. No store, no canvas,
// no React. The preview's picker and form call it to show and fit the box, and
// the form calls `planZoomToRegion` once more on Apply for what to write.
//
// **The zoom is a canvas-space map, so a crop or a non-default transform needs
// nothing special.** Every pipeline draws a media clip as its (cropped) source
// rectangle, centred at `x * W, y * H` and `sw * scaleX` by `sh * scaleY` big
// (`core/canvasRenderer.ts`). Filling the frame with a region R of the project
// frame is the map p -> (p - R.origin) * k with k = W / R.width: a uniform scale
// and a translation of the whole picture. Applied to the clip that is a new
// centre `(c - R.origin) * k` and both scales times k, whatever the crop, the
// base transform or the keyframes already put there. The crop never enters the
// arithmetic except through the drawn box the region is clamped to.
//
// What it refuses rather than guesses at, each with a reason the form shows:
// a rotated clip, a masked clip (a circle or rounded mask would show what is
// behind it when filled to the frame), a zoom that would not fit in what is left
// of the clip, and any keyframe (or Animate In/Out preset handle) of the four
// properties inside the zoom's time span, or an animation that runs across it.
import type { AnimatableProperty, Clip, ClipAnimation, EasingType, Keyframe } from '../store/types';
import { DEFAULT_EFFECTS, DEFAULT_TRANSFORM } from '../store/types';
import { croppedSourceRect } from '../core/clipCrop';
import {
  KEYFRAME_TIME_EPSILON,
  getAllKeyframesForProperty,
  getAnimatedValues,
} from './animation';

/** A rectangle in project pixels: x, y is its top-left corner. */
export interface ZoomRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A width and height, in pixels. */
export interface ZoomSize {
  width: number;
  height: number;
}

/** The form's three timing choices. Seconds. */
export interface ZoomSettings {
  /** How long the zoom stays on the region. */
  hold: number;
  /** How long each of the ease in and the ease out takes. */
  transition: number;
  /** The curve of the ease in and the ease out. */
  easing: EasingType;
}

export const DEFAULT_ZOOM_SETTINGS: ZoomSettings = {
  hold: 3,
  transition: 0.5,
  easing: 'ease-in-out',
};

/** The shortest hold or transition the form accepts, in seconds. */
export const MIN_ZOOM_STEP = 0.05;

/**
 * The deepest zoom: a region can be no narrower than the frame over this.
 * Past ten times, a 1080p source is upscaled from fewer than 200 pixels across.
 */
export const MAX_ZOOM_FACTOR = 10;

/** The four properties a zoom writes. */
export const ZOOM_PROPERTIES = ['x', 'y', 'scaleX', 'scaleY'] as const;
export type ZoomProperty = (typeof ZOOM_PROPERTIES)[number];

/** The names the keyframe panel gives them, for the refusal reasons. */
const PROPERTY_NAMES: Record<ZoomProperty | 'rotation', string> = {
  x: 'Position X',
  y: 'Position Y',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
  rotation: 'Rotation',
};

/** What a zoom writes to one clip's position and scale. */
export type ZoomPlacement = Record<ZoomProperty, number>;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const seconds = (t: number) => `${t.toFixed(2)} s`;

/**
 * Where the clip's picture is in the frame at `clipTime`, cut to the frame:
 * the only area a region may cover, so the zoom never shows anything that is
 * not the clip. Null when the clip is not in the frame at all.
 */
export function zoomBounds(
  clip: Clip,
  source: ZoomSize,
  project: ZoomSize,
  clipTime: number
): ZoomRect | null {
  const at = placementAt(clip, clipTime);
  const region = croppedSourceRect(source.width, source.height, clip.crop);
  const width = Math.abs(region.sw * at.scaleX);
  const height = Math.abs(region.sh * at.scaleY);
  const left = Math.max(0, at.x * project.width - width / 2);
  const top = Math.max(0, at.y * project.height - height / 2);
  const right = Math.min(project.width, at.x * project.width + width / 2);
  const bottom = Math.min(project.height, at.y * project.height + height / 2);
  if (!(right > left && bottom > top)) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The box a drag from `start` to `current` draws: the output's aspect ratio,
 * anchored at the corner the drag started from and grown towards the pointer,
 * as wide as the drag is wide or tall, whichever needs the bigger box.
 */
export function dragZoomRect(
  start: { x: number; y: number },
  current: { x: number; y: number },
  project: ZoomSize
): ZoomRect {
  const aspect = project.width / project.height;
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const width = Math.max(Math.abs(dx), Math.abs(dy) * aspect);
  const height = width / aspect;
  return {
    x: dx < 0 ? start.x - width : start.x,
    y: dy < 0 ? start.y - height : start.y,
    width,
    height,
  };
}

/**
 * The region a requested box becomes: the output's aspect ratio (as wide as
 * the box, or as tall, whichever is bigger), no smaller than
 * 1 / {@link MAX_ZOOM_FACTOR} of the frame, no bigger than fits in `bounds`,
 * and moved, not shrunk, back inside `bounds` when it sticks out. Its top-left
 * corner stays where it was asked for whenever it can.
 *
 * Null when `bounds` cannot hold even the smallest region, which is the clip
 * covering too little of the frame to zoom into.
 */
export function fitZoomRegion(
  requested: ZoomRect,
  bounds: ZoomRect,
  project: ZoomSize
): ZoomRect | null {
  const aspect = project.width / project.height;
  const minWidth = project.width / MAX_ZOOM_FACTOR;
  const maxWidth = Math.min(bounds.width, bounds.height * aspect);
  if (maxWidth < minWidth) return null;

  const asked = Math.max(requested.width, requested.height * aspect);
  const width = clamp(Number.isFinite(asked) ? asked : minWidth, minWidth, maxWidth);
  const height = width / aspect;
  return {
    x: clamp(requested.x, bounds.x, bounds.x + bounds.width - width),
    y: clamp(requested.y, bounds.y, bounds.y + bounds.height - height),
    width,
    height,
  };
}

/** The region the tool opens with: half the frame, centred on the clip's picture. */
export function defaultZoomRegion(bounds: ZoomRect, project: ZoomSize): ZoomRect | null {
  const width = project.width / 2;
  const height = project.height / 2;
  return fitZoomRegion(
    {
      x: bounds.x + bounds.width / 2 - width / 2,
      y: bounds.y + bounds.height / 2 - height / 2,
      width,
      height,
    },
    bounds,
    project
  );
}

/**
 * The position and scale that make `region` fill the frame, from the clip's
 * position and scale `from`. See the header for why this is the whole of it.
 */
export function zoomedPlacement(from: ZoomPlacement, region: ZoomRect, project: ZoomSize): ZoomPlacement {
  const k = project.width / region.width;
  return {
    x: ((from.x * project.width - region.x) * k) / project.width,
    y: ((from.y * project.height - region.y) * k) / project.height,
    scaleX: from.scaleX * k,
    scaleY: from.scaleY * k,
  };
}

function placementAt(clip: Clip, clipTime: number): ZoomPlacement & { rotation: number } {
  const v = getAnimatedValues(
    clipTime,
    clip.duration,
    clip.animation,
    clip.transform || DEFAULT_TRANSFORM,
    clip.effects || DEFAULT_EFFECTS
  );
  return { x: v.x, y: v.y, scaleX: v.scaleX, scaleY: v.scaleY, rotation: v.rotation };
}

/** Everything {@link planZoomToRegion} needs. */
export interface ZoomRequest {
  clip: Clip;
  /** The clip's source frame size, in source pixels. */
  source: ZoomSize;
  /** The project's frame size, in project pixels. */
  project: ZoomSize;
  /** Where the zoom starts, in the clip's own time (the playhead minus the clip's position). */
  clipTime: number;
  /** The region to fill the frame with, in project pixels; fitted here as {@link fitZoomRegion} fits it. */
  region: ZoomRect;
  settings: ZoomSettings;
}

/** What a zoom writes, or why it writes nothing. */
export type ZoomPlan =
  | {
      ok: true;
      /** The region as fitted. */
      region: ZoomRect;
      /** The clip time the zoom starts and ends at. */
      start: number;
      end: number;
      /** The clip's four whole new tracks: its own keyframes plus the zoom's four on each. */
      tracks: Record<ZoomProperty, Keyframe[]>;
      /**
       * The clip's whole keyframe map with those four tracks in it: what one
       * `updateClipAnimation(clip.id, { keyframes })` writes, as one undo step.
       */
      keyframes: ClipAnimation['keyframes'];
    }
  | { ok: false; reason: string };

/** Why a zoom cannot write here, or null when it can. */
function conflict(clip: Clip, start: number, end: number): string | null {
  const span = `inside the zoom (${seconds(start)} to ${seconds(end)})`;
  const animation = clip.animation;
  const transform = clip.transform || DEFAULT_TRANSFORM;
  const effects = clip.effects || DEFAULT_EFFECTS;

  const properties: (ZoomProperty | 'rotation')[] = [...ZOOM_PROPERTIES, 'rotation'];
  for (const property of properties) {
    const track = getAllKeyframesForProperty(property, clip.duration, animation, transform, effects);
    const inside = track.find(
      (kf) => kf.time >= start - KEYFRAME_TIME_EPSILON && kf.time <= end + KEYFRAME_TIME_EPSILON
    );
    if (inside) {
      const own = animation?.keyframes[property]?.some(
        (kf) => Math.abs(kf.time - inside.time) < KEYFRAME_TIME_EPSILON
      );
      const what = own
        ? 'a keyframe'
        : `an Animate ${animation && animation.in.type !== 'none' && inside.time <= animation.in.duration + KEYFRAME_TIME_EPSILON ? 'In' : 'Out'} preset point`;
      return `${PROPERTY_NAMES[property]} has ${what} at ${seconds(inside.time)}, ${span}. Move or delete it, or start the zoom somewhere else.`;
    }
    const before = [...track].reverse().find((kf) => kf.time < start);
    const after = track.find((kf) => kf.time > end);
    if (before && after && before.value !== after.value) {
      return `${PROPERTY_NAMES[property]} animates between its keyframes at ${seconds(before.time)} and ${seconds(after.time)}, across the zoom (${seconds(start)} to ${seconds(end)}). Start the zoom where it holds still.`;
    }
  }
  return null;
}

/**
 * The keyframes a zoom adds to `clip`, or the reason it adds none.
 *
 * Four keyframes on each of x, y, scaleX and scaleY: at the start, holding
 * whatever the clip shows there (its base transform, or the value its own
 * animation holds through the span); one transition later, the zoomed
 * placement; one hold later, the same again; one transition after that, back
 * to the start's value. The ease in and the ease out use `settings.easing`;
 * the hold and the segment after the zoom are `linear` between equal values,
 * which is no motion at all.
 *
 * Before the start and after the end the clip renders exactly as it did:
 * nothing of the four properties' tracks moves inside the span (refused
 * otherwise), so the value at the start is the value at the end, and the
 * keyframes on either side keep their times, values and easings.
 */
export function planZoomToRegion(request: ZoomRequest): ZoomPlan {
  const { clip, source, project, clipTime, region, settings } = request;

  if (!(settings.transition >= MIN_ZOOM_STEP) || !(settings.hold >= MIN_ZOOM_STEP)) {
    return { ok: false, reason: `The hold and the transition each need at least ${seconds(MIN_ZOOM_STEP)}.` };
  }
  if (clipTime < 0 || clipTime >= clip.duration) {
    return { ok: false, reason: 'Move the playhead onto the clip: the zoom starts at the playhead.' };
  }
  const total = settings.transition * 2 + settings.hold;
  const start = clipTime;
  const end = start + total;
  if (end > clip.duration + KEYFRAME_TIME_EPSILON) {
    return {
      ok: false,
      reason: `The zoom takes ${seconds(total)}, but the clip ends ${seconds(clip.duration - start)} after the playhead. Move the playhead earlier, or shorten the hold or the transition.`,
    };
  }
  if (!(source.width > 0 && source.height > 0)) {
    return { ok: false, reason: "The clip's video size is not known yet. Wait for it to load." };
  }
  if (clip.mask && clip.mask.kind !== 'none') {
    return { ok: false, reason: 'The clip has a mask, which would show what is behind it once zoomed. Remove the mask first.' };
  }

  const from = placementAt(clip, start);
  if (from.rotation !== 0) {
    return { ok: false, reason: 'Zoom to region needs an unrotated clip. Set Rotation to 0 first.' };
  }
  const why = conflict(clip, start, end);
  if (why) return { ok: false, reason: why };

  const bounds = zoomBounds(clip, source, project, start);
  if (!bounds) return { ok: false, reason: 'The clip is not in the frame at the playhead.' };
  const fitted = fitZoomRegion(region, bounds, project);
  if (!fitted) {
    return { ok: false, reason: 'The clip covers too little of the frame to zoom into.' };
  }

  const to = zoomedPlacement(from, fitted, project);
  const t1 = start + settings.transition;
  const t2 = t1 + settings.hold;
  const tracks = {} as Record<ZoomProperty, Keyframe[]>;
  for (const property of ZOOM_PROPERTIES) {
    const own = clip.animation?.keyframes[property as AnimatableProperty] ?? [];
    const zoom: Keyframe[] = [
      { time: start, value: from[property], easing: settings.easing },
      { time: t1, value: to[property], easing: 'linear' },
      { time: t2, value: to[property], easing: settings.easing },
      { time: end, value: from[property], easing: 'linear' },
    ];
    tracks[property] = [...own, ...zoom].sort((a, b) => a.time - b.time);
  }

  return { ok: true, region: fitted, start, end, tracks, keyframes: { ...clip.animation?.keyframes, ...tracks } };
}
