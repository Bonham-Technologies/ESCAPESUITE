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

export { getUndoableState, pushToHistory };
