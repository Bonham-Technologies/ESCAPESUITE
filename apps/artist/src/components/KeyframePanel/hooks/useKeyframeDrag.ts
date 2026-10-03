// Dragging a keyframe diamond along one property's row in the panel.
//
// **One listener pair per gesture, not per pointer frame** (ESCSUITE-167 /
// m4). The pair used to be rebound on every mousemove — `dragState.currentTime`
// (and `findSnapTime`, which depends on it) sat in the effect's deps — exactly
// the churn the five timeline gesture hooks were moved off of
// (`components/Timeline/useClipDrag.ts`, `useTrimDrag.ts`, pinned at
// `components/Timeline/timelineGestures.perf.test.ts`). The live drag now lives
// in `dragRef`, written synchronously on every move and read by the handlers,
// and `useWindowListener`'s `enabled` flag — `dragState.isDragging`, which
// flips twice a gesture — is what binds and unbinds the pair. The handlers
// themselves are still rebuilt on every render (plain functions, not
// `useCallback`), the same as `useClipDrag`'s and `useTrimDrag`'s: a fresh
// closure every render costs nothing, because what decides whether the DOM
// listener itself is touched is `enabled`, not the handler's identity.
// Neither handler re-checks `dragRef.current.isDragging` (review round 1,
// MINOR 3): the pair exists only while it is true, `handleMouseUp` clears
// `dragRef` synchronously with the state write that unbinds it, and a stray
// event in the narrow window between (same-batch delivery) would write
// `{ ...IDLE_DRAG_STATE, currentTime }` — `isDragging: false` draws nothing
// and the next `startDrag` overwrites it — so the guard had nothing left to
// reach from its early-return side.
//
// **The point cannot be dragged into a neighbour's epsilon window at all**
// (ESCSUITE-167 / M6, reworked by ESCSUITE-183). `moveClipKeyframe` deletes
// whatever already sits within `KEYFRAME_TIME_EPSILON` of the target — the
// same reason `useKeyframeGraphKeyboard.ts`'s `nudgeTime` refuses a keyboard
// move onto an occupied time — but this drag used to *aim* for one:
// `findSnapTime` offered every other keyframe's time, and the playhead, as
// snap targets regardless of what already lived there. Snapping onto a
// neighbour, or onto the playhead where one sits, silently destroyed it.
// Occupied times are excluded from the snap candidates (the playhead stays a
// target unless a keyframe already sits on it), and `handleMouseMove` now
// clamps `newTime` *before* the snap check runs — approaching from the left
// stops at `occupied - EPSILON`, from the right at `occupied + EPSILON` —
// rather than letting the diamond follow the pointer into the forbidden zone
// and refusing the drop on release, the shape ESCSUITE-88 ruled against for
// a locked track's own drag. The playhead snap still runs after the clamp,
// so it can still pull the (already-clamped) point the rest of the way onto
// the playhead when that is within the snap threshold. `handleMouseUp`'s own
// occupied check is kept as a backstop rather than deleted — it is the same
// test `nudgeTime` makes for the keyboard's different entry point, and this
// hook's own tests show it is no longer reachable by a mouse drag now that
// the clamp runs on every move first. The occupied-times list itself is
// computed once, on `startDrag`, into `occupiedTimesRef` (review round 1,
// MINOR 2) rather than on every pointer move: the keyframe array cannot
// change mid-drag (nothing writes to the store between mousedown and
// mouseup), so recomputing — and reallocating — it per move bought nothing.
//
// **The refusal's text is forwarded, not displayed** (review round 1, MAJOR 1
// + MINOR 6). This hook has no live region of its own: it reports the raw
// message to the `onAnnounce` callback it is handed, and clears it (`''`) the
// moment a drop actually lands, so a stale refusal from an earlier attempt in
// the same row does not linger once the user succeeds. `KeyframePanel` is the
// one that owns the displayed state and the alternation that makes a second,
// textually identical refusal audible — `announceWithMark`, shared with
// `useKeyframeGraphKeyboard.ts`'s own `announce` rather than a third
// hand-rolled copy of the same mechanism. The text itself still comes from
// `occupiedTimeMessage`, so the two refusals — this drag's and the graph
// keyboard's `nudgeTime` — read identically wherever the user meets them.
import { useState, useCallback, useRef } from 'react';
import type { Keyframe, AnimatableProperty } from '../../../store/types';
import { KEYFRAME_TIME_EPSILON } from '../../../utils/animation';
import { useWindowListener } from '../../../hooks/useDocumentListener';
import { occupiedTimeMessage } from './useKeyframeGraphKeyboard';

interface DragState {
  isDragging: boolean;
  keyframe: Keyframe | null;
  property: AnimatableProperty | null;
  originalTime: number;
  currentTime: number;
}

const SNAP_THRESHOLD_PX = 5;

/**
 * A hair past `KEYFRAME_TIME_EPSILON` itself, so the clamped landing clears
 * the backstop's own `< KEYFRAME_TIME_EPSILON` check with room to spare.
 * `occupiedTime ± KEYFRAME_TIME_EPSILON` lands exactly on the window's edge
 * in exact arithmetic, but floating point does not always agree — e.g.
 * `Math.abs(3 - (3 + 0.001))` comes back `0.0009999999999998899`, which IS
 * `< 0.001`, so the exact boundary occasionally reads as still-occupied and
 * the backstop (correctly, on its own terms) refuses a landing the clamp
 * meant to allow. Nine orders of magnitude below the epsilon it rides on, so
 * it never changes which times are "near" one another, including in the
 * handful of tests that pin an exact clamped value with `toBeCloseTo`.
 */
const CLAMP_MARGIN = 1e-9;

const IDLE_DRAG_STATE: DragState = {
  isDragging: false,
  keyframe: null,
  property: null,
  originalTime: 0,
  currentTime: 0,
};

export function useKeyframeDrag(
  clipDuration: number,
  playheadTime: number,
  allKeyframeTimes: number[],
  onKeyframeMoved: (property: AnimatableProperty, originalTime: number, newTime: number) => void,
  /**
   * Told the raw refusal text (`occupiedTimeMessage`'s own string, no mark),
   * or `''` once a drop lands — see the file header. The caller (ultimately
   * `KeyframePanel`) owns the live region and the re-read alternation.
   */
  onAnnounce: (text: string) => void
) {
  const [dragState, setDragState] = useState<DragState>(IDLE_DRAG_STATE);
  /** The live gesture, written synchronously so the handlers never read a frame-old value. */
  const dragRef = useRef<DragState>(dragState);
  /** Every occupied time but the one being dragged, snapshotted once per gesture. */
  const occupiedTimesRef = useRef<number[]>([]);

  const trackRef = useRef<HTMLDivElement | null>(null);

  const startDrag = useCallback((
    property: AnimatableProperty,
    keyframe: Keyframe,
    e: React.MouseEvent
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const next: DragState = {
      isDragging: true,
      keyframe,
      property,
      originalTime: keyframe.time,
      currentTime: keyframe.time,
    };
    dragRef.current = next;
    occupiedTimesRef.current = allKeyframeTimes.filter(
      t => Math.abs(t - keyframe.time) >= KEYFRAME_TIME_EPSILON
    );
    setDragState(next);
  }, [allKeyframeTimes]);

  const pixelsToTime = (pixelX: number, trackWidth: number): number => {
    const ratio = pixelX / trackWidth;
    return Math.max(0, Math.min(ratio * clipDuration, clipDuration));
  };

  const findSnapTime = (time: number, trackWidth: number): number | null => {
    const pixelThreshold = SNAP_THRESHOLD_PX;
    const timeThreshold = (pixelThreshold / trackWidth) * clipDuration;
    const occupied = occupiedTimesRef.current;

    // Snap to the playhead, unless a keyframe already sits there: that would
    // be indistinguishable from snapping onto the keyframe itself.
    const playheadOccupied = occupied.some(t => Math.abs(t - playheadTime) < KEYFRAME_TIME_EPSILON);
    if (!playheadOccupied && Math.abs(time - playheadTime) < timeThreshold) {
      return playheadTime;
    }

    // Other keyframes are deliberately not snap targets (ESCSUITE-167 / M6):
    // snapping onto one is exactly the destructive case `handleMouseUp` below
    // refuses outright.

    return null;
  };

  const handleMouseMove = (e: MouseEvent) => {
    const track = trackRef.current;
    if (!track) return;
    const drag = dragRef.current;

    const rect = track.getBoundingClientRect();
    const relativeX = e.clientX - rect.left;
    let newTime = pixelsToTime(relativeX, rect.width);

    // Clamp away from every neighbour's epsilon window before the snap check
    // runs (ESCSUITE-183): one pass over the once-per-gesture occupied list,
    // no allocation. Re-clamped to the clip bounds afterwards — a neighbour
    // sitting right at an edge could otherwise push the point just past it.
    for (const occupiedTime of occupiedTimesRef.current) {
      if (Math.abs(newTime - occupiedTime) < KEYFRAME_TIME_EPSILON) {
        newTime = newTime < occupiedTime
          ? occupiedTime - KEYFRAME_TIME_EPSILON - CLAMP_MARGIN
          : occupiedTime + KEYFRAME_TIME_EPSILON + CLAMP_MARGIN;
      }
    }
    newTime = Math.max(0, Math.min(newTime, clipDuration));

    const snapTime = findSnapTime(newTime, rect.width);
    if (snapTime !== null) {
      newTime = snapTime;
    }

    const next: DragState = { ...drag, currentTime: newTime };
    dragRef.current = next;
    setDragState(next);
  };

  const handleMouseUp = () => {
    const drag = dragRef.current;
    if (drag.property) {
      const occupied = occupiedTimesRef.current;
      const landsOnOccupied = occupied.some(t => Math.abs(t - drag.currentTime) < KEYFRAME_TIME_EPSILON);

      if (landsOnOccupied) {
        // Backstop, not the common case (ESCSUITE-183): `handleMouseMove`'s
        // clamp keeps `currentTime` out of every occupied window on every
        // move, so a mouse drag should never actually reach here — this
        // hook's own tests confirm it. Kept anyway as the same rule the
        // keyboard's `nudgeTime` enforces for its own, different entry point
        // (a key repeat can still ask for an occupied time directly, with no
        // pointer position to clamp). The keyframe stays where it was,
        // nothing is pushed to the undo stack, and the live region says why.
        onAnnounce(occupiedTimeMessage(drag.property, drag.currentTime));
      } else if (drag.currentTime !== drag.originalTime) {
        onKeyframeMoved(drag.property, drag.originalTime, drag.currentTime);
        // A landed move clears whatever refusal an earlier attempt in this
        // gesture's row left behind.
        onAnnounce('');
      }
    }

    dragRef.current = IDLE_DRAG_STATE;
    setDragState(IDLE_DRAG_STATE);
  };

  useWindowListener('mousemove', handleMouseMove, dragState.isDragging);
  useWindowListener('mouseup', handleMouseUp, dragState.isDragging);

  return {
    dragState,
    startDrag,
    trackRef,
  };
}
