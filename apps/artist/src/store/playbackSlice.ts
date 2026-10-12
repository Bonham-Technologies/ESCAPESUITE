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

/**
 * The fields a seek writes: the new playhead and one more on `seekSequence`
 * (ESCSUITE-287). `seekTo` and every action that moves the playhead inside its
 * own `set` updater (the marker jumps, `resetProject`) spread it, so none can
 * move the playhead and forget the count.
 */
export function seekFields(state: Pick<EditorState, 'seekSequence'>, time: number): Pick<EditorState, 'currentTime' | 'seekSequence'> {
  return { currentTime: time, seekSequence: state.seekSequence + 1 };
}

export const createPlaybackSlice: StateCreator<EditorState, [], [], PlaybackSlice> = (set) => ({
  currentTime: 0,
  isPlaying: false,
  seekSequence: 0,
  inPoint: null,
  outPoint: null,

  // Playback actions
  setCurrentTime: (time: number) => set({ currentTime: time }),
  seekTo: (time: number) => set((state) => seekFields(state, time)),
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
