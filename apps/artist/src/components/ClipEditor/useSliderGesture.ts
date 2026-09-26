// One drag of an inspector slider is one undo step (ESCSUITE-75).
//
// A range input writes on every `input` event: dragging the blur slider from 0
// to 50 in steps of 0.5 is about a hundred writes, and each of them used to
// push an undo entry — so one drag filled the whole 50-entry history stack with
// its own intermediate values, evicted everything the user had done before it,
// and left Ctrl+Z stepping back half a pixel at a time. It also paid a
// full-project `structuredClone` per entry.
//
// The fix is ESCSUITE-52's, which did the same job for a transform drag in the
// preview (`Preview/useTransformHandles.ts`): the **first** write of a gesture
// goes through unskipped — so `pushToHistory` snapshots the state as it was
// before the drag — and every write after it passes `skipHistory`. Nothing
// extra happens on release, so a gesture that is abandoned mid-drag is already
// undoable to where it started.
//
// This hook is the gesture, and nothing else: two refs and the five listeners
// that flip them. It holds no state, so a slider wired to it adds no store
// subscription and no render — `ClipEditor.rerender.test.tsx`'s counts are
// unchanged by design, not by luck.
import { useCallback, useMemo, useRef } from 'react';

/**
 * The listeners to spread onto an `<input type="range">`, so the hook can see
 * where one gesture stops and the next begins.
 *
 * Deliberately typed against the property each one reads rather than against
 * React's event types: it keeps the hook testable without a DOM, and parameter
 * contravariance still makes the object assignable to an input's props.
 */
export interface SliderGestureHandlers {
  onPointerDown: () => void;
  onPointerUp: () => void;
  onKeyDown: (event: { repeat: boolean }) => void;
  onKeyUp: () => void;
  onBlur: () => void;
}

export interface SliderGesture {
  /** Spread onto every slider whose writes should coalesce into one undo step. */
  handlers: SliderGestureHandlers;
  /**
   * The `skipHistory` flag for the write that is about to happen: `false` for
   * the first write of a gesture, `true` for every write after it, and `false`
   * for a write that belongs to no gesture at all (a click on the slider's
   * track, or a value set from code) — those keep their own undo entry, exactly
   * as before this hook existed.
   *
   * Call it once per write, at the point the write happens: it is what marks
   * the gesture as having pushed.
   */
  skipHistoryForWrite: () => boolean;
}

/**
 * Turn a run of slider writes into one undo entry.
 *
 * A gesture opens on `pointerdown` or `keydown` and closes on `pointerup`,
 * `keyup` or `blur`. A **held** arrow key is one gesture, not one per
 * repetition: the browser fires `keydown` over and over while the key is down,
 * every repetition after the first carrying `repeat: true`, and a repeat leaves
 * the open gesture exactly as it is (the same rule the keyframe drags took in
 * #373).
 */
export function useSliderGesture(): SliderGesture {
  // Refs, not state: these are read and written by DOM listeners and at write
  // time, never rendered, and a re-render of the whole inspector per pointer
  // move is the cost this hook exists to avoid.
  const activeRef = useRef(false);
  const pushedRef = useRef(false);

  const skipHistoryForWrite = useCallback((): boolean => {
    if (!activeRef.current) return false;
    if (pushedRef.current) return true;
    pushedRef.current = true;
    return false;
  }, []);

  const handlers = useMemo<SliderGestureHandlers>(() => {
    const begin = () => {
      activeRef.current = true;
      pushedRef.current = false;
    };
    const end = () => {
      activeRef.current = false;
      pushedRef.current = false;
    };
    return {
      onPointerDown: begin,
      onPointerUp: end,
      onKeyDown: (event) => {
        // A repetition of a key that is already down continues the gesture it
        // started; it must not reopen it, or a held arrow would push an entry
        // per repeat.
        if (event.repeat) {
          activeRef.current = true;
          return;
        }
        begin();
      },
      onKeyUp: end,
      onBlur: end,
    };
  }, []);

  return { handlers, skipHistoryForWrite };
}
