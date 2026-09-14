// Playback slice: the transport position and the in/out points that bound a
// section of the timeline.

import type { StateCreator } from 'zustand';
import type { EditorState } from './types';

export type PlaybackSlice = Pick<EditorState, 'currentTime' | 'isPlaying' | 'inPoint' | 'outPoint' | 'setCurrentTime' | 'setIsPlaying' | 'setInPoint' | 'setOutPoint' | 'clearInOutPoints'>;

export const createPlaybackSlice: StateCreator<EditorState, [], [], PlaybackSlice> = (set) => ({
  currentTime: 0,
  isPlaying: false,
  inPoint: null,
  outPoint: null,

  // Playback actions
  setCurrentTime: (time: number) => set({ currentTime: time }),
  setIsPlaying: (playing: boolean) => set({ isPlaying: playing }),

  // In/Out point actions
  setInPoint: (time: number) => set((state) => {
    if (state.outPoint !== null && time > state.outPoint) {
      // Swap: in becomes out, out becomes in
      return { inPoint: state.outPoint, outPoint: time };
    }
    return { inPoint: time };
  }),

  setOutPoint: (time: number) => set((state) => {
    if (state.inPoint !== null && time < state.inPoint) {
      // Swap: out becomes in, in becomes out
      return { outPoint: state.inPoint, inPoint: time };
    }
    return { outPoint: time };
  }),

  clearInOutPoints: () => set({ inPoint: null, outPoint: null }),
});
