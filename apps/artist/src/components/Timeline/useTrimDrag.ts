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
// **One trim is one undo entry** (ESCSUITE-77, the rule ESCSUITE-52 set for a
// preview transform drag and ESCSUITE-75 for the inspector's sliders). Writing
// on every mousemove meant pushing an undo entry on every mousemove: a single
// trim was dozens of entries, so it evicted everything before it from the
// 50-entry stack, paid a full-project `structuredClone` each frame, and left
// Ctrl+Z stepping back a few milliseconds of media at a time. The **first**
// write of a gesture goes through unskipped — so the entry snapshots the clip's
// in and out points as they were before the drag — and every write after it
// passes `skipHistory`. Nothing extra happens on release *for the undo stack*, so
// a trim abandoned mid-drag is already undoable to where it started — and the one
// thing release does do, the ripple tool's `shiftClipsAfter`, takes the flag too:
// it belongs to the trim that produced it, and pushing an entry of its own made
// one ripple trim two undo steps. Unlike
// `Preview/useTransformHandles.ts`, whose writes are throttled to an animation
// frame, a trim writes synchronously from the mousemove — so "decide at the
// move" and "decide at the write" would be the same moment were it not for the
// moves `computeTrimUpdate` refuses, which write nothing. The flag is therefore
// asked for inside the `if (update)`: a gesture whose opening move was rejected
// must still push on the write that does land.
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
  /**
   * The store's `updateClip`. The trailing `skipHistory` is ESCSUITE-77's: the
   * gesture's first write leaves it `false` and the rest of the drag passes
   * `true`, so the whole trim is one undo entry.
   */
  updateClip: (clipId: string, updates: Partial<Clip>, skipHistory?: boolean) => void;
  /**
   * The store's `shiftClipsAfter`, for the ripple tool. Takes the same trailing
   * `skipHistory`: the release's shift belongs to the trim that preceded it, so
   * it joins that gesture's entry rather than opening one of its own.
   */
  shiftClipsAfter: (trackId: string | undefined, afterTime: number, delta: number, skipHistory?: boolean) => void;
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
  /**
   * Whether the trim under way has already pushed its undo entry. A ref, not
   * state: it is read and written by a document listener on every mousemove,
   * and a re-render per frame is the opposite of what this hook wants.
   */
  const historyPushedRef = useRef(false);

  /**
   * The `skipHistory` flag for the store write that is about to happen: `false`
   * for the first write of a gesture — which therefore snapshots the clip as it
   * was before the drag — and `true` for every write after it.
   *
   * Call it where the write happens, never at the mousemove that asks for one:
   * `computeTrimUpdate` refuses a move that would leave the clip too short, and
   * such a move writes nothing at all. Marking the gesture as pushed there would
   * lose the entry the trim owes the undo stack.
   *
   * A plain function, not a `useCallback`: its only two callers are
   * `handleMouseMove` and `handleMouseUp`, which this hook deliberately rebuilds
   * on every render so that the moves and the release read the clips they always
   * did (see the note at the top). Nothing takes its identity as a dependency, so
   * memoising it would buy nothing and claim otherwise.
   */
  const skipHistoryForWrite = (): boolean => {
    if (historyPushedRef.current) return true;
    historyPushedRef.current = true;
    return false;
  };

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
      updateClip(trim.clipId, update, skipHistoryForWrite());
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
          // Shift all clips after the original end position. Part of the trim
          // that produced it, not a step of its own: asked *before* the ref
          // reset below, so it answers `true` whenever the drag wrote anything
          // — and still pushes in the case where it did not, which a non-zero
          // delta makes unreachable today.
          shiftClipsAfter(clip.trackId, originalEnd, delta, skipHistoryForWrite());
        }
      }
    }
    trimRef.current = null;
    trackArea.end();
    // Belt and braces with the reset in `handleTrimMouseDown`: every write is
    // gated on a `trimRef` only that handler fills, so the flag cannot be read
    // stale today. Clearing it at both ends keeps the invariant local to the
    // gesture.
    historyPushedRef.current = false;
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
      // A fresh gesture owes the undo stack one entry, which its first store
      // write will push. A press released without a move writes nothing and so
      // pushes nothing.
      historyPushedRef.current = false;
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
