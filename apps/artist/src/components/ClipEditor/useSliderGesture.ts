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
// **The bit that remembers all that is not here.** It is
// `hooks/useGestureHistory.ts`, shared with the preview's transform drag and the
// timeline's trim (ESCSUITE-87), and the reason it moved out is that "the first
// write pushes" has to mean the first write that *landed*: a clip on a locked
// track refuses the write and pushes nothing, so a gesture that marked itself
// pushed anyway would hand `skipHistory` to the write that did land and leave
// the whole drag off the undo stack. `commit` runs the write, hands it the flag
// and takes the mark back if the store says it was refused.
//
// One difference from `useTransformHandles` is worth knowing: there, the writes
// are throttled to an animation frame, so `commit` has to be called inside the
// updater the throttler runs rather than at the pointer move that schedules one.
// A slider's writes are synchronous — the `input` event calls the handler, which
// writes — so "decide at the call" and "decide at the write" are the same moment
// here, and `commit` can wrap the write in the handler itself. A future throttle
// on these writes would move it, not delete it.
//
// This hook is the gesture, and nothing else: one gesture history and the six
// listeners that drive it. It holds no state, so a slider wired to it adds no
// store subscription and no render — `ClipEditor.rerender.test.tsx`'s counts are
// unchanged by design, not by luck.
import { useMemo, useRef } from 'react';
import { useGestureHistory } from '../../hooks';

/**
 * The keys a native `<input type="range">` actually acts on. `onKeyDown` used
 * to call `begin()` for ANY non-repeat key, Shift included, and `onKeyUp`
 * `end()`d for any key — so tapping Shift mid-drag (to hold an aspect lock
 * elsewhere in the app, say) reset the "have I pushed?" flag and then closed
 * the gesture the pointer was still driving (ESCSUITE-169). Mirrors
 * `Preview/useCropHandleGesture.ts`'s `ARROW_STEPS` filter on its own keydown.
 */
const RANGE_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown',
]);

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
  /**
   * A touch or pen gesture the browser took away — a scroll took over, the pen
   * left range — which gets no `pointerup` of its own. Without it the gesture
   * stayed open with its entry already pushed, and the next write swallowed its
   * own undo entry.
   */
  onPointerCancel: () => void;
  onKeyDown: (event: { repeat: boolean; key: string }) => void;
  onKeyUp: (event: { key: string }) => void;
  onBlur: () => void;
}

export interface SliderGesture {
  /** Spread onto every slider whose writes should coalesce into one undo step. */
  handlers: SliderGestureHandlers;
  /**
   * Run one store write inside the gesture. Hands it the `skipHistory` flag the
   * gesture owes it — `false` for the first write of a gesture, `true` for every
   * write after it, and `false` for a write that belongs to no gesture at all (a
   * click on the slider's track, or a value set from code), which keeps its own
   * undo entry exactly as before this hook existed — and, if the write reports
   * it did not land, takes back the "already pushed" mark so the gesture's undo
   * entry follows the first write that DOES land. Returns what the write
   * returned.
   *
   * Call it once per write, at the point the write happens: it is what marks the
   * gesture as having pushed.
   */
  commit: (write: (skipHistory: boolean) => boolean) => boolean;
}

/**
 * Turn a run of slider writes into one undo entry.
 *
 * A gesture opens on `pointerdown` or `keydown` and closes on `pointerup`,
 * `pointercancel`, `keyup` or `blur`. A **held** arrow key is one gesture, not one per
 * repetition: the browser fires `keydown` over and over while the key is down,
 * every repetition after the first carrying `repeat: true`, and a repeat leaves
 * the open gesture exactly as it is (the same rule the keyframe drags took in
 * #373).
 *
 * The keyboard side only ever acts on a key the slider itself responds to
 * (`RANGE_KEYS`), and only while no pointer drag already owns the gesture
 * (ESCSUITE-169): a key reaching the input mid-drag — Shift, chiefly — must
 * neither reopen the "have I pushed?" flag on its keydown nor close the
 * pointer's own gesture on its keyup. `onBlur` carries neither guard: unlike
 * `Preview/useCropHandleGesture.ts`'s mouse drag, which has its own document
 * listeners standing by to supply the eventual `mouseup` regardless of focus,
 * a slider's pointer drag has no such backstop — blur IS the substitute for a
 * `pointerup` that may never come — so it closes whatever is open regardless
 * of key or pointer state.
 */
export function useSliderGesture(): SliderGesture {
  // Not state: this is read and written by DOM listeners and at write time,
  // never rendered, and a re-render of the whole inspector per pointer move is
  // the cost this hook exists to avoid.
  const history = useGestureHistory();
  /** Whether a pointer drag is open — see the keyboard guard above. */
  const pointerDownRef = useRef(false);

  const handlers = useMemo<SliderGestureHandlers>(() => ({
    onPointerDown: () => {
      pointerDownRef.current = true;
      history.begin();
    },
    onPointerUp: () => {
      pointerDownRef.current = false;
      history.end();
    },
    onPointerCancel: () => {
      pointerDownRef.current = false;
      history.end();
    },
    onKeyDown: (event) => {
      if (pointerDownRef.current) return;
      if (!RANGE_KEYS.has(event.key)) return;
      // A repetition of a key that is already down continues the gesture it
      // started; it must not reopen it, or a held arrow would push an entry
      // per repeat.
      if (event.repeat) {
        history.resume();
        return;
      }
      history.begin();
    },
    onKeyUp: (event) => {
      if (pointerDownRef.current) return;
      if (!RANGE_KEYS.has(event.key)) return;
      history.end();
    },
    onBlur: history.end,
  }), [history]);

  return { handlers, commit: history.commit };
}
