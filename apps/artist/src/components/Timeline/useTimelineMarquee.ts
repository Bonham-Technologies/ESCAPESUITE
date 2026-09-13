// Rubber-band selection over the track area.
//
// The gesture is ambiguous until it has moved: a press on empty track space is
// either the start of a marquee or a plain click that seeks and deselects, and
// which one it turns out to be is not known until the pointer either travels
// past `MARQUEE_DRAG_THRESHOLD` or comes up where it went down. So mousedown
// only records the origin; the rectangle does not exist — `marquee.active` stays
// false, and nothing is drawn — until a mousemove clears the threshold.
//
// That is also why the hook sets `marqueeJustFinished`: `Timeline`'s click
// handler fires after the mouseup that completed a selection, and without the
// flag it would immediately seek the playhead and clear what was just selected.
//
// Selection happens once, on release: the rectangle is turned into a time range
// and a set of tracks (found by hit-testing the `data-track-id` rows), and every
// clip inside both is selected — added to the existing selection with ctrl/cmd
// held, replacing it otherwise.
import type * as React from 'react';
import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { Clip } from '../../store/types';
import {
  clipsIntersectingRange,
  exceedsMarqueeThreshold,
  marqueeTimeRange,
  marqueeYRange,
  trackSpansMarquee,
} from './timelineGeometry';
import type { DragState } from './types';

/** What the marquee needs that it cannot reach on its own. */
export interface TimelineMarqueeDeps {
  /** The scrolling track area: the marquee's coordinate space and its rows. */
  trackContainerRef: RefObject<HTMLDivElement | null>;
  /** Horizontal scale of the timeline, in pixels per second of media. */
  pixelsPerSecond: number;
  /** Every clip on the timeline — the candidates the rectangle selects from. */
  clips: Clip[];
  /** The current multi-selection, which ctrl/cmd adds to rather than replaces. */
  selectedClipIds: Set<string>;
  selectClipsInRange: (clipIds: string[]) => void;
  /** True while the playhead is being dragged: no marquee may start. */
  isDraggingPlayhead: boolean;
  /** A clip drag in progress, which likewise blocks a marquee. */
  dragState: DragState | null;
  /**
   * Set on the mouseup that completed a selection, so `Timeline`'s own click
   * handler knows to skip its seek-and-deselect. Owned by `Timeline` because
   * that handler is built before this hook is called.
   */
  marqueeJustFinished: RefObject<boolean>;
}

/** The rectangle, or the absence of one. */
export interface Marquee {
  /** Where the pointer went down, in track-container pixels. */
  start: { x: number; y: number } | null;
  /** Where it is now — null until the drag threshold is cleared. */
  current: { x: number; y: number } | null;
  /** True once there is a rectangle to draw and to select with. */
  active: boolean;
}

/** The marquee state to draw, and the way to start one. */
export interface TimelineMarquee {
  marquee: Marquee;
  /** `onMouseDown` for the track container. */
  handleTrackMouseDown: (e: React.MouseEvent) => void;
}

export function useTimelineMarquee({
  trackContainerRef,
  pixelsPerSecond,
  clips,
  selectedClipIds,
  selectClipsInRange,
  isDraggingPlayhead,
  dragState,
  marqueeJustFinished,
}: TimelineMarqueeDeps): TimelineMarquee {
  const [tlMarqueeStart, setTlMarqueeStart] = useState<{x: number; y: number} | null>(null);
  const [tlMarqueeCurrent, setTlMarqueeCurrent] = useState<{x: number; y: number} | null>(null);
  const tlMarqueeActive = tlMarqueeStart !== null && tlMarqueeCurrent !== null;

  // Handle mousedown on track area to start marquee selection
  const handleTrackMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!trackContainerRef.current || isDraggingPlayhead || dragState) return;

      const target = e.target as HTMLElement;
      const isClickOnClip = target.closest('[data-clip-id]');
      const isClickOnPlayhead = target.closest('[data-playhead]');

      // Only start marquee on empty space
      if (isClickOnClip || isClickOnPlayhead) return;

      const rect = trackContainerRef.current.getBoundingClientRect();
      setTlMarqueeStart({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      setTlMarqueeCurrent(null);
    },
    [isDraggingPlayhead, dragState, trackContainerRef]
  );

  // Marquee mousemove/mouseup via useEffect (document-level events)
  useEffect(() => {
    if (!tlMarqueeStart) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!trackContainerRef.current) return;
      const rect = trackContainerRef.current.getBoundingClientRect();
      const currentX = e.clientX - rect.left;
      const currentY = e.clientY - rect.top;
      const dx = currentX - tlMarqueeStart.x;
      const dy = currentY - tlMarqueeStart.y;
      if (exceedsMarqueeThreshold(dx, dy)) {
        setTlMarqueeCurrent({ x: currentX, y: currentY });
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (tlMarqueeActive && trackContainerRef.current) {
        const current = tlMarqueeCurrent!;
        const scrollLeft = trackContainerRef.current.scrollLeft;

        // Convert marquee X pixel positions to time values
        const { startTime, endTime } = marqueeTimeRange(
          tlMarqueeStart.x,
          current.x,
          scrollLeft,
          pixelsPerSecond
        );

        // Determine which tracks the marquee spans by Y position
        const { topPx, bottomPx } = marqueeYRange(tlMarqueeStart.y, current.y);

        // Find track elements and match Y ranges
        const trackElements = trackContainerRef.current.querySelectorAll('[data-track-id]');
        const containerRect = trackContainerRef.current.getBoundingClientRect();
        const scrollTop = trackContainerRef.current.scrollTop;

        const spannedTrackIds = new Set<string>();
        trackElements.forEach((el) => {
          const elRect = el.getBoundingClientRect();
          // Convert to container-relative coordinates
          const elTop = elRect.top - containerRect.top + scrollTop;
          const elBottom = elRect.bottom - containerRect.top + scrollTop;
          // Check if track overlaps with marquee Y range
          if (trackSpansMarquee(elTop, elBottom, topPx, bottomPx)) {
            const trackId = el.getAttribute('data-track-id');
            if (trackId) spannedTrackIds.add(trackId);
          }
        });

        // Find all clips within the time range on the spanned tracks
        const intersecting = clipsIntersectingRange(clips, spannedTrackIds, startTime, endTime);

        if (e.ctrlKey || e.metaKey) {
          const existing = Array.from(selectedClipIds);
          const combined = [...new Set([...existing, ...intersecting])];
          selectClipsInRange(combined);
        } else {
          selectClipsInRange(intersecting);
        }

        marqueeJustFinished.current = true;
      } else {
        // No drag - let handleTrackClick handle the deselect + seek
      }

      setTlMarqueeStart(null);
      setTlMarqueeCurrent(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [tlMarqueeStart, tlMarqueeActive, tlMarqueeCurrent, pixelsPerSecond, clips, selectedClipIds, selectClipsInRange, trackContainerRef, marqueeJustFinished]);

  return {
    marquee: { start: tlMarqueeStart, current: tlMarqueeCurrent, active: tlMarqueeActive },
    handleTrackMouseDown,
  };
}
