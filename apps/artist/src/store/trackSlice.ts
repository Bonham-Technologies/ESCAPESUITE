// Track slice: the timeline's tracks. Every action records an undo step;
// `addTrack` reads its pre-change snapshot from `get()` before the bare `set`
// so the history entry holds the state as it was, and returns the new track.

import { v4 as uuidv4 } from 'uuid';
import type { StateCreator } from 'zustand';
import type { EditorState, Track } from './types';
import { pushToHistory } from './storeHistory';
import { calculateTimelineDuration } from './projectFactory';
import { isTrackLocked } from './trackLock';
import { pruneSelection } from './selectionPrune';

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
    if (isTrackLocked(tracks, trackId)) return state; // ESCSUITE-84

    const newTracks = tracks.filter(t => t.id !== trackId);
    const newClips = state.project.timeline.clips.filter(c => c.trackId !== trackId);
    // ESCSUITE-100: a clipboard entry naming this track cannot land anywhere
    // once it's gone, so drop it here rather than leave pasteClips's own
    // all-or-nothing guard as the only thing standing between a paste and a
    // clip on no track at all.
    const newClipboard = state.clipboard && state.clipboard.some((c) => c.trackId === trackId)
      ? state.clipboard.filter((c) => c.trackId !== trackId)
      : state.clipboard;
    // ESCSUITE-101: the same pruning the clipboard already gets above, for the
    // selection — a clip on the removed track leaves it too, and nothing here
    // used to reconcile that.
    const pruned = pruneSelection(newClips, state.selectedClipId, state.selectedClipIds);

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
      selectedClipId: pruned.selectedClipId,
      selectedClipIds: pruned.selectedClipIds,
      clipboard: newClipboard,
      history: pushToHistory(state),
    };
  }),

  // ESCSUITE-242: the track header's volume slider writes on every `input`
  // event, and runs those writes through `useSliderGesture`'s `commit` — so
  // this takes the trailing `skipHistory` flag every gesture-driven action
  // takes, in the same position and shape, and reports whether it wrote (the
  // ESCSUITE-87 boolean `commit` reads). An id that names no track is refused
  // in front of the `set`, the way ESCSUITE-172 refuses an unknown clip: the
  // `map` below would match nothing, and the `set` used to run anyway, spending
  // an undo entry on no change at all. Every other caller passes two
  // arguments and is one undo step exactly as before.
  updateTrack: (trackId: string, updates: Partial<Track>, skipHistory?: boolean) => {
    if (!get().project.timeline.tracks.some((t) => t.id === trackId)) return false;

    set((state) => ({
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
      history: skipHistory ? state.history : pushToHistory(state),
    }));

    return true;
  },

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
