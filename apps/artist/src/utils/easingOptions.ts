// The easing curves the editor offers wherever an easing is chosen: the clip
// inspector's Animate In / Animate Out selects and the keyframe panel's
// per-keyframe select.
//
// The array's order is the order its <option>s appear in, so it is what the
// user sees and what tests addressing one of those selects by index resolve to
// — reordering it is a visible change, not a tidy-up.
//
// It lives here rather than in ClipEditor/clipEditorOptions.ts (which re-exports
// it) so the keyframe panel does not have to reach into the inspector.
import type { EasingType } from '../store/types';

/** A subset of `EasingType`: the quad variants exist in the engine but are not offered here. */
export const EASING_TYPES: { value: EasingType; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'Ease In' },
  { value: 'ease-out', label: 'Ease Out' },
  { value: 'ease-in-out', label: 'Ease In-Out' },
  { value: 'ease-in-cubic', label: 'Ease In (Cubic)' },
  { value: 'ease-out-cubic', label: 'Ease Out (Cubic)' },
  { value: 'ease-in-out-cubic', label: 'Ease In-Out (Cubic)' },
];
