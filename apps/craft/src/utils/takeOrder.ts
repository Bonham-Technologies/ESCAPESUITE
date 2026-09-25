// The order the library shows takes in: newest take first, and each take's
// companion rows directly under the primary they belong to.
//
// Kept out of the store so it is pure over the list — `loadRecordings` is its
// only caller, and the ordering is the half of that function worth testing on
// its own. A take is identified by its primary (a primary's `takeId` is its own
// id, see `utils/recordingMetadata.ts`), so grouping is one equality.
import type { Recording } from '../store/types';

/**
 * Newest take first; a take's companions immediately after its primary, oldest
 * companion first; then any companion whose primary is missing.
 *
 * Sorting companions by their own `createdAt` would break the grouping: both
 * parts are saved within the same millisecond or two and the companion is
 * written second, so by date alone a webcam row would float above the screen
 * row it describes.
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
      companions.sort((a, b) => a.createdAt - b.createdAt);
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
