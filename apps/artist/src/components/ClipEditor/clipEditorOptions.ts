// The fixed option lists the clip inspector's dropdowns are built from, plus
// the Crop section's aspect-preset buttons (`CROP_ASPECT_PRESETS`), which are
// an action row rather than a value list.
//
// Each array's order is the order its <option>s appear in, so it is what the
// user sees and what tests addressing a select by index resolve to — reordering
// one of these tables is a visible change, not a tidy-up.
import type {
  BlendMode,
  ClipMaskKind,
  TransitionType,
  AnimationPresetType,
} from '../../store/types';

/** Transition Out → Type. */
export const TRANSITION_TYPES: { value: TransitionType; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'dissolve', label: 'Dissolve' },
  { value: 'wipe-left', label: 'Wipe Left' },
  { value: 'wipe-right', label: 'Wipe Right' },
  { value: 'wipe-up', label: 'Wipe Up' },
  { value: 'wipe-down', label: 'Wipe Down' },
  { value: 'slide-left', label: 'Slide Left' },
  { value: 'slide-right', label: 'Slide Right' },
  { value: 'slide-up', label: 'Slide Up' },
  { value: 'slide-down', label: 'Slide Down' },
];

/** Blend Mode. A subset of the canvas composite operations the renderer supports. */
export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'difference', label: 'Difference' },
  { value: 'add', label: 'Add' },
];

/**
 * Mask & Stroke → the mask's shape (ESCSUITE-65).
 *
 * `'none'` is first because it is the default and because a list of shapes with
 * no way back to "no shape" is a trap. The labels say what the shape is rather
 * than what it is for — "Rounded Rectangle", not "Webcam" — because the mask is
 * a clip property now, not a handoff artefact.
 */
export const CLIP_MASK_KINDS: { value: ClipMaskKind; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'circle', label: 'Circle' },
  { value: 'rounded', label: 'Rounded Rectangle' },
];

/**
 * Crop → the aspect-ratio presets (ESCSUITE-6).
 *
 * Buttons rather than a dropdown, because this is not a stored property with a
 * current value: a preset is an action that recomputes the four insets, and a
 * `<select>` showing "1:1" after the user has since dragged an inset would be
 * lying. `None` is first for the same reason it is first in `CLIP_MASK_KINDS` —
 * a list of shapes with no way back to "no shape" is a trap — and `aspect: null`
 * is how it says so.
 */
export const CROP_ASPECT_PRESETS: { label: string; aspect: number | null }[] = [
  { label: 'None', aspect: null },
  { label: '1:1', aspect: 1 },
  { label: '16:9', aspect: 16 / 9 },
  { label: '9:16', aspect: 9 / 16 },
  { label: '4:3', aspect: 4 / 3 },
];

/** Animate In / Animate Out → preset. */
export const ANIMATION_PRESETS: { value: AnimationPresetType; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'slide-left', label: 'Slide Left' },
  { value: 'slide-right', label: 'Slide Right' },
  { value: 'slide-up', label: 'Slide Up' },
  { value: 'slide-down', label: 'Slide Down' },
  { value: 'scale', label: 'Scale' },
  { value: 'scale-up', label: 'Scale Up' },
  { value: 'scale-down', label: 'Scale Down' },
  { value: 'pop', label: 'Pop' },
  { value: 'blur', label: 'Blur' },
];

/**
 * Animate In / Animate Out → easing.
 *
 * The table itself lives in `src/utils/easingOptions.ts`, because the keyframe
 * panel offers the same curves per keyframe; re-exported here so the inspector's
 * own imports keep reading from one place.
 */
export { EASING_TYPES } from '../../utils/easingOptions';
