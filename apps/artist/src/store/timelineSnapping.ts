// Where a dragged clip is allowed to land.
//
// Pure functions over the clips they are handed: `getSnapPoints` collects the
// timeline's edges (plus 0, which is always a snap target), `findNearestSnapPoint`
// picks the closest of them inside a threshold, and `wouldOverlap` answers whether
// a placement collides with something already on the track. None of them reads the
// store, so the timeline's geometry and drag handlers can import them without
// pulling the store module into their graph. `projectStore.ts` re-exports all three
// for the callers that have always reached them through it.
//
// `trackIndexDelta` and `canMoveSelectedClips` (ESCSUITE-80) are the same kind of
// thing one level up: the two questions a *multi-selection's* drop asks before it
// commits — how many rows the gesture moved, and whether every clip in the group
// can take that move. They are here rather than in the drag hook because they are
// arithmetic over clips and tracks with no DOM and no store in them, and because
// they are answers about `selectionSlice.moveSelectedClips` — the action they
// guard — whose index space they share. `trackRefusesDrop` (ESCSUITE-82) is the
// one rule about a *row* the two drop paths share: a locked row, or one that is
// not on the timeline, takes no clip.
import type { Clip, Track } from './types';

// Get snap points from all clip edges
export function getSnapPoints(clips: Clip[], excludeClipId?: string): number[] {
  const points: Set<number> = new Set([0]); // Always snap to start

  for (const clip of clips) {
    if (clip.id === excludeClipId) continue;
    points.add(clip.timelinePosition);
    points.add(clip.timelinePosition + clip.duration);
  }

  return Array.from(points).sort((a, b) => a - b);
}

// Find nearest snap point within threshold
export function findNearestSnapPoint(
  position: number,
  snapPoints: number[],
  threshold: number
): number | null {
  let nearest: number | null = null;
  let minDistance = threshold;

  for (const point of snapPoints) {
    const distance = Math.abs(position - point);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = point;
    }
  }

  return nearest;
}

// Check if clip placement would overlap with another on same track
export function wouldOverlap(
  clips: Clip[],
  trackId: string,
  position: number,
  duration: number,
  excludeClipId?: string
): boolean {
  const end = position + duration;

  for (const clip of clips) {
    if (clip.trackId !== trackId) continue;
    if (clip.id === excludeClipId) continue;

    const clipEnd = clip.timelinePosition + clip.duration;
    // Overlap if ranges intersect
    if (position < clipEnd && end > clip.timelinePosition) {
      return true;
    }
  }

  return false;
}

/**
 * The timeline's track ids in the order `selectionSlice.moveSelectedClips`
 * indexes them: ascending `index`, which is bottom-to-top on screen (the
 * timeline draws the highest index at the top). The two helpers below are its
 * only callers, and they exist to agree with that action's arithmetic.
 */
function orderedTrackIds(tracks: Track[]): string[] {
  return [...tracks].sort((a, b) => a.index - b.index).map((track) => track.id);
}

/**
 * How many rows a drop moved the clip the pointer was holding, in
 * `moveSelectedClips`' index space — or **null** when either row is not on the
 * timeline, which a caller must refuse outright rather than read as "no row
 * change". Reachable: a track removed while a drag over it is live.
 */
export function trackIndexDelta(
  tracks: Track[],
  fromTrackId: string,
  toTrackId: string
): number | null {
  const order = orderedTrackIds(tracks);
  const from = order.indexOf(fromTrackId);
  const to = order.indexOf(toTrackId);
  if (from === -1 || to === -1) return null;
  return to - from;
}

/**
 * Whether a row refuses to take a clip: it is locked, or it is not on the
 * timeline at all. The single-clip drop asks this of the row under the
 * pointer; `canMoveSelectedClips` applies the same locked rule inline, over a
 * Set, because it is in a loop — and it has its own "not on the timeline"
 * check already, on the row index (ESCSUITE-82). The mousedown already refuses
 * to *start* on a locked row; this is the other end of the gesture, which used
 * to check nothing — a clip could be dropped onto a locked row, and a
 * selection holding a clip on one (ctrl+click adds it) could be dragged off it
 * by a free member. A rule added here must be added to that loop too.
 */
export function trackRefusesDrop(tracks: Track[], trackId: string): boolean {
  const track = tracks.find((t) => t.id === trackId);
  return track === undefined || track.locked;
}

/** A move `moveSelectedClips` would make, asked about before it is made. */
export interface BulkMove {
  /** Every clip on the timeline — the movers and the ones they could land on. */
  clips: Clip[];
  /** Every track, for the row arithmetic and the edges of the stack. */
  tracks: Track[];
  /** Which clips are moving. */
  selectedClipIds: ReadonlySet<string>;
  /** Seconds every member moves along the timeline. */
  deltaTime: number;
  /** Rows every member moves, in `orderedTrackIds` space. */
  deltaTrack: number;
}

/**
 * Whether **every** selected clip can take the move — so the caller can commit
 * all of it or none of it.
 *
 * Four ways a member refuses, matching the single-clip drop's own veto one
 * rung down in `useClipDrag`: its current row is not on the timeline, the row
 * it would land on is off the top or the bottom of the stack, either of those
 * rows is locked (ESCSUITE-82), or its landing spot is taken. A member's *old*
 * placement is never in the way — the group vacates it in the same write — so
 * a selection sliding along its own run never vetoes itself.
 *
 * There is no audio-versus-video row check here, and that is not an omission:
 * ARTIST's `Track` has no kind. A clip is audio because its *source* media is
 * (`TimelineTrack` reads `sourceMedia?.mediaType`), and any clip may sit on any
 * track — which is exactly what the single-clip drop allows too.
 *
 * Positions are computed the way `moveSelectedClips` computes them, the
 * `Math.max(0, …)` clamp included, so what is checked is what would be written.
 */
export function canMoveSelectedClips({
  clips,
  tracks,
  selectedClipIds,
  deltaTime,
  deltaTrack,
}: BulkMove): boolean {
  const order = orderedTrackIds(tracks);
  const trackIndex = new Map(order.map((id, index) => [id, index]));
  const locked = new Set(tracks.filter((track) => track.locked).map((track) => track.id));

  /** The clips nothing is moving, and then each member as it is placed. */
  const settled: Clip[] = [];
  const moved: Clip[] = [];

  for (const clip of clips) {
    if (!selectedClipIds.has(clip.id)) {
      settled.push(clip);
      continue;
    }

    const from = trackIndex.get(clip.trackId);
    if (from === undefined) return false;
    const to = from + deltaTrack;
    if (to < 0 || to >= order.length) return false;
    // A locked row holds what it has and takes nothing new. The row the member
    // sits on can be locked even though the drag started elsewhere: the
    // mousedown guard only sees the row of the clip the pointer holds.
    if (locked.has(clip.trackId) || locked.has(order[to])) return false;

    moved.push({
      ...clip,
      trackId: order[to],
      timelinePosition: Math.max(0, clip.timelinePosition + deltaTime),
    });
  }

  for (const clip of moved) {
    // No `excludeClipId`: a member's own old placement is not in `settled` — it
    // is in `moved` — so there is nothing of its own for it to collide with.
    if (wouldOverlap(settled, clip.trackId, clip.timelinePosition, clip.duration)) {
      return false;
    }
    settled.push(clip);
  }

  return true;
}
