// Undo/redo history for the editor store: the snapshot taken before a change and
// the cap on how many are kept. Every mutating action pushes through here.

import type { EditorState, SourceVideo, UndoableState } from './types';
import { createUndoableSnapshot } from '../utils/deepClone';
import { calculateTimelineDuration } from './projectFactory';
import { sameSourceVideo } from './sourceVideoEquality';

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
 * Called from the same action that revokes, over the history that action
 * leaves behind (the entry it just pushed, or, for `addSourceVideo`'s
 * replace-in-place arm, the existing stack — that add pushes nothing), so
 * there is nothing for `undo`/`redo` themselves to do.
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

/**
 * Clear a set of permanently-removed source ids — and any clip that
 * referenced one — out of every history snapshot that still carries them.
 *
 * `scrubDeadThumbnails`'s sibling, for a removal `removeSourceVideosPermanently`
 * (`store/projectSlice.ts`) makes rather than a field going stale: a storage
 * clear (Clear Unused / Clear All, `components/VideoUploader.tsx`) deletes the
 * source's bytes from IndexedDB itself, so an undo/redo that handed the
 * `SourceVideo` back would restore a tile nothing can ever play, place or
 * export again (ESCSUITE-149). Unlike `scrubDeadThumbnails`, which clears one
 * field and leaves the rest of the snapshot's source alone, this drops the
 * whole `SourceVideo` — the source itself is gone, not just its thumbnail —
 * and any clip in that snapshot's timeline that named it, recalculating the
 * snapshot's own `timeline.duration` so a restored past/future state stays
 * internally consistent with the clips it actually holds.
 *
 * Called from the same (non-undoable) action that performs the removal, over
 * every snapshot already on the stack — the clear itself pushes no entry of
 * its own, so there is nothing for `undo`/`redo` to walk back across that
 * this does not also reach.
 *
 * Returns the exact `history` object, not a structurally-equal copy, when
 * nothing in `past` or `future` carries any of `removedIds` — there is no
 * `removedIds.length === 0` fast path separate from that (ESCSUITE-149
 * review, MINOR 4): an empty list carries nothing by construction, so the
 * general check already covers it, and a caller does not have to special-case
 * "nothing to scrub" to find out whether anything changed. This is what lets
 * `removeSourceVideosPermanently` (`projectSlice.ts`) tell "scrubbed a stale
 * snapshot" apart from "truly nothing to do" with `history === state.history`
 * — needed because an id can legitimately be gone from the *live* library
 * (nothing left to remove or revoke there) while an older snapshot still
 * names it, e.g. a source already gone from a `resetProject` teardown and
 * then named again in a later storage clear.
 */
export function scrubRemovedSources(
  history: { past: UndoableState[]; future: UndoableState[] },
  removedIds: readonly string[]
): { past: UndoableState[]; future: UndoableState[] } {
  const removed = new Set(removedIds);
  const carriesARemovedSource = (snapshot: UndoableState) =>
    snapshot.sourceVideos.some((v) => removed.has(v.id)) ||
    snapshot.project.timeline.clips.some((c) => c.sourceVideoId && removed.has(c.sourceVideoId));
  const scrubOne = (snapshot: UndoableState): UndoableState => {
    if (!carriesARemovedSource(snapshot)) return snapshot;
    const clips = snapshot.project.timeline.clips.filter(
      (c) => !c.sourceVideoId || !removed.has(c.sourceVideoId)
    );
    return {
      project: {
        ...snapshot.project,
        timeline: {
          ...snapshot.project.timeline,
          clips,
          duration: calculateTimelineDuration(clips),
        },
      },
      sourceVideos: snapshot.sourceVideos.filter((v) => !removed.has(v.id)),
    };
  };
  const past = history.past.map(scrubOne);
  const future = history.future.map(scrubOne);
  const sameElements = (a: UndoableState[], b: UndoableState[]) => a.every((s, i) => s === b[i]);
  return sameElements(past, history.past) && sameElements(future, history.future)
    ? history
    : { past, future };
}

/**
 * ESCSUITE-244: `scrubRemovedSources` in reverse. An import is not an edit —
 * its bytes are already in IndexedDB and undo cannot un-write them — so it
 * records no step of its own. But every snapshot holds its own copy of
 * `sourceVideos` and undo/redo replace the live library with it wholesale, so
 * a snapshot taken before the import would, on the next undo or redo that
 * lands on it, drop the source and strand its bytes. So this makes the
 * imported source present in every past and future snapshot: an add leaves no
 * snapshot without the added source. It says nothing about a source that
 * entered the live library another way (undoing a `resetProject` can restore
 * a live library that a future snapshot lacks, and redo then drops it again).
 *
 * Two properties follow, and both are deliberate:
 *  - undoing an edit made *before* the import keeps the import in the library;
 *  - an import made while a redo branch exists keeps that branch (nothing
 *    clears `future` — an import is not an edit, and must not discard the
 *    user's redo), and redo keeps the import.
 *
 * A snapshot that already holds the id has it replaced in place (the live
 * library's replace-in-place arm, so order does not shuffle); one that does not
 * gets it appended. Returns the identical `history` object when no snapshot
 * changed (an empty stack, or every snapshot already holding an equal entry).
 */
export function graftAddedSource(
  history: { past: UndoableState[]; future: UndoableState[] },
  video: SourceVideo
): { past: UndoableState[]; future: UndoableState[] } {
  const graftOne = (snapshot: UndoableState): UndoableState => {
    const at = snapshot.sourceVideos.findIndex((v) => v.id === video.id);
    if (at === -1) {
      return { ...snapshot, sourceVideos: [...snapshot.sourceVideos, video] };
    }
    if (sameSourceVideo(snapshot.sourceVideos[at], video)) return snapshot;
    return {
      ...snapshot,
      sourceVideos: snapshot.sourceVideos.map((v, i) => (i === at ? video : v)),
    };
  };
  const past = history.past.map(graftOne);
  const future = history.future.map(graftOne);
  const sameElements = (a: UndoableState[], b: UndoableState[]) => a.every((s, i) => s === b[i]);
  return sameElements(past, history.past) && sameElements(future, history.future)
    ? history
    : { past, future };
}

export { getUndoableState, pushToHistory };
