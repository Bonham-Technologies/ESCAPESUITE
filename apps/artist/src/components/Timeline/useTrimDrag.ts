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
//
// **One listener pair per gesture, and one measurement.** The per-move store
// write used to be what re-bound the listeners: `clips` is a fresh array after
// every `updateClip`, and it was in the effect's deps. The listeners now go
// through `useDocumentListener`, whose `enabled` flag is `trimState !== null` —
// a boolean that flips twice a gesture — while the handler it holds in a ref
// is still rebuilt on every render, so the moves and the release read exactly
// the clips they always did. The track area is measured once on mousedown
// (`useTrackAreaCache`); a move reads only `scrollLeft`.
import type * as React from 'react';
import { useCallback, useRef, useState, type RefObject } from 'react';
import { useDocumentListener } from '../../hooks/useDocumentListener';
import type { Clip, SourceVideo, ToolType, Track } from '../../store/types';
import { computeTrimUpdate, pointerTime } from './timelineGeometry';
import type { TrimState } from './types';
import { useTrackAreaCache } from './useTrackAreaCache';

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
  /** The same gesture, for handlers that must not wait on a render. */
  const trimRef = useRef<TrimState | null>(null);
  const trackArea = useTrackAreaCache();

  const handleMouseMove = (e: MouseEvent) => {
    if (!trackContainerRef.current) return;
    const container = trackContainerRef.current;

    const trim = trimRef.current;
    if (!trim) return;

    const clip = clips.find(c => c.id === trim.clipId);
    if (!clip) return;

    const sourceVideo = sourceVideos.find(v => v.id === clip.sourceVideoId);

    const area = trackArea.read(container);
    const mouseTime = pointerTime(e.clientX, area.left, container.scrollLeft, pixelsPerSecond);

    const update = computeTrimUpdate({
      edge: trim.edge,
      mouseTime,
      clip,
      sourceVideo,
      origin: trim.origin,
    });

    if (update) {
      updateClip(trim.clipId, update);
    }
  };

  const handleMouseUp = () => {
    const trim = trimRef.current;
    // If ripple tool is active, shift subsequent clips
    if (activeTool === 'ripple' && trim) {
      const clip = clips.find((c) => c.id === trim.clipId);
      if (clip) {
        const originalEnd = trim.origin.timelinePosition +
          (trim.origin.endTime - trim.origin.startTime);
        const currentEnd = clip.timelinePosition + (clip.endTime - clip.startTime);
        const delta = currentEnd - originalEnd;

        if (delta !== 0) {
          // Shift all clips after the original end position
          shiftClipsAfter(clip.trackId, originalEnd, delta);
        }
      }
    }
    trimRef.current = null;
    trackArea.end();
    setTrimState(null);
  };

  useDocumentListener('mousemove', handleMouseMove, trimState !== null);
  useDocumentListener('mouseup', handleMouseUp, trimState !== null);

  // Handle trim edge mouse down
  const handleTrimMouseDown = useCallback(
    (e: React.MouseEvent, clip: Clip, edge: 'start' | 'end') => {
      e.stopPropagation();
      e.preventDefault();

      const track = tracks.find(t => t.id === clip.trackId);
      if (!track || track.locked) return;

      setSelectedClipId(clip.id);
      // Where the track area is, taken once: a trim reads only `scrollLeft`
      // per move after this.
      trackArea.begin(trackContainerRef.current, false);
      const initial: TrimState = {
        clipId: clip.id,
        edge,
        origin: {
          startTime: clip.startTime,
          endTime: clip.endTime,
          timelinePosition: clip.timelinePosition,
        },
      };
      trimRef.current = initial;
      setTrimState(initial);
    },
    [tracks, setSelectedClipId, trackArea, trackContainerRef]
  );

  return { trimState, handleTrimMouseDown };
}
