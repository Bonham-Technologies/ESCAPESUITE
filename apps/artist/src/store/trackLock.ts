// Which rows are frozen, and whether a given clip sits on one.
//
// `Track.locked` means "prevent edits" (ESCSUITE-84): every store action that
// would add a clip to a locked track, or change, move, remove, split, duplicate,
// keyframe or restyle a clip already on one, asks one of these four questions
// first and returns its state untouched when the answer is yes. Pure functions
// over the clips and tracks they are handed — no store, no React — so a slice
// can import them without an edge to any other slice, the way it imports
// `timelineSnapping.ts` and `projectFactory.ts`.
//
// A track that is not on the timeline is not locked, and a clip that is not on
// the timeline is not on a locked track: both are "nothing to protect", and the
// action that asked already has its own answer for a missing id.
import type { Clip, Track } from './types';

/** Ids of the tracks whose contents are frozen. */
export function lockedTrackIds(tracks: Track[]): Set<string> {
  const ids = new Set<string>();
  for (const track of tracks) {
    if (track.locked) ids.add(track.id);
  }
  return ids;
}

/** Whether `trackId` names a locked track. */
export function isTrackLocked(tracks: Track[], trackId: string | undefined): boolean {
  if (trackId === undefined) return false;
  const track = tracks.find((t) => t.id === trackId);
  return track !== undefined && track.locked;
}

/** Whether the clip with `clipId` sits on a locked track. */
export function clipOnLockedTrack(clips: Clip[], tracks: Track[], clipId: string): boolean {
  const clip = clips.find((c) => c.id === clipId);
  return clip !== undefined && isTrackLocked(tracks, clip.trackId);
}

/**
 * Whether ANY of the named clips sits on a locked track — the all-or-nothing
 * question a group action asks before it touches anything.
 */
export function anyClipOnLockedTrack(
  clips: Clip[],
  tracks: Track[],
  clipIds: Iterable<string>
): boolean {
  const wanted = clipIds instanceof Set ? clipIds : new Set(clipIds);
  if (wanted.size === 0) return false;
  const locked = lockedTrackIds(tracks);
  if (locked.size === 0) return false;
  for (const clip of clips) {
    if (wanted.has(clip.id) && locked.has(clip.trackId)) return true;
  }
  return false;
}
