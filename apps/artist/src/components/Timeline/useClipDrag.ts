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
//
// **One drag is one undo entry** (ESCSUITE-79), whichever of those it is. A bulk
// move always was — `moveSelectedClips` moves every selected clip inside one
// `set` — but a single move that changed the clip's row *and* its time is two
// store writes, and they used to push an entry each. The first now pushes and
// the second passes `skipHistory`, the shape `updateClip` and `shiftClipsAfter`
// already carry.
//
// **One listener pair, one measurement, one snap array — per gesture, not per
// pointer frame.** The listeners go through `useDocumentListener`, whose
// `enabled` flag is `dragState !== null`: a boolean that flips twice a gesture,
// so the pair is bound by the mousedown and given back by the mouseup, while
// the handlers themselves stay as fresh as they ever were (the hook holds the
// current one in a ref). `dragState` is still `useState`, because the ghost
// clip and the snap line are drawn from it; `dragRef` carries the same value
// for the handlers, written synchronously so a mouseup never waits on a
// render. The track rows are measured once (`useTrackAreaCache`) and the snap
// points computed once, both on mousedown — a clip drag writes nothing to the
// store until release, so neither can change while it runs.
import type * as React from 'react';
import { useCallback, useRef, useState, type RefObject } from 'react';
import { useDocumentListener } from '../../hooks/useDocumentListener';
import { getSnapPoints, wouldOverlap } from '../../store/timelineSnapping';
import type { Clip, ToolType, Track } from '../../store/types';
import { pixelsToTime } from '../../utils/timeUtils';
import { getSplitOffset, pointerTime, snapDragPosition } from './timelineGeometry';
import type { DragState } from './types';
import { useTrackAreaCache } from './useTrackAreaCache';

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
  /**
   * The store's `setClipTimelinePosition`. The trailing `skipHistory` is
   * ESCSUITE-79's: a drop that changed the clip's row as well as its time has
   * already pushed the gesture's undo entry through `moveClipToTrack`, so this
   * write joins that entry instead of opening one of its own.
   */
  setClipTimelinePosition: (clipId: string, position: number, skipHistory?: boolean) => void;
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
  /**
   * The same gesture the state above holds, written before React re-renders so
   * the document handlers never read a frame-old value.
   */
  const dragRef = useRef<DragState | null>(null);
  /** The snap targets, taken once on mousedown. */
  const snapPointsRef = useRef<number[]>([]);
  const trackArea = useTrackAreaCache();

  const handleMouseMove = (e: MouseEvent) => {
    if (!trackContainerRef.current) return;
    const container = trackContainerRef.current;

    // The release clears the drag, but the effect that unbinds the listeners
    // only runs after the render that clears it — so a mousemove delivered in
    // the same batch still reaches this handler, and has to be a no-op rather
    // than a resurrection of the finished drag.
    const drag = dragRef.current;
    if (!drag) return;

    const area = trackArea.read(container);

    // Calculate new timeline position
    // Kept as the original two-step expression: `pointerTime` would sum the
    // same terms in a different order, and the extraction promised identical
    // floating-point results.
    const x = e.clientX - area.left + container.scrollLeft - drag.offsetX;
    let newPosition = pixelsToTime(x, pixelsPerSecond);
    newPosition = Math.max(0, newPosition);

    // Apply snapping if enabled
    let snappedPosition: number | null = null;
    if (snapEnabled) {
      const threshold = pixelsToTime(snapThreshold, pixelsPerSecond);
      const clip = clips.find(c => c.id === drag.clipId);

      if (clip) {
        const snapped = snapDragPosition(
          newPosition,
          clip.duration,
          snapPointsRef.current,
          threshold
        );
        newPosition = snapped.position;
        snappedPosition = snapped.snappedPosition;
      }
    }

    // Determine target track based on mouse Y position, against the rows this
    // gesture measured when it began. Only the scroll offset is read per move.
    const pointerY = e.clientY - area.top + container.scrollTop;
    let targetTrackId = drag.currentTrackId;
    for (const row of trackArea.readRows(container)) {
      if (pointerY >= row.top && pointerY < row.top + row.height) {
        targetTrackId = row.id;
      }
    }

    const next: DragState = {
      ...drag,
      currentTrackId: targetTrackId,
      currentPosition: newPosition,
      snappedPosition,
    };
    dragRef.current = next;
    setDragState(next);
  };

  const handleMouseUp = () => {
    const drag = dragRef.current;
    if (drag) {
      const clip = clips.find(c => c.id === drag.clipId);
      if (clip) {
        const deltaTime = drag.currentPosition - drag.originalPosition;

        // Bulk drag: if dragged clip is part of multi-selection, move all selected clips
        if (selectedClipIds.has(drag.clipId) && selectedClipIds.size > 1 && deltaTime !== 0) {
          moveSelectedClips(deltaTime, 0);
        } else {
          // Single clip move
          // Check for overlaps before committing
          const overlap = wouldOverlap(
            clips,
            drag.currentTrackId,
            drag.currentPosition,
            clip.duration,
            drag.clipId
          );

          if (!overlap) {
            // Commit the move. A drop that changed the row *and* the time is two
            // store writes and **one** undo entry (ESCSUITE-79): the first one
            // pushes it — so the entry holds the clip on the track and at the
            // position the gesture found it — and the second passes
            // `skipHistory`. Both writes pushing made one drag two undo steps,
            // and the first Ctrl+Z then left the clip on its new row at its old
            // time, a half-state the drag had never produced.
            //
            // No `historyPushedRef` here, unlike `useTrimDrag`: a clip drag
            // writes nothing until release, so both writes happen in this one
            // handler and "has the entry been pushed?" is just "did the row
            // change?".
            const movedTrack = drag.currentTrackId !== drag.originalTrackId;
            if (movedTrack) {
              moveClipToTrack(drag.clipId, drag.currentTrackId);
            }
            if (deltaTime !== 0) {
              setClipTimelinePosition(drag.clipId, drag.currentPosition, movedTrack);
            }
          }
        }
      }
    }
    dragRef.current = null;
    trackArea.end();
    setDragState(null);
  };

  useDocumentListener('mousemove', handleMouseMove, dragState !== null);
  useDocumentListener('mouseup', handleMouseUp, dragState !== null);

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

      // Everything the moves will need, taken once: where the track area and
      // its rows are, and what the drag may snap to. Neither can change while
      // the drag runs, which is why neither is re-taken per frame.
      trackArea.begin(trackContainerRef.current, true);
      snapPointsRef.current = getSnapPoints(clips, clip.id);

      const initial: DragState = {
        clipId: clip.id,
        originalTrackId: clip.trackId,
        originalPosition: clip.timelinePosition,
        currentTrackId: clip.trackId,
        currentPosition: clip.timelinePosition,
        snappedPosition: null,
        offsetX,
      };
      dragRef.current = initial;
      setDragState(initial);
    },
    [
      tracks,
      setSelectedClipId,
      toggleClipSelection,
      selectedClipIds,
      activeTool,
      handleRazorClick,
      clips,
      trackArea,
      trackContainerRef,
    ]
  );

  return { dragState, handleClipMouseDown };
}
