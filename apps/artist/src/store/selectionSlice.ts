// Selection slice: which clip and track are selected, the multi-selection set
// and the clipboard, plus the nine actions that act on a multi-selection.
// `copySelectedClips` is the only one that records no undo step — it writes
// `clipboard` and nothing else.

import { v4 as uuidv4 } from 'uuid';
import type { StateCreator } from 'zustand';
import type { EditorState } from './types';
import { cloneClip } from '../utils/deepClone';
import { pushToHistory } from './storeHistory';
import { calculateTimelineDuration } from './projectFactory';
import { anyClipOnLockedTrack, lockedTrackIds } from './trackLock';

export type SelectionSlice = Pick<EditorState, 'selectedClipId' | 'selectedClipIds' | 'selectedTrackId' | 'clipboard' | 'setSelectedClipId' | 'setSelectedTrackId' | 'toggleClipSelection' | 'selectClipsInRange' | 'clearMultiSelection' | 'moveSelectedClips' | 'deleteSelectedClips' | 'copySelectedClips' | 'pasteClips' | 'muteSelectedClips' | 'unmuteSelectedClips'>;

export const createSelectionSlice: StateCreator<EditorState, [], [], SelectionSlice> = (set) => ({
  selectedClipId: null,
  selectedClipIds: new Set<string>(),
  selectedTrackId: null,
  clipboard: null,

  // Selection actions
  setSelectedClipId: (id: string | null) => set({
    selectedClipId: id,
    selectedClipIds: new Set<string>(), // Clear multi-selection on single click
  }),
  setSelectedTrackId: (id: string | null) => set({ selectedTrackId: id }),

  // Multi-Select actions
  toggleClipSelection: (clipId: string) => set((state) => {
    const newSet = new Set(state.selectedClipIds);
    if (newSet.has(clipId)) {
      newSet.delete(clipId);
      // If set is now empty, clear primary selection too
      if (newSet.size === 0) {
        return { selectedClipIds: newSet, selectedClipId: null };
      }
      return { selectedClipIds: newSet };
    } else {
      newSet.add(clipId);
      return { selectedClipIds: newSet, selectedClipId: clipId };
    }
  }),

  selectClipsInRange: (clipIds: string[]) => set(() => ({
    selectedClipIds: new Set(clipIds),
    selectedClipId: clipIds.length > 0 ? clipIds[clipIds.length - 1] : null,
  })),

  clearMultiSelection: () => set({
    selectedClipIds: new Set<string>(),
    selectedClipId: null,
  }),

  moveSelectedClips: (deltaTime: number, deltaTrack: number) => set((state) => {
    if (state.selectedClipIds.size === 0) return state;

    const tracks = state.project.timeline.tracks;
    const sortedTracks = [...tracks].sort((a, b) => a.index - b.index);
    const trackIndexMap = new Map(sortedTracks.map((t, i) => [t.id, i]));

    const newClips = state.project.timeline.clips.map(clip => {
      if (!state.selectedClipIds.has(clip.id)) return clip;

      const updatedClip = { ...clip };

      // Adjust timeline position
      if (deltaTime !== 0) {
        updatedClip.timelinePosition = Math.max(0, clip.timelinePosition + deltaTime);
      }

      // Move to different track if deltaTrack !== 0
      if (deltaTrack !== 0) {
        const currentTrackIdx = trackIndexMap.get(clip.trackId);
        if (currentTrackIdx !== undefined) {
          const newTrackIdx = Math.max(0, Math.min(sortedTracks.length - 1, currentTrackIdx + deltaTrack));
          updatedClip.trackId = sortedTracks[newTrackIdx].id;
        }
      }

      return updatedClip;
    });

    // ESCSUITE-84: a locked track holds its clips where they are. Checked
    // against the original clips (the origin) protects a locked-row clip that
    // was ctrl+clicked into the selection; checked against newClips (the
    // landing) protects a locked row from receiving clips moved onto it. Both
    // arrays are in the same order (.map preserves it), so walking them by
    // index compares each clip's before and after.
    const locked = lockedTrackIds(tracks);
    const original = state.project.timeline.clips;
    for (let i = 0; i < original.length; i++) {
      if (locked.has(original[i].trackId) || locked.has(newClips[i].trackId)) return state;
    }

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: newClips,
          duration: calculateTimelineDuration(newClips),
        },
      },
      history: pushToHistory(state),
    };
  }),

  deleteSelectedClips: () => set((state) => {
    if (state.selectedClipIds.size === 0) return state;
    if (anyClipOnLockedTrack(state.project.timeline.clips, state.project.timeline.tracks, state.selectedClipIds)) return state; // ESCSUITE-84

    const newClips = state.project.timeline.clips.filter(
      clip => !state.selectedClipIds.has(clip.id)
    );

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: newClips,
          duration: calculateTimelineDuration(newClips),
        },
      },
      selectedClipId: null,
      selectedClipIds: new Set<string>(),
      history: pushToHistory(state),
    };
  }),

  copySelectedClips: () => set((state) => {
    if (state.selectedClipIds.size === 0) return state;

    const selectedClips = state.project.timeline.clips
      .filter(clip => state.selectedClipIds.has(clip.id))
      .map(clip => cloneClip(clip));

    return { clipboard: selectedClips };
  }),

  pasteClips: () => set((state) => {
    if (!state.clipboard || state.clipboard.length === 0) return state;

    // Find the earliest position among clipboard clips to calculate offsets
    const minPosition = Math.min(...state.clipboard.map(c => c.timelinePosition));

    const newClips = state.clipboard.map(clip => ({
      ...cloneClip(clip),
      id: uuidv4(),
      timelinePosition: clip.timelinePosition - minPosition + (state.currentTime || minPosition + 0.5),
    }));

    // ESCSUITE-84: a clone keeps its clipboard trackId, so a paste lands
    // exactly where it was copied from — the check is on the clones, and it
    // is all-or-nothing.
    const locked = lockedTrackIds(state.project.timeline.tracks);
    if (newClips.some((clip) => locked.has(clip.trackId))) return state; // ESCSUITE-84

    const allClips = [...state.project.timeline.clips, ...newClips];
    const newSelectedIds = new Set(newClips.map(c => c.id));

    return {
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: allClips,
          duration: calculateTimelineDuration(allClips),
        },
      },
      selectedClipIds: newSelectedIds,
      selectedClipId: newClips[newClips.length - 1].id,
      history: pushToHistory(state),
    };
  }),

  muteSelectedClips: () => set((state) => {
    if (state.selectedClipIds.size === 0) return state;

    // Find which tracks contain selected clips
    const trackIdsToMute = new Set<string>();
    for (const clip of state.project.timeline.clips) {
      if (state.selectedClipIds.has(clip.id)) {
        trackIdsToMute.add(clip.trackId);
      }
    }

    const newTracks = state.project.timeline.tracks.map(track => {
      if (trackIdsToMute.has(track.id)) {
        return { ...track, muted: true };
      }
      return track;
    });

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

  unmuteSelectedClips: () => set((state) => {
    if (state.selectedClipIds.size === 0) return state;

    // Find which tracks contain selected clips
    const trackIdsToUnmute = new Set<string>();
    for (const clip of state.project.timeline.clips) {
      if (state.selectedClipIds.has(clip.id)) {
        trackIdsToUnmute.add(clip.trackId);
      }
    }

    const newTracks = state.project.timeline.tracks.map(track => {
      if (trackIdsToUnmute.has(track.id)) {
        return { ...track, muted: false };
      }
      return track;
    });

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
