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
// **A drop never lands on top of a neighbour** (ESCSUITE-167 / M6).
// `moveClipKeyframe` deletes whatever already sits within
// `KEYFRAME_TIME_EPSILON` of the target — the same reason
// `useKeyframeGraphKeyboard.ts`'s `nudgeTime` refuses a keyboard move onto an
// occupied time — but this drag used to *aim* for one: `findSnapTime` offered
// every other keyframe's time, and the playhead, as snap targets regardless of
// what already lived there. Snapping onto a neighbour, or onto the playhead
// where one sits, silently destroyed it. Occupied times are excluded from the
// snap candidates now (the playhead stays a target unless a keyframe already
// sits on it), and `handleMouseUp` refuses the drop outright — leaving the
// keyframe at its original time and pushing nothing — if the final position
// still lands within epsilon of one, which a pixel-exact coincidence could
// reach without ever touching the snap logic. The occupied-times list itself
// is computed once, on `startDrag`, into `occupiedTimesRef` (review round 1,
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
        // Refuse: the keyframe stays where it was, nothing is pushed to the
        // undo stack, and the live region says why — the same refusal
        // `nudgeTime` makes for the identical keyboard case.
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
