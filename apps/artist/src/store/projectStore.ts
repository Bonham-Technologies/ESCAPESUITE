// Zustand store for project state management

import { create } from 'zustand';
import type { StateCreator } from 'zustand';
import type { EditorState } from './types';
import { createHistorySlice, type HistorySlice } from './historySlice';
import { createPlaybackSlice, type PlaybackSlice } from './playbackSlice';
import { createMarkerSlice, type MarkerSlice } from './markerSlice';
import { createUiSlice, type UiSlice } from './uiSlice';
import { createProjectSlice, type ProjectSlice } from './projectSlice';
import { createTrackSlice, type TrackSlice } from './trackSlice';
import { createClipSlice, type ClipSlice } from './clipSlice';
import { createKeyframeSlice, type KeyframeSlice } from './keyframeSlice';
import { createOverlaySlice, type OverlaySlice } from './overlaySlice';
import { createSelectionSlice, type SelectionSlice } from './selectionSlice';

// The pure helpers moved to their own modules — none of them reads the store —
// and DEFAULT_PROJECT_NAME is re-exported here so every existing import path still resolves.
export { DEFAULT_PROJECT_NAME } from './projectFactory';

// Nothing is left: the ten slices now cover every field and action of
// EditorState, so this Omit resolves to the empty object and stands only as the
// type-level proof of that. Task 6 deletes it and orders the composition.
type RemainingSlice = Omit<EditorState, keyof HistorySlice | keyof PlaybackSlice | keyof MarkerSlice | keyof UiSlice | keyof ProjectSlice | keyof TrackSlice | keyof ClipSlice | keyof KeyframeSlice | keyof OverlaySlice | keyof SelectionSlice>;

const createRemainingSlice: StateCreator<EditorState, [], [], RemainingSlice> = () => ({});

export const useEditorStore = create<EditorState>((...a) => ({
  ...createHistorySlice(...a),
  ...createPlaybackSlice(...a),
  ...createMarkerSlice(...a),
  ...createUiSlice(...a),
  ...createProjectSlice(...a),
  ...createTrackSlice(...a),
  ...createClipSlice(...a),
  ...createKeyframeSlice(...a),
  ...createOverlaySlice(...a),
  ...createSelectionSlice(...a),
  ...createRemainingSlice(...a),
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
