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
// clamps `newTime` *before* the snap check runs, through
// `utils/keyframeClamp.ts` — the same two functions the graph's own point drag
// calls, so the numeric decision cannot be right in one drag and wrong in the
// other (review of ESCSUITE-183, finding 3). The point stops at the edge of
// the forbidden window on the side the pointer approached from, rather than
// following the pointer into the zone and having the drop refused on release:
// the shape ESCSUITE-88 ruled against for a locked track's own drag. A move
// the clamp cannot place at all — a cluster whose merged window covers the
// whole clip — is ignored, the diamond staying where it is, so there is no
// landing left for a release-time check to refuse and the old one was
// deleted rather than kept unreachable. The playhead snap still runs after
// the clamp, and only onto a playhead the same windows say is legal, so it
// cannot undo the clamp's work. The occupied windows themselves are built
// once, on `startDrag`, into `occupiedWindowsRef` (review round 1, MINOR 2)
// rather than on every pointer move: the keyframe array cannot change
// mid-drag (nothing writes to the store between mousedown and mouseup), so
// recomputing — and reallocating — them per move bought nothing, and
// `clampToLegalTime` itself allocates nothing at all.
//
// **What it reports is forwarded, not displayed** (review round 1, MAJOR 1
// + MINOR 6). This hook has no live region of its own: it reports to the
// `onAnnounce` callback it is handed, and since ESCSUITE-183 the only thing it
// has to say is `''` — nothing — the moment a drop lands, because a mouse drag
// can no longer produce a refusal to announce. `KeyframePanel` owns the one
// `role="status"` every property row's drag shares (only one diamond on one
// row can ever be dragging at a time), and the occupied-time refusal itself is
// now the keyboard's alone: `nudgeTime` has no pointer position to clamp, so
// it still refuses and still says so.
import { useState, useCallback, useRef } from 'react';
import type { Keyframe, AnimatableProperty } from '../../../store/types';
import { KEYFRAME_TIME_EPSILON } from '../../../utils/animation';
import {
  clampToLegalTime,
  occupiedWindows,
  type OccupiedWindow,
} from '../../../utils/keyframeClamp';
import { useWindowListener } from '../../../hooks/useDocumentListener';

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
   * Told `''` — "nothing to report" — once a drop lands. Since ESCSUITE-183 a
   * mouse drag has nothing else it can say: the clamp makes every landing a
   * legal one, so the refusal this used to carry is gone. The caller
   * (ultimately `KeyframePanel`) owns the live region it writes into.
   */
  onAnnounce: (text: string) => void
) {
  const [dragState, setDragState] = useState<DragState>(IDLE_DRAG_STATE);
  /** The live gesture, written synchronously so the handlers never read a frame-old value. */
  const dragRef = useRef<DragState>(dragState);
  /**
   * The forbidden windows around every occupied time but the one being
   * dragged, built once per gesture (see the file header).
   */
  const occupiedWindowsRef = useRef<readonly OccupiedWindow[]>([]);

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
    occupiedWindowsRef.current = occupiedWindows(
      allKeyframeTimes.filter(t => Math.abs(t - keyframe.time) >= KEYFRAME_TIME_EPSILON)
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

    // Snap to the playhead, unless it sits inside a forbidden window: snapping
    // there would be indistinguishable from snapping onto the keyframe that
    // makes it forbidden, and would undo the clamp that just ran. Asked of the
    // same windows the clamp uses rather than of a second, differently-worded
    // test of the same thing — a time the clamp leaves alone is a legal one.
    const playheadIsLegal =
      clampToLegalTime(playheadTime, playheadTime, occupiedWindowsRef.current, 0, clipDuration)
        === playheadTime;
    if (playheadIsLegal && Math.abs(time - playheadTime) < timeThreshold) {
      return playheadTime;
    }

    // Other keyframes are deliberately not snap targets (ESCSUITE-167 / M6):
    // snapping onto one is exactly the destructive case the clamp above exists
    // to make unreachable.

    return null;
  };

  const handleMouseMove = (e: MouseEvent) => {
    const track = trackRef.current;
    if (!track) return;
    const drag = dragRef.current;

    const rect = track.getBoundingClientRect();
    const relativeX = e.clientX - rect.left;
    const pointerTime = pixelsToTime(relativeX, rect.width);

    // Where the pointer is allowed to put the diamond (ESCSUITE-183), decided
    // against the once-per-gesture windows and the clip's own bounds together,
    // with the gesture's previous position saying which way it is travelling.
    // `null` means this clip has no legal time at all: ignore the move rather
    // than show the point somewhere it cannot be dropped.
    let newTime = clampToLegalTime(
      pointerTime,
      drag.currentTime,
      occupiedWindowsRef.current,
      0,
      clipDuration
    );
    if (newTime === null) return;

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
    // No occupied check here (ESCSUITE-183): `handleMouseMove`'s clamp only
    // ever writes a legal time, and ignores the move outright when there is
    // none, so `currentTime` cannot be inside a forbidden window by the time
    // the mouse comes up. The release-time refusal this used to carry had no
    // reachable caller left and was deleted rather than kept and tested
    // through a path nothing can take; the occupied-time refusal lives on in
    // `useKeyframeGraphKeyboard.ts`'s `nudgeTime`, whose entry point has no
    // pointer position to clamp.
    if (drag.property && drag.currentTime !== drag.originalTime) {
      onKeyframeMoved(drag.property, drag.originalTime, drag.currentTime);
      // A landed drop has nothing to report — since ESCSUITE-183 that is the
      // only thing this hook reports.
      onAnnounce('');
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
