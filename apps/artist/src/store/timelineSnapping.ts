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
//
// `clampTrimToNeighbours` and `firstFreeGroupStart` (ESCSUITE-161 / 162) are
// the same invariant asked by the other two writers that can break it. The
// timeline's rule is that **one row never holds two overlapping clips** —
// `store/clipQueries.ts`'s `getClipsAtTime` returns every clip at an instant,
// so a row holding two means the preview, both exporters and
// `core/audioMixer.ts` draw and mix both, `core/exportTypes.ts`'s
// `getActiveTransition` misreads the pair, and the clip drag then refuses to
// move either of them. `wouldOverlap` is how a drop keeps the rule and
// `duplicateClip` walks its row past a collision; these two are how a trim and
// a paste keep it. Both are arithmetic over the clips they are handed, with no
// store and no DOM. `clampTrimToNeighbours` allocates nothing at all, because a
// trim calls it on every mousemove; `firstFreeGroupStart` builds and sorts one
// span per (member, same-row clip) pair whether the two collide or not, and
// runs once per Ctrl+V.
//
// One importer places clips whose times it did not choose: `addCaptionCues`
// (ESCSUITE-293) keeps a caption file's cues in file order on the one Captions
// track, overlaps included. A gesture on such a pair must not be broken by an
// overlap it found (ESCSUITE-308): `preexistingOverlaps` names what a clip
// already overlaps, the trim clamp and both drag vetoes leave those clips out of
// their neighbours, and `wouldOverlap` itself — the placement predicate — is
// unchanged. Paste and duplicate keep the strict rule: they make clips, and a
// clip made now has no overlap to have found.
import type { Clip, Track, TrimOrigin } from './types';

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

/**
 * How far inside a clip another one must reach before this counts as an
 * overlap: one nanosecond (ESCSUITE-161 / 162 review).
 *
 * The two writers that butt a clip up against its neighbour aim at the
 * neighbour's exact edge and cannot land on it in binary floating point. A
 * clamped end trim writes `endTime = startTime + (mouseTime - timelinePosition)`
 * and `trimClip` derives `duration = endTime - startTime`, so the clip's end is
 * `p + ((s + (L - p)) - s)` — not `L`: fuzzed over 2e6 random triples, 8.0% of
 * end trims land strictly past the limit, worst 3.55e-15 s. A relocated paste is
 * the same shape from the other side (`offset + (occupantEnd - offset)`, short
 * of the occupant's end in 3.2% of cases, worst 3.55e-15 s).
 *
 * A strict comparison read those misses as collisions, which is not harmless:
 * `canMoveSelectedClips` is state-based rather than sampled, so a group holding
 * both butted clips refused every drag, silently and for good. One nanosecond is
 * far below a frame and below `MIN_CLIP_DURATION` and `MIN_SPLIT_DISTANCE`, so
 * no overlap a user can make falls inside it; it lives in the shared predicate
 * rather than as a tolerance sprinkled over the two writers, so every reader of
 * the invariant answers the same question.
 */
const OVERLAP_EPSILON = 1e-9;

/**
 * Whether `clip` reaches into the span `[start, end)` by more than
 * `OVERLAP_EPSILON` — the one comparison every reader of "do these two
 * overlap?" makes: `wouldOverlap` for a placement, `preexistingOverlaps` and
 * `clampTrimToNeighbours` for what a gesture found when it began
 * (ESCSUITE-308). A pair meeting within the epsilon is butted, not
 * overlapping, which is the side the tie has to fall on: a clamped end trim
 * lands up to 3.55e-15 s past its neighbour's start, and reading that as an
 * overlap the gesture *found* would exempt the neighbour from the clip's next
 * trim and let it run straight over it.
 */
export function overlapsSpan(
  clip: Pick<Clip, 'timelinePosition' | 'duration'>,
  start: number,
  end: number
): boolean {
  return (
    start < clip.timelinePosition + clip.duration - OVERLAP_EPSILON &&
    end > clip.timelinePosition + OVERLAP_EPSILON
  );
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

    // Overlap if ranges intersect by more than a float bit's worth.
    if (overlapsSpan(clip, position, end)) {
      return true;
    }
  }

  return false;
}

/**
 * The clips on `clip`'s own row that already overlap it — the overlaps a
 * gesture on `clip` *found*, rather than made (ESCSUITE-308).
 *
 * The rule the four writers keep is that one row never holds two overlapping
 * clips, but one importer places clips it did not choose the times of:
 * `addCaptionCues` (ESCSUITE-293) keeps a caption file's cues in file order on
 * the one Captions track, and a file may overlap two cues. Read as neighbours,
 * such a pair broke both gestures — the trim clamp took the inner cue's start
 * as the long cue's end limit (a 9 s caption became 1 s on the first move),
 * and the drag veto read the pair as already colliding and refused every drag
 * of either. A gesture may keep, or change, an overlap it found; it may not
 * make one with a clip it did not overlap. The clip drag takes this set once,
 * on mousedown, beside its snap points; `canMoveSelectedClips` takes it per
 * member from the clips it is handed, which a drag has not yet changed.
 */
export function preexistingOverlaps(
  clip: Pick<Clip, 'id' | 'trackId' | 'timelinePosition' | 'duration'>,
  clips: Clip[]
): Set<string> {
  const found = new Set<string>();
  const end = clip.timelinePosition + clip.duration;
  for (const other of clips) {
    if (other.trackId !== clip.trackId || other.id === clip.id) continue;
    if (overlapsSpan(other, clip.timelinePosition, end)) found.add(other.id);
  }
  return found;
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
  /**
   * Each member where it would land, beside the clips it already overlapped
   * where it stands (ESCSUITE-308): those are not in its way, wherever the
   * move takes the pair.
   */
  const moved: { clip: Clip; found: ReadonlySet<string> }[] = [];

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
      clip: {
        ...clip,
        trackId: order[to],
        timelinePosition: Math.max(0, clip.timelinePosition + deltaTime),
      },
      found: preexistingOverlaps(clip, clips),
    });
  }

  for (const { clip, found } of moved) {
    // No `excludeClipId`: a member's own old placement is not in `settled` — it
    // is in `moved` — so there is nothing of its own for it to collide with.
    // What it already overlapped is left out of the candidates: a group may
    // carry an overlap it found, or slide one member across another it found,
    // but may not land on anything new.
    const candidates = settled.filter((other) => !found.has(other.id));
    if (wouldOverlap(candidates, clip.trackId, clip.timelinePosition, clip.duration)) {
      return false;
    }
    settled.push(clip);
  }

  return true;
}

/**
 * Where the pointer may take a trim before the clip would run into its
 * neighbour on its own row (ESCSUITE-161): `mouseTime` itself when there is
 * nothing in the way, the neighbour's facing edge when there is.
 *
 * The edge being dragged says which neighbour matters and which of the clip's
 * own edges is the fixed one to measure from — an end trim never moves the
 * clip's start, and a start trim never moves its end (`computeTrimUpdate`
 * holds `origin`'s end for both clip kinds). A neighbour starting at or after
 * that fixed start is in front of the clip; one ending at or before that fixed
 * end is behind it; the nearest of them is as far as the trim may go. A
 * neighbour touching the clamped edge exactly is not an overlap, which is the
 * same open-interval rule `wouldOverlap` applies.
 *
 * A clip that already overlapped the trimmed one at the gesture's start — its
 * span reaching into `origin`'s by more than `OVERLAP_EPSILON` — is no
 * neighbour at all (ESCSUITE-308, `preexistingOverlaps`' rule). Imported
 * caption cues can overlap; read as neighbours, a cue with a shorter one inside
 * it clamped its end to the inner cue's start on the first move. One it did not
 * overlap still clamps as before.
 *
 * Clamping the *pointer time* rather than the computed update is what keeps the
 * gesture idempotent: `computeTrimUpdate` re-derives the edge from the origin
 * and the pointer on every move, so a trim that wanders out past the neighbour
 * and back comes home exactly (ESCSUITE-110's rule), with the clamp applied to
 * the input rather than accumulated into the result.
 */
export function clampTrimToNeighbours(
  clips: Clip[],
  clip: Pick<Clip, 'id' | 'trackId' | 'timelinePosition'>,
  edge: 'start' | 'end',
  origin: TrimOrigin,
  mouseTime: number
): number {
  // Where the clip stood when the gesture began. A clip that already reached
  // into that span is not a neighbour (ESCSUITE-308): the trim found that
  // overlap rather than made it. Two numbers, not a set, because the clamp
  // runs on every mousemove and must allocate nothing — and the clips it is
  // handed besides the trimmed one do not move while a trim runs.
  const originEnd = origin.timelinePosition + (origin.endTime - origin.startTime);
  const fixedEdge = edge === 'end' ? clip.timelinePosition : originEnd;

  let limit: number | null = null;

  for (const other of clips) {
    if (other.trackId !== clip.trackId) continue;
    if (other.id === clip.id) continue;
    if (overlapsSpan(other, origin.timelinePosition, originEnd)) continue;

    if (edge === 'end') {
      if (other.timelinePosition >= fixedEdge && (limit === null || other.timelinePosition < limit)) {
        limit = other.timelinePosition;
      }
      continue;
    }

    const otherEnd = other.timelinePosition + other.duration;
    if (otherEnd <= fixedEdge && (limit === null || otherEnd > limit)) {
      limit = otherEnd;
    }
  }

  if (limit === null) return mouseTime;
  return edge === 'end' ? Math.min(mouseTime, limit) : Math.max(mouseTime, limit);
}

/** One clip of a group being placed together, relative to the group's start. */
export interface GroupMember {
  /** The row it lands on. */
  trackId: string;
  /** Seconds after the group's start at which it begins. */
  offset: number;
  /** How long it is, in seconds. */
  duration: number;
}

/**
 * The earliest start at or after `preferredStart` at which **no** member of the
 * group lands on a clip already on its row (ESCSUITE-162). The group moves as
 * one, so its members keep their offsets from each other.
 *
 * Every (member, occupant) collision is one open span of the group's own start
 * coordinate: a member at `start + offset` for `duration` seconds overlaps an
 * occupant `[from, to)` exactly while the group starts inside
 * `(from - offset - duration, to - offset)`. Sorted by their left edge and
 * swept once, those spans give the first start outside all of them — the group
 * is bumped to a span's right edge whenever it falls inside, and a span whose
 * left edge is already past the group can never be bumped back into, because
 * the group only ever moves forward. There is always an answer: past the last
 * occupant's end, every row is free.
 */
export function firstFreeGroupStart(
  clips: Clip[],
  members: readonly GroupMember[],
  preferredStart: number
): number {
  const blocked: { from: number; to: number }[] = [];

  for (const member of members) {
    for (const clip of clips) {
      if (clip.trackId !== member.trackId) continue;
      blocked.push({
        from: clip.timelinePosition - member.offset - member.duration,
        to: clip.timelinePosition + clip.duration - member.offset,
      });
    }
  }

  blocked.sort((a, b) => a.from - b.from);

  let start = preferredStart;
  for (const span of blocked) {
    if (span.from < start && start < span.to) start = span.to;
  }

  return start;
}
