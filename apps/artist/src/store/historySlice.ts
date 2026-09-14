// History slice: the undo/redo stack. Owns `history` and the five actions that
// read and rewind it; every other slice only pushes onto it via `pushToHistory`.

import type { StateCreator } from 'zustand';
import type { EditorState } from './types';
import { getUndoableState } from './storeHistory';

export type HistorySlice = Pick<EditorState, 'history' | 'undo' | 'redo' | 'canUndo' | 'canRedo' | 'clearHistory'>;

export const createHistorySlice: StateCreator<EditorState, [], [], HistorySlice> = (set, get) => ({
  history: {
    past: [],
    future: [],
  },

  // Undo/Redo actions
  undo: () => set((state) => {
    if (state.history.past.length === 0) return state;

    const previous = state.history.past[state.history.past.length - 1];
    const newPast = state.history.past.slice(0, -1);

    // Save current state to future
    const currentSnapshot = getUndoableState(state);

    return {
      project: previous.project,
      sourceVideos: previous.sourceVideos,
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
    const currentSnapshot = getUndoableState(state);

    return {
      project: next.project,
      sourceVideos: next.sourceVideos,
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
