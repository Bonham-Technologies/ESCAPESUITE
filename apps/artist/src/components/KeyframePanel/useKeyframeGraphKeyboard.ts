import { useCallback, useState, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type SetStateAction } from 'react';
import type { AnimatableProperty, EasingType, Keyframe } from '../../store/types';
import { EASING_TYPES } from '../../utils/easingOptions';

// The name each property is announced by. Deliberately a copy of the labels
// KeyframePanel lists its property tracks with rather than an import of them:
// the panel owns the graph, so importing from it would invert the dependency.
export const PROPERTY_LABELS: Record<AnimatableProperty, string> = {
  x: 'Position X',
  y: 'Position Y',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
  rotation: 'Rotation',
  opacity: 'Opacity',
  blur: 'Blur',
  volume: 'Volume',
};

/** Format a value for display, in the property's own unit. */
export function formatValue(value: number, prop: AnimatableProperty): string {
  if (prop === 'rotation') return `${value.toFixed(0)}°`;
  if (prop === 'blur') return `${value.toFixed(0)}px`;
  if (prop === 'opacity' || prop === 'volume') return `${(value * 100).toFixed(0)}%`;
  if (prop === 'x' || prop === 'y') return `${(value * 100).toFixed(0)}%`;
  return value.toFixed(2);
}

/**
 * What a screen reader reads for one keyframe handle. It overrides the <title>
 * child, which stays as the pointer tooltip.
 */
export function keyframeOptionLabel(
  value: string,
  time: number,
  easing: EasingType,
  isCustom: boolean
): string {
  const easingLabel = EASING_TYPES.find(o => o.value === easing)?.label ?? easing;
  return `${value} at ${time.toFixed(2)} s, ${easingLabel}${isCustom ? '' : ', preset, not editable'}`;
}

/** The DOM id of a keyframe option — what aria-activedescendant points at. */
export function keyframeOptionId(property: AnimatableProperty, index: number): string {
  return `kf-${property}-${index}`;
}

interface KeyframeGraphKeyboardOptions {
  property: AnimatableProperty;
  /** Every keyframe drawn on the graph, presets included, sorted by time. */
  keyframes: Keyframe[];
  isCustomKeyframe: (kf: Keyframe) => boolean;
  /** The selected keyframe, when it is one the user can edit. */
  selectedKeyframe: Keyframe | undefined;
  setSelectedKeyframeTime: Dispatch<SetStateAction<number | null>>;
  onDeleteKeyframe?: (property: AnimatableProperty, time: number) => void;
}

/**
 * The keyframe graph's keyboard surface: which option is active, and what every
 * key the graph claims does to it. Lives beside the component rather than in it
 * so the graph's render stays about drawing.
 */
export function useKeyframeGraphKeyboard({
  property,
  keyframes,
  isCustomKeyframe,
  selectedKeyframe,
  setSelectedKeyframeTime,
  onDeleteKeyframe,
}: KeyframeGraphKeyboardOptions) {
  // The listbox's active descendant, tracked by time rather than by index
  // because the keyframe array is sorted by time — a time nudge re-sorts it and
  // an index would then address a different keyframe. Unlike
  // selectedKeyframeTime this may address a *preset* keyframe, so a keyboard or
  // screen-reader user can walk the whole curve; selection still follows it only
  // for the custom ones.
  const [activeTime, setActiveTime] = useState<number | null>(null);

  // The active descendant, resolved back to a position in the sorted array.
  // -1 means "no active option", which is also what the arrow keys step from.
  const activeIndex = activeTime === null
    ? -1
    : keyframes.findIndex(kf => Math.abs(kf.time - activeTime) < 0.001);
  const activeId = activeIndex === -1 ? undefined : keyframeOptionId(property, activeIndex);

  // Move the active option, and take the selection with it when the keyframe is
  // one the user can edit — single-select follow-focus, the APG listbox default
  // and the model the easing control assumes. Landing on a preset clears the
  // selection instead, because a preset is never editable.
  const activateIndex = useCallback((index: number) => {
    const kf = keyframes[index];
    if (!kf) return;
    setActiveTime(kf.time);
    setSelectedKeyframeTime(isCustomKeyframe(kf) ? kf.time : null);
  }, [keyframes, isCustomKeyframe, setSelectedKeyframeTime]);

  // The propagation contract, in one place.
  //
  // While the graph has focus it owns its own keys. React attaches its listener
  // at the root container, which sits *below* `window`, so stopPropagation() on
  // the synthetic event stops the native one before either of the editor's
  // window-level cascades (app/useAppKeyboardShortcuts.ts and
  // Preview/PlaybackControls.tsx) can see it.
  //
  //   * ArrowLeft/Right/Up/Down, Home, End and Enter are claimed
  //     unconditionally — a focused listbox owning its arrows is what a user
  //     expects, and an unconditional claim is one fewer branch to get wrong.
  //   * Delete/Backspace and Escape are claimed whenever an option is active —
  //     including a preset, which is announced as the selected option and would
  //     otherwise let the editor delete the whole clip two keystrokes into the
  //     graph. They only *act* on a custom keyframe. With nothing active they
  //     are not claimed at all, so Delete still reaches the editor's "delete the
  //     selected clip" shortcut: the bug (ESCSUITE-49) was that both fired at
  //     once, not that the editor's one fires at all.
  //   * Everything else — Tab, Space, '?', letters — falls through untouched, so
  //     the shortcut sheet, play/pause and tool switching still work from here.
  const handleKeyDown = useCallback((e: ReactKeyboardEvent<SVGSVGElement>) => {
    const key = e.key;

    if (
      key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' ||
      key === 'ArrowDown' || key === 'Home' || key === 'End' || key === 'Enter'
    ) {
      e.preventDefault();
      e.stopPropagation();
      const last = keyframes.length - 1;
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        // Neither arrow wraps; from -1 ("nothing active") either lands on the
        // first keyframe.
        const next = activeIndex + (key === 'ArrowRight' ? 1 : -1);
        activateIndex(Math.max(0, Math.min(next, last)));
      } else if (key === 'Home') {
        activateIndex(0);
      } else if (key === 'End') {
        activateIndex(last);
      }
      return;
    }

    if ((key === 'Delete' || key === 'Backspace') && activeTime !== null) {
      e.preventDefault();
      e.stopPropagation();
      // Only a custom keyframe can be deleted; on a preset the key is swallowed
      // and nothing happens.
      if (selectedKeyframe && onDeleteKeyframe) {
        onDeleteKeyframe(property, selectedKeyframe.time);
        setActiveTime(null);
        setSelectedKeyframeTime(null);
      }
      return;
    }

    if (key === 'Escape' && activeTime !== null) {
      e.preventDefault();
      e.stopPropagation();
      setActiveTime(null);
      setSelectedKeyframeTime(null);
    }
  }, [
    keyframes.length,
    activeIndex,
    activateIndex,
    activeTime,
    selectedKeyframe,
    setSelectedKeyframeTime,
    onDeleteKeyframe,
    property,
  ]);

  return { activeIndex, activeId, setActiveTime, onKeyDown: handleKeyDown };
}
