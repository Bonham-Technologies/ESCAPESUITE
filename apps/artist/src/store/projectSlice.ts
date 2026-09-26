// Project slice: the project itself and the source-video library it draws from.
// Every action here records an undo step, and `resetProject` clears the fields
// other slices own by writing them through the one flat state object.

import type { StateCreator } from 'zustand';
import type { EditorState, Project, SourceVideo } from './types';
import { pushToHistory } from './storeHistory';
import { createEmptyProject, calculateTimelineDuration } from './projectFactory';
import { sameSourceVideo } from './sourceVideoEquality';
import { ensureTimelineHasTracks } from './projectMigration';
import { lockedSourceVideoIds } from './trackLock';

export type ProjectSlice = Pick<EditorState, 'project' | 'sourceVideos' | 'setProject' | 'resetProject' | 'setProjectResolution' | 'addSourceVideo' | 'removeSourceVideo'>;

export const createProjectSlice: StateCreator<EditorState, [], [], ProjectSlice> = (set) => ({
  project: createEmptyProject(),
  sourceVideos: [],

  // Project actions
  setProject: (project: Project) => set((state) => ({
    project: ensureTimelineHasTracks(project),
    history: pushToHistory(state),
  })),

  resetProject: () => set((state) => ({
    project: createEmptyProject(),
    sourceVideos: [],
    currentTime: 0,
    isPlaying: false,
    selectedClipId: null,
    selectedClipIds: new Set<string>(),
    selectedTrackId: null,
    clipboard: null,
    inPoint: null,
    outPoint: null,
    markers: [],
    history: pushToHistory(state),
  })),

  setProjectResolution: (width: number, height: number) => set((state) => ({
    project: {
      ...state.project,
      modified: Date.now(),
      resolution: { width, height },
    },
    history: pushToHistory(state),
  })),

  // Source video actions
  // Idempotent by id. Source videos are keyed by id everywhere downstream — the media
  // library renders one element per id, and every clip names the source it plays by id —
  // so a second entry under an id already held is never new media, it is the same media
  // seen again (a restored session overlapping the library, the same URL loaded twice).
  // Replaced in place rather than ignored, so the newer metadata (a fresh thumbnail URL,
  // above all) wins, and rather than appended, so the library order does not shuffle.
  // A re-add carrying identical metadata changes nothing, so it records nothing:
  // an undo step that restores an identical library reads to the user as an undo
  // that did nothing.
  addSourceVideo: (video: SourceVideo) => set((state) => {
    const existing = state.sourceVideos.findIndex((v) => v.id === video.id)
    if (existing !== -1 && sameSourceVideo(state.sourceVideos[existing], video)) return state
    const sourceVideos = existing === -1
      ? [...state.sourceVideos, video]
      : state.sourceVideos.map((v, i) => (i === existing ? video : v))
    return { sourceVideos, history: pushToHistory(state) }
  }),

  removeSourceVideo: (id: string) => set((state) => {
    // All-or-nothing, like every other group refusal: this takes every clip
    // that uses the source with it, and a clip on a locked track cannot be
    // removed — so the source stays too (ESCSUITE-84). The media library's
    // Remove and Clear All buttons ask the same question, because clearing
    // deletes the blobs before the store hears about it.
    const { clips, tracks } = state.project.timeline;
    if (lockedSourceVideoIds(clips, tracks).has(id)) return state; // ESCSUITE-84
    const kept = clips.filter((c) => c.sourceVideoId !== id);
    return {
      sourceVideos: state.sourceVideos.filter((v) => v.id !== id),
      project: {
        ...state.project,
        modified: Date.now(),
        timeline: {
          ...state.project.timeline,
          clips: kept,
          duration: calculateTimelineDuration(kept),
        },
      },
      history: pushToHistory(state),
    };
  }),
});
