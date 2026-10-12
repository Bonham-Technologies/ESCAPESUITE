// Playback slice: the transport position and the in/out points that bound a
// section of the timeline.
//
// Two writers of the position (ESCSUITE-287): `setCurrentTime` is the preview
// render loop's own, and `seekTo` is everyone else's. A seek also counts
// itself in `seekSequence`, so the loop's pause write — which publishes the
// last frame it drew (ESCSUITE-281) — can tell a pause that came with a seek
// from a plain one even when the seek lands on the time the store held.

import type { StateCreator } from 'zustand';
import type { EditorState } from './types';

export type PlaybackSlice = Pick<EditorState, 'currentTime' | 'isPlaying' | 'seekSequence' | 'inPoint' | 'outPoint' | 'setCurrentTime' | 'seekTo' | 'setIsPlaying' | 'setInPoint' | 'setOutPoint' | 'clearInOutPoints'>;

export const createPlaybackSlice: StateCreator<EditorState, [], [], PlaybackSlice> = (set) => ({
  currentTime: 0,
  isPlaying: false,
  seekSequence: 0,
  inPoint: null,
  outPoint: null,

  // Playback actions
  setCurrentTime: (time: number) => set({ currentTime: time }),
  seekTo: (time: number) => set((state) => ({ currentTime: time, seekSequence: state.seekSequence + 1 })),
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
