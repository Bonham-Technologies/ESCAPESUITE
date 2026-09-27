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

  const startTime = clipDuration - duration;
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
        { time: startTime + duration * 0.3, value: baseTransform.scaleX * 1.1, easing: 'ease-out' },
        { time: clipDuration, value: 0, easing: 'linear' },
      ];
      keyframes.scaleY = [
        { time: startTime, value: baseTransform.scaleY, easing: 'ease-in' },
        { time: startTime + duration * 0.3, value: baseTransform.scaleY * 1.1, easing: 'ease-out' },
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

/**
 * Merge keyframe arrays, with later keyframes taking precedence at same time
 */
function mergeKeyframes(base: Keyframe[], override: Keyframe[]): Keyframe[] {
  if (!base || base.length === 0) return override || [];
  if (!override || override.length === 0) return base;

  const merged = [...base];

  for (const kf of override) {
    // Check if there's already a keyframe at this time (within tolerance)
    const existingIndex = merged.findIndex(m => Math.abs(m.time - kf.time) < 0.001);
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
 * Get all animated property values at a specific time within a clip
 *
 * @param clipTime - Time relative to clip start (seconds)
 * @param clipDuration - Total clip duration (seconds)
 * @param animation - The clip's animation configuration (can be undefined)
 * @param baseTransform - The clip's base transform values
 * @param baseEffects - The clip's base effect values
 * @returns All animated values at this point in time
 */
export function getAnimatedValues(
  clipTime: number,
  clipDuration: number,
  animation: ClipAnimation | undefined,
  baseTransform: ClipTransform,
  baseEffects: ClipEffects
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

  // Generate preset keyframes
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

// ============================================
// SPLIT (ESCSUITE-95)
// ============================================

const KEYFRAME_TIME_EPSILON = 0.001;

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
 * `duration` is clamped to its own half's new duration, so a fade that used
 * to fit inside the whole clip cannot now run longer than the piece it
 * animates.
 *
 * Keyframes: per property track, the first half keeps every keyframe with
 * `time < splitOffset` and — only when the parent track has a keyframe at or
 * past the split — appends one synthesised keyframe at `splitOffset` holding
 * the curve's own interpolated value there, so the first half does not jump
 * at its new end (when no such keyframe exists, the last kept value already
 * holds all the way to the cut, and nothing is appended). The second half
 * keeps every keyframe with `time >= splitOffset`, shifted by `-splitOffset`,
 * and — only when the parent has a keyframe before the split and none
 * exactly at it — prepends one synthesised keyframe at 0 holding the same
 * interpolated value, so the second half does not jump at its new start.
 * `interpolateKeyframes` (the store's one interpolator) computes both
 * synthesised values against the *parent's* track, before it is cut.
 *
 * A synthesised keyframe's easing copies the neighbour it stands in for — the
 * keyframe that followed it in the parent for the first half's boundary, the
 * one that preceded it for the second half's. That neighbour always exists
 * when this function decides to synthesise (it is exactly what the
 * `atOrAfter.length > 0` / `before.length > 0` conditions above test for),
 * so there is no "no neighbour" case to fall back from.
 *
 * `animation` is read, never written: the two returned halves are deep
 * copies that share no keyframe, preset or array with the parent or with
 * each other.
 */
export function splitAnimation(
  animation: ClipAnimation,
  splitOffset: number,
  firstDuration: number,
  secondDuration: number
): SplitAnimationResult {
  const first: ClipAnimation = {
    in: { ...animation.in },
    out: { ...DEFAULT_ANIMATION.out },
    keyframes: {},
  };
  first.in.duration = Math.min(first.in.duration, firstDuration);

  const second: ClipAnimation = {
    in: { ...DEFAULT_ANIMATION.in },
    out: { ...animation.out },
    keyframes: {},
  };
  second.out.duration = Math.min(second.out.duration, secondDuration);

  const properties = Object.keys(animation.keyframes) as AnimatableProperty[];

  for (const property of properties) {
    const track = animation.keyframes[property];
    if (!track || track.length === 0) continue;

    const sorted = ensureKeyframesSorted(track);
    const before = sorted.filter((kf) => kf.time < splitOffset);
    const atOrAfter = sorted.filter((kf) => kf.time >= splitOffset);

    // First half: everything before the cut, plus a synthesised boundary
    // value only when the parent has something at or past the cut (otherwise
    // the last kept keyframe's value already holds to the new end). `track`
    // is non-empty here (the `continue` above), so every keyframe falls into
    // `before` or `atOrAfter` and `firstTrack` always ends up with at least
    // one entry — there is no empty case to guard.
    const firstTrack: Keyframe[] = before.map((kf) => ({ ...kf }));
    if (atOrAfter.length > 0) {
      const followingKeyframe = atOrAfter[0];
      const value = interpolateKeyframes(sorted, splitOffset, followingKeyframe.value);
      firstTrack.push({
        time: splitOffset,
        value,
        easing: followingKeyframe.easing,
      });
    }
    first.keyframes[property] = firstTrack;

    // Second half: everything at or after the cut, shifted to start at 0,
    // plus a synthesised boundary value only when the parent has something
    // before the cut and nothing exactly at it (a keyframe exactly at the
    // cut already shifts to time 0 and supplies that value itself). Same
    // non-empty guarantee as `firstTrack` above.
    const secondTrack: Keyframe[] = atOrAfter.map((kf) => ({
      time: kf.time - splitOffset,
      value: kf.value,
      easing: kf.easing,
    }));
    const hasExactAtSplit =
      atOrAfter.length > 0 && Math.abs(atOrAfter[0].time - splitOffset) < KEYFRAME_TIME_EPSILON;
    if (before.length > 0 && !hasExactAtSplit) {
      const precedingKeyframe = before[before.length - 1];
      const value = interpolateKeyframes(sorted, splitOffset, precedingKeyframe.value);
      secondTrack.unshift({
        time: 0,
        value,
        easing: precedingKeyframe.easing,
      });
    }
    second.keyframes[property] = secondTrack;
  }

  return { first, second };
}
