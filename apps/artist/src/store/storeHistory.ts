// Undo/redo history for the editor store: the snapshot taken before a change and
// the cap on how many are kept. Every mutating action pushes through here.

import type { EditorState, UndoableState } from './types';
import { createUndoableSnapshot } from '../utils/deepClone';

// Maximum history size to prevent memory issues
const MAX_HISTORY_SIZE = 50;

// Helper to get undoable state snapshot
function getUndoableState(state: EditorState): UndoableState {
  return createUndoableSnapshot(state.project, state.sourceVideos);
}

// Helper to push state to history (call before making changes)
function pushToHistory(state: EditorState): { past: UndoableState[]; future: UndoableState[] } {
  const snapshot = getUndoableState(state);
  const newPast = [...state.history.past, snapshot];

  // Limit history size
  if (newPast.length > MAX_HISTORY_SIZE) {
    newPast.shift();
  }

  return {
    past: newPast,
    future: [], // Clear future on new action
  };
}

/**
 * Clear a just-revoked thumbnail URL out of every history snapshot that
 * still carries it. A `SourceVideo.thumbnailUrl` is one browser-wide
 * `URL.createObjectURL` handle (`revokeSourceThumbnails`, core/storage.ts) —
 * revoking it for the live source also kills it for any undo/redo snapshot
 * taken while that source still held it. `structuredClone` (`deepClone.ts`)
 * copies the *string*, not a live reference, so the clone is left holding the
 * exact same now-dead handle (ESCSUITE-113): undo/redo themselves never
 * revoke — a source coming back via redo still needs a working URL — but a
 * source coming back via undo *past* a teardown that already revoked it would
 * otherwise land on a `thumbnailUrl` nothing can ever open again. Scrubbed
 * here, it comes back with none instead — exactly how a source that never
 * had a thumbnail already renders — and picks up a live one again the next
 * time it is genuinely reloaded into the library.
 *
 * Called from the same action that revokes, over its own returned history
 * (which already includes the entry it just pushed), so there is nothing for
 * `undo`/`redo` themselves to do.
 */
export function scrubDeadThumbnails(
  history: { past: UndoableState[]; future: UndoableState[] },
  deadUrls: readonly string[]
): { past: UndoableState[]; future: UndoableState[] } {
  if (deadUrls.length === 0) return history;
  const dead = new Set(deadUrls);
  const carriesADeadUrl = (snapshot: UndoableState) =>
    snapshot.sourceVideos.some((v) => v.thumbnailUrl && dead.has(v.thumbnailUrl));
  const scrubOne = (snapshot: UndoableState): UndoableState => {
    if (!carriesADeadUrl(snapshot)) return snapshot;
    return {
      ...snapshot,
      sourceVideos: snapshot.sourceVideos.map((v) =>
        v.thumbnailUrl && dead.has(v.thumbnailUrl) ? { ...v, thumbnailUrl: undefined } : v
      ),
    };
  };
  return { past: history.past.map(scrubOne), future: history.future.map(scrubOne) };
}

export { getUndoableState, pushToHistory };
