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
// The mouseup listener is therefore still an ordinary bubble-phase document
// listener — no capture, no `once` — so the flag is always set before the click
// that follows it is dispatched.
//
// Selection happens once, on release: the rectangle is turned into a time range
// and a set of tracks (found by hit-testing the `data-track-id` rows), and every
// clip inside both is selected — added to the existing selection with ctrl/cmd
// held, replacing it otherwise.
//
// **One listener pair per gesture, and one measurement.** The rectangle's
// corners are what used to re-bind the listeners every frame; they now live in
// refs as well as in state, and the pair is bound by `useDocumentListener` on a
// boolean — `tlMarqueeStart !== null` — that flips twice a gesture. The track
// area is measured once on mousedown; the rows are still walked only on the
// mouseup that selects, which is where they always were.
import type * as React from 'react';
import { useCallback, useRef, useState, type RefObject } from 'react';
import { useDocumentListener } from '../../hooks/useDocumentListener';
import type { Clip } from '../../store/types';
import {
  clipsIntersectingRange,
  exceedsMarqueeThreshold,
  marqueeTimeRange,
  marqueeYRange,
  trackSpansMarquee,
} from './timelineGeometry';
import type { DragState } from './types';
import { useTrackAreaCache } from './useTrackAreaCache';

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

/** A point in the track container's own pixel space. */
interface MarqueePoint {
  x: number;
  y: number;
}

/** The rectangle, or the absence of one. */
export interface Marquee {
  /** Where the pointer went down, in track-container pixels. */
  start: MarqueePoint | null;
  /** Where it is now — null until the drag threshold is cleared. */
  current: MarqueePoint | null;
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
  marqueeJustFinished: marqueeJustFinishedRef,
}: TimelineMarqueeDeps): TimelineMarquee {
  const [tlMarqueeStart, setTlMarqueeStart] = useState<MarqueePoint | null>(null);
  const [tlMarqueeCurrent, setTlMarqueeCurrent] = useState<MarqueePoint | null>(null);
  const tlMarqueeActive = tlMarqueeStart !== null && tlMarqueeCurrent !== null;
  /** The same two corners, for handlers that must not wait on a render. */
  const startRef = useRef<MarqueePoint | null>(null);
  const currentRef = useRef<MarqueePoint | null>(null);
  const trackArea = useTrackAreaCache();

  const handleMouseMove = (e: MouseEvent) => {
    if (!trackContainerRef.current) return;
    const container = trackContainerRef.current;

    const start = startRef.current;
    if (!start) return;

    const area = trackArea.read(container);
    const currentX = e.clientX - area.left;
    const currentY = e.clientY - area.top;
    const dx = currentX - start.x;
    const dy = currentY - start.y;
    if (exceedsMarqueeThreshold(dx, dy)) {
      const next = { x: currentX, y: currentY };
      currentRef.current = next;
      setTlMarqueeCurrent(next);
    }
  };

  const handleMouseUp = (e: MouseEvent) => {
    const current = currentRef.current;
    if (current && trackContainerRef.current) {
      const container = trackContainerRef.current;
      // Non-null whenever `current` is: only a move that already had an origin
      // can have set it.
      const start = startRef.current!;
      const scrollLeft = container.scrollLeft;

      // Convert marquee X pixel positions to time values
      const { startTime, endTime } = marqueeTimeRange(
        start.x,
        current.x,
        scrollLeft,
        pixelsPerSecond
      );

      // Determine which tracks the marquee spans by Y position
      const { topPx, bottomPx } = marqueeYRange(start.y, current.y);

      // Find the track rows and match Y ranges. Still once per gesture, on the
      // release — the rows are measured through the gesture's own cache, so a
      // mid-marquee scroll re-measures them rather than answering from a box
      // that has moved.
      const spannedTrackIds = new Set<string>();
      for (const row of trackArea.readRows(container)) {
        // Check if track overlaps with marquee Y range
        if (trackSpansMarquee(row.top, row.top + row.height, topPx, bottomPx)) {
          spannedTrackIds.add(row.id);
        }
      }

      // Find all clips within the time range on the spanned tracks
      const intersecting = clipsIntersectingRange(clips, spannedTrackIds, startTime, endTime);

      if (e.ctrlKey || e.metaKey) {
        const existing = Array.from(selectedClipIds);
        const combined = [...new Set([...existing, ...intersecting])];
        selectClipsInRange(combined);
      } else {
        selectClipsInRange(intersecting);
      }

      marqueeJustFinishedRef.current = true;
    } else {
      // No drag - let handleTrackClick handle the deselect + seek
    }

    startRef.current = null;
    currentRef.current = null;
    trackArea.end();
    setTlMarqueeStart(null);
    setTlMarqueeCurrent(null);
  };

  useDocumentListener('mousemove', handleMouseMove, tlMarqueeStart !== null);
  useDocumentListener('mouseup', handleMouseUp, tlMarqueeStart !== null);

  // Handle mousedown on track area to start marquee selection
  const handleTrackMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!trackContainerRef.current || isDraggingPlayhead || dragState) return;
      const container = trackContainerRef.current;

      const target = e.target as HTMLElement;
      const isClickOnClip = target.closest('[data-clip-id]');
      const isClickOnPlayhead = target.closest('[data-playhead]');

      // Only start marquee on empty space
      if (isClickOnClip || isClickOnPlayhead) return;

      // Where the track area is, taken once for the whole gesture.
      trackArea.begin(container, false);
      const area = trackArea.read(container);
      const start = { x: e.clientX - area.left, y: e.clientY - area.top };
      startRef.current = start;
      currentRef.current = null;
      setTlMarqueeStart(start);
      setTlMarqueeCurrent(null);
    },
    [isDraggingPlayhead, dragState, trackArea, trackContainerRef]
  );

  return {
    marquee: { start: tlMarqueeStart, current: tlMarqueeCurrent, active: tlMarqueeActive },
    handleTrackMouseDown,
  };
}
