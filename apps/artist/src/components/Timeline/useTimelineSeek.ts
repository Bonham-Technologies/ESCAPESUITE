// Clicking the timeline to move the playhead — on the ruler, and on empty
// track space.
//
// The two handlers do the same three things (pause if playing, convert the
// click's X into a time, write it), and differ only in what else a click on
// their surface can mean. The ruler's is unconditional: there is nothing on it
// to click but time. The track area's has to stand down for every other reading
// of the same click — a clip drag in progress, a playhead scrub, a click that
// merely finished a marquee, a click that landed on the playhead itself — and,
// when the click really did land on bare track, clears the selection too.
//
// A carried quirk, preserved from before this file existed: the ruler clamps to
// `timelineDuration || minTimelineDuration`, so on an empty timeline it seeks
// anywhere in the 60s the ruler draws, while the track area clamps to
// `timelineDuration` and so pins the playhead at 0. Both are left as they were.
import type * as React from 'react';
import { useCallback, type RefObject } from 'react';
import { clampTime, pointerTime } from './timelineGeometry';
import type { DragState } from './types';

/** What the two click handlers need that they cannot reach on their own. */
export interface TimelineSeekDeps {
  /** The ruler's scroll box: the coordinate space of a ruler click. */
  rulerRef: RefObject<HTMLDivElement | null>;
  /** The scrolling track area: the coordinate space of a track click. */
  trackContainerRef: RefObject<HTMLDivElement | null>;
  /** Horizontal scale of the timeline, in pixels per second of media. */
  pixelsPerSecond: number;
  /** The project's duration — what a track click clamps to. */
  timelineDuration: number;
  /** The ruler's span, its floor included — what a ruler click falls back to. */
  minTimelineDuration: number;
  /** Playback state: a seek pauses it. */
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setSelectedClipId: (id: string | null) => void;
  clearMultiSelection: () => void;
  /** True while the playhead is being scrubbed: the track click stands down. */
  isDraggingPlayhead: boolean;
  /** A clip drag in progress, which likewise suppresses the track click. */
  dragState: DragState | null;
  /**
   * Set by `useTimelineMarquee` on the mouseup that completed a selection: the
   * click that follows it only ended the marquee and must not seek or deselect.
   */
  marqueeJustFinishedRef: RefObject<boolean>;
}

/** The two `onClick` handlers the timeline's surfaces bind to. */
export interface TimelineSeek {
  /** `onClick` for the ruler. */
  handleRulerClick: (e: React.MouseEvent) => void;
  /** `onClick` for the track container. */
  handleTrackClick: (e: React.MouseEvent) => void;
}

export function useTimelineSeek({
  rulerRef,
  trackContainerRef,
  pixelsPerSecond,
  timelineDuration,
  minTimelineDuration,
  isPlaying,
  setIsPlaying,
  setCurrentTime,
  setSelectedClipId,
  clearMultiSelection,
  isDraggingPlayhead,
  dragState,
  marqueeJustFinishedRef,
}: TimelineSeekDeps): TimelineSeek {
  // Handle ruler click to seek (and pause if playing)
  const handleRulerClick = useCallback(
    (e: React.MouseEvent) => {
      if (!rulerRef.current) return;

      if (isPlaying) {
        setIsPlaying(false);
      }

      const rect = rulerRef.current.getBoundingClientRect();
      const time = pointerTime(e.clientX, rect.left, rulerRef.current.scrollLeft, pixelsPerSecond);
      const clampedTime = clampTime(time, timelineDuration || minTimelineDuration);
      setCurrentTime(clampedTime);
    },
    [pixelsPerSecond, timelineDuration, minTimelineDuration, setCurrentTime, isPlaying, setIsPlaying, rulerRef]
  );

  // Handle click on track to seek, pause, and deselect.
  // Reads what the drag and marquee hooks own: a live `dragState` suppresses it,
  // and `marqueeJustFinishedRef` tells it that the click it is about to handle only
  // ended a rubber-band selection.
  const handleTrackClick = useCallback(
    (e: React.MouseEvent) => {
      // If a marquee selection just completed, skip normal click behavior
      if (marqueeJustFinishedRef.current) {
        marqueeJustFinishedRef.current = false;
        return;
      }

      if (!trackContainerRef.current || isDraggingPlayhead || dragState) return;

      // Only deselect if clicking directly on the track container, not on a clip or playhead
      const target = e.target as HTMLElement;
      const isClickOnClip = target.closest('[data-clip-id]');
      const isClickOnPlayhead = target.closest('[data-playhead]');

      // Don't seek or deselect when clicking playhead
      if (isClickOnPlayhead) return;

      if (isPlaying) {
        setIsPlaying(false);
      }

      const rect = trackContainerRef.current.getBoundingClientRect();
      const time = pointerTime(e.clientX, rect.left, trackContainerRef.current.scrollLeft, pixelsPerSecond);
      const clampedTime = clampTime(time, timelineDuration);
      setCurrentTime(clampedTime);

      // Deselect clip only when clicking on empty track space
      if (!isClickOnClip) {
        clearMultiSelection();
        setSelectedClipId(null);
      }
    },
    [pixelsPerSecond, timelineDuration, setCurrentTime, setSelectedClipId, clearMultiSelection, isDraggingPlayhead, dragState, isPlaying, setIsPlaying, trackContainerRef, marqueeJustFinishedRef]
  );

  return { handleRulerClick, handleTrackClick };
}
