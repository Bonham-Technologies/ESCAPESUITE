// The selection, reconciled against whatever clips are actually left on the
// timeline (ESCSUITE-101).
//
// Nothing that removes a clip from the timeline — a single delete, a ripple
// delete, a split, a track or a source video taking its clips with it, or an
// undo/redo landing on an older or newer clip list — used to touch
// `selectedClipId` or `selectedClipIds` beyond the one id the caller already
// knew about. A clip that left through any other door stayed "selected": the
// paste → undo → Delete sequence in the ticket is `pasteClips` leaving the
// pasted clip selected, `undo` removing it from the timeline without
// reconciling the selection, and `deleteSelectedClips` then finding a
// selection that still names it and deleting nothing — but still pushing an
// undo entry, because nothing told it there was nothing to do.
//
// One pure question, asked the way `trackLock.ts`'s five are: no store, no
// React, just the clips and the selection a caller hands it.
import type { Clip } from './types';

export interface PrunedSelection {
  selectedClipId: string | null;
  selectedClipIds: Set<string>;
}

/**
 * `selectedClipId` and `selectedClipIds` with every id that names no clip in
 * `clips` dropped. `selectedClipId` becomes `null` when it was one of them.
 *
 * Reference-stable: returns the SAME `selectedClipIds` Set (and the same
 * `selectedClipId` value) when nothing needed pruning, so a caller that
 * spreads the result into its own `set()` triggers no re-render over a
 * selection that did not actually change.
 */
export function pruneSelection(
  clips: Clip[],
  selectedClipId: string | null,
  selectedClipIds: Set<string>
): PrunedSelection {
  // Nothing selected, nothing to prune — the common case for undo/redo, which
  // ask this on every keypress whether or not anything is selected. Skips
  // building a Set of every clip id on the timeline for a question whose
  // answer is already known.
  if (selectedClipId === null && selectedClipIds.size === 0) {
    return { selectedClipId, selectedClipIds };
  }

  const existing = new Set(clips.map((clip) => clip.id));

  let prunedIds = selectedClipIds;
  for (const id of selectedClipIds) {
    if (!existing.has(id)) {
      prunedIds = new Set([...selectedClipIds].filter((candidate) => existing.has(candidate)));
      break;
    }
  }

  const prunedId = selectedClipId !== null && !existing.has(selectedClipId) ? null : selectedClipId;

  return { selectedClipId: prunedId, selectedClipIds: prunedIds };
}
