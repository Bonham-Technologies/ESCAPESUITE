// The autosave payload: what of the editor's state gets written to
// session storage, and in what shape.
//
// Pure: takes the store's state and a timestamp as plain values, rather than
// reading `useEditorStore.getState()` or `Date.now()` itself, so the call
// site keeps control of *when* those are read while the shape of the
// snapshot is tested without a store.
import type { EditorState } from '../store/types';
import type { SessionState } from '../core/storage';

/** Build the session snapshot autosave persists, at `timestamp`. */
export function buildSessionSnapshot(state: EditorState, timestamp: number): SessionState {
  return {
    project: state.project,
    sourceVideos: state.sourceVideos,
    currentTime: state.currentTime,
    selectedClipId: state.selectedClipId,
    zoom: state.zoom,
    timestamp,
  };
}
