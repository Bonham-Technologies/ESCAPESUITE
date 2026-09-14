// Track slice: the timeline's tracks. Every action records an undo step;
// `addTrack` reads its pre-change snapshot from `get()` before the bare `set`
// so the history entry holds the state as it was, and returns the new track.

import { v4 as uuidv4 } from 'uuid';
import type { StateCreator } from 'zustand';
import type { EditorState, Track } from './types';
import { pushToHistory } from './storeHistory';
import { calculateTimelineDuration } from './projectFactory';

export type TrackSlice = Pick<EditorState, 'addTrack' | 'removeTrack' | 'updateTrack' | 'reorderTracks'>;

export const createTrackSlice: StateCreator<EditorState, [], [], TrackSlice> = (set, get) => ({
  // Track actions
  addTrack: (name?: string) => {
    const state = get();
    const tracks = state.project.timeline.tracks;
    const newIndex = tracks.length > 0 ? Math.max(...tracks.map(t => t.index)) + 1 : 0;
    const newTrack: Track = {
      id: uuidv4(),
      name: name || `Track ${newIndex + 1}`,
      index: newIndex,
      visible: true,
      locked: false,
      muted: false,
      volume: 1,
      height: 60,
    };

    set({
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          tracks: [...tracks, newTrack],
        },
      },
      history: pushToHistory(state),
    });

    return newTrack;
  },

  removeTrack: (trackId: string) => set((state) => {
    const tracks = state.project.timeline.tracks;
    if (tracks.length <= 1) return state; // Keep at least one track

    const newTracks = tracks.filter(t => t.id !== trackId);
    const newClips = state.project.timeline.clips.filter(c => c.trackId !== trackId);

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          tracks: newTracks,
          clips: newClips,
          duration: calculateTimelineDuration(newClips),
        },
      },
      selectedTrackId: state.selectedTrackId === trackId ? null : state.selectedTrackId,
      history: pushToHistory(state),
    };
  }),

  updateTrack: (trackId: string, updates: Partial<Track>) => set((state) => ({
    project: {
      ...state.project,
      modified: Date.now(),
      timeline: {
        ...state.project.timeline,
        tracks: state.project.timeline.tracks.map(track =>
          track.id === trackId ? { ...track, ...updates } : track
        ),
      },
    },
    history: pushToHistory(state),
  })),

  reorderTracks: (trackIds: string[]) => set((state) => {
    const trackMap = new Map(state.project.timeline.tracks.map(t => [t.id, t]));
    const newTracks = trackIds
      .map((id, index) => {
        const track = trackMap.get(id);
        return track ? { ...track, index } : null;
      })
      .filter((t): t is Track => t !== null);

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          tracks: newTracks,
        },
      },
      history: pushToHistory(state),
    };
  }),
});
