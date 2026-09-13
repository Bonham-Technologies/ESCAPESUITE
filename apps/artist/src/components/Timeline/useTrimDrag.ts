// Dragging a clip's edge: changing what part of the source it plays.
//
// Unlike the clip drag, a trim writes to the store on every mousemove — the
// clip really does resize under the pointer, so there is no ghost to preview
// and nothing to commit on release. `trimState` therefore holds the *origin*
// of the gesture rather than its current value: `computeTrimUpdate` re-derives
// the edge from where the pointer is now and where it started, so a trim that
// wanders out past a limit and back comes home exactly, instead of accumulating
// the clamped deltas of every frame in between.
//
// Release only does something with the ripple tool out, and then the origin is
// what makes it possible: the clips after this one shift by however much the
// end moved over the whole gesture.
import type * as React from 'react';
import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { Clip, SourceVideo, ToolType, Track } from '../../store/types';
import { computeTrimUpdate, pointerTime } from './timelineGeometry';
import type { TrimState } from './types';

/** What a trim gesture needs that it cannot reach on its own. */
export interface TrimDragDeps {
  /** The scrolling track area: the gesture's coordinate space. */
  trackContainerRef: RefObject<HTMLDivElement | null>;
  /** Horizontal scale of the timeline, in pixels per second of media. */
  pixelsPerSecond: number;
  /** Every clip on the timeline, to re-find the one being trimmed. */
  clips: Clip[];
  /** The imported media, for the source duration a trim cannot run past. */
  sourceVideos: SourceVideo[];
  /** Every track, to refuse a gesture that starts on a locked one. */
  tracks: Track[];
  /** The active tool: `ripple` closes the gap the trim leaves behind. */
  activeTool: ToolType;
  setSelectedClipId: (id: string | null) => void;
  updateClip: (clipId: string, updates: Partial<Clip>) => void;
  shiftClipsAfter: (trackId: string | undefined, afterTime: number, delta: number) => void;
}

/** The trim in progress, and the way to start one. */
export interface TrimDrag {
  /** The live gesture, or null. `TimelineTrack` styles the clip from it. */
  trimState: TrimState | null;
  /** `onMouseDown` for a clip's start or end handle. */
  handleTrimMouseDown: (e: React.MouseEvent, clip: Clip, edge: 'start' | 'end') => void;
}

export function useTrimDrag({
  trackContainerRef,
  pixelsPerSecond,
  clips,
  sourceVideos,
  tracks,
  activeTool,
  setSelectedClipId,
  updateClip,
  shiftClipsAfter,
}: TrimDragDeps): TrimDrag {
  const [trimState, setTrimState] = useState<TrimState | null>(null);

  // Handle trim edge mouse down
  const handleTrimMouseDown = useCallback(
    (e: React.MouseEvent, clip: Clip, edge: 'start' | 'end') => {
      e.stopPropagation();
      e.preventDefault();

      const track = tracks.find(t => t.id === clip.trackId);
      if (!track || track.locked) return;

      setSelectedClipId(clip.id);
      setTrimState({
        clipId: clip.id,
        edge,
        origin: {
          startTime: clip.startTime,
          endTime: clip.endTime,
          timelinePosition: clip.timelinePosition,
        },
      });
    },
    [tracks, setSelectedClipId]
  );

  // Handle trim drag
  useEffect(() => {
    if (!trimState) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!trackContainerRef.current) return;

      const clip = clips.find(c => c.id === trimState.clipId);
      if (!clip) return;

      const sourceVideo = sourceVideos.find(v => v.id === clip.sourceVideoId);

      const containerRect = trackContainerRef.current.getBoundingClientRect();
      const scrollLeft = trackContainerRef.current.scrollLeft;
      const mouseTime = pointerTime(e.clientX, containerRect.left, scrollLeft, pixelsPerSecond);

      const update = computeTrimUpdate({
        edge: trimState.edge,
        mouseTime,
        clip,
        sourceVideo,
        origin: trimState.origin,
      });

      if (update) {
        updateClip(trimState.clipId, update);
      }
    };

    const handleMouseUp = () => {
      // If ripple tool is active, shift subsequent clips
      if (activeTool === 'ripple' && trimState) {
        const clip = clips.find((c) => c.id === trimState.clipId);
        if (clip) {
          const originalEnd = trimState.origin.timelinePosition +
            (trimState.origin.endTime - trimState.origin.startTime);
          const currentEnd = clip.timelinePosition + (clip.endTime - clip.startTime);
          const delta = currentEnd - originalEnd;

          if (delta !== 0) {
            // Shift all clips after the original end position
            shiftClipsAfter(clip.trackId, originalEnd, delta);
          }
        }
      }
      setTrimState(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [trimState, clips, sourceVideos, pixelsPerSecond, updateClip, activeTool, shiftClipsAfter, trackContainerRef]);

  return { trimState, handleTrimMouseDown };
}
