// UI slice: the editor's view preferences — timeline zoom, snapping, the active
// tool and loop playback. None of it is part of the project or the undo stack.

import type { StateCreator } from 'zustand';
import type { EditorState } from './types';

export type UiSlice = Pick<EditorState, 'zoom' | 'snapEnabled' | 'snapThreshold' | 'activeTool' | 'loopPlayback' | 'setZoom' | 'setSnapEnabled' | 'setActiveTool' | 'setLoopPlayback'>;

export const createUiSlice: StateCreator<EditorState, [], [], UiSlice> = (set) => ({
  zoom: 1,
  snapEnabled: true,
  snapThreshold: 10, // pixels
  activeTool: 'select',
  loopPlayback: false,

  // UI actions
  setZoom: (zoom: number) => set({ zoom: Math.max(0.1, Math.min(10, zoom)) }),
  setSnapEnabled: (enabled: boolean) => set({ snapEnabled: enabled }),
  setActiveTool: (tool) => set({ activeTool: tool }),
  setLoopPlayback: (enabled: boolean) => set({ loopPlayback: enabled }),
});
