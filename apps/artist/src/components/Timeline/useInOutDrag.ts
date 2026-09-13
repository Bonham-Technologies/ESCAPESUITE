// Dragging the in and out point markers: the region the timeline exports.
//
// The two handles sit on the ruler but are dragged in the track container's
// coordinate space, the same one the playhead scrub uses — with the ruler as
// the fallback, because the markers are drawn there and can be grabbed before
// the track area exists.
//
// One effect serves both handles: a gesture is either an in-point drag or an
// out-point drag, never both, so the single pair of document listeners asks
// which flag is set and writes that point. Release clears both, which is also
// why the flags cannot be collapsed into one — the effect has to know which of
// the two setters to call while the gesture runs.
//
// Neither point is ordered against the other here: dragging the in point past
// the out point is left to the store's own setters.
import React, { useCallback, useEffect, useState, type RefObject } from 'react';
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
  setInPoint,
  setOutPoint,
}: InOutDragDeps): InOutDrag {
  const [isDraggingInPoint, setIsDraggingInPoint] = useState(false);
  const [isDraggingOutPoint, setIsDraggingOutPoint] = useState(false);

  const handleInPointMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDraggingInPoint(true);
  }, []);

  const handleOutPointMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
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

      if (isDraggingInPoint) {
        setInPoint(clampedTime);
      } else {
        setOutPoint(clampedTime);
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
