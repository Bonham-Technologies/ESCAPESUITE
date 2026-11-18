// What the library asks before it deletes a row (ESCSUITE-483).
//
// Deleting a take's primary deletes its companion parts with it
// (`useRecordingLibrary.handleDeleteRecording` cascades on `takeId`), so the
// question says how many files go and which ones whenever that is more than
// one. A companion row deletes only itself, and a plain take is one file.
import type { Recording } from '../store/types';
import { companionPartFor, companionRank } from './companionParts';
import type { ConfirmRequest } from './confirmAction';

/** The tail every question ends with: there is no undo. */
export const DELETE_IS_PERMANENT = "This can't be undone.";

/**
 * The files deleting `id` takes with it — its companion parts, in the order
 * the library lists them. Empty for a companion row or a plain take. The same
 * test `handleDeleteRecording` cascades on.
 */
export function companionsOf(id: string, recordings: Recording[]): Recording[] {
  return recordings
    .filter((r) => r.takeId === id && r.id !== id)
    .sort((a, b) => companionRank(a.role) - companionRank(b.role));
}

/** "a and b", "a, b and c" — only ever called with two or more. */
function listInWords(items: string[]): string {
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The question the Delete button asks about `recording`. */
export function deleteConfirmation(
  recording: Recording,
  recordings: Recording[]
): Omit<ConfirmRequest, 'returnFocus'> {
  const companions = companionsOf(recording.id, recordings);
  const files = companions.length + 1;
  const parts = companions.map((c) => {
    // `companionsOf` matched on `takeId`, so each has a companion role — but a
    // role written by a newer CRAFT has no descriptor here, and is still a file.
    const label = companionPartFor(c.role)?.label;
    return label ? `the ${label} track` : 'another track';
  });
  const message =
    files > 1
      ? `This take is ${files} files, and all of them will be deleted: ${listInWords(['the recording', ...parts])}. ${DELETE_IS_PERMANENT}`
      : DELETE_IS_PERMANENT;
  return {
    title: `Delete "${recording.name}"?`,
    message,
    confirmLabel: 'Delete',
  };
}
