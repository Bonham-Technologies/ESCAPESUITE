// ESCSUITE-255: what a transform write is allowed to contain.
import type { ClipTransform } from './types';

const POSITIVE_FIELDS = ['scaleX', 'scaleY'] as const;
const FINITE_FIELDS = ['x', 'y', 'rotation', 'opacity'] as const;

/**
 * Whether a (partial) transform is safe to write: every numeric field it
 * carries is a finite number, and `scaleX` / `scaleY` are above zero — the
 * rule `projectMigration.ts`'s `isValidTransform` applies to a whole
 * transform in a file. A field the write leaves out (or leaves `undefined`)
 * is not the write's business. `scaleLocked` is a UI preference, not checked.
 *
 * The inspector's range inputs and the resize handles floor a scale at 0.1,
 * so only a computed write can break this — Fit to Canvas on a source that
 * reported 0x0 wrote `Infinity`, which the autosave kept and a saved
 * `.veditor` serialised as `null`.
 */
export function isSaneTransformWrite(updates: Partial<ClipTransform>): boolean {
  for (const key of POSITIVE_FIELDS) {
    const value = updates[key];
    if (value !== undefined && !(Number.isFinite(value) && value > 0)) return false;
  }
  for (const key of FINITE_FIELDS) {
    const value = updates[key];
    if (value !== undefined && !Number.isFinite(value)) return false;
  }
  return true;
}
