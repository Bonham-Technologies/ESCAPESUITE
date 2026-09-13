// Dragging a clip along the timeline — and, with the razor out, cutting it.
//
// The gesture starts on the clip (`handleClipMouseDown`) but continues on the
// document, because the pointer routinely leaves the clip it picked up: the
// mousemove that moves it and the mouseup that commits it are bound while a
// drag is live and taken back the moment it ends.
//
// `handleClipMouseDown` is really four handlers sharing one entry point, and
// the first match wins: the razor tool splits instead of dragging, ctrl/cmd
// toggles multi-selection instead of dragging, a locked track refuses, and
// only what is left of the gesture becomes a drag.
//
// While the drag runs, nothing is written to the store — `dragState` is the
// preview, and `TimelineTrack` draws the clip from it. The commit happens once,
// on mouseup: a bulk move when the dragged clip is part of a multi-selection,
// otherwise a single move that an overlap on the target track can veto outright.
import type * as React from 'react';
import { useCallback, useEffect, useState, type RefObject } from 'react';
import { getSnapPoints, wouldOverlap } from '../../store/projectStore';
import type { Clip, ToolType, Track } from '../../store/types';
import { pixelsToTime } from '../../utils/timeUtils';
import { getSplitOffset, pointerTime, snapDragPosition } from './timelineGeometry';
import type { DragState } from './types';

/** What a clip drag needs that it cannot reach on its own. */
export interface ClipDragDeps {
  /** The scrolling track area: the drag's coordinate space and its track rows. */
  trackContainerRef: RefObject<HTMLDivElement | null>;
  /** Horizontal scale of the timeline, in pixels per second of media. */
  pixelsPerSecond: number;
  /** Every clip on the timeline: snap points, the dragged clip, overlap checks. */
  clips: Clip[];
  /** Every track, to refuse a gesture that starts on a locked one. */
  tracks: Track[];
  /** Whether dragging snaps to neighbouring clip edges. */
  snapEnabled: boolean;
  /** How near, in pixels, a snap point has to be to take the drag. */
  snapThreshold: number;
  /** The multi-selection, which turns a drag into a bulk move. */
  selectedClipIds: Set<string>;
  /** The active tool: `razor` diverts the mousedown into a split. */
  activeTool: ToolType;
  setSelectedClipId: (id: string | null) => void;
  toggleClipSelection: (clipId: string) => void;
  moveSelectedClips: (deltaTime: number, deltaTrack: number) => void;
  setClipTimelinePosition: (clipId: string, position: number) => void;
  moveClipToTrack: (clipId: string, trackId: string) => void;
  splitClip: (clipId: string, splitTime: number) => void;
}

/** The drag in progress, and the way to start one. */
export interface ClipDrag {
  /** The live gesture, or null. Drives the ghost clip and the snap line. */
  dragState: DragState | null;
  /** `onMouseDown` for a clip body. */
  handleClipMouseDown: (e: React.MouseEvent, clip: Clip) => void;
}

export function useClipDrag({
  trackContainerRef,
  pixelsPerSecond,
  clips,
  tracks,
  snapEnabled,
  snapThreshold,
  selectedClipIds,
  activeTool,
  setSelectedClipId,
  toggleClipSelection,
  moveSelectedClips,
  setClipTimelinePosition,
  moveClipToTrack,
  splitClip,
}: ClipDragDeps): ClipDrag {
  const [dragState, setDragState] = useState<DragState | null>(null);

  // Handle razor tool click on clip
  const handleRazorClick = useCallback(
    (e: React.MouseEvent, clip: Clip) => {
      if (!trackContainerRef.current) return;

      const track = tracks.find(t => t.id === clip.trackId);
      if (!track || track.locked) return;

      const containerRect = trackContainerRef.current.getBoundingClientRect();
      const scrollLeft = trackContainerRef.current.scrollLeft;
      const clickTime = pointerTime(e.clientX, containerRect.left, scrollLeft, pixelsPerSecond);

      // Only split if click is within the clip bounds (not on edges)
      const splitTimeRelative = getSplitOffset(clickTime, clip.timelinePosition, clip.duration);

      if (splitTimeRelative !== null) {
        splitClip(clip.id, splitTimeRelative);
      }
    },
    [tracks, pixelsPerSecond, splitClip, trackContainerRef]
  );

  // Handle clip drag start
  const handleClipMouseDown = useCallback(
    (e: React.MouseEvent, clip: Clip) => {
      e.stopPropagation();

      // Handle razor tool
      if (activeTool === 'razor') {
        handleRazorClick(e, clip);
        return;
      }

      // Ctrl+click (or Cmd+click on Mac) toggles multi-selection
      if (e.ctrlKey || e.metaKey) {
        toggleClipSelection(clip.id);
        return;
      }

      // If the clip is part of a multi-selection, keep the selection for bulk drag
      // Otherwise, select just this clip
      if (!selectedClipIds.has(clip.id)) {
        setSelectedClipId(clip.id);
      }

      const track = tracks.find(t => t.id === clip.trackId);
      if (!track || track.locked) return;

      const clipElement = e.currentTarget as HTMLElement;
      const clipRect = clipElement.getBoundingClientRect();
      const offsetX = e.clientX - clipRect.left;

      setDragState({
        clipId: clip.id,
        originalTrackId: clip.trackId,
        originalPosition: clip.timelinePosition,
        currentTrackId: clip.trackId,
        currentPosition: clip.timelinePosition,
        snappedPosition: null,
        offsetX,
      });
    },
    [tracks, setSelectedClipId, toggleClipSelection, selectedClipIds, activeTool, handleRazorClick]
  );

  // Handle drag movement
  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!trackContainerRef.current) return;

      const containerRect = trackContainerRef.current.getBoundingClientRect();
      const scrollLeft = trackContainerRef.current.scrollLeft;

      // Calculate new timeline position
      // Kept as the original two-step expression: `pointerTime` would sum the
      // same terms in a different order, and the extraction promised identical
      // floating-point results.
      const x = e.clientX - containerRect.left + scrollLeft - dragState.offsetX;
      let newPosition = pixelsToTime(x, pixelsPerSecond);
      newPosition = Math.max(0, newPosition);

      // Apply snapping if enabled
      let snappedPosition: number | null = null;
      if (snapEnabled) {
        const snapPoints = getSnapPoints(clips, dragState.clipId);
        const threshold = pixelsToTime(snapThreshold, pixelsPerSecond);
        const clip = clips.find(c => c.id === dragState.clipId);

        if (clip) {
          const snapped = snapDragPosition(newPosition, clip.duration, snapPoints, threshold);
          newPosition = snapped.position;
          snappedPosition = snapped.snappedPosition;
        }
      }

      // Determine target track based on mouse Y position
      const trackElements = trackContainerRef.current.querySelectorAll('[data-track-id]');
      let targetTrackId = dragState.currentTrackId;

      trackElements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY < rect.bottom) {
          // Non-null by construction: the elements come from the
          // `[data-track-id]` selector above, so the attribute is present.
          targetTrackId = el.getAttribute('data-track-id')!;
        }
      });

      setDragState(prev => prev ? {
        ...prev,
        currentTrackId: targetTrackId,
        currentPosition: newPosition,
        snappedPosition,
      } : null);
    };

    const handleMouseUp = () => {
      if (dragState) {
        const clip = clips.find(c => c.id === dragState.clipId);
        if (clip) {
          const deltaTime = dragState.currentPosition - dragState.originalPosition;

          // Bulk drag: if dragged clip is part of multi-selection, move all selected clips
          if (selectedClipIds.has(dragState.clipId) && selectedClipIds.size > 1 && deltaTime !== 0) {
            moveSelectedClips(deltaTime, 0);
          } else {
            // Single clip move
            // Check for overlaps before committing
            const overlap = wouldOverlap(
              clips,
              dragState.currentTrackId,
              dragState.currentPosition,
              clip.duration,
              dragState.clipId
            );

            if (!overlap) {
              // Commit the move
              if (dragState.currentTrackId !== dragState.originalTrackId) {
                moveClipToTrack(dragState.clipId, dragState.currentTrackId);
              }
              if (deltaTime !== 0) {
                setClipTimelinePosition(dragState.clipId, dragState.currentPosition);
              }
            }
          }
        }
      }
      setDragState(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, clips, snapEnabled, snapThreshold, pixelsPerSecond, moveClipToTrack, setClipTimelinePosition, selectedClipIds, moveSelectedClips, trackContainerRef]);

  return { dragState, handleClipMouseDown };
}
