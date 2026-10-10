// Project slice: the project itself and the source-video library it draws from.
// Every action here records an undo step, and `resetProject` clears the fields
// other slices own by writing them through the one flat state object.

import type { StateCreator } from 'zustand';
import type { EditorState, Project, SourceVideo } from './types';
import { graftAddedSource, pushToHistory, scrubDeadThumbnails, scrubRemovedSources } from './storeHistory';
import { createEmptyProject, calculateTimelineDuration } from './projectFactory';
import { sameSourceVideo } from './sourceVideoEquality';
import { ensureTimelineHasTracks } from './projectMigration';
import { pruneSelection } from './selectionPrune';
import { revokeSourceThumbnails, revokeThumbnailUrl } from '../core/storage';

export type ProjectSlice = Pick<EditorState, 'project' | 'sourceVideos' | 'setProject' | 'resetProject' | 'setProjectResolution' | 'addSourceVideo' | 'removeSourceVideosPermanently' | 'setSourceThumbnail'>;

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
  // ESCSUITE-244: and no add records a step at all. The caller has already
  // written the bytes to IndexedDB, and undo cannot un-write them: an undoable
  // add let undo drop the source while its row stayed in the shared store, with
  // nothing in either app able to list or free it. The way to take an import out
  // is the library's Remove (ESCSUITE-154), which deletes the bytes. Modelled on
  // ESCSUITE-149's clears, the same fact in reverse — and, like them, it has to
  // reach backwards: every snapshot carries its own copy of the library, so the
  // source is grafted into every past and future snapshot (`graftAddedSource`).
  // Undoing an older edit therefore keeps the import, and an import made while a
  // redo branch exists neither clears that branch nor is dropped by redoing it.
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
    // Scrub the dead handle first (ESCSUITE-113), then graft the incoming entry
    // into every snapshot (ESCSUITE-244), so a snapshot never ends up holding
    // either the revoked URL or a library that lacks this source.
    let history = state.history
    if (previous && previous.thumbnailUrl && previous.thumbnailUrl !== video.thumbnailUrl) {
      revokeSourceThumbnails([previous])
      history = scrubDeadThumbnails(history, [previous.thumbnailUrl])
    }
    history = graftAddedSource(history, video)
    return history === state.history ? { sourceVideos } : { sourceVideos, history }
  }),

  // ESCSUITE-149: a storage clear (per-item Remove, Clear Unused or Clear
  // All, all in `components/VideoUploader.tsx`) deletes the source's bytes
  // from IndexedDB itself before this is ever called, so pushing an undo
  // step for the write that follows would let `undo()` hand a `SourceVideo`
  // back whose bytes are already gone: the tile renders but cannot be
  // played, placed or exported. Modelled on ESCSUITE-117's
  // `setSourceThumbnail` — no `pushToHistory` — but unlike that one-field
  // repair this also has to reach backwards: an edit already on the undo
  // stack before the clear must not be able to resurrect these ids either,
  // so every existing snapshot is scrubbed too (`scrubRemovedSources`,
  // `storeHistory.ts`).
  //
  // Takes every id in one state write (a batch of one, for the per-item
  // Remove — ESCSUITE-154): removes the sources, drops any clip that
  // referenced one (recalculating duration), prunes the clipboard
  // (ESCSUITE-100) and the selection (ESCSUITE-101), and revokes each
  // removed source's `blob:` thumbnail (ESCSUITE-113). This is **not**
  // all-or-nothing on a locked track the way the `removeSourceVideo` it
  // replaced was: every caller only ever hands this the ids whose bytes it
  // already deleted, having filtered locked ones out of its own loop first
  // (ESCSUITE-84).
  removeSourceVideosPermanently: (ids: string[]) => set((state) => {
    if (ids.length === 0) return state;
    const removedIds = new Set(ids);
    const removed = state.sourceVideos.filter((v) => removedIds.has(v.id));
    if (removed.length === 0) {
      // Nothing left in the *live* library to remove or revoke — but one of
      // these ids can still be sitting in an existing undo/redo snapshot (its
      // bytes already deleted by this same caller, just via a batch that
      // landed earlier, or by a `resetProject` teardown before this one
      // ran), so the scrub still has to run (ESCSUITE-149 review, MAJOR 1).
      // `scrubRemovedSources` returns the identical `history` object when
      // nothing anywhere carries these ids, so this stays a true no-op —
      // same `state`, no new object — in that case.
      const history = scrubRemovedSources(state.history, ids);
      return history === state.history ? state : { history };
    }
    revokeSourceThumbnails(removed);
    const { clips } = state.project.timeline;
    const kept = clips.filter((c) => !c.sourceVideoId || !removedIds.has(c.sourceVideoId));
    const newClipboard = state.clipboard && state.clipboard.some((c) => c.sourceVideoId && removedIds.has(c.sourceVideoId))
      ? state.clipboard.filter((c) => !c.sourceVideoId || !removedIds.has(c.sourceVideoId))
      : state.clipboard;
    const pruned = pruneSelection(kept, state.selectedClipId, state.selectedClipIds);
    return {
      sourceVideos: state.sourceVideos.filter((v) => !removedIds.has(v.id)),
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
      history: scrubRemovedSources(state.history, ids),
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
      revokeThumbnailUrl(thumbnailUrl);
      return state;
    }
    return {
      sourceVideos: state.sourceVideos.map((v) => (v.id === id ? { ...v, thumbnailUrl } : v)),
    };
  }),
});
