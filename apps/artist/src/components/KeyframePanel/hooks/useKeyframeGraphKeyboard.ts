import { useCallback, useState, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type SetStateAction } from 'react';
import type { AnimatableProperty, EasingType, Keyframe } from '../../../store/types';
import { interpolateKeyframes } from '../../../utils/animation';
import { EASING_TYPES } from '../../../utils/easingOptions';

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

// How far one arrow key moves a keyframe's value, in that property's own unit:
// a fraction of the canvas for x/y, a factor for the scales, degrees for
// rotation, 0-1 for opacity and volume, pixels for blur. Fine is roughly 1% of
// the useful range; coarse is the step a user reaches for when they know where
// they are going.
const NUDGE_STEPS: Record<AnimatableProperty, { fine: number; coarse: number }> = {
  x: { fine: 0.01, coarse: 0.1 },
  y: { fine: 0.01, coarse: 0.1 },
  scaleX: { fine: 0.01, coarse: 0.1 },
  scaleY: { fine: 0.01, coarse: 0.1 },
  rotation: { fine: 1, coarse: 15 },
  opacity: { fine: 0.01, coarse: 0.1 },
  blur: { fine: 1, coarse: 5 },
  volume: { fine: 0.01, coarse: 0.1 },
};

// How far Alt+Arrow moves a keyframe in time, in seconds. The fine step is ten
// times the graph's own 0.001s "same keyframe" tolerance, so one nudge can
// never land inside a neighbour; the coarse step is a tenth of the graph's
// one-second gridlines.
const TIME_NUDGE = { fine: 0.01, coarse: 0.1 };

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

/** What the live region says after a nudge or an add. */
function nudgeAnnouncement(property: AnimatableProperty, value: number, time: number): string {
  return `${PROPERTY_LABELS[property]} ${formatValue(value, property)} at ${time.toFixed(2)} seconds`;
}

interface KeyframeGraphKeyboardOptions {
  property: AnimatableProperty;
  /** Every keyframe drawn on the graph, presets included, sorted by time. */
  keyframes: Keyframe[];
  isCustomKeyframe: (kf: Keyframe) => boolean;
  /** The selected keyframe, when it is one the user can edit. */
  selectedKeyframe: Keyframe | undefined;
  setSelectedKeyframeTime: Dispatch<SetStateAction<number | null>>;
  clipDuration: number;
  playheadTime: number;
  /** The value the curve holds where there are no keyframes at all. */
  defaultValue: number;
  /** The property's value range — the same one the drag clamps to. */
  range: { min: number; max: number };
  onKeyframeMoved: (property: AnimatableProperty, originalTime: number, newTime: number) => void;
  onKeyframeValueChanged: (property: AnimatableProperty, time: number, newValue: number) => void;
  onAddKeyframe: (property: AnimatableProperty, time: number, value: number) => void;
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
  clipDuration,
  playheadTime,
  defaultValue,
  range,
  onKeyframeMoved,
  onKeyframeValueChanged,
  onAddKeyframe,
  onDeleteKeyframe,
}: KeyframeGraphKeyboardOptions) {
  // The listbox's active descendant, tracked by time rather than by index
  // because the keyframe array is sorted by time — a time nudge re-sorts it and
  // an index would then address a different keyframe. Unlike
  // selectedKeyframeTime this may address a *preset* keyframe, so a keyboard or
  // screen-reader user can walk the whole curve; selection still follows it only
  // for the custom ones.
  const [activeTime, setActiveTime] = useState<number | null>(null);

  // What the graph's live region is saying. Empty until the first edit: moving
  // the active option writes nothing here, because aria-activedescendant
  // already makes the AT read the option and announcing both double-speaks.
  const [nudgeMessage, setNudgeMessage] = useState('');

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

  // Nudge the selected keyframe's value. A preset is never selected, so this is
  // a no-op there and on an empty graph — the key is still the graph's.
  const nudgeValue = useCallback((direction: 1 | -1, coarse: boolean) => {
    if (!selectedKeyframe) return;
    const steps = NUDGE_STEPS[property];
    const step = coarse ? steps.coarse : steps.fine;
    // The drag's own clamp, so a nudge and a drag can never disagree about
    // where the top and bottom of the graph are.
    const newValue = Math.max(
      range.min,
      Math.min(selectedKeyframe.value + direction * step, range.max)
    );
    onKeyframeValueChanged(property, selectedKeyframe.time, newValue);
    setNudgeMessage(nudgeAnnouncement(property, newValue, selectedKeyframe.time));
  }, [selectedKeyframe, property, range, onKeyframeValueChanged]);

  // Nudge the selected keyframe along the time axis.
  const nudgeTime = useCallback((direction: 1 | -1, coarse: boolean) => {
    if (!selectedKeyframe) return;
    const step = coarse ? TIME_NUDGE.coarse : TIME_NUDGE.fine;
    // Again the drag's clamp: a keyframe never leaves the clip.
    const newTime = Math.max(0, Math.min(selectedKeyframe.time + direction * step, clipDuration));
    // moveClipKeyframe deletes whatever already sits within 0.001s of the
    // target, so a nudge onto a neighbour would silently destroy it. Refuse the
    // nudge instead — nothing moves, the live region says why, and the key is
    // still swallowed rather than falling through to the editor.
    // `keyframes` is every handle on the graph, presets included: landing on a
    // preset is refused too, because the store would merge the two all the same.
    const occupied = keyframes.some(kf =>
      Math.abs(kf.time - selectedKeyframe.time) >= 0.001 && Math.abs(kf.time - newTime) < 0.001
    );
    if (occupied) {
      setNudgeMessage(
        `${PROPERTY_LABELS[property]} keyframe not moved: another keyframe is at ${newTime.toFixed(2)} seconds`
      );
      return;
    }
    onKeyframeMoved(property, selectedKeyframe.time, newTime);
    // The keyframe lives at newTime now, so the active option and the selection
    // follow it — exactly what the drag's mouseup does.
    setActiveTime(newTime);
    setSelectedKeyframeTime(newTime);
    setNudgeMessage(nudgeAnnouncement(property, selectedKeyframe.value, newTime));
  }, [selectedKeyframe, keyframes, clipDuration, property, onKeyframeMoved, setSelectedKeyframeTime]);

  // Add a keyframe where the playhead is, at the value the curve already has
  // there, so the shape the user can see does not jump when they add to it.
  const addAtPlayhead = useCallback(() => {
    const time = Math.max(0, Math.min(playheadTime, clipDuration));
    const value = interpolateKeyframes(keyframes, playheadTime, defaultValue);
    onAddKeyframe(property, time, value);
    setActiveTime(time);
    setSelectedKeyframeTime(time);
    setNudgeMessage(nudgeAnnouncement(property, value, time));
  }, [playheadTime, clipDuration, keyframes, defaultValue, property, onAddKeyframe, setSelectedKeyframeTime]);

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
        const direction = key === 'ArrowRight' ? 1 : -1;
        if (e.altKey) {
          // Alt is the time modifier because the drag already means exactly
          // that (KeyframeGraph's mousedown reads e.altKey as 'time').
          nudgeTime(direction, e.shiftKey);
        } else {
          // Neither arrow wraps; from -1 ("nothing active") either lands on the
          // first keyframe.
          activateIndex(Math.max(0, Math.min(activeIndex + direction, last)));
        }
      } else if (key === 'ArrowUp' || key === 'ArrowDown') {
        nudgeValue(key === 'ArrowUp' ? 1 : -1, e.shiftKey);
      } else if (key === 'Home') {
        activateIndex(0);
      } else if (key === 'End') {
        activateIndex(last);
      } else {
        // Enter: the only key the guard above lets through to here. An
        // `else if` would add a branch nothing can ever take.
        addAtPlayhead();
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
        setNudgeMessage(
          `${PROPERTY_LABELS[property]} keyframe at ${selectedKeyframe.time.toFixed(2)} seconds deleted`
        );
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
    nudgeValue,
    nudgeTime,
    addAtPlayhead,
    activeTime,
    selectedKeyframe,
    setSelectedKeyframeTime,
    onDeleteKeyframe,
    property,
  ]);

  return { activeIndex, activeId, setActiveTime, nudgeMessage, onKeyDown: handleKeyDown };
}
