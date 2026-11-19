// UI slice: the editor's view preferences — timeline zoom, snapping, the active
// tool, loop playback (and its suspension for a Remove silences Play), the preview's crop mode and Zoom to region tool, and the "Remove silences"
// review. None of it is part of the project or the undo stack.

import type { StateCreator } from 'zustand';
import type { EditorState } from './types';

export type UiSlice = Pick<EditorState, 'zoom' | 'snapEnabled' | 'snapThreshold' | 'activeTool' | 'loopPlayback' | 'loopSuspended' | 'cropClipId' | 'zoomRegionClipId' | 'silenceReview' | 'setZoom' | 'setSnapEnabled' | 'setActiveTool' | 'setLoopPlayback' | 'setLoopSuspended' | 'setCropClipId' | 'setZoomRegionClipId' | 'setSilenceReviewClip' | 'setSilenceCandidates'>;

export const createUiSlice: StateCreator<EditorState, [], [], UiSlice> = (set) => ({
  zoom: 1,
  snapEnabled: true,
  snapThreshold: 10, // pixels
  activeTool: 'select',
  loopPlayback: false,
  loopSuspended: false,
  cropClipId: null,
  zoomRegionClipId: null,
  silenceReview: null,

  // UI actions
  setZoom: (zoom: number) => set({ zoom: Math.max(0.1, Math.min(10, zoom)) }),
  setSnapEnabled: (enabled: boolean) => set({ snapEnabled: enabled }),
  setActiveTool: (tool) => set({ activeTool: tool }),
  setLoopPlayback: (enabled: boolean) => set({ loopPlayback: enabled }),
  setLoopSuspended: (suspended: boolean) => set({ loopSuspended: suspended }),
  setCropClipId: (clipId: string | null) => set({ cropClipId: clipId }),
  setZoomRegionClipId: (clipId: string | null) => set({ zoomRegionClipId: clipId }),
  setSilenceReviewClip: (clipId: string | null) =>
    set({ silenceReview: clipId === null ? null : { clipId, candidates: [] } }),
  setSilenceCandidates: (candidates) =>
    set((state) => (state.silenceReview ? { silenceReview: { ...state.silenceReview, candidates } } : {})),
});
