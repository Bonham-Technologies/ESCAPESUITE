// One typing burst, or one sweep of a colour picker, is one undo step
// (ESCSUITE-242).
//
// The caption textarea, the font-size field and the inspector's colour pickers
// write on every event: a keystroke, a spinner step, every position an
// `<input type="color">` reports while the user sweeps it. Each write used to
// push an undo entry, so typing a caption in full — or one sweep of a picker —
// filled the 50-entry `MAX_HISTORY_SIZE` stack with its own intermediate values
// and evicted everything the user had done before it.
//
// The rule is `useSliderGesture`'s (ESCSUITE-75/87), over the same
// `hooks/useGestureHistory.ts`: the burst's **first** write pushes, so the entry
// snapshots the state before the burst, and every write after it passes
// `skipHistory`. What differs is where a burst ends. A slider drag is bounded by
// the pointer or the key; typing and a picker sweep are not — a picker opens on
// the press and reports after the release, and keystrokes have no gesture around
// them — so a burst opens on its first edit and closes on whichever comes first
// of:
//   * `blur` — the user left the control (the inline text editor commits on
//     blur for the same reason);
//   * `BURST_PAUSE_MS` with no edit — a typist who stops and starts again has
//     made two edits, and a browser that reports a picker as one `change` per
//     step still coalesces into one sweep;
//   * unmount — the timer is cleared and the scope ended, so nothing outlives
//     the panel (ESCSUITE-120's lesson).
//
// It does not close on the picker's own closing `change`: the control's React
// `onChange` already fires on every `input`, and React's value tracker drops the
// native `change` that follows, because it carries the value the last `input`
// already reported — so it never reaches a handler. The pause and the blur are
// what end a sweep.
//
// `onEdit` is called from inside each control's `onChange`, immediately before
// its write, rather than spread as an `onInput` listener: that way the burst is
// open at the moment of the write however the browser — or a test — delivered
// the edit, with no reliance on the order React dispatches `onInput` and
// `onChange` for one native event.
//
// Its history is its own, separate from the panel's slider gesture, and the two
// are composed at the write (`useClipEditorActions`' `commitEdit`): a blur that
// closes a burst therefore never closes a slider drag the same press opened.
//
// No React state and no store subscription — a ref holding the pending timer,
// and the gesture history — so a control wired to it adds no render:
// `ClipEditor.rerender.test.tsx` is unchanged by design.
import { useEffect, useMemo, useRef } from 'react';
import { useGestureHistory } from '../../hooks';
import type { GestureHistory } from '../../hooks';

/**
 * How long a burst waits for the next edit before it closes, in milliseconds.
 *
 * 600 ms is longer than the gap between two keystrokes of anyone typing a word
 * (and than the interval a picker reports at while it is being swept), and
 * shorter than the pause of a user who has stopped to read what they wrote —
 * so a word, a phrase or a sweep is one undo step, and coming back to the field
 * after a moment's thought is a second one.
 */
export const BURST_PAUSE_MS = 600;

/** What a burst-coalesced control calls; not spread onto it as DOM listeners. */
export interface BurstGestureHandlers {
  /** An edit is about to be written: open the burst if none is open, and restart its pause. */
  onEdit: () => void;
  /** The control lost focus: the burst, if one is open, is over. */
  onBlur: () => void;
}

export interface BurstGesture {
  /** Handed to every control whose writes should coalesce into one burst. */
  handlers: BurstGestureHandlers;
  /** Run one store write inside the burst — `useGestureHistory`'s `commit`. */
  commit: GestureHistory['commit'];
}

/** Turn a run of edits to one control into one undo entry. */
export function useBurstGesture(): BurstGesture {
  const history = useGestureHistory();
  // The pending pause. `undefined` exactly when no burst is open, so it doubles
  // as the "is a burst open?" bit: every edit inside a burst re-arms it, and
  // every way a burst ends clears it.
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handlers = useMemo<BurstGestureHandlers>(() => {
    const close = () => {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
      history.end();
    };
    return {
      onEdit: () => {
        // A repeat edit continues the open burst: it must not `begin()` again,
        // or every keystroke would push an entry of its own.
        if (timerRef.current === undefined) history.begin();
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(close, BURST_PAUSE_MS);
      },
      onBlur: close,
    };
  }, [history]);

  // Unmount ends the scope and clears the timer, so no pause fires into a
  // panel that has gone.
  useEffect(() => handlers.onBlur, [handlers]);

  return { handlers, commit: history.commit };
}
