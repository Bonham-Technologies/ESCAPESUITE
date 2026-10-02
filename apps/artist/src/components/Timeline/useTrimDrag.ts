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
// must still push on the write that does land. Since ESCSUITE-87 the *store* can
// reject one too — a clip on a locked row refuses the write and pushes nothing
// (ESCSUITE-84) — so the bookkeeping is `hooks/useGestureHistory.ts`, shared with
// the inspector's sliders and the preview's transform drag: `commit` runs the
// write, hands it the flag and takes the "already pushed" mark back if the store
// says the write never happened.
//
// **A trim stops at the clip next to it** (ESCSUITE-161). The timeline's rule is
// that one row never holds two overlapping clips — `getClipsAtTime` returns
// every clip at an instant, so a row holding two means the preview, both
// exporters and `core/audioMixer.ts` draw and mix both of them. A drop has been
// vetoed by `store/timelineSnapping.ts`'s `wouldOverlap` since the beginning
// and `duplicateClip` walks its row past a collision; a trim wrote whatever the
// pointer asked for. `clampTrimToNeighbours` now holds the pointer time to the
// facing edge of the neighbour on the clip's own row before `computeTrimUpdate`
// ever sees it, so an end trim stops at the next clip's start and a start trim
// at the previous clip's end. Once the pointer is out past that edge every move
// computes the same update, so `changesClip` refuses the write rather than
// re-rendering the timeline per frame for no change.
//
// **The clamp lives here and not in `trimClip`**, deliberately, for three
// reasons. The **ripple** tool's end trim is excepted: it lengthens the clip
// over its neighbours during the drag and pushes them out of the way on
// release, so the overlap is real and transient and refusing it would break the
// tool — and which tool is out is something only the gesture knows, never the
// store. Its *start* trim is not excepted, and that is the asymmetry the review
// caught: `handleMouseUp` measures the shift from the clip's end, which a start
// trim never moves, so a ripple start trim shifts nothing and its overlap would
// be permanent rather than transient. And
// the store is already not where a trim's geometry is enforced: the source's
// length and `MIN_CLIP_DURATION` are `computeTrimUpdate`'s rules too, with
// `trimClip` enforcing only what it owns (the locked row, ESCSUITE-84). It also
// has exactly one caller — this hook — so a second copy of the rule in the
// store would buy no defence and cost the ripple tool a flag to turn it off
// again. The clamp is applied to the **pointer time** rather than to the
// computed update, which is what keeps ESCSUITE-110's idempotence: a trim that
// wanders out past the neighbour and back comes home exactly.
//
// **One listener pair per gesture, and one measurement.** The per-move store
// write used to be what re-bound the listeners: `clips` is a fresh array after
// every `trimClip` write, and it was in the effect's deps. The listeners now go
// through `useDocumentListener`, whose `enabled` flag is `trimState !== null` —
// a boolean that flips twice a gesture — while the handler it holds in a ref
// is still rebuilt on every render, so the moves and the release read exactly
// the clips they always did. The track area is measured once on mousedown
// (`useTrackAreaCache`); a move reads only `scrollLeft`.
import type * as React from 'react';
import { useCallback, useRef, useState, type RefObject } from 'react';
import { useDocumentListener } from '../../hooks/useDocumentListener';
import { useGestureHistory } from '../../hooks/useGestureHistory';
import { clampTrimToNeighbours } from '../../store/timelineSnapping';
import type { Clip, SourceVideo, ToolType, Track } from '../../store/types';
import { computeTrimUpdate, pointerTime, type TrimOrigin } from './timelineGeometry';
import type { TrimState } from './types';
import { useTrackAreaCache } from './useTrackAreaCache';

/**
 * Whether a computed update would actually change the clip (ESCSUITE-101's "a
 * no-op edit refuses", applied to the one gesture that writes per frame).
 *
 * `computeTrimUpdate` returns the same update for every pointer position past a
 * limit, and the clamp above turns "past a limit" from a rare case — the
 * source's own length — into the normal one for a gesture the user holds against
 * the neighbour. Writing it anyway costs a new clips array, a new `modified` and
 * a re-render every frame for no change. Comparing only the keys the update
 * carries is enough: `trimClip` derives `duration` from them and rebases the
 * animation from `trim.origin` by the resulting duration, so an update that
 * changes none of them would hand back the clip it was given.
 */
function changesClip(clip: Clip, update: Partial<Clip>): boolean {
  return (Object.keys(update) as (keyof Clip)[]).some((key) => clip[key] !== update[key]);
}

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
   * The store's `trimClip` (ESCSUITE-110 review round 1 split this out of the
   * generic `updateClip`, which a trim used to go through). The trailing
   * `skipHistory` is ESCSUITE-77's: the gesture's first write leaves it
   * `false` and the rest of the drag passes `true`, so the whole trim is one
   * undo entry.
   */
  trimClip: (
    clipId: string,
    edge: 'start' | 'end',
    updates: Partial<Clip>,
    origin: TrimOrigin,
    skipHistory?: boolean
  ) => boolean;
  /**
   * The store's `shiftClipsAfter`, for the ripple tool. Takes the same trailing
   * `skipHistory`: the release's shift belongs to the trim that preceded it, so
   * it joins that gesture's entry rather than opening one of its own.
   */
  shiftClipsAfter: (trackId: string | undefined, afterTime: number, delta: number, skipHistory?: boolean) => boolean;
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
  trimClip,
  shiftClipsAfter,
}: TrimDragDeps): TrimDrag {
  const [trimState, setTrimState] = useState<TrimState | null>(null);
  /** The same gesture, for handlers that must not wait on a render. */
  const trimRef = useRef<TrimState | null>(null);
  const trackArea = useTrackAreaCache();
  /**
   * Whether the trim under way has already pushed its undo entry. Not state: it
   * is read and written by a document listener on every mousemove, and a
   * re-render per frame is the opposite of what this hook wants.
   *
   * Every write goes through its `commit`, and `commit` is called where the write
   * happens, never at the mousemove that asks for one: `computeTrimUpdate`
   * refuses a move that would leave the clip too short, and such a move writes
   * nothing at all. Marking the gesture as pushed there would lose the entry the
   * trim owes the undo stack — and so, since ESCSUITE-87, would marking it on a
   * write the store itself refused.
   */
  const gestureHistory = useGestureHistory();

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

    // The ripple tool's END trim is the one trim allowed to run over its
    // neighbours: the release shifts them by however much the end moved, so the
    // overlap the drag makes lasts only as long as the drag. A ripple START
    // trim earns no such exception — `handleMouseUp` measures its shift from
    // the clip's **end**, and a start trim never moves the end, so the delta is
    // 0, nothing is shifted and the overlap would be permanent.
    const limitedTime =
      activeTool === 'ripple' && trim.edge === 'end'
        ? mouseTime
        : clampTrimToNeighbours(clips, clip, trim.edge, trim.origin, mouseTime);

    const update = computeTrimUpdate({
      edge: trim.edge,
      mouseTime: limitedTime,
      clip,
      sourceVideo,
      origin: trim.origin,
    });

    if (update && changesClip(clip, update)) {
      gestureHistory.commit((skipHistory) => trimClip(trim.clipId, trim.edge, update, trim.origin, skipHistory));
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
          // that produced it, not a step of its own: committed *before* the
          // gesture is closed below, so it is told to skip whenever the drag
          // wrote anything — and still pushes in the case where it did not,
          // which a non-zero delta makes unreachable today.
          gestureHistory.commit((skipHistory) =>
            shiftClipsAfter(clip.trackId, originalEnd, delta, skipHistory)
          );
        }
      }
    }
    trimRef.current = null;
    trackArea.end();
    // Belt and braces with the `begin` in `handleTrimMouseDown`: every write is
    // gated on a `trimRef` only that handler fills, so the flag cannot be read
    // stale today. Closing the gesture at both ends keeps the invariant local to
    // it.
    gestureHistory.end();
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
      gestureHistory.begin();
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
          // The gesture's own starting animation (ESCSUITE-110 review round
          // 1) — `trimClip` rebases from this on every move, never from the
          // clip's current one, so the gesture is idempotent. Never mutated
          // in place by anything else in the app, so capturing the reference
          // needs no clone.
          animation: clip.animation,
        },
      };
      trimRef.current = initial;
      setTrimState(initial);
    },
    [tracks, setSelectedClipId, trackArea, trackContainerRef, gestureHistory]
  );

  return { trimState, handleTrimMouseDown };
}
