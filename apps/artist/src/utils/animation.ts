// Animation interpolation engine
// Handles keyframe evaluation and preset-to-keyframe conversion

import type {
  ClipAnimation,
  ClipTransform,
  ClipEffects,
  Keyframe,
  EasingType,
  AnimationPresetType,
  AnimatableProperty,
} from '../store/types';
import { DEFAULT_ANIMATION } from '../store/types';

// ============================================
// ANIMATED VALUES TYPE
// ============================================

export interface AnimatedValues {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  blur: number;
  volume: number;  // Audio volume (0-1)
}

// ============================================
// EASING FUNCTIONS
// ============================================

type EasingFunction = (t: number) => number;

const easingFunctions: Record<EasingType, EasingFunction> = {
  'linear': (t) => t,
  'ease-in': (t) => t * t,
  'ease-out': (t) => t * (2 - t),
  'ease-in-out': (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  'ease-in-quad': (t) => t * t,
  'ease-out-quad': (t) => t * (2 - t),
  'ease-in-out-quad': (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  'ease-in-cubic': (t) => t * t * t,
  'ease-out-cubic': (t) => (--t) * t * t + 1,
  'ease-in-out-cubic': (t) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
};

function applyEasing(t: number, easing: EasingType): number {
  const fn = easingFunctions[easing] || easingFunctions['linear'];
  return fn(Math.max(0, Math.min(1, t)));
}

// ============================================
// KEYFRAME INTERPOLATION
// ============================================

/**
 * Binary search to find the index of the last keyframe with time <= target
 * Returns -1 if all keyframes are after target
 */
function binarySearchKeyframes(keyframes: Keyframe[], targetTime: number): number {
  let left = 0;
  let right = keyframes.length - 1;
  let result = -1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (keyframes[mid].time <= targetTime) {
      result = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return result;
}

/**
 * Interpolate a value from a keyframe array at a given time.
 * IMPORTANT: Keyframes must be pre-sorted by time (ascending).
 * The store guarantees this - DO NOT pass unsorted keyframes.
 *
 * Uses binary search for O(log n) lookup instead of O(n) linear scan.
 */
export function interpolateKeyframes(
  keyframes: Keyframe[],
  time: number,
  defaultValue: number
): number {
  if (!keyframes || keyframes.length === 0) {
    return defaultValue;
  }

  // Helper to safely get a keyframe value, falling back to defaultValue if invalid
  const safeValue = (value: number | undefined): number => {
    return value !== undefined && Number.isFinite(value) ? value : defaultValue;
  };

  // Before first keyframe - return first value
  if (time <= keyframes[0].time) {
    return safeValue(keyframes[0].value);
  }

  // After last keyframe - return last value
  if (time >= keyframes[keyframes.length - 1].time) {
    return safeValue(keyframes[keyframes.length - 1].value);
  }

  // Binary search to find the keyframe at or before this time
  const index = binarySearchKeyframes(keyframes, time);

  if (index < 0 || index >= keyframes.length - 1) {
    return defaultValue;
  }

  const kf1 = keyframes[index];
  const kf2 = keyframes[index + 1];

  // Safely get values, falling back to defaultValue if undefined/NaN
  const value1 = safeValue(kf1.value);
  const value2 = safeValue(kf2.value);

  // Calculate progress between keyframes
  const duration = kf2.time - kf1.time;
  const elapsed = time - kf1.time;
  const t = duration > 0 ? elapsed / duration : 0;

  // Apply easing (use kf1's easing - it defines the curve TO the next keyframe)
  const easedT = applyEasing(t, kf1.easing);

  // Linear interpolation with eased t
  return value1 + (value2 - value1) * easedT;
}

/**
 * Ensures keyframes are sorted by time. Use this when receiving keyframes
 * from external sources that may not be sorted.
 */
export function ensureKeyframesSorted(keyframes: Keyframe[]): Keyframe[] {
  if (!keyframes || keyframes.length <= 1) {
    return keyframes;
  }

  // Check if already sorted
  let isSorted = true;
  for (let i = 1; i < keyframes.length; i++) {
    if (keyframes[i].time < keyframes[i - 1].time) {
      isSorted = false;
      break;
    }
  }

  if (isSorted) {
    return keyframes;
  }

  return [...keyframes].sort((a, b) => a.time - b.time);
}

// ============================================
// PRESET TO KEYFRAME CONVERSION
// ============================================

interface PresetKeyframes {
  [key: string]: Keyframe[];
}

/**
 * Which of a clip's two animation presets a caller is talking about — the same
 * two names `ClipAnimation` uses for them.
 */
export type PresetSide = 'in' | 'out';

/**
 * The preset keyframes of a side that is not being applied. One shared frozen
 * object rather than a fresh `{}` per call, so suppressing a preset allocates
 * nothing — every read of it below is a property lookup that misses.
 */
const NO_PRESET_KEYFRAMES: PresetKeyframes = Object.freeze({});

/**
 * Generate keyframes for an "in" animation preset
 */
function generateInPresetKeyframes(
  preset: AnimationPresetType,
  duration: number,
  easing: EasingType,
  baseTransform: ClipTransform,
  baseEffects: ClipEffects
): PresetKeyframes {
  if (preset === 'none' || duration <= 0) {
    return {};
  }

  const keyframes: PresetKeyframes = {};

  switch (preset) {
    case 'fade':
      keyframes.opacity = [
        { time: 0, value: 0, easing },
        { time: duration, value: baseTransform.opacity, easing: 'linear' },
      ];
      break;

    case 'slide-left':
      keyframes.x = [
        { time: 0, value: baseTransform.x + 0.5, easing }, // Start from right
        { time: duration, value: baseTransform.x, easing: 'linear' },
      ];
      break;

    case 'slide-right':
      keyframes.x = [
        { time: 0, value: baseTransform.x - 0.5, easing }, // Start from left
        { time: duration, value: baseTransform.x, easing: 'linear' },
      ];
      break;

    case 'slide-up':
      keyframes.y = [
        { time: 0, value: baseTransform.y + 0.5, easing }, // Start from bottom
        { time: duration, value: baseTransform.y, easing: 'linear' },
      ];
      break;

    case 'slide-down':
      keyframes.y = [
        { time: 0, value: baseTransform.y - 0.5, easing }, // Start from top
        { time: duration, value: baseTransform.y, easing: 'linear' },
      ];
      break;

    case 'scale':
    case 'scale-up':
      keyframes.scaleX = [
        { time: 0, value: 0, easing },
        { time: duration, value: baseTransform.scaleX, easing: 'linear' },
      ];
      keyframes.scaleY = [
        { time: 0, value: 0, easing },
        { time: duration, value: baseTransform.scaleY, easing: 'linear' },
      ];
      break;

    case 'scale-down':
      keyframes.scaleX = [
        { time: 0, value: baseTransform.scaleX * 2, easing },
        { time: duration, value: baseTransform.scaleX, easing: 'linear' },
      ];
      keyframes.scaleY = [
        { time: 0, value: baseTransform.scaleY * 2, easing },
        { time: duration, value: baseTransform.scaleY, easing: 'linear' },
      ];
      break;

    case 'pop':
      // Scale up slightly then settle
      keyframes.scaleX = [
        { time: 0, value: 0, easing: 'ease-out' },
        { time: duration * 0.7, value: baseTransform.scaleX * 1.1, easing: 'ease-in-out' },
        { time: duration, value: baseTransform.scaleX, easing: 'linear' },
      ];
      keyframes.scaleY = [
        { time: 0, value: 0, easing: 'ease-out' },
        { time: duration * 0.7, value: baseTransform.scaleY * 1.1, easing: 'ease-in-out' },
        { time: duration, value: baseTransform.scaleY, easing: 'linear' },
      ];
      break;

    case 'blur':
      keyframes.blur = [
        { time: 0, value: 20, easing },
        { time: duration, value: baseEffects.blur, easing: 'linear' },
      ];
      keyframes.opacity = [
        { time: 0, value: 0, easing },
        { time: duration, value: baseTransform.opacity, easing: 'linear' },
      ];
      break;
  }

  return keyframes;
}

/**
 * Generate keyframes for an "out" animation preset
 */
function generateOutPresetKeyframes(
  preset: AnimationPresetType,
  duration: number,
  easing: EasingType,
  clipDuration: number,
  baseTransform: ClipTransform,
  baseEffects: ClipEffects
): PresetKeyframes {
  if (preset === 'none' || duration <= 0) {
    return {};
  }

  // Belt and braces (ESCSUITE-125): the write paths that set a preset (and
  // `trimAnimation`, on a trim that shortens the clip) clamp `duration` to
  // `maxPresetDuration(clipDuration)` before it ever gets here, but a
  // hand-edited project or an older file can still carry a `duration` longer
  // than the clip. Clamping to `clipDuration` itself — not the tighter
  // `maxPresetDuration` bound the UI enforces — is enough to keep `startTime`
  // from going negative, which is the only thing this function's own math
  // requires.
  const clampedDuration = Math.min(duration, clipDuration);
  const startTime = clipDuration - clampedDuration;
  const keyframes: PresetKeyframes = {};

  switch (preset) {
    case 'fade':
      keyframes.opacity = [
        { time: startTime, value: baseTransform.opacity, easing },
        { time: clipDuration, value: 0, easing: 'linear' },
      ];
      break;

    case 'slide-left':
      keyframes.x = [
        { time: startTime, value: baseTransform.x, easing },
        { time: clipDuration, value: baseTransform.x - 0.5, easing: 'linear' }, // Exit to left
      ];
      break;

    case 'slide-right':
      keyframes.x = [
        { time: startTime, value: baseTransform.x, easing },
        { time: clipDuration, value: baseTransform.x + 0.5, easing: 'linear' }, // Exit to right
      ];
      break;

    case 'slide-up':
      keyframes.y = [
        { time: startTime, value: baseTransform.y, easing },
        { time: clipDuration, value: baseTransform.y - 0.5, easing: 'linear' }, // Exit to top
      ];
      break;

    case 'slide-down':
      keyframes.y = [
        { time: startTime, value: baseTransform.y, easing },
        { time: clipDuration, value: baseTransform.y + 0.5, easing: 'linear' }, // Exit to bottom
      ];
      break;

    case 'scale':
    case 'scale-down':
      keyframes.scaleX = [
        { time: startTime, value: baseTransform.scaleX, easing },
        { time: clipDuration, value: 0, easing: 'linear' },
      ];
      keyframes.scaleY = [
        { time: startTime, value: baseTransform.scaleY, easing },
        { time: clipDuration, value: 0, easing: 'linear' },
      ];
      break;

    case 'scale-up':
      keyframes.scaleX = [
        { time: startTime, value: baseTransform.scaleX, easing },
        { time: clipDuration, value: baseTransform.scaleX * 2, easing: 'linear' },
      ];
      keyframes.scaleY = [
        { time: startTime, value: baseTransform.scaleY, easing },
        { time: clipDuration, value: baseTransform.scaleY * 2, easing: 'linear' },
      ];
      keyframes.opacity = [
        { time: startTime, value: baseTransform.opacity, easing },
        { time: clipDuration, value: 0, easing: 'linear' },
      ];
      break;

    case 'pop':
      // Scale up slightly then shrink
      keyframes.scaleX = [
        { time: startTime, value: baseTransform.scaleX, easing: 'ease-in' },
        { time: startTime + clampedDuration * 0.3, value: baseTransform.scaleX * 1.1, easing: 'ease-out' },
        { time: clipDuration, value: 0, easing: 'linear' },
      ];
      keyframes.scaleY = [
        { time: startTime, value: baseTransform.scaleY, easing: 'ease-in' },
        { time: startTime + clampedDuration * 0.3, value: baseTransform.scaleY * 1.1, easing: 'ease-out' },
        { time: clipDuration, value: 0, easing: 'linear' },
      ];
      break;

    case 'blur':
      keyframes.blur = [
        { time: startTime, value: baseEffects.blur, easing },
        { time: clipDuration, value: 20, easing: 'linear' },
      ];
      keyframes.opacity = [
        { time: startTime, value: baseTransform.opacity, easing },
        { time: clipDuration, value: 0, easing: 'linear' },
      ];
      break;
  }

  return keyframes;
}

// Two keyframe times within this many seconds of each other are treated as
// "the same time" — the tolerance `mergeKeyframes` and `splitAnimation` both
// use to decide whether a keyframe sits exactly at a given instant. Exported
// since ESCSUITE-101, so `keyframeSlice.ts`'s `removeClipKeyframe` can ask the
// same question before refusing a delete that would touch nothing.
export const KEYFRAME_TIME_EPSILON = 0.001;

/**
 * Merge keyframe arrays, with later keyframes taking precedence at same time
 */
function mergeKeyframes(base: Keyframe[], override: Keyframe[]): Keyframe[] {
  if (!base || base.length === 0) return override || [];
  if (!override || override.length === 0) return base;

  const merged = [...base];

  for (const kf of override) {
    // Check if there's already a keyframe at this time (within tolerance)
    const existingIndex = merged.findIndex(m => Math.abs(m.time - kf.time) < KEYFRAME_TIME_EPSILON);
    if (existingIndex >= 0) {
      merged[existingIndex] = kf; // Replace
    } else {
      merged.push(kf);
    }
  }

  return merged.sort((a, b) => a.time - b.time);
}

// ============================================
// MAIN ANIMATION VALUE RESOLVER
// ============================================

/**
 * Per-call adjustments to how a clip's animation is evaluated.
 *
 * Optional, and every default is the behaviour this function always had: a
 * caller that passes nothing gets both presets and every keyframe.
 */
export interface AnimatedValuesOptions {
  /**
   * One preset side to leave out of this evaluation (ESCSUITE-139) — the clip's
   * own keyframes are unaffected either way.
   *
   * For the renderer, this is "a transition owns the entrance of its incoming
   * clip and the exit of its outgoing clip": while a clip is the incoming side
   * of an active transition its in-preset is suppressed, and while it is the
   * outgoing side its out-preset is. Leaving a side out IS the steady state the
   * ruling asks for, with no second interpolation path and no special values to
   * invent: every in-preset's LAST keyframe and every out-preset's FIRST
   * keyframe hold the clip's own base transform/effects, so an ignored
   * in-preset reads exactly as "already finished" and an ignored out-preset
   * exactly as "not started yet", for every property the preset drives rather
   * than for opacity alone.
   */
  suppressPreset?: PresetSide;
}

/**
 * The one options object per suppressible side, frozen and shared.
 *
 * Lived in `core/canvasRenderer.ts` until ESCSUITE-147, which gave it a second
 * caller: the preview's geometry has to evaluate a clip under the very
 * suppression the renderer draws it under, or the selection box lands where the
 * picture is not. Shared rather than copied so there is one answer, and frozen
 * and hoisted rather than built per call because both callers ask repeatedly for
 * as long as a transition lasts — the renderer twice a frame, the pointer once a
 * move — for a value with exactly two possible contents.
 */
export const PRESET_SUPPRESSION: Readonly<Record<PresetSide, AnimatedValuesOptions>> = {
  in: Object.freeze({ suppressPreset: 'in' }),
  out: Object.freeze({ suppressPreset: 'out' }),
};

/**
 * Get all animated property values at a specific time within a clip
 *
 * @param clipTime - Time relative to clip start (seconds)
 * @param clipDuration - Total clip duration (seconds)
 * @param animation - The clip's animation configuration (can be undefined)
 * @param baseTransform - The clip's base transform values
 * @param baseEffects - The clip's base effect values
 * @param options - Per-call adjustments; see {@link AnimatedValuesOptions}
 * @returns All animated values at this point in time
 */
export function getAnimatedValues(
  clipTime: number,
  clipDuration: number,
  animation: ClipAnimation | undefined,
  baseTransform: ClipTransform,
  baseEffects: ClipEffects,
  options?: AnimatedValuesOptions
): AnimatedValues {
  // Start with base values
  const result: AnimatedValues = {
    x: baseTransform.x,
    y: baseTransform.y,
    scaleX: baseTransform.scaleX,
    scaleY: baseTransform.scaleY,
    rotation: baseTransform.rotation,
    opacity: baseTransform.opacity,
    blur: baseEffects.blur,
    volume: 1,  // Default volume is 1 (100%), can be overridden by keyframes
  };

  // If no animation config, return base values
  if (!animation) {
    return result;
  }

  // Generate preset keyframes. A suppressed side contributes no keyframes at
  // all (ESCSUITE-139) — the merge below then leaves that property's track to
  // the other preset and the clip's own keyframes, and a property neither of
  // those touches keeps the base value it was seeded with. Composing with
  // ESCSUITE-125's clamps needs nothing: the generator that would have clamped
  // is simply not called.
  const inKeyframes = options?.suppressPreset === 'in'
    ? NO_PRESET_KEYFRAMES
    : generateInPresetKeyframes(
        animation.in.type,
        animation.in.duration,
        animation.in.easing,
        baseTransform,
        baseEffects
      );

  const outKeyframes = options?.suppressPreset === 'out'
    ? NO_PRESET_KEYFRAMES
    : generateOutPresetKeyframes(
        animation.out.type,
        animation.out.duration,
        animation.out.easing,
        clipDuration,
        baseTransform,
        baseEffects
      );

  // For each animatable property, merge presets with custom keyframes and interpolate
  const properties: AnimatableProperty[] = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity', 'blur', 'volume'];

  for (const prop of properties) {
    // Merge: in preset + out preset + custom keyframes (custom takes precedence)
    let keyframes = mergeKeyframes(
      inKeyframes[prop] || [],
      outKeyframes[prop] || []
    );

    // Custom keyframes override presets
    const customKeyframes = animation.keyframes[prop];
    if (customKeyframes && customKeyframes.length > 0) {
      keyframes = mergeKeyframes(keyframes, customKeyframes);
    }

    // If we have any keyframes, interpolate
    if (keyframes.length > 0) {
      result[prop] = interpolateKeyframes(keyframes, clipTime, result[prop]);
    }
  }

  return result;
}

/**
 * Check if a clip has any animation (presets or keyframes)
 */
export function hasAnimation(animation: ClipAnimation | undefined): boolean {
  if (!animation) return false;

  // Check presets
  if (animation.in.type !== 'none' && animation.in.duration > 0) return true;
  if (animation.out.type !== 'none' && animation.out.duration > 0) return true;

  // Check custom keyframes
  const properties: AnimatableProperty[] = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity', 'blur', 'volume'];
  for (const prop of properties) {
    const kfs = animation.keyframes[prop];
    if (kfs && kfs.length > 0) return true;
  }

  return false;
}

/**
 * Get all keyframes for a property, including those generated from presets
 */
export function getAllKeyframesForProperty(
  property: AnimatableProperty,
  clipDuration: number,
  animation: ClipAnimation | undefined,
  baseTransform: ClipTransform,
  baseEffects: ClipEffects
): Keyframe[] {
  if (!animation) return [];

  const inKeyframes = generateInPresetKeyframes(
    animation.in.type,
    animation.in.duration,
    animation.in.easing,
    baseTransform,
    baseEffects
  );

  const outKeyframes = generateOutPresetKeyframes(
    animation.out.type,
    animation.out.duration,
    animation.out.easing,
    clipDuration,
    baseTransform,
    baseEffects
  );

  let keyframes = mergeKeyframes(
    inKeyframes[property] || [],
    outKeyframes[property] || []
  );

  const customKeyframes = animation.keyframes[property];
  if (customKeyframes && customKeyframes.length > 0) {
    keyframes = mergeKeyframes(keyframes, customKeyframes);
  }

  return keyframes;
}

/**
 * Create a default animation config
 */
export function createDefaultAnimation(): ClipAnimation {
  return structuredClone(DEFAULT_ANIMATION);
}

/**
 * Get the animated volume value at a specific clip time
 * This is a convenience function for audio processing
 *
 * @param clipTime - Time relative to clip start (seconds)
 * @param animation - The clip's animation configuration
 * @param baseVolume - Base volume (default 1.0)
 * @returns Volume value between 0-1
 */
export function getAnimatedVolume(
  clipTime: number,
  animation: ClipAnimation | undefined,
  baseVolume: number = 1
): number {
  if (!animation) {
    return baseVolume;
  }

  const volumeKeyframes = animation.keyframes.volume;
  if (!volumeKeyframes || volumeKeyframes.length === 0) {
    return baseVolume;
  }

  const result = interpolateKeyframes(volumeKeyframes, clipTime, baseVolume);

  // Ensure we always return a valid finite number clamped to 0-1
  if (!Number.isFinite(result)) {
    return baseVolume;
  }
  return Math.max(0, Math.min(1, result));
}

/**
 * Check if a clip has volume keyframes
 */
export function hasVolumeKeyframes(animation: ClipAnimation | undefined): boolean {
  if (!animation) return false;
  const volumeKeyframes = animation.keyframes.volume;
  return volumeKeyframes !== undefined && volumeKeyframes.length > 0;
}

/**
 * The upper bound offered for an animation/transition duration slider, and
 * (since ESCSUITE-110) the bound `trimAnimation` clamps a kept preset's
 * duration to when a trim shortens the clip it sits on. Moved here from
 * `components/ClipEditor/clipEditorModel.ts` (which re-exports it) so this
 * file does not import from a component directory.
 */
export function maxPresetDuration(clipDuration: number): number {
  return Math.min(2, clipDuration / 2);
}

// ============================================
// SPLIT (ESCSUITE-95) / TRIM (ESCSUITE-110)
// ============================================

/**
 * The keyframes of `sorted` (already time-sorted) that fall strictly before
 * `boundary`, plus one synthesised keyframe *at* `boundary` when the track
 * has anything at or past it — holding `interpolateKeyframes`' own value
 * there, with the easing of the keyframe it stands in for, so the truncated
 * track does not jump at its new end. When nothing sits at or past
 * `boundary`, the last kept keyframe's value already holds all the way to
 * it, and nothing is appended.
 *
 * The shared arithmetic behind `splitAnimation`'s first half and
 * `trimAnimation`'s trim-from-the-end. `sorted` is also the track
 * `interpolateKeyframes` reads the synthesised value from. `trimAnimation`
 * calls this one first, against the untouched original track, so there is no
 * "which track to interpolate against" question here the way there is for
 * `cutStart` below.
 */
function cutEnd(sorted: Keyframe[], boundary: number): Keyframe[] {
  const before = sorted.filter((kf) => kf.time < boundary - KEYFRAME_TIME_EPSILON);
  const atOrAfter = sorted.filter((kf) => kf.time >= boundary - KEYFRAME_TIME_EPSILON);

  const track: Keyframe[] = before.map((kf) => ({ ...kf }));
  if (atOrAfter.length > 0) {
    const followingKeyframe = atOrAfter[0];
    const value = interpolateKeyframes(sorted, boundary, followingKeyframe.value);
    track.push({
      time: boundary,
      value,
      easing: followingKeyframe.easing,
    });
  }
  return track;
}

/**
 * The keyframes of `track` (already time-sorted) at or after `boundary`,
 * shifted so `boundary` becomes time 0 — snapped exactly to 0 for a keyframe
 * already within `KEYFRAME_TIME_EPSILON` of it, rather than left at a small
 * residual — plus one synthesised keyframe prepended at 0 when `track` has
 * something before `boundary` and nothing exactly at it (a keyframe already
 * at the boundary shifts to 0 and supplies that value itself).
 *
 * The shared arithmetic behind `splitAnimation`'s second half and
 * `trimAnimation`'s trim-from-the-start.
 *
 * `reference` (defaulting to `track` itself, which is all `splitAnimation`
 * ever needs) is what the synthesised keyframe's value is interpolated
 * against. `trimAnimation` passes the *original*, un-end-cropped track here
 * rather than its own `cutEnd`-cropped one: interpolating against the cropped
 * track would read the segment leading up to `boundary` as running to
 * whatever `cutEnd` synthesised at the new end, re-easing it a SECOND time
 * over that shorter span — a different (and for any easing but `linear`,
 * wrong) answer from interpolating the original segment once, directly, at
 * `boundary`. `before`'s own last real keyframe is identical either way
 * (nothing before `boundary` ever moves), so only the interpolation target
 * differs.
 */
function cutStart(track: Keyframe[], boundary: number, reference: Keyframe[] = track): Keyframe[] {
  const before = track.filter((kf) => kf.time < boundary - KEYFRAME_TIME_EPSILON);
  const atOrAfter = track.filter((kf) => kf.time >= boundary - KEYFRAME_TIME_EPSILON);

  const result: Keyframe[] = atOrAfter.map((kf) => ({
    time: Math.abs(kf.time - boundary) < KEYFRAME_TIME_EPSILON ? 0 : kf.time - boundary,
    value: kf.value,
    easing: kf.easing,
  }));
  const hasExactAtBoundary =
    atOrAfter.length > 0 && Math.abs(atOrAfter[0].time - boundary) < KEYFRAME_TIME_EPSILON;
  if (before.length > 0 && !hasExactAtBoundary) {
    const precedingKeyframe = before[before.length - 1];
    const value = interpolateKeyframes(reference, boundary, precedingKeyframe.value);
    result.unshift({
      time: 0,
      value,
      easing: precedingKeyframe.easing,
    });
  }
  return result;
}

export interface SplitAnimationResult {
  first: ClipAnimation;
  second: ClipAnimation;
}

/**
 * Split a clip's animation in two at `splitOffset` (clip-relative seconds, the
 * same unit `Keyframe.time` uses), for the razor/Ctrl+B/inspector Split
 * (ESCSUITE-95). Before this, `splitClip` copied the whole `animation` object
 * onto both halves: a fade at the start of the original clip replayed from
 * the second half's own start too, and a preset was regenerated against each
 * half's shorter `clipDuration`, so one fade-in/out became two.
 *
 * Presets: the in-preset stays with the first half and the out-preset with
 * the second — "fade in at the start, fade out at the end" survives a cut
 * exactly that literally. The half that loses a preset has that side reset to
 * `DEFAULT_ANIMATION`'s "none" shape (rather than carrying a `type: 'none'`
 * preset with a stale, unused `duration`/`easing`). A kept preset's
 * `duration` is carried over **untouched**, even past its own half's new,
 * shorter length: nothing else in the app clamps a preset to the clip it sits
 * on (trimming a clip leaves a 2s fade on a 1s result alone), the inspector's
 * own slider bound (`maxPresetDuration()` in `clipEditorModel.ts`) is a UI
 * clamp on user input, not an invariant this function must also enforce, and
 * — the concrete reason — an unclamped 3s fade-in on a first half only 2s
 * long still renders bit-identically to what the parent clip showed over
 * those same two seconds, while clamping the duration would have changed the
 * picture.
 *
 * Keyframes: per property track, the first half keeps every keyframe with
 * `time < splitOffset` and — only when the parent track has a keyframe at or
 * past the split — appends one synthesised keyframe at `splitOffset` holding
 * the curve's own interpolated value there, so the first half does not jump
 * at its new end (when no such keyframe exists, the last kept value already
 * holds all the way to the cut, and nothing is appended). The second half
 * keeps every keyframe with `time >= splitOffset`, shifted by `-splitOffset`,
 * and — only when the parent has a keyframe before the split and none at it
 * — prepends one synthesised keyframe at 0 holding the same interpolated
 * value, so the second half does not jump at its new start.
 * `interpolateKeyframes` (the store's one interpolator) computes both
 * synthesised values against the *parent's* track, before it is cut. A
 * keyframe within `KEYFRAME_TIME_EPSILON` of `splitOffset` counts as sitting
 * *at* the split either way — it shifts onto the second half at time 0 rather
 * than being kept (near-)unchanged on the first, which still gets its usual
 * synthesised boundary keyframe in its place.
 *
 * A synthesised keyframe's easing copies the neighbour it stands in for — the
 * keyframe that followed it in the parent for the first half's boundary, the
 * one that preceded it for the second half's. That neighbour always exists
 * when this function decides to synthesise (it is exactly what the
 * `atOrAfter.length > 0` / `before.length > 0` checks in the implementation
 * below test for), so there is no "no neighbour" case to fall back from.
 *
 * **What is not preserved**: only the two boundary values (and, for a
 * keyframe already sitting at the split, that keyframe itself) are exact. A
 * segment that straddled the cut is re-eased over a shorter span on each
 * side — the parent's easing function runs start-to-end over the *original*
 * gap between its two real keyframes, while each half now runs the same
 * function over a fraction of that gap — so for any easing other than
 * `linear`, the curve between a synthesised boundary keyframe and its
 * neighbour differs slightly from the parent's curve over that same stretch.
 * The two clip halves still meet at the same value at the cut; only the
 * shape of the approach on either side can differ.
 *
 * `animation` is read, never written: the two returned halves are deep
 * copies that share no keyframe, preset or array with the parent or with
 * each other.
 */
export function splitAnimation(
  animation: ClipAnimation,
  splitOffset: number
): SplitAnimationResult {
  const first: ClipAnimation = {
    in: { ...animation.in },
    out: { ...DEFAULT_ANIMATION.out },
    keyframes: {},
  };

  const second: ClipAnimation = {
    in: { ...DEFAULT_ANIMATION.in },
    out: { ...animation.out },
    keyframes: {},
  };

  const properties = Object.keys(animation.keyframes) as AnimatableProperty[];

  for (const property of properties) {
    const track = animation.keyframes[property];
    if (!track || track.length === 0) continue;

    // `track` is non-empty here (the `continue` above), so every keyframe
    // falls before or at-or-after `splitOffset` and both `cutEnd`/`cutStart`
    // always end up with at least one entry — there is no empty case to
    // guard. A keyframe within tolerance of the split counts as sitting at
    // it, so it belongs on the second half (at time 0) rather than the
    // first — see `cutStart`'s own `hasExactAtBoundary` check.
    const sorted = ensureKeyframesSorted(track);
    first.keyframes[property] = cutEnd(sorted, splitOffset);
    second.keyframes[property] = cutStart(sorted, splitOffset);
  }

  return { first, second };
}

/** The clip-relative interval `trimAnimation` keeps, in the ORIGINAL clip's
 * time coordinates (before the trim) — the same coordinate space
 * `Keyframe.time` and `splitAnimation`'s `splitOffset` use. `end - start` is
 * always the trimmed clip's new duration. */
export interface TrimAnimationRange {
  /** How much is cut from the front (0 for a trim from the end only). */
  start: number;
  /** The point beyond which everything is cut (the original duration for a
   * trim from the start only). */
  end: number;
}

/**
 * Rebase a clip's animation onto a shorter clip after a trim (ESCSUITE-110):
 * the store's `trimClip` calls this (review round 1 split it out of the
 * generic `updateClip`, which `useTrimDrag`'s commit used to go through) for
 * every trim that shortens a clip — trimming it longer changes nothing, by
 * the caller simply not calling this. Unlike `splitAnimation`, trimming does
 * not create a second clip, so there is nothing to divide ownership of: both
 * `in` and `out` presets stay right where they are, on the one clip that
 * remains.
 *
 * Presets: a kept preset's `duration` is clamped to `maxPresetDuration(end -
 * start)` — the same bound the inspector's own sliders enforce on new input —
 * UNLESS the preset's `type` is `'none'`, in which case its `duration` is left
 * alone: a `'none'` preset's `duration` does nothing (`generateInPresetKeyframes`
 * / `generateOutPresetKeyframes` both bail out before reading it), so clamping
 * it would report a number the UI never actually used, and would throw away
 * whatever the field held if the clip's preset is later switched back on.
 * Before this clamp existed at all, nothing bounded a trimmed clip's presets,
 * so a 2s fade-out surviving a trim down to a 1s clip left
 * `generateOutPresetKeyframes` computing `startTime = clipDuration - duration
 * = 1 - 2 = -1`: the clip opened already part-faded, and the keyframe panel
 * plotted the keyframe at a negative time. (`splitAnimation` deliberately
 * does NOT clamp an active preset's duration — see its own doc comment —
 * because an unclamped preset on a split half still renders bit-identically
 * to what the parent showed; a trim has no "what the parent showed" to fall
 * back on, since the trimmed content is gone.)
 *
 * Keyframes: cropped and shifted with the exact arithmetic `splitAnimation`
 * uses — trimming from the end is that function's first half (`cutEnd`,
 * boundary at the new end); trimming from the start is its second half
 * (`cutStart`, boundary at `start`, shifting the survivors back to 0). A
 * trim only ever moves one edge, but this function crops both in one pass so
 * a caller never needs to know which edge moved, only the interval that
 * survives: `start` and `end` are applied as `cutEnd` first (drop anything
 * past `end`, synthesising a boundary there) and then `cutStart` on ITS
 * result (drop anything before `start`, synthesising a boundary at 0). The
 * synthesised boundary AT `start`, though, is interpolated against the
 * ORIGINAL track, not `cutEnd`'s output — `cutStart`'s `reference` parameter
 * — so a segment spanning both cuts is re-eased exactly once (over
 * `[precedingKeyframe, start]` directly) rather than twice (once implicitly
 * inside `cutEnd`'s synthesised point at `end`, and again by `cutStart`
 * treating that synthesised point as the segment's real far end). The two
 * synthesised boundaries themselves — the one `cutEnd` places at `end` and
 * the one `cutStart` places at `start` — are otherwise exact regardless of
 * easing, the same guarantee `splitAnimation` documents for its own two
 * halves.
 *
 * `animation` is read, never written: the result shares no keyframe, preset
 * or array with it.
 */
export function trimAnimation(
  animation: ClipAnimation,
  { start, end }: TrimAnimationRange
): ClipAnimation {
  const cap = maxPresetDuration(end - start);
  const clampPreset = (preset: ClipAnimation['in']): ClipAnimation['in'] =>
    preset.type === 'none' ? { ...preset } : { ...preset, duration: Math.min(preset.duration, cap) };

  const result: ClipAnimation = {
    in: clampPreset(animation.in),
    out: clampPreset(animation.out),
    keyframes: {},
  };

  const properties = Object.keys(animation.keyframes) as AnimatableProperty[];

  for (const property of properties) {
    const track = animation.keyframes[property];
    if (!track || track.length === 0) continue;

    const sorted = ensureKeyframesSorted(track);
    const croppedAtEnd = cutEnd(sorted, end);
    result.keyframes[property] =
      start > KEYFRAME_TIME_EPSILON ? cutStart(croppedAtEnd, start, sorted) : croppedAtEnd;
  }

  return result;
}
