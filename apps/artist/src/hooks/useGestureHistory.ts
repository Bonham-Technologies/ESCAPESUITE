// One gesture, one undo entry — and the entry follows the write that LANDED.
//
// Two gestures in this app write to the store many times over and owe the undo
// stack exactly one entry between them: the inspector's sliders
// (`ClipEditor/useSliderGesture.ts`, ESCSUITE-75) and a transform drag on the
// preview canvas (`Preview/useTransformHandles.ts`, ESCSUITE-52). A trim does
// the same (`Timeline/useTrimDrag.ts`, ESCSUITE-77). The rule all three follow
// is that the gesture's **first** write goes through unskipped — `pushToHistory`
// snapshots the state it is handed, so only a write that has not happened yet
// leaves the pre-gesture state on the stack — and every write after it passes
// `skipHistory`.
//
// Each of them used to keep that "have I pushed yet?" bit itself, and each
// assumed its first write landed. Since ESCSUITE-84 it may not: a clip whose
// track is locked refuses the write, changing no state and pushing no entry. A
// gesture that had already marked itself pushed would then hand `skipHistory` to
// the write that *did* land — a row unlocked mid-drag, say — and the whole
// gesture would leave nothing on the undo stack at all.
//
// ESCSUITE-87 is the fix, and it is one mechanism rather than three: the store
// actions those gestures call now report whether they wrote, and `commit` below
// runs one write, hands it the flag the gesture owes it, and takes the mark back
// if the write says it was refused. A gesture is then "one entry, pushed by the
// first write that actually happened" — which is what the rule always meant.
//
// No React state and no store subscription: the whole thing is two booleans in a
// closure, read and written from DOM listeners and from inside throttled
// updaters, and never rendered.
import { useRef } from 'react';

/** The "have I pushed this gesture's undo entry yet?" bit, and its writes. */
export interface GestureHistory {
  /** A gesture starts. It owes the undo stack one entry, which it has not pushed. */
  begin: () => void;
  /**
   * A gesture continues — an auto-repeat of a key that is still down, say.
   * Unlike `begin`, it does **not** forget whether the entry has been pushed:
   * a held arrow key is one undo step, not one per repetition. Called with no
   * gesture open it starts one, for a hold whose first press was never seen.
   */
  resume: () => void;
  /** A gesture ends. The next write belongs to no gesture and pushes its own entry. */
  end: () => void;
  /**
   * Run one store write inside the gesture.
   *
   * Hands it the `skipHistory` flag the gesture owes it — `false` for the
   * gesture's first write, `true` for the rest, `false` for a write that belongs
   * to no gesture at all — and, if the write reports it did not land, takes back
   * the "already pushed" mark so the gesture's undo entry follows the first
   * write that DOES land. Returns what the write returned.
   */
  commit: (write: (skipHistory: boolean) => boolean) => boolean;
}

/** A gesture history of its own, for a hook or a test to hold. */
export function createGestureHistory(): GestureHistory {
  /** Whether a gesture is open. */
  let active = false;
  /** Whether a write inside the open gesture has already pushed its entry. */
  let pushed = false;

  return {
    begin: () => {
      active = true;
      pushed = false;
    },
    resume: () => {
      active = true;
    },
    end: () => {
      active = false;
      pushed = false;
    },
    commit: (write) => {
      const skipHistory = active ? pushed : false;
      if (active && !pushed) pushed = true;

      const wrote = write(skipHistory);

      // Refused, and it was this write that was to push the gesture's entry:
      // hand the debt back, so the next write pushes instead. A *later* write
      // being refused changes nothing — it was skipping anyway, and the entry
      // an earlier write pushed is still there.
      if (!wrote && !skipHistory && active) pushed = false;

      return wrote;
    },
  };
}

/**
 * One gesture history for the life of the component.
 *
 * A ref rather than state: every read and write happens in a DOM listener or
 * inside a throttled updater, a re-render per pointer move is the cost these
 * gestures exist to avoid, and the identity has to hold still — the hooks hand
 * `commit` to memoised callbacks that take it as a dependency.
 */
export function useGestureHistory(): GestureHistory {
  const historyRef = useRef<GestureHistory | null>(null);
  historyRef.current ??= createGestureHistory();
  return historyRef.current;
}
