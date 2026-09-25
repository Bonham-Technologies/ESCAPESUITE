// The parts of one take, and the order they stack in (ESCSUITE-14).
//
// The mirror of ESCAPECRAFT's `utils/takeOrder.ts`, which groups its library
// rows by the same rule: a take is named by its primary, so the primary's
// `takeId` is its own id and "belongs to this take" is one equality. Kept pure
// over the metadata list — `app/takeImport.ts` is the only caller, and the
// grouping is the half of it worth testing without storage.
import type { SourceVideo } from '../store/types';

/**
 * The roles this build knows how to place, in the order they stack: the screen
 * at the bottom, then the camera over it, then the audio parts.
 *
 * Typed as plain strings on purpose. `RecordingRole` is a compile-time union
 * and IndexedDB is not type-checked, so the question these answer — "is this a
 * role we know?" — has to be a runtime one.
 */
const ROLE_ORDER: readonly string[] = ['screen', 'webcam', 'mic', 'system'];

/**
 * Where a part sits in its take's stack. `Infinity` for a role this build does
 * not know, which is what keeps such a part off the timeline.
 */
export function partRoleRank(role: string | undefined): number {
  const rank = ROLE_ORDER.indexOf(role ?? '');
  return rank === -1 ? Number.POSITIVE_INFINITY : rank;
}

/** Whether a companion with this role can be put on the timeline at all. */
export function isPlaceableRole(role: string | undefined): boolean {
  return Number.isFinite(partRoleRank(role));
}

/**
 * The take's parts, primary first, then its companions in role order.
 *
 * Companions are not sorted by `recordedAt`: every part of a take is saved
 * within a millisecond or two of every other, and they are written in an order
 * that is the save path's business rather than the timeline's. Two parts of the
 * same rank fall back to their ids, so the answer does not depend on what
 * `getAllVideoMetadata()` happened to return first.
 */
export function orderTakeParts(primary: SourceVideo, all: SourceVideo[]): SourceVideo[] {
  const companions = all
    .filter((candidate) => candidate.id !== primary.id && candidate.takeId === primary.id)
    .sort((a, b) => {
      const byRole = partRoleRank(a.role) - partRoleRank(b.role);
      // Infinity - Infinity is NaN, which would leave two unknown-role parts in
      // an order the engine chose; ids decide instead.
      return Number.isNaN(byRole) || byRole === 0 ? a.id.localeCompare(b.id) : byRole;
    });

  return [primary, ...companions];
}
