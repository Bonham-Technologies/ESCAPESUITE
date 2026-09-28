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
import { pruneSelection } from './selectionPrune';

export type SelectionSlice = Pick<EditorState, 'selectedClipId' | 'selectedClipIds' | 'selectedTrackId' | 'clipboard' | 'setSelectedClipId' | 'setSelectedTrackId' | 'toggleClipSelection' | 'selectClipsInRange' | 'clearMultiSelection' | 'moveSelectedClips' | 'deleteSelectedClips' | 'copySelectedClips' | 'pasteClips' | 'muteSelectedClips' | 'unmuteSelectedClips'>;

export const createSelectionSlice: StateCreator<EditorState, [], [], SelectionSlice> = (set, get) => ({
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
    // index compares each clip's before and after — but only for a selected
    // clip: an unselected clip's origin and landing trackId are identical
    // (moveSelectedClips leaves it untouched), so testing it too would refuse
    // the whole move whenever ANY clip anywhere sits on a locked track,
    // selected or not.
    const locked = lockedTrackIds(tracks);
    const original = state.project.timeline.clips;
    for (let i = 0; i < original.length; i++) {
      if (!state.selectedClipIds.has(original[i].id)) continue;
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

  // ESCSUITE-101: reports `false` and writes nothing, the get()-then-set()
  // shape `pasteClips` uses, for two reasons a selection can have nothing to
  // delete — every id it names is a ghost (the clip already left some other
  // way: an undo, a track or source-video removal, a split), or the ids that
  // DO still exist all sit on a locked track (ESCSUITE-84). Belt-and-braces
  // for the first: `pruneSelection` running in every removing action and in
  // undo/redo means a ghost should rarely reach here at all, the same way
  // `pasteClips`'s "track no longer on the timeline" check rarely fires now
  // that `removeTrack`/`removeSourceVideo` prune the clipboard themselves.
  deleteSelectedClips: () => {
    const state = get();
    if (state.selectedClipIds.size === 0) return false;

    const clips = state.project.timeline.clips;
    // Reuses pruneSelection's own existing-ids Set rather than an O(n*m)
    // `filter(id => clips.some(...))` — passing `null` for selectedClipId
    // asks only about the ids Set, which is all this needs.
    const toDelete = pruneSelection(clips, null, state.selectedClipIds).selectedClipIds;
    if (toDelete.size === 0) return false; // every selected id is a ghost

    if (anyClipOnLockedTrack(clips, state.project.timeline.tracks, toDelete)) return false; // ESCSUITE-84

    set((s) => {
      const newClips = s.project.timeline.clips.filter((clip) => !toDelete.has(clip.id));

      return {
        project: {
          ...s.project,
          modified: Date.now(),
          timeline: {
            ...s.project.timeline,
            clips: newClips,
            duration: calculateTimelineDuration(newClips),
          },
        },
        selectedClipId: null,
        selectedClipIds: new Set<string>(),
        history: pushToHistory(s),
      };
    });

    return true;
  },

  copySelectedClips: () => set((state) => {
    if (state.selectedClipIds.size === 0) return state;

    const selectedClips = state.project.timeline.clips
      .filter(clip => state.selectedClipIds.has(clip.id))
      .map(clip => cloneClip(clip));

    return { clipboard: selectedClips };
  }),

  // ESCSUITE-100: reads through `get()` before writing, the way `moveClipToTrack`
  // does, so it can refuse and answer `false` without a `set` call at all.
  pasteClips: () => {
    const state = get();
    if (!state.clipboard || state.clipboard.length === 0) return false;

    // Find the earliest position among clipboard clips to calculate offsets
    const minPosition = Math.min(...state.clipboard.map(c => c.timelinePosition));

    // Paste always lands at the playhead: the earliest clone at `currentTime`,
    // the rest keeping their relative offsets. `currentTime` is never
    // undefined, so there is no "no playhead" case to default away from —
    // the old `|| minPosition + 0.5` treated a playhead at 0 as missing and
    // pasted a clip copied from 3s at 3.5s instead of 0.
    const newClips = state.clipboard.map(clip => ({
      ...cloneClip(clip),
      id: uuidv4(),
      timelinePosition: clip.timelinePosition - minPosition + state.currentTime,
    }));

    // A clone keeps its clipboard trackId, and that track can be gone by the
    // time paste runs — `removeTrack`/`removeSourceVideo` prune the clipboard
    // themselves, so this is a belt-and-braces guard reached only through a
    // project load that replaced the tracks out from under an existing
    // clipboard. All-or-nothing, like the lock right below.
    const trackIds = new Set(state.project.timeline.tracks.map((t) => t.id));
    if (newClips.some((clip) => !trackIds.has(clip.trackId))) return false; // ESCSUITE-100

    // ESCSUITE-84: a clone keeps its clipboard trackId, so a paste lands
    // exactly where it was copied from — the check is on the clones, and it
    // is all-or-nothing.
    const locked = lockedTrackIds(state.project.timeline.tracks);
    if (newClips.some((clip) => locked.has(clip.trackId))) return false; // ESCSUITE-84

    set((s) => {
      const allClips = [...s.project.timeline.clips, ...newClips];
      return {
        project: {
          ...s.project,
          modified: Date.now(),
          timeline: {
            ...s.project.timeline,
            clips: allClips,
            duration: calculateTimelineDuration(allClips),
          },
        },
        selectedClipIds: new Set(newClips.map(c => c.id)),
        selectedClipId: newClips[newClips.length - 1].id,
        history: pushToHistory(s),
      };
    });

    return true;
  },

  // ESCSUITE-101: `false`, with nothing written, when every track a selected
  // clip sits on already has the mute state being asked for — Mute on an
  // already-muted track used to be an undo entry that undid nothing. When
  // only some of them would change, only those are rewritten (the rest keep
  // their existing track object, not a same-value copy of it), still as one
  // history entry.
  muteSelectedClips: () => {
    const state = get();
    if (state.selectedClipIds.size === 0) return false;

    const trackIdsToMute = new Set<string>();
    for (const clip of state.project.timeline.clips) {
      if (state.selectedClipIds.has(clip.id)) {
        trackIdsToMute.add(clip.trackId);
      }
    }

    const changing = state.project.timeline.tracks.some(
      (track) => trackIdsToMute.has(track.id) && !track.muted
    );
    if (!changing) return false;

    set((s) => {
      const newTracks = s.project.timeline.tracks.map((track) =>
        trackIdsToMute.has(track.id) && !track.muted ? { ...track, muted: true } : track
      );

      return {
        project: {
          ...s.project,
          modified: Date.now(),
          timeline: {
            ...s.project.timeline,
            tracks: newTracks,
          },
        },
        history: pushToHistory(s),
      };
    });

    return true;
  },

  unmuteSelectedClips: () => {
    const state = get();
    if (state.selectedClipIds.size === 0) return false;

    const trackIdsToUnmute = new Set<string>();
    for (const clip of state.project.timeline.clips) {
      if (state.selectedClipIds.has(clip.id)) {
        trackIdsToUnmute.add(clip.trackId);
      }
    }

    const changing = state.project.timeline.tracks.some(
      (track) => trackIdsToUnmute.has(track.id) && track.muted
    );
    if (!changing) return false;

    set((s) => {
      const newTracks = s.project.timeline.tracks.map((track) =>
        trackIdsToUnmute.has(track.id) && track.muted ? { ...track, muted: false } : track
      );

      return {
        project: {
          ...s.project,
          modified: Date.now(),
          timeline: {
            ...s.project.timeline,
            tracks: newTracks,
          },
        },
        history: pushToHistory(s),
      };
    });

    return true;
  },
});
