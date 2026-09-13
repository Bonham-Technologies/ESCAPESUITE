// Dragging the playhead: scrubbing the project's time with the pointer.
//
// The gesture is the simplest of the timeline's drags — there is nothing to
// preview and nothing to commit, because the store's `currentTime` *is* the
// thing being moved, so every mousemove writes it and release does no more
// than stop listening.
//
// Its coordinate space is the track container rather than the ruler the
// playhead is drawn over, so a scrub that starts on the playhead and one that
// starts on a track measure from the same left edge and the same horizontal
// scroll offset.
//
// `isDraggingPlayhead` leaves the hook because two other things ask it: a
// marquee refuses to start while a scrub is running, and the track's click
// handler refuses to seek for the click that ends one.
import type * as React from 'react';
import { useCallback, useEffect, useState, type RefObject } from 'react';
import { clampTime, pointerTime } from './timelineGeometry';

/** What a playhead scrub needs that it cannot reach on its own. */
export interface PlayheadDragDeps {
  /** The scrolling track area: the gesture's coordinate space. */
  trackContainerRef: RefObject<HTMLDivElement | null>;
  /** Horizontal scale of the timeline, in pixels per second of media. */
  pixelsPerSecond: number;
  /** The project's duration — the scrub is clamped to it. */
  timelineDuration: number;
  setCurrentTime: (time: number) => void;
}

/** The scrub in progress, and the way to start one. */
export interface PlayheadDrag {
  /** True while the pointer is scrubbing; read by the marquee and the track click. */
  isDraggingPlayhead: boolean;
  /** `onMouseDown` for the playhead handle. */
  handlePlayheadMouseDown: (e: React.MouseEvent) => void;
}

export function usePlayheadDrag({
  trackContainerRef,
  pixelsPerSecond,
  timelineDuration,
  setCurrentTime,
}: PlayheadDragDeps): PlayheadDrag {
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);

  // Handle playhead drag
  const handlePlayheadMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDraggingPlayhead(true);
  }, []);

  useEffect(() => {
    if (!isDraggingPlayhead) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!trackContainerRef.current) return;

      const rect = trackContainerRef.current.getBoundingClientRect();
      const time = pointerTime(e.clientX, rect.left, trackContainerRef.current.scrollLeft, pixelsPerSecond);
      const clampedTime = clampTime(time, timelineDuration);
      setCurrentTime(clampedTime);
    };

    const handleMouseUp = () => {
      setIsDraggingPlayhead(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingPlayhead, pixelsPerSecond, timelineDuration, setCurrentTime, trackContainerRef]);

  return { isDraggingPlayhead, handlePlayheadMouseDown };
}
