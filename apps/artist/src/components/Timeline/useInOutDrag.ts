// Dragging the in and out point markers: the region the timeline exports.
//
// The two handles sit on the ruler but are dragged in the track container's
// coordinate space, the same one the playhead scrub uses — with the ruler as
// the fallback, because the markers are drawn there and can be grabbed before
// the track area exists.
//
// One effect serves both handles: a gesture is either an in-point drag or an
// out-point drag, never both, so the single pair of document listeners asks
// which flag is set to decide which point started the gesture. Release
// clears both, which is also why the flags cannot be collapsed into one — the
// effect has to know whether a gesture is running at all.
//
// Which point the gesture is *currently* writing can change mid-gesture
// (ESCSUITE-165): dragging the in handle rightward past the out point, left
// unordered, fed the pointer straight into the store's own swap-on-cross
// invariant (`setInPoint`/`setOutPoint`, `store/playbackSlice.ts`) on every
// single mousemove past the crossing, which re-swapped every time and
// collapsed the region to whatever one mousemove was wide — chasing the
// pointer instead of spanning from the stationary point to it. The ordering
// is done here instead: `draggedPointRef` names which point the pointer is
// currently moving, and at each move the *other* point's value is read live
// off `inPointRef`/`outPointRef` — mirrored from the caller's own `inPoint`/
// `outPoint` every render — rather than snapshotted once at mousedown. A
// snapshot would go stale the moment anything outside this gesture wrote the
// stationary point directly (the keyboard's I/O shortcuts, the Toolbar's
// in/out buttons both do), silently discarding that write the instant the
// drag crossed. Reading live means a crossing always uses whatever the
// store actually holds, the same as the store's own swap would have — and
// the write at the crossing instant is still explicit on both points, so
// that swap never has occasion to fire mid-drag.
import type * as React from 'react';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { clampTime, pointerTime } from './timelineGeometry';

/** What an in/out marker drag needs that it cannot reach on its own. */
export interface InOutDragDeps {
  /** The scrolling track area: the gesture's coordinate space. */
  trackContainerRef: RefObject<HTMLDivElement | null>;
  /** The ruler, used instead when there is no track area to measure against. */
  rulerRef: RefObject<HTMLDivElement | null>;
  /** Horizontal scale of the timeline, in pixels per second of media. */
  pixelsPerSecond: number;
  /** The project's duration — both points are clamped to it. */
  timelineDuration: number;
  /** The store's current in point — read live at each move while the out handle drags. */
  inPoint: number | null;
  /** The store's current out point — read live at each move while the in handle drags. */
  outPoint: number | null;
  setInPoint: (time: number) => void;
  setOutPoint: (time: number) => void;
}

/** The two handles' `onMouseDown`s. */
export interface InOutDrag {
  /** `onMouseDown` for the in point handle on the ruler. */
  handleInPointMouseDown: (e: React.MouseEvent) => void;
  /** `onMouseDown` for the out point handle on the ruler. */
  handleOutPointMouseDown: (e: React.MouseEvent) => void;
}

export function useInOutDrag({
  trackContainerRef,
  rulerRef,
  pixelsPerSecond,
  timelineDuration,
  inPoint,
  outPoint,
  setInPoint,
  setOutPoint,
}: InOutDragDeps): InOutDrag {
  const [isDraggingInPoint, setIsDraggingInPoint] = useState(false);
  const [isDraggingOutPoint, setIsDraggingOutPoint] = useState(false);

  // Mirrored every render (no effect — a drag never starts without a render
  // in between it and the props that fed it), so a mousedown handler built
  // once with useCallback still grabs the current value rather than a stale
  // closure over the point it was first mounted with.
  const inPointRef = useRef(inPoint);
  inPointRef.current = inPoint;
  const outPointRef = useRef(outPoint);
  outPointRef.current = outPoint;

  // Which point the gesture is currently writing. See the file comment for
  // why a ref rather than state — flipping it must never itself trigger a
  // re-render or re-bind the listeners below.
  const draggedPointRef = useRef<'in' | 'out'>('in');

  const handleInPointMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    draggedPointRef.current = 'in';
    setIsDraggingInPoint(true);
  }, []);

  const handleOutPointMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    draggedPointRef.current = 'out';
    setIsDraggingOutPoint(true);
  }, []);

  // Handle in/out point marker drag
  useEffect(() => {
    if (!isDraggingInPoint && !isDraggingOutPoint) return;

    const handleMouseMove = (e: MouseEvent) => {
      const ref = trackContainerRef.current || rulerRef.current;
      if (!ref) return;

      const rect = ref.getBoundingClientRect();
      const time = pointerTime(e.clientX, rect.left, ref.scrollLeft, pixelsPerSecond);
      const clampedTime = clampTime(time, timelineDuration);

      if (draggedPointRef.current === 'in') {
        // The out point as the store holds it *right now* — not whatever it
        // was when the in handle was grabbed — so a write from outside this
        // gesture (keyboard I/O, the Toolbar's in/out buttons) is what a
        // crossing sees.
        const stationary = outPointRef.current;
        if (stationary !== null && clampedTime > stationary) {
          // Crossed the out point: the gesture now drags the out handle, and
          // the in point lands exactly where the out point was — the region
          // spans from there to the pointer, not from wherever the in point
          // happened to be a move ago.
          draggedPointRef.current = 'out';
          setInPoint(stationary);
          setOutPoint(clampedTime);
        } else {
          setInPoint(clampedTime);
        }
      } else {
        const stationary = inPointRef.current;
        if (stationary !== null && clampedTime < stationary) {
          draggedPointRef.current = 'in';
          setOutPoint(stationary);
          setInPoint(clampedTime);
        } else {
          setOutPoint(clampedTime);
        }
      }
    };

    const handleMouseUp = () => {
      setIsDraggingInPoint(false);
      setIsDraggingOutPoint(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingInPoint, isDraggingOutPoint, pixelsPerSecond, timelineDuration, setInPoint, setOutPoint, trackContainerRef, rulerRef]);

  return { handleInPointMouseDown, handleOutPointMouseDown };
}
