// Which clips are edited as one (ESCSUITE-355).
//
// A take recorded with ESCAPECRAFT's separate tracks lands as one clip per part
// — screen, webcam, microphone, system audio — each on its own row. They are
// one recording, so `placeTakeOnTimeline` gives them one `linkGroupId`, and a
// split, a delete, a ripple delete or a drag of any of them acts on all of
// them unless the user holds Alt. A link group is a *segment*: a split leaves
// the left halves in the group they had and puts the right halves in a new
// one, so dragging one piece moves its partners, not every piece of the take.
//
// A linked clip on a locked track is left alone by a split or a delete — the
// lock is the user saying "do not touch this row" — and refuses a move whole,
// the way a multi-selection's move already does.
import { v4 as uuidv4 } from 'uuid';
import type { Clip, Track } from './types';
import { lockedTrackIds } from './trackLock';

/**
 * `clipIds` and every clip linked to any of them, as one set. A clip with no
 * link adds only itself; an id that names no clip is kept as given, so a
 * caller's own ghost check still sees it.
 */
export function withLinkedClips(clips: readonly Clip[], clipIds: Iterable<string>): Set<string> {
  const ids = new Set(clipIds);
  const groups = new Set<string>();
  for (const clip of clips) {
    if (ids.has(clip.id) && clip.linkGroupId) groups.add(clip.linkGroupId);
  }
  if (groups.size === 0) return ids;
  for (const clip of clips) {
    if (clip.linkGroupId && groups.has(clip.linkGroupId)) ids.add(clip.id);
  }
  return ids;
}

/** The clips linked to `clip`, not counting itself. */
export function linkedPartners(clips: readonly Clip[], clip: Clip): Clip[] {
  if (!clip.linkGroupId) return [];
  return clips.filter((other) => other.id !== clip.id && other.linkGroupId === clip.linkGroupId);
}

/** `clip` without a link. The same object when it had none. */
export function withoutLink(clip: Clip): Clip {
  if (clip.linkGroupId === undefined) return clip;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { linkGroupId, ...rest } = clip;
  return rest;
}

/**
 * Copies of linked clips linked to each other and to nothing else: each group
 * the copies carry gets one fresh id, shared by the copies that carried it. A
 * paste of a whole take stays a take; it is not tied to the take it came from.
 * A copy whose group has no other copy beside it is unlinked.
 */
export function relinkCopies(copies: readonly Clip[]): Clip[] {
  const count = new Map<string, number>();
  for (const clip of copies) {
    if (clip.linkGroupId) count.set(clip.linkGroupId, (count.get(clip.linkGroupId) ?? 0) + 1);
  }
  const fresh = new Map<string, string>();
  return copies.map((clip) => {
    if (!clip.linkGroupId) return clip;
    if ((count.get(clip.linkGroupId) ?? 0) < 2) return withoutLink(clip);
    let id = fresh.get(clip.linkGroupId);
    if (!id) {
      id = uuidv4();
      fresh.set(clip.linkGroupId, id);
    }
    return { ...clip, linkGroupId: id };
  });
}

/**
 * `clipId` and the clips linked to it that a delete may take: every partner
 * not on a locked track. `clipId`'s own lock is the caller's to refuse.
 */
export function deletableWithLinks(clips: readonly Clip[], tracks: Track[], clipId: string): Set<string> {
  const ids = new Set([clipId]);
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return ids;
  const locked = lockedTrackIds(tracks);
  for (const partner of linkedPartners(clips, clip)) {
    if (!locked.has(partner.trackId)) ids.add(partner.id);
  }
  return ids;
}
