// History slice: the undo/redo stack. Owns `history` and the five actions that
// read and rewind it; every other slice only pushes onto it via `pushToHistory`.

import type { StateCreator } from 'zustand';
import type { EditorState, UndoableState } from './types';
import { getUndoableState } from './storeHistory';
import { pruneSelection } from './selectionPrune';

export type HistorySlice = Pick<EditorState, 'history' | 'undo' | 'redo' | 'canUndo' | 'canRedo' | 'clearHistory'>;

/**
 * What landing on `snapshot` writes besides the project: the in/out points
 * and markers when the entry carries them (ESCSUITE-434), nothing otherwise.
 *
 * Markers are not edits (adding, renaming or removing one records no step),
 * so the entry's list is not written over the live one: each marker the entry
 * holds goes back to the time it has there, and a marker added or removed
 * since stays added or removed. Otherwise undoing the cut, or redoing it
 * after an undo, would silently drop a marker made in between.
 */
function editorFields(snapshot: UndoableState, current: EditorState['markers']): Partial<EditorState> {
  if (!snapshot.editor) return {};
  const { inPoint, outPoint } = snapshot.editor;
  const times = new Map(snapshot.editor.markers.map((m) => [m.id, m.time]));
  const markers = current
    .map((m) => {
      const time = times.get(m.id);
      return time === undefined || time === m.time ? m : { ...m, time };
    })
    .sort((a, b) => a.time - b.time);
  return { inPoint, outPoint, markers };
}

export const createHistorySlice: StateCreator<EditorState, [], [], HistorySlice> = (set, get) => ({
  history: {
    past: [],
    future: [],
  },

  // Undo/Redo actions
  //
  // ESCSUITE-101: an undo or a redo can land the project on a clip list that
  // no longer holds an id the selection names — undoing the add that created
  // it, or redoing a delete that removed it. Nothing here used to reconcile
  // the selection against the *restored* clips, so the ticket's own sequence
  // (paste, then undo) left the pasted clip "selected" after it had already
  // left the timeline. `pruneSelection` runs against `previous`/`next`'s own
  // clips — the state being landed on, not the one being left.
  undo: () => set((state) => {
    if (state.history.past.length === 0) return state;

    const previous = state.history.past[state.history.past.length - 1];
    const newPast = state.history.past.slice(0, -1);

    // Save current state to future (with the markers and points when the
    // entry being undone moved them, so a redo moves them again)
    const currentSnapshot = getUndoableState(state, previous.editor !== undefined);
    const pruned = pruneSelection(previous.project.timeline.clips, state.selectedClipId, state.selectedClipIds);

    return {
      project: previous.project,
      sourceVideos: previous.sourceVideos,
      ...editorFields(previous, state.markers),
      selectedClipId: pruned.selectedClipId,
      selectedClipIds: pruned.selectedClipIds,
      history: {
        past: newPast,
        future: [currentSnapshot, ...state.history.future],
      },
    };
  }),

  redo: () => set((state) => {
    if (state.history.future.length === 0) return state;

    const next = state.history.future[0];
    const newFuture = state.history.future.slice(1);

    // Save current state to past
    const currentSnapshot = getUndoableState(state, next.editor !== undefined);
    const pruned = pruneSelection(next.project.timeline.clips, state.selectedClipId, state.selectedClipIds);

    return {
      project: next.project,
      sourceVideos: next.sourceVideos,
      ...editorFields(next, state.markers),
      selectedClipId: pruned.selectedClipId,
      selectedClipIds: pruned.selectedClipIds,
      history: {
        past: [...state.history.past, currentSnapshot],
        future: newFuture,
      },
    };
  }),

  canUndo: () => get().history.past.length > 0,
  canRedo: () => get().history.future.length > 0,

  clearHistory: () => set({
    history: { past: [], future: [] },
  }),
});
