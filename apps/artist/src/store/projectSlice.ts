// Project slice: the project itself and the source-video library it draws from.
// Every action here records an undo step, and `resetProject` clears the fields
// other slices own by writing them through the one flat state object.

import type { StateCreator } from 'zustand';
import type { EditorState, Project, SourceVideo } from './types';
import { pushToHistory, scrubDeadThumbnails } from './storeHistory';
import { createEmptyProject, calculateTimelineDuration } from './projectFactory';
import { sameSourceVideo } from './sourceVideoEquality';
import { ensureTimelineHasTracks } from './projectMigration';
import { lockedSourceVideoIds } from './trackLock';
import { pruneSelection } from './selectionPrune';
import { revokeSourceThumbnails } from '../core/storage';

export type ProjectSlice = Pick<EditorState, 'project' | 'sourceVideos' | 'setProject' | 'resetProject' | 'setProjectResolution' | 'addSourceVideo' | 'removeSourceVideo' | 'setSourceThumbnail'>;

export const createProjectSlice: StateCreator<EditorState, [], [], ProjectSlice> = (set) => ({
  project: createEmptyProject(),
  sourceVideos: [],

  // Project actions
  //
  // ESCSUITE-115: this replaces the whole project — a different clip list —
  // so a selection carried over from the one before it can outlive its own
  // clips as a ghost. Project load, LOAD_PROJECT from a host and session
  // restore all go through here; `pruneSelection` (ESCSUITE-101) is
  // reference-stable, so a caller with nothing selected (the common case:
  // `resetProject()` runs first in most callers) writes the same Set back.
  setProject: (project: Project) => set((state) => {
    const withTracks = ensureTimelineHasTracks(project);
    const pruned = pruneSelection(withTracks.timeline.clips, state.selectedClipId, state.selectedClipIds);
    return {
      project: withTracks,
      selectedClipId: pruned.selectedClipId,
      selectedClipIds: pruned.selectedClipIds,
      history: pushToHistory(state),
    };
  }),

  // ESCSUITE-113: every source video leaving the library on a reset held a
  // live `URL.createObjectURL` handle (thumbnailUrl) that nothing else was
  // ever going to free. Revoked here, all at once, before the tear-down
  // itself — and scrubbed out of the history this same action pushes (and
  // everything already in it), so an undo that later walks back past this
  // reset does not hand a source a thumbnailUrl nothing can open (see
  // `scrubDeadThumbnails`).
  resetProject: () => set((state) => {
    revokeSourceThumbnails(state.sourceVideos);
    const deadThumbnailUrls = state.sourceVideos
      .map((v) => v.thumbnailUrl)
      .filter((url): url is string => Boolean(url));
    return {
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
      history: scrubDeadThumbnails(pushToHistory(state), deadThumbnailUrls),
    };
  }),

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
  // ESCSUITE-113: a replace-in-place is the one way a source's thumbnailUrl
  // changes without the source itself ever leaving the library — nothing
  // else would free the URL it is replacing, so this is the one place that
  // owns it. Only when the URL actually changes: a re-add carrying the same
  // live handle (the identical string — sameSourceVideo already sent an
  // *unchanged* re-add home above) must not revoke out from under whatever
  // still shows it, and a session restore landing on a library the CRAFT
  // handoff already filled must free only the session's own stale URL, never
  // the handoff's still-live one.
  addSourceVideo: (video: SourceVideo) => set((state) => {
    const existing = state.sourceVideos.findIndex((v) => v.id === video.id)
    if (existing !== -1 && sameSourceVideo(state.sourceVideos[existing], video)) return state
    const previous = existing !== -1 ? state.sourceVideos[existing] : undefined
    const sourceVideos = existing === -1
      ? [...state.sourceVideos, video]
      : state.sourceVideos.map((v, i) => (i === existing ? video : v))
    let history = pushToHistory(state)
    if (previous && previous.thumbnailUrl && previous.thumbnailUrl !== video.thumbnailUrl) {
      revokeSourceThumbnails([previous])
      history = scrubDeadThumbnails(history, [previous.thumbnailUrl])
    }
    return { sourceVideos, history }
  }),

  removeSourceVideo: (id: string) => set((state) => {
    // All-or-nothing, like every other group refusal: this takes every clip
    // that uses the source with it, and a clip on a locked track cannot be
    // removed — so the source stays too (ESCSUITE-84). The media library's
    // Remove and Clear All buttons ask the same question, because clearing
    // deletes the blobs before the store hears about it.
    const { clips, tracks } = state.project.timeline;
    if (lockedSourceVideoIds(clips, tracks).has(id)) return state; // ESCSUITE-84
    const removed = state.sourceVideos.find((v) => v.id === id);
    // An id naming no source is a no-op, not an edit: nothing to write,
    // nothing to revoke, and no undo step recording a "removal" that changed
    // nothing (ESCSUITE-113 review).
    if (!removed) return state;
    // ESCSUITE-113: the source leaving the library may hold a live
    // thumbnailUrl (a `URL.createObjectURL` handle) — the one place this
    // action owns freeing, and nothing else ever will.
    revokeSourceThumbnails([removed]);
    const kept = clips.filter((c) => c.sourceVideoId !== id);
    // ESCSUITE-100: a clipboard entry that used to point at this source can
    // never be pasted back — the same belt-and-braces pruning `removeTrack`
    // does for a deleted track.
    const newClipboard = state.clipboard && state.clipboard.some((c) => c.sourceVideoId === id)
      ? state.clipboard.filter((c) => c.sourceVideoId !== id)
      : state.clipboard;
    // ESCSUITE-101: the same reconciliation as the clipboard's, for the
    // selection — a clip whose source just left the library leaves the
    // timeline with it.
    const pruned = pruneSelection(kept, state.selectedClipId, state.selectedClipIds);
    // The revoked thumbnailUrl above is also scrubbed out of history (this
    // push and everything already in it) — see `scrubDeadThumbnails`.
    const history = removed.thumbnailUrl
      ? scrubDeadThumbnails(pushToHistory(state), [removed.thumbnailUrl])
      : pushToHistory(state);
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
      selectedClipId: pruned.selectedClipId,
      selectedClipIds: pruned.selectedClipIds,
      clipboard: newClipboard,
      history,
    };
  }),

  // ESCSUITE-117: the one write here that is NOT an edit. A source restored by
  // undo comes back with no thumbnailUrl — ESCSUITE-113 scrubbed the revoked
  // handle out of the history snapshots rather than hand back a URL nothing can
  // open — so the media library reads the *stored* thumbnail again and returns
  // the fresh handle through here. Repairing a tile is not something the user
  // then wants to undo, so no `pushToHistory`.
  setSourceThumbnail: (id: string, thumbnailUrl: string) => set((state) => {
    const existing = state.sourceVideos.find((v) => v.id === id);
    // Gone from the library, or already showing this very handle: nothing to
    // write, and nothing freed either way. The first case is the caller's to
    // free — it minted the handle and it is the half that knows the source
    // left — and in the second the handle IS the live one.
    if (!existing || existing.thumbnailUrl === thumbnailUrl) return state;
    if (existing.thumbnailUrl) {
      // The rebuild raced a real load (an import, a session restore) that put a
      // live handle here while the read was in flight. The library's is the one
      // on screen, so the one that lost the race is freed rather than replacing
      // it — otherwise this leaks it.
      revokeSourceThumbnails([{ ...existing, thumbnailUrl }]);
      return state;
    }
    return {
      sourceVideos: state.sourceVideos.map((v) => (v.id === id ? { ...v, thumbnailUrl } : v)),
    };
  }),
});
