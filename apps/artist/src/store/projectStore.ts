// Zustand store for project state management

import { create } from 'zustand';
import type { EditorState } from './types';
import { createHistorySlice } from './historySlice';
import { createProjectSlice } from './projectSlice';
import { createTrackSlice } from './trackSlice';
import { createClipSlice } from './clipSlice';
import { createKeyframeSlice } from './keyframeSlice';
import { createOverlaySlice } from './overlaySlice';
import { createSelectionSlice } from './selectionSlice';
import { createPlaybackSlice } from './playbackSlice';
import { createMarkerSlice } from './markerSlice';
import { createUiSlice } from './uiSlice';

// The pure helpers moved to their own modules — none of them reads the store —
// and DEFAULT_PROJECT_NAME is re-exported here so every existing import path still resolves.
export { DEFAULT_PROJECT_NAME } from './projectFactory';

export const useEditorStore = create<EditorState>((...a) => ({
  ...createHistorySlice(...a),
  ...createProjectSlice(...a),
  ...createTrackSlice(...a),
  ...createClipSlice(...a),
  ...createKeyframeSlice(...a),
  ...createOverlaySlice(...a),
  ...createSelectionSlice(...a),
  ...createPlaybackSlice(...a),
  ...createMarkerSlice(...a),
  ...createUiSlice(...a),
}));

// Selectors for common derived state
export const selectTimelineDuration = (state: EditorState) => state.project.timeline.duration;
export const selectClipCount = (state: EditorState) => state.project.timeline.clips.length;
export const selectSelectedClip = (state: EditorState) =>
  state.project.timeline.clips.find((c) => c.id === state.selectedClipId);
export const selectSelectedTrack = (state: EditorState) =>
  state.project.timeline.tracks.find((t) => t.id === state.selectedTrackId);

// The clip queries moved to ./clipQueries — they never read the store — and are
// re-exported here so every existing import path still resolves.
export { getClipsAtTime, getClipAtTime, getClipPosition } from './clipQueries';

// The snapping helpers moved to ./timelineSnapping — they never read the store —
// and are re-exported here so every existing import path still resolves.
export { getSnapPoints, findNearestSnapPoint, wouldOverlap } from './timelineSnapping';
