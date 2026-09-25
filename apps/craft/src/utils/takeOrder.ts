// The order the library shows takes in: newest take first, and each take's
// companion rows directly under the primary they belong to.
//
// Kept out of the store so it is pure over the list — `loadRecordings` is its
// only caller, and the ordering is the half of that function worth testing on
// its own. A take is identified by its primary (a primary's `takeId` is its own
// id, see `utils/recordingMetadata.ts`), so grouping is one equality.
import type { Recording } from '../store/types';
import { companionRank } from './companionParts';

/**
 * Newest take first; a take's companions immediately after its primary, in
 * role order — webcam, then mic, then system; then any companion whose primary
 * is missing.
 *
 * Sorting companions by their own `createdAt` would break the grouping: every
 * part is saved within the same millisecond or two and the companions are
 * written second, so by date alone a webcam row would float above the screen
 * row it describes — and three companions sharing one `now` would come out in
 * whatever order storage returned them, which is uuid order.
 */
export function orderTakes(recordings: Recording[]): Recording[] {
  const companionsByTake = new Map<string, Recording[]>();
  const primaries: Recording[] = [];

  for (const recording of recordings) {
    // A primary carries its own id as its takeId, so "not the primary of its
    // own take" is exactly what makes a row a companion.
    if (recording.takeId !== undefined && recording.takeId !== recording.id) {
      const group = companionsByTake.get(recording.takeId);
      if (group) group.push(recording);
      else companionsByTake.set(recording.takeId, [recording]);
    } else {
      primaries.push(recording);
    }
  }

  primaries.sort((a, b) => b.createdAt - a.createdAt);

  const ordered: Recording[] = [];
  for (const primary of primaries) {
    ordered.push(primary);
    const companions = companionsByTake.get(primary.id);
    if (companions) {
      // Role first: every part of a take is saved with one `now`, so the date
      // cannot order three companions and storage returns them in uuid order.
      // Date second, for two companions of one role saved in two takes' worth
      // of milliseconds. The id last, so the answer never depends on what the
      // engine's sort happened to do.
      companions.sort(
        (a, b) =>
          companionRank(a.role) - companionRank(b.role) ||
          a.createdAt - b.createdAt ||
          a.id.localeCompare(b.id)
      );
      ordered.push(...companions);
      companionsByTake.delete(primary.id);
    }
  }

  // Whatever is left has no primary to sit under — storage cleared between the
  // two writes, or a primary deleted by a build that did not cascade. Shown
  // rather than hidden: a row the user cannot see is a file they cannot delete.
  const orphans = [...companionsByTake.values()]
    .flat()
    .sort((a, b) => b.createdAt - a.createdAt);

  return [...ordered, ...orphans];
}
