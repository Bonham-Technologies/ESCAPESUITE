# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ESCAPEARTIST is a client-side web video editor built with React 19, TypeScript, and Vite. It enables video editing entirely in the browser using WebCodecs API for encoding/decoding and IndexedDB for local storage. No server-side processing or FFmpeg required.

**Monorepo Location**: `apps/artist` in the ESCAPESUITE monorepo.

## Build Commands

Run from monorepo root using pnpm:

```bash
pnpm dev:artist          # Start development server (localhost:5175)
pnpm build:artist        # Production build
pnpm test --filter=@escapesuite/artist   # Run tests
pnpm lint                # Lint all apps including artist
```

Or from this directory:

```bash
pnpm dev                 # Start development server
pnpm build               # TypeScript check + Vite build
pnpm build:standalone    # Offline single-file build
pnpm test:run            # Run tests
pnpm lint                # Run ESLint
```

## Architecture

### State Management
- **Zustand store** (`src/store/projectStore.ts`): single source of truth for all editor state, **composed from ten slices** — `create<EditorState>((...a) => ({ ...createHistorySlice(...a), ...createProjectSlice(...a), … }))`. `projectStore.ts` is the **only entry point**, and its surface is exactly `useEditorStore`, the four `select*` selectors and the re-exports; every slice and helper module below is **internal to `src/store/`** and imported by nothing outside it. `create<EditorState>` refuses to compile when the composition misses a field, so the ten slices provably cover the whole interface with no cast. Two invariants hold the split together. **Wherever a slice records an undo step it does so through `storeHistory.ts`'s `pushToHistory`, and nothing re-implements it** (`playbackSlice`, `markerSlice` and `uiSlice` record none) — one module decides what an undo snapshot contains and how deep the stack goes. And **cross-slice reads go through `get()` or the `state` argument of `set`, never through an import**, so the slice graph has no edges between slices at all: a slice's only imports are `zustand`, `./types`, the pure helper modules, `utils/deepClone` and `uuid`. Zustand keeps one flat state object, which is what makes that import-free — `clipSlice.addClipToTimeline` reads `state.currentTime` (playback's field) and writes `project` and `history` (project's and history's) without knowing those slices exist. Each slice declares its own shape as `Pick<EditorState, …>`, so `src/store/types.ts` stays the single declaration of the interface
- Core types defined in `src/store/types.ts`: `Project`, `Timeline`, `Clip`, `SourceVideo`, `EditorState`, `Track`
- Timeline is a flat array of `Clip` objects; each clip references a `sourceVideoId` and defines `startTime`/`endTime` within that source
- **Track properties**: `id`, `name`, `index`, `visible`, `locked`, `muted`, `volume` (0-1), `height` — `locked` freezes the track's contents everywhere (ESCSUITE-84, see Timeline)
- **Auto-track creation**: When adding clips/overlays without specifying a track, a new track is created automatically
- **Snapping helpers** (`src/store/timelineSnapping.ts`): `getSnapPoints`, `findNearestSnapPoint` and `wouldOverlap` — pure functions over the clips they are handed, with no store access, so `components/Timeline/timelineGeometry.ts` and `useClipDrag.ts` can import them without pulling the store module into their graph. `projectStore.ts` re-exports all three, so the paths that always reached them through the store still work. Two more live here and are **not** re-exported, because only the clip drag asks them: `trackIndexDelta` (how many rows a drop moved the clip the pointer held, in `moveSelectedClips`' ascending-`index` space, or `null` when either row has left the timeline) and `canMoveSelectedClips` (whether *every* clip of a multi-selection can take a given time and row delta) — ESCSUITE-80, below. A third, `trackRefusesDrop` (a locked row, or one not on the timeline, takes no clip), is what the single-clip drop asks about the row under the pointer; the group veto applies the same locked rule inline — ESCSUITE-82, below

**Pure helpers** — no zustand, no React, no store access:

| Module | Owns |
|--------|------|
| `storeHistory.ts` | The undo mechanism: `getUndoableState` (what one snapshot holds), `pushToHistory` (push it and drop the redo stack) and the module-private `MAX_HISTORY_SIZE` of 50 that caps the past. The single definition of an undo step — every mutating action in every slice goes through it. `scrubDeadThumbnails(history, deadUrls)` is one exception to "undo/redo never revoke" (ESCSUITE-113): `structuredClone` copies a `thumbnailUrl` *string*, not a live reference, so a source's handle dying in `revokeSourceThumbnails` also kills it for every snapshot taken while that source still held it. Called from the same action that revokes (`resetProject`, `removeSourceVideo`, and `addSourceVideo`'s replace-in-place branch), over the history it just pushed, clearing that same string to `undefined` wherever it still appears past or future — never minting a fresh one, which is `undo`/`redo` staying synchronous rather than growing an IndexedDB read. `scrubRemovedSources(history, removedIds)` is the other (ESCSUITE-149): where `scrubDeadThumbnails` clears one field, this drops the whole `SourceVideo` — and any clip in that snapshot that named it, recalculating the snapshot's own `timeline.duration` — because a storage clear (`removeSourceVideosPermanently`) deletes the source's bytes, not just its thumbnail handle, so an undo past it must not be able to hand the source back at all. Unlike `scrubDeadThumbnails`, it has no `removedIds.length === 0` fast path of its own (ESCSUITE-149 review, MINOR 4) — an empty list carries nothing by construction, so it falls out of the same general check this function uses to decide whether anything changed at all: it returns the exact `history` object, not a copy, whenever neither `past` nor `future` carries any of `removedIds`, which is what lets `removeSourceVideosPermanently` tell "scrubbed a stale snapshot" apart from "nothing to do" by identity (`history === state.history`) rather than by trusting its own `removed.length` — an id can be gone from the *live* library already (nothing left to remove there) while an older snapshot still names it (ESCSUITE-149 review, MAJOR 1) |
| `projectFactory.ts` | The empty shapes and the duration sum: `createDefaultTrack`, `createTrackAtTop`, `findEmptyTrack`, `createEmptyTimeline`, `createEmptyProject`, `calculateTimelineDuration`, and `DEFAULT_PROJECT_NAME`, which `projectStore.ts` re-exports so the old import path still resolves |
| `sourceVideoEquality.ts` | `sameSourceVideo` (and the `sameWaveform` it needs) — the field-by-field comparison that lets `addSourceVideo` treat a re-add of identical metadata as no change at all, rather than as an undo step that restores an identical library |
| `projectMigration.ts` | `ensureTimelineHasTracks` — normalising a loaded project onto the current timeline shape: missing resolution, missing tracks, missing overlay arrays, clips without a `trackId`, and the `convertLegacyOverlays` call on **both** return paths. Runs on every `setProject`. `parseProject(input: unknown)` (ESCSUITE-102) wraps it for the two callers that receive an unvalidated project — a dropped/opened `.veditor` file and the host's `LOAD_PROJECT` — checking the shape (`timeline` an object, `clips` an array, clip ids unique, every clip's `trackId` a string naming a track that exists once migration has run) *before* running the migration, and returning `{ ok: true, project }` or `{ ok: false, reason }` instead of throwing partway through. An absent `tracks` is not itself a failure — that is what the migration branch is for. `resolution`, if present, is checked too (ESCSUITE-152): an object with finite integer `width`/`height` both between 2 and 7680x4320 (8K), rejected otherwise with a reason naming `resolution` — a `{width:0,height:0}` host payload used to sail through and reach `VideoEncoder.configure` inside the exporter instead of being refused here. Odd dimensions are not rejected (the exporters round those to even, ESCSUITE-111), and an *absent* `resolution` is left untouched, to `ensureTimelineHasTracks`'s own 1920x1080 default above. `exportToMP4` and `exportToWebM` each carry the same check again right after resolving their output raster, throwing `ExportError` before any `VideoEncoder` is built — belt-and-braces for a caller (a hand-built headless job spec) that constructs `projectResolution` without going through `parseProject` at all |
| `clipQueries.ts` | `getClipsAtTime`, `getClipAtTime`, `getClipPosition` — reads over a clips array they are handed, never over the store. Re-exported by `projectStore.ts` |
| `trackLock.ts` | Five questions over the clips and tracks a caller hands it — `lockedTrackIds`, `isTrackLocked`, `clipOnLockedTrack`, `anyClipOnLockedTrack` and `lockedSourceVideoIds` (the media a locked row's clips use, which `removeSourceVideo` and the media library's two buttons both ask about) — that every locked-track guard is built from (ESCSUITE-84, see Timeline) |
| `selectionPrune.ts` | One question, `pruneSelection(clips, selectedClipId, selectedClipIds)` — the selection with every id that names no clip in `clips` dropped, `selectedClipId` nulled if it was one of them, and the SAME `selectedClipIds` Set (reference-stable) when nothing needed pruning. Asked by every action that can remove a clip from the timeline some way other than the id it was passed, and by `undo`/`redo` against the clips they land on (ESCSUITE-101, see Timeline) |

**Slices** — each one `export const createXSlice: StateCreator<EditorState, [], [], XSlice>`, composed in this order:

| Module | Owns |
|--------|------|
| `historySlice.ts` | `history`, and `undo`/`redo`/`canUndo`/`canRedo`/`clearHistory`. The only slice that reads the history stacks, and the only one whose actions restore state instead of recording it |
| `projectSlice.ts` | `project` and `sourceVideos`: `setProject` (through `ensureTimelineHasTracks`), `resetProject`, `setProjectResolution`, `addSourceVideo`, `removeSourceVideo`, `removeSourceVideosPermanently`, `setSourceThumbnail`. `resetProject` and `removeSourceVideo` are the two places a source actually leaves the in-memory library through an undoable edit, so they call `revokeSourceThumbnails` — the removed one, or (for a reset) all of them — and `scrubDeadThumbnails` over the history they push. `addSourceVideo`'s replace-in-place branch is the third: a re-add under an id already held can carry a fresh `thumbnailUrl` without the source ever leaving, so it revokes the *previous* entry's handle — but only when it actually differs from the incoming one, so a re-add that keeps the same live handle (an unchanged re-add already returns early above; a changed re-add that happens to keep the same thumbnail does not) never revokes it out from under whatever still shows it. This is the one place ESCSUITE-113 owns the CRAFT handoff / session-restore overlap: the handoff (`useHostIntegration`) can fill the library before the restore question is even answered, so `handleRestoreSession` does not revoke anything itself — it just calls `addSourceVideo` per restored source, same as any other caller, and this is where a restored source sharing a handed-off id frees the stale one (ESCSUITE-113). `setSourceThumbnail(id, url)` is one write in this slice that is **not** an edit (ESCSUITE-117): it puts a rebuilt handle on a source that has none and pushes **no** history entry, because repairing a tile is not something the user then wants to undo. It refuses — and revokes the URL it was handed — when the source already carries a *different* live handle, which is the rebuild having lost a race with a real load; an id naming no source, or the same URL again, changes nothing and frees nothing (the caller owns a handle for a source that has gone, and is the half that knows it). `removeSourceVideosPermanently(ids)` is the other (ESCSUITE-149), and for the same reason as `setSourceThumbnail`: it pushes no history entry of its own. It exists because `removeSourceVideo` is the wrong tool for a storage clear — `VideoUploader.tsx`'s Clear Unused and Clear All delete the source's **bytes** from IndexedDB before they ever touch the store, so an undo that handed the `SourceVideo` back would restore a tile nothing can play, place or export again. One write removes every named source, drops any clip that referenced one (recalculating `timeline.duration`), prunes the clipboard and the selection, and revokes each removed source's thumbnail — then, because the clear can reach back past edits already on the undo stack, scrubs those same ids out of every existing past/future snapshot too (`scrubRemovedSources`, `storeHistory.ts`), so no later undo/redo can resurrect them either. The scrub runs even when every named id has *already* left the live library (`removed.length === 0`) — a batch can legitimately name an id the live `sourceVideos` has already lost (one storage clear landing after another, or after a plain `removeSourceVideo`) while an older snapshot still carries it, and skipping the scrub in that case was ESCSUITE-149 review's MAJOR 1: the write then falls back to `history === state.history ? state : { history }`, a true no-op (the same `state` object back) when nothing anywhere needed scrubbing. `removeSourceVideo` itself is unchanged and stays undoable — it is what the media library's own per-item Remove still calls, which has the same bytes-then-undoable-write shape this ticket fixes here and is tracked separately (ESCSUITE-149 review, MAJOR 2) |
| `trackSlice.ts` | The four track actions — `addTrack` (returns the new track, so it reads through `get`), `removeTrack`, `updateTrack`, `reorderTracks`. Declares no state of its own; tracks live inside `project.timeline` |
| `clipSlice.ts` | The fourteen clip actions (`addClipToTimeline`, `removeClipFromTimeline`, `rippleDeleteClip`, `shiftClipsAfter`, `updateClip`, `trimClip`, `splitClip`, `moveClipToTrack`, `setClipTimelinePosition`, `updateClipTransform`, `updateClipBlendMode`, `updateClipEffects`, `updateClipTransition`, `updateClipAnimation`), plus `duplicateClip` and `recalculateTimelineDuration` — the one mutating action that touches neither `history` nor `modified` |
| `keyframeSlice.ts` | Keyframe data (`setClipKeyframe`, `removeClipKeyframe`, `moveClipKeyframe`, `clearClipKeyframes`) **and** the keyframe panel's own UI state: `keyframePanelState` with its five `setKeyframePanel*` setters. Panel UI, but *keyframe* panel UI, so it sits beside the data it edits rather than in `uiSlice` |
| `overlaySlice.ts` | The overlay clip actions: `addTextOverlayClip` and `addShapeOverlayClip` (both return the new clip, so both read through `get`), `updateTextOverlayData`, `updateShapeOverlayData`. Overlay *clips* only — the legacy overlay arrays are `legacyOverlays.ts`'s business and are already folded into clips by the time a project reaches here |
| `selectionSlice.ts` | `selectedClipId`, `selectedClipIds`, `selectedTrackId`, `clipboard`, and the eleven actions over them: `setSelectedClipId`, `setSelectedTrackId`, `toggleClipSelection`, `selectClipsInRange`, `clearMultiSelection`, `moveSelectedClips`, `deleteSelectedClips`, `copySelectedClips`, `pasteClips`, `muteSelectedClips`, `unmuteSelectedClips` |
| `playbackSlice.ts` | `currentTime`, `isPlaying`, `inPoint`, `outPoint` and their five setters. No history: moving the playhead is not an undoable edit |
| `markerSlice.ts` | `markers` and the six marker actions, `goToNextMarker`/`goToPreviousMarker` included — which write `currentTime`, playback's field, off the `state` argument rather than importing anything |
| `uiSlice.ts` | The five shell preferences the store carries — `zoom` (clamped to 0.1–10 by `setZoom`), `snapEnabled`, `snapThreshold`, `activeTool`, `loopPlayback` — and their four setters. Twenty-one lines, no history, no `get` |

### Core Modules (`src/core/`)
- `storage.ts`: IndexedDB layer using `idb` library. Stores video blobs, thumbnails, projects, and settings in separate object stores. `video-editor-db` is shared with ESCAPECRAFT (root `CLAUDE.md`, Data Flow), so **nothing in ARTIST clears a whole object store** — every bulk delete iterates the ids the library itself holds, per id, the way the media library's Clear All and Clear Unused both do (ESCSUITE-142); `clearAllVideos()` and `clearAllData()`, the two functions that used to do exactly that, were deleted for this reason. `resolveThumbnailUrl(id)` is the one mechanism for turning a *stored* thumbnail into a live `URL.createObjectURL` handle — `undefined` when nothing is stored — that both `projectManager.loadProject` and `useSessionRestore.handleRestoreSession` call rather than trusting a `thumbnailUrl` that arrived from disk (ESCSUITE-96). `revokeSourceThumbnails(sources)` is the other half: nothing else ever frees that handle, so it is the one function every path that retires a `blob:` `thumbnailUrl` calls — a no-op for a source with none, or with a non-`blob:` URL. `revokeThumbnailUrl(url)` is the same revoke for a single handle that is not (yet) a source's, so a caller holding one does not fabricate a `SourceVideo` to get it past the guard; `revokeSourceThumbnails` is written in terms of it, so there is still one place a thumbnail handle is freed and one `blob:` check to read. Its callers each own a moment a source's *old* handle stops being needed: `store/projectSlice.ts`'s `removeSourceVideo` (the one leaving), `removeSourceVideosPermanently` (every one in the batch, on a storage clear — ESCSUITE-149) and `resetProject` (all of them, on teardown); `addSourceVideo`'s replace-in-place branch, when a re-add under an id already held carries a *different* `thumbnailUrl` than the one it is replacing — the one place a source's thumbnail changes without the source itself ever leaving the library, and so the one place a session restore landing on a library the CRAFT handoff already filled can free just the id it actually replaces, leaving every other handed-off thumbnail live; and `useProjectActions.ts`'s `loadProjectFile`, over a REFUSED load's *incoming* sources (`loadProject` mints their thumbnails before validation ever runs) — the outgoing library on a *successful* load is `resetProject`'s to free, not this callback's, so the same URLs are never revoked twice (ESCSUITE-113). A handle that never reached the library at all — `setSourceThumbnail`'s, when the media library's lazy rebuild lost a race with a real load — goes through `revokeThumbnailUrl` directly (ESCSUITE-117). **Nothing else revokes a `SourceVideo.thumbnailUrl`** — in particular the `?loadVideo=` handoff (`useHostIntegration.ts`) keeps no owner of its own: it used to hold the URLs `importTake` had already handed to `addSourceVideo` and revoke them in its effect's cleanup, which under StrictMode's double mount (every development build) left every tile of the take dead, because the second run finds the parts already in the library and mints nothing to replace them with (ESCSUITE-117). Undo/redo never call it — a source coming back via redo still needs a working URL — but a `thumbnailUrl` a revoke just killed is also scrubbed (to `undefined`, not rebuilt) out of every undo/redo snapshot that still carries the same string, by `scrubDeadThumbnails` (`store/storeHistory.ts`), called from the same action that revokes: undoing back past a removal, a reset or a replace lands a source with no thumbnail rather than one nothing can ever open, the same as a source that never had one. Since ESCSUITE-117 it does not wait to be genuinely reloaded either: `VideoLibrary` (`components/VideoUploader.tsx`) calls `resolveThumbnailUrl` for every source in the library that has no `thumbnailUrl` — once per source per mount, in-flight ids tracked in a ref so a re-render issues no second read — and hands what comes back to `setSourceThumbnail`. The handle is the effect's until the store takes it, so it is revoked instead if the source has left the library, the editor has unmounted, or a real load got there first. "Has unmounted" is a `mountedRef` scoped to the **component**, deliberately not a flag scoped to the effect run: a rebuild that lands writes the store, which hands the component a new `sourceVideos` array and re-runs the effect, so a per-run flag cleared by the previous run's cleanup told every read still parked that the editor had gone — each freed the handle it had just minted, the re-run skipped those ids as already read, and exactly one tile per burst was repaired (review round 1, which is why undo across a project load — the ticket's own headline case, restoring every source at once — has two tests of its own). The ref is set `true` on the way in as well as `false` on cleanup, because StrictMode's cleanup-then-remount of the same instance keeps the ref, and a clear-only ref would have left every development build "unmounted" from its second mount onward
- `videoProcessor.ts`: Video metadata extraction and thumbnail generation using native `<video>` element and canvas.
  **Duration fallback**: a WebM with no Duration/Cues element — raw MediaRecorder output, or an
  ESCAPECRAFT take whose `fixWebMMetadata` failed — reports `Infinity` (or `0`) on
  `loadedmetadata`. That used to **hang the import outright**, not merely mis-length it:
  `processVideoFile` asked `generateThumbnail` for a frame at `duration * 0.1`, a browser throws a
  `TypeError` on a non-finite `currentTime` (WebIDL `double`), the throw happens inside the
  element's own event handler where no `try/catch` up the stack can see it, and the thumbnail
  promise never settles — so the media row sat on "Processing…" for ever.
  `loadMediaDuration` now seeks to `Number.MAX_SAFE_INTEGER` (browsers clamp to the end;
  Chromium scans the container to find it), listens for both `durationchange` and `seeked`, and
  takes the first usable — finite, positive, and **not the seek target itself**, which an
  un-clamped browser would report straight back — value of the element's `duration`, else of its
  `currentTime` (the position the seek clamped to, which is all some browsers reveal). A
  usable duration on `loadedmetadata` resolves immediately with no seek; nothing usable within 5 s
  rejects with `Could not determine the duration of <name>`, which `VideoUploader` shows verbatim
  in the file's upload row. One `release()` is the single settle path, so the probe is torn down
  and the object URL revoked **exactly once** whichever way the promise settles — pinned by
  `toHaveBeenCalledTimes(1)` on the success, timeout and error paths. `processVideoFile` passes the
  thumbnail time explicitly as `metadata.duration * 0.1`, because `generateThumbnail` loads its own
  element and would read the same `Infinity`.
  **`extractAudioMetadata` shares the probe**: `loadMediaDuration(element, objectUrl, name, kind)`
  is the one implementation both importers call — an ESCAPECRAFT take recorded with no camera is
  the same headerless WebM, just Opus-only, and used to build an infinitely long *audio* clip
  (no hang, since the audio path never seeks, but the same wrong length). Only the word in the
  failure message differs: `Failed to load audio: <name>` against the video path's
  `Failed to load video: <name>`, with `Could not determine the duration of <name>` shared.
  **The stored path needs the same guard**: the `?loadVideo=` handoff from ESCAPECRAFT
  (`app/useHostIntegration.ts`) adds a recording from its stored metadata and never calls
  `extractVideoMetadata`, and CRAFT stores `Infinity` in preference to its own wall clock (its
  guard is `duration > 0`, which `Infinity` passes). `resolveStoredDuration(blob, metadata)`
  returns the stored duration when it is usable and otherwise recovers it from the blob, so the
  handoff cannot build an infinite clip either. The `<video>` double
  (`src/test/doubles/media.ts`) models the discovery with `durationAfterSeek` /
  `durationStaysUnknown`, and throws on a non-finite `currentTime` the way a browser does, so this
  class of hang is caught by the unit suite rather than only in a browser. The `<audio>` double
  shares that one `currentTime` setter (`SeekScript`, which both `VideoScript` and `AudioScript`
  extend), so the two importers cannot drift apart in the tests either.
- `exporter.ts`: Two export paths using WebCodecs + `mediabunny` for muxing:
  - **WebM**: VP9 video + Opus audio, frame-by-frame encoding with audio mixing
  - **MP4**: H.264 video + AAC audio, frame-by-frame encoding with WebCodecs decoding
- `audioMixer.ts`: `extractAndMixAudio` is the export pipeline's one audio mixer — both
  `exportWebM.ts` and `exportMP4.ts` call it directly, on the main thread. It decodes each
  clip's source with `OfflineAudioContext`, applies `getAnimatedVolume` per sample (so a
  clip's volume keyframes always reach the export, the same as the preview), sums the result
  into one stereo interleaved timeline buffer and normalises the peak back under 1. A clip
  whose track has been deleted is **skipped**, the same as a muted track (ESCSUITE-99;
  previously it was mixed in at full volume), and the same as a **hidden** track (ESCSUITE-127:
  the preview was already silent for one — `store/clipQueries.ts`'s `getClipsAtTime` filters on
  `track.visible` before `usePreviewRenderLoop` builds its audio routing from that list — but the
  mixer built its own clip list and only checked `muted`, so an export used to carry a hidden
  track's audio that no one heard in the editor). There used to also be
  `extractAndMixAudioWithWorker`, a Web Worker fast path (`workers/exportWorker.ts`,
  `utils/workerSupport.ts`) with a main-thread fallback — deleted by ESCSUITE-99, because its
  own mixer multiplied by track volume alone (dropping volume keyframes) and its support probe
  tested for `OfflineAudioContext` *inside* the worker, which real Chromium never exposes to a
  `DedicatedWorker`, so `getWorkerSupport()` always resolved `false` and the worker path never
  ran in production. Every export already went through the main-thread mixer; deleting the dead
  path just stops paying for the Worker spin-up and probe on every export.
- `outputTransform.ts`: the one place project space is carried onto an output raster —
  `projectToOutputScale`, `setOutputTransform` and `openOutputFrame`, called by the preview and
  by both exporters. See "Export Resolution" below
- `projectManager.ts`: Project save/load to JSON files with embedded video references.
  **File format**: each entry in `ProjectFile.videos` carries the video's base64 bytes and,
  since ESCSUITE-97, a `meta?: SourceVideoMeta` beside them — the live `SourceVideo`'s own
  `duration`/`width`/`height`/`frameRate` plus whatever of `mediaType`, `source`, `recordedAt`,
  `waveformData`, `hasAudio`, `takeId`, `role`, `startOffset`, `overlayPlacement` and
  `hasWebcam` it had (`id`/`name`/`mimeType` are already the entry's own top-level fields, and
  `size` is always the restored blob's). `saveProject` writes it from the `SourceVideo` it was
  given; `loadProject` takes every field from it and never touches the blob when it is present.
  `meta` is optional and the file's `version` stays 1 — purely additive, so a project saved
  before this ticket, or by an older build, has no `meta` and `loadProject` falls back to
  `extractMetadataFromBlob` exactly as it always did. That fallback used to read a video or
  audio element's raw `duration` with no guard, so a saved ESCAPECRAFT take whose WebM has no
  Duration element came back `Infinity` seconds long on every reopen — the same headerless-WebM
  problem `loadMediaDuration` (`videoProcessor.ts`) already solved for import and for the
  CRAFT handoff, just re-introduced by this third hand-rolled probe. `extractMetadataFromBlob`'s
  video and audio branches now call that same exported `loadMediaDuration`, so an old file's
  duration is recovered the same way an import's is, and cannot come back infinite.
  `headless/seedSources.ts` shares that same fallback for a source it wasn't handed full
  metadata for, so a headless render of a headerless source that used to complete instantly
  with a silently wrong `Infinity` duration can now take up to the probe's 5s timeout and reject
  instead — the correct outcome, but a latency and failure-mode change for that one caller.
  A file with `meta` skips the blob probe for whichever of `duration`/`width`/`height` it holds
  a usable number for — waveform peaks and take identity are trusted from what was actually
  recorded or computed, not guessed at from the bytes — but `meta` came out of `JSON.parse`, not
  the type checker, so `loadProject` still recovers any of those three from the blob if a
  hand-edited file's value is not a real, non-negative finite number (review round 1); a
  `thumbnailUrl` inside `meta` is never trusted either way; the only source of one is
  `resolveThumbnailUrl` over what is actually stored, exactly as ESCSUITE-96 already required.
  `source`/`takeId`/`role`/`startOffset`/`overlayPlacement` — CRAFT's take identity, not
  ARTIST's — are the one part of a restored source's metadata `loadProject` never takes from
  `meta`: a source already in the shared DB (a take ESCAPECRAFT still owns, or one an earlier
  import/load already restored) keeps those five fields exactly as stored, while everything
  else about it (duration, dimensions, waveform data, …) is still rebuilt from the file being
  reopened, the same as for any other source; a source the id names nothing for has them
  cleared outright rather than copied from `meta`. Copying them from the file onto a copy the
  DB doesn't already hold used to put a take the user had deleted in CRAFT straight back into
  CRAFT's own library — CRAFT reads
  `getAllVideoMetadata().filter(v => v.source === 'recording')` (root CLAUDE.md, "Data Flow"),
  with no notion of "this one came from a project file" to exclude it — and trusting the file's
  identity fields even for a source already present would let a stale saved snapshot overwrite
  what CRAFT (or a later edit) has since written (ESCSUITE-151). Either way `storeVideo`/
  `storeThumbnail` only run for a source not already in the DB; a present source's
  `thumbnailUrl` is still refreshed from what is actually stored (ESCSUITE-96).
- `videoDecodeManager.ts`: Main thread API for WebCodecs video decoding via Web Worker
- `frameSource.ts`: Abstraction layer for frame sources (WebCodecs or HTMLVideoElement fallback)
- `clipCrop.ts`: a media clip's **crop** (ESCSUITE-6) — four insets, as fractions of the source frame. `croppedSourceRect(w, h, crop?)` is the region to draw and is read by both media draws in `canvasRenderer.ts` **and** by `components/Preview/previewGeometry.ts`, so the picture and the chrome round it can never disagree; it floors the region at one source pixel, because `drawImage` throws `IndexSizeError` on a zero-width source rect and a throw inside a preview frame kills the whole frame. `isValidCrop(value)` is the shape check `parseProject` runs — four finite insets >= 0 leaving something on each axis — and takes no dimensions, because a project is validated before its media is re-linked. `normaliseCrop(crop, w, h)` is what the inspector stores: clamped to 0-90% per edge, `undefined` for an all-zero crop, and a refusal (`{ ok: false }`, write nothing) for anything that would leave less than a source pixel. `cropForAspect(w, h, aspect, crop?)` is the aspect presets, computed against the region the clip **already** shows rather than the whole frame, so presets compose and Reset is the thing that starts over. Static: `crop` is not an `AnimatableProperty` and never passes through `getAnimatedValues`

### Video Decode Worker (`src/workers/decodeWorker.ts`)
Web Worker for WebCodecs-based video decoding, enabling full-speed exports in background tabs:
- Uses `mp4box.js` for MP4 container demuxing
- Uses WebCodecs `VideoDecoder` for frame decoding
- Builds keyframe index for efficient seeking
- LRU frame cache with configurable size
- Returns `VideoFrame` objects (transferable) for zero-copy performance

### Integration API (`src/utils/integration.ts`)
The editor can be embedded in other applications via:
- **PostMessage**: Bidirectional communication with parent window
- **URL parameters**: parsed once at startup by `parseUrlParams()` (later URL changes are ignored; `App` holds the parsed result in state)

Message types: `LOAD_VIDEO`, `LOAD_PROJECT`, `GET_STATE`, `EXPORT`, `SET_THEME`, `GET_THEME` (inbound); `READY`, `VIDEO_LOADED`, `STATE`, `EXPORT_COMPLETE`, `EXPORT_PROGRESS`, `PROJECT_SAVED`, `ERROR`, `THEME_CHANGED`, `THEME_STATE` (outbound)

**Documented but not currently implemented** — these appear in the protocol comment and in the `IntegrationMessage` union, but nothing implements them today; treat them as reserved names, not as a contract a host can rely on:

| Name | Status |
|------|--------|
| inbound `EXPORT` | `App`'s handler has no case for it |
| outbound `EXPORT_PROGRESS` | nothing sends it |
| outbound `PROJECT_SAVED` | nothing sends it |
| `?project=<base64>` | parsed by `parseUrlParams`, never applied |
| `?autoplay=true` | parsed by `parseUrlParams`, never applied |

`sendMessage()` posts to the parent only when `isEmbedded()` (from `@escapesuite/shared/config`) is true; it always dispatches a `videoeditor:message` CustomEvent for same-window hosts. The post is addressed to `?hostOrigin=` when the host supplied a valid one, and to `'*'` otherwise.

**Inbound message filtering**: `initIntegration`'s listener acts only on events whose `event.source` is `window.parent` — the framing window is the only one that drives the editor. When `?hostOrigin=` is set, `event.origin` must match it as well.

**Outgoing `EXPORT_COMPLETE`**: sent from `ExportDialog` right after a successful export (alongside the normal browser download, which is unchanged). Not sent when the export fails or is cancelled.

**Inbound `LOAD_PROJECT` is validated (ESCSUITE-102)**: the payload is the project object itself
(not wrapped in a `data` field), and `useHostIntegration` runs a *present* payload through the
same `parseProject` a dropped `.veditor` file goes through before `setProject` ever sees it — a
host is no better placed than a malformed file to hand a project ARTIST's migration can walk with
no guards. A payload that fails validation is answered with
`{ type: 'ERROR', payload: { message, code: 'INVALID_PROJECT' } }` and the current project is left
untouched, undo history included. An absent payload is still silently ignored, as it always was.

**`LOAD_VIDEO` and `?video=` fetch through the page's own `connect-src` (ESCSUITE-130)**:
`loadVideoFromUrl` (`utils/integration.ts`) is a plain `fetch(url)`, so both are bound by whatever
Content-Security-Policy the deployment sets — on the hosted deployment (`connect-src 'self'
https://api.vercel.com https://vercel.live` in `vercel.json`) that means a **same-origin URL
only**; a cross-origin one never leaves the page. The browser throws a bare `TypeError: Failed to
fetch` for that refusal, a CORS refusal and an ordinary network failure alike, with no way to tell
them apart from the exception — so `loadVideoFromUrl` catches it, resolves the URL's origin, and
throws a message naming that origin and, when it differs from `location.origin`, the likely
Content-Security-Policy cause (`Could not load the video from <origin>: this deployment does not
allow loading from other origins (Content-Security-Policy), or the server refused the request.`).
A same-origin rejection keeps a plain "the request failed" message — that is an ordinary network
or 404 failure, not a policy one. `useHostIntegration` passes that message on rather than a
generic one: the `?video=` path shows it via `showNotification` (as well as the existing
`console.error`), and inbound `LOAD_VIDEO` both shows it and answers the host with
`{ type: 'ERROR', payload: { message, code: 'LOAD_ERROR' } }` carrying it. A self-hosted or
standalone build fetches under whatever `connect-src` it sets itself, so this only bites the
hosted deployment. See the root `CLAUDE.md`'s "URL params (ARTIST)" bullet.

```ts
{ type: 'EXPORT_COMPLETE', payload: { blob: Blob, format: 'mp4' | 'webm', name: string } }
// name is `${projectName || 'export'}.${format}`
```

**URL parameters**:

| Param | Effect |
|-------|--------|
| `?video=<url>` | Load a video from a URL (repeatable). Fetched from the page itself, so bound by its `connect-src` — same-origin only on the hosted deployment (ESCSUITE-130, see above) |
| `?project=<base64>` | Base64-encoded project state — *documented but not currently implemented* (parsed, never applied) |
| `?autoplay=true` | Start playback once loaded — *documented but not currently implemented* (parsed, never applied) |
| `?loadVideo=<id>` | Load a **take** from IndexedDB (ESCAPECRAFT handoff). The id names the take's primary part; every part of it joins the media library and is placed on the timeline — see "A handed-over take is several files" below |
| `?suppressRestore=1` | Skip the "Resume Previous Session?" prompt. Accepts `1` or `true`. ESCAPEARTIST **neither offers nor writes** the saved session under this flag — the session autosave is switched off too, so a host-driven session leaves storage exactly as it found it |
| `?title=<name>` | Initial project name. Trimmed, capped at 120 chars, trimmed again after the cut, blank ignored. Applied only while the project name is still the default `'Untitled Project'`, so it never overrides a name from `?project=` data or a restored session. `clearHistory()` runs right after, so the host naming the project is not an undo step |
| `?hostOrigin=<origin>` | The host's own origin, e.g. `https://host.example`. **Recommended for production hosts.** Must be a bare origin (a URL whose serialisation equals its own origin); anything else is ignored with one console warning. Outbound posts go to it instead of `'*'`, and inbound messages from any other origin are dropped. It protects the **host's** deployment, *not* against being framed — a hostile page that frames the app also controls this URL and would just supply its own origin. Refusing to be framed is `Content-Security-Policy: frame-ancestors` on the deployment serving the app  The hosted deployment sends `frame-ancestors 'self'` (see `vercel.json`); self-hosted builds must set their own. |

#### A handed-over take is several files

`?loadVideo=<id>` names a take's **primary** part. Since ESCSUITE-14 a take recorded with
ESCAPECRAFT's "Record webcam as a separate track" is several `SourceVideo`s sharing a
`takeId` (see the root `CLAUDE.md`'s Data Flow), so the handoff resolves the take before it
does anything with it — `app/takeImport.ts` reads `getAllVideoMetadata()` and hands the list
to `utils/takeParts.ts`'s `orderTakeParts`, which keeps the parts whose `takeId` is the
primary's id. That is the same one equality ESCAPECRAFT groups its library rows by
(`apps/craft/src/utils/takeOrder.ts`). A take with **no** `takeId` — every recording made
before ESCSUITE-14 and every composited PiP take after it — costs no second storage read at
all.

**Every handoff now places clips** (spec decision 7), a single-file take included. It used to
add the recording to the library and leave the timeline empty for the user to drag it onto.
The primary lands on the track a drop from the media library would take — `findEmptyTrack`'s
lowest-index empty one, or a new track at the top if there is none — and each companion on a
new track **above** the one before it, in role order (`ROLE_ORDER` in `utils/takeParts.ts`:
`screen`, `webcam`, `mic`, `system`, so slice 3's audio parts need no ARTIST change). The
whole take is **one undo step**: `store/clipSlice.ts`'s `placeTakeOnTimeline` writes every
track and every clip in a single `set` with a single `pushToHistory`, so one Ctrl+Z takes the
take off the timeline and leaves its media in the library. Each clip sits at the take's start
plus its own `startOffset`, and the take's start is `calculateTimelineDuration` over the clips
already there — so a handoff into a session that already holds work **appends at the end**
rather than landing on top of it; an empty timeline measures 0, so the ordinary import still
starts there and there is no special case for it. An empty list places nothing and records no
undo step, because a take whose every part was missing must not leave an undo step that undoes
nothing.

**The webcam clip's transform is seeded from the take's `overlayPlacement`** (decision 8), so
the import looks like what the user saw while recording and stays editable — which is the
whole point of the separate track. `utils/overlayPlacement.ts` owns the conversion
(`overlayPlacementToTransform`) and is pinned against `Compositor.drawWebcamOverlay`'s own
numbers, with two deliberate differences. The corner inset is `overlayMarginFor(frame.width)`,
which mirrors ESCAPECRAFT's `overlayPaddingFor` (`apps/craft/src/core/overlayGeometry.ts`)
exactly: `DEFAULT_OVERLAY_PADDING` (20 px) below and at `COMPOSITOR_MAX_WIDTH` (1280), and
`frame.width * OVERLAY_MARGIN_FRACTION` (`20 / 1280` of the frame) above it. The compositor caps
its preview canvas **only above 1280** — it never scales a narrower share up — so both halves are
the 20 px the user actually saw: a flat 20 px on a 4K project would put the overlay four times
closer to the edge than it looked, and 20/1280 of a 640-wide share put it 10 px from the edge,
half as far as the preview and the composited MP4 both did (fixed in ESCSUITE-69; the sub-1280
case is pinned in `utils/overlayPlacement.test.ts` against craft's own arithmetic). And the
aspect is the **camera's**, not the compositor's
hard-coded 16:9 box, which stretches a 4:3 picture — the width, which is the size the user
chose, is the compositor's exactly. `x`/`y` are the clip's centre as a fraction of the canvas
and the scale is the drawn width over the part's native width, because that is how
`core/canvasRenderer.ts` reads them: **scale 1 means native pixels**. A part whose stored
dimensions are unusable (nothing ESCAPECRAFT writes) still lands in its corner: the box falls
back to 16:9 and the clip to `DEFAULT_TRANSFORM.scaleX`, which beats a clip zero pixels wide.
The placement's `shape` is **no longer ignored** (ESCSUITE-65): `maskForPlacement` and
`strokeForPlacement` map it and ESCAPECRAFT's white border onto the clip's own `mask` and
`stroke`, beside the transform and from the same one question about whether this part is the
take's camera. The mask's radius is a fraction of the clip's **shorter drawn side** — so it
survives a resolution change — and the stroke's width is a fraction of the **project's** width
carrying craft's 3 px scaled the way `overlayPaddingFor` scales its padding: flat at or below
`COMPOSITOR_MAX_WIDTH`, proportional above it. The handed-over mask is visible on the timeline
as well as in the frame: the webcam clip's thumbnail is clipped to the same circle (see the
Timeline section). Its border is not — the thumbnail shows the shape only.

**The corner is the screen recording's, not the canvas's.** `overlayPlacementToTransform`
takes an optional fourth argument — the **frame**, a rectangle in canvas pixels — and both the
inset and the overlay's width are fractions of `frame.width`. `placeTakeOnTimeline` computes it
from the take's primary: every part imports at native pixels centred on the canvas, so a
1280x720 screen recording in a 1920x1080 project is drawn in a rectangle 320 across and 180
down, and the camera sat in a corner of *that* while recording. Measuring from the canvas
instead would drop the camera over the middle of the picture on every take whose capture is not
the project's own size. The frame defaults to the whole canvas — which is what it *is* when the
two match, and what a primary with no stored dimensions falls back to.

**An audio part carries no picture, and now says so.** A take's microphone and
system-audio companions are stored as `mediaType: 'audio'` with no dimensions at all
(ESCSUITE-14 slice 3), and `TakeClipPart` carries that one field through to the store, where
two decisions turn on it (ESCSUITE-71): such a clip takes `DEFAULT_TRANSFORM`, **always** —
even one that somehow arrived carrying an `overlayPlacement` — and it can never be the
rectangle the webcam corner is measured against, which is the take's first part *with* a
picture rather than `parts[0]`. Both used to be true by accident: an audio part arrives
`0x0`, which fell through to the default transform (right, for a clip nothing ever draws —
`previewGeometry.getOverlayBounds` answers `null` for an audio source) and, had a part ever
arrived before the primary, would have measured the camera against a rectangle that silently
means "the whole canvas". The clip carries the whole default rather than no transform at all
because `Clip.transform` is a required field.

**Every part arrives with its waveform**, computed by the same `extractWaveformData`
(`utils/waveform.ts`) the media library's own import path calls for every file, at the same
point in the sequence — with the library entry, before the take is placed (ESCSUITE-71). It
is *not* only the audio parts: `processVideoFile` gives a video a waveform too, so the
primary's own mixed audio gets one and a handed-over take is not the one import that looks
different. And it had to be done here, because nothing recomputes one: those two import paths
are the only writers of `waveformData`, so a part that arrived without one never got one.

Three rules, and a shape. A part ESCAPECRAFT recorded with `hasAudio: false` is **never
decoded** — that flag is the capture's own answer (ESCSUITE-60/62), the webcam half of a
separate-tracks take having no audio track by construction with the whole mix staying on the
primary. `hasAudio` is **the persisted flag where there is one and the peaks otherwise**
(`part.hasAudio ?? peaks.length > 0`): the extractor's own `hasAudio` is a silence heuristic
and is deliberately not consulted, because it would cost a take recorded in a quiet room the
flag slice 3 persisted *and* leave a pre-ESCSUITE-60 quiet part with no flag at all — which is
peaks `TimelineTrack` would never draw, since it needs the flag **and** non-empty peaks. A
waveform that cannot be read costs the part its waveform and nothing else, exactly like a
thumbnail. The shape is two passes: the storage reads stay serial, part by part, but each
part's waveform is *started* rather than awaited and the library is written after one
`Promise.all` — so a four-part take waits one decode instead of four, while the peaks still
arrive with the entry (one `addSourceVideo` per part, so placing the take is still one undo
step, and it is placed complete).

Three things the import refuses to do, each chosen rather than defaulted:

- **A part whose blob is gone is skipped and counted**, never fatal — storage cleared between
  the two writes, or a companion deleted by hand. A companion whose `getVideo` *rejects* is
  answered the same way: how a part was lost is not the take's business, only that it was, and
  a half-imported take (the primary in the library, nothing on the timeline, a failure toast)
  is worse than a take that arrived a track short and said so. The toast then says
  `Loaded recording: <name> — 1 missing part skipped` (`'info'`) *instead of* the success
  sentence, because `useNotification` is one slot on a three-second timer and two messages
  mean the first is never read. A companion whose own length cannot be read borrows the take's
  instead of being left off, because every part of a take is the same length by construction.
  The primary's own path is exempt from both: its blob is already in hand, and a primary whose
  length cannot be resolved still throws, because that is the take failing rather than a part
  of it. A `getThumbnail` that rejects, for any part including the primary, costs that part its
  picture and nothing else — a thumbnail is cosmetic — and if the import throws part-way it
  revokes every thumbnail URL it had made, because its return value is the only way those URLs
  ever escape.
- **A companion with a role this build does not know joins the library and nothing else.**
  IndexedDB is not type-checked; a record written by a newer ESCAPECRAFT is visible and
  deletable rather than placed somewhere arbitrary. (`partRoleRank` answers `Infinity` for such
  a role, which is also what sorts those parts last.)
- **A take any part of which is already in the library is skipped whole** — no re-add, no
  second placement, no notice. That guard predates this work and is what keeps a host
  re-navigating the same id from placing the take twice. It used to ask only about the
  **primary**, which was a hole a user could walk through: delete the primary from the media
  library, re-send the take from ESCAPECRAFT, and the companion — still in the library, so
  re-adding it is idempotent by id — was **placed** a second time, on a second new track
  (ESCSUITE-69). So the question is asked about every part, and asked in `app/takeImport.ts`
  rather than in the hook, because the parts are not known until the metadata scan and the
  refusal has to land before the first write: `importTake` takes an `isInLibrary(id)` lookup
  (the hook lends it `useEditorStore.getState().sourceVideos`, read at call time) and answers
  `alreadyInLibrary`, on which the hook returns without placing or saying anything.
  **The question is asked twice**, because that first one is asked too early to settle it on
  the ordinary path: the library is read when the import's storage reads land, which on a load
  with no `?suppressRestore=1` is *before* `handleRestoreSession` runs
  `session.sourceVideos.forEach(addSourceVideo)`. So a saved session that already holds the
  take got past it and the take was appended a second time — whether the user saw a duplicate
  or a silent skip came down to whether the import lost the race to the prompt click. The
  second check is in `placePendingTake`, at placement time, and asks the **timeline** rather
  than the library: by then the restore has re-added every part it holds, so an id lookup can
  no longer separate "the session already had this take" from "the import just added it", while
  a clip already playing the part can — and is the thing a second placement would duplicate.
  A take dropped there is dropped silently and hands its thumbnail URLs back, the restore
  having re-added its own library entries over the import's.
  The any-part rule has a cost, and it is deliberate: a take whose primary was deleted from the
  library while its companion survived **cannot be re-imported at all** until the companion is
  deleted too. Silence beats a duplicate clip — the library is where a part is visible and
  deletable, so the way back is open, and the alternative is a take the user cannot get rid of
  without noticing it arrived twice.

**The effect that runs the import knows when it is gone.** `useHostIntegration`'s
`?loadVideo=` branch carries an effect-scoped `cancelled` flag, set as the cleanup's first
statement and read twice — after the `getVideo`, where nothing has been created yet and
leaving is free, and after `importTake`, where the parts are already in the library (harmless,
and `addSourceVideo` is idempotent by id) but the timeline and the toast belong to whoever is
still mounted, so that run revokes its own thumbnail URLs and returns. Two things need it:
StrictMode, which every dev build runs (`bootstrapApp` wraps `App` in it) and which would
otherwise place the take twice — the library guard cannot separate the two runs, because the
first is still awaiting storage when the second checks — and an unmount mid-import, which
would otherwise have the cleanup revoke an array that is still empty and land a
`placeTakeOnTimeline` in a project the editor has left.

`LOAD_VIDEO` and `?video=` are **not** take handoffs: they fetch a file from a URL, address no
stored take, and still only add to the library. Both are pinned as placing nothing.

**Placement waits for the restore decision.** ESCAPECRAFT's standalone "Send to Editor" opens
`/artist/?loadVideo=<id>` with **no** `?suppressRestore=1`, so a user with a saved session is
offered "Resume Previous Session?" while the handoff is arriving — and restoring does
`setProject` plus `clearHistory()` (`app/useSessionRestore.ts`), which would replace a take
placed before it and leave no undo step back to it. So the two halves of the import are split:
the parts join the **media library** as soon as they are read (restoring re-adds its own source
videos and `addSourceVideo` is idempotent by id, so nothing there is at risk), while the
**timeline** placement and its toast are held in a ref and drained by a second effect once
`sessionDecisionPending` goes false — whichever way the question was answered. Declining places
the take as usual; accepting restores first and then appends the take after the restored clips
(the append-at-end rule), one undo step, and since the restore's `clearHistory()` has already
run that step still undoes it.

`sessionDecisionPending` is `!sessionRestored`, **not** `showSessionPrompt`, and the difference
is the whole point: for the first moments of a cold load `getSessionState()` has not come back,
so no prompt is on screen while the question is very much unanswered — and a take placed in
that window is discarded by the "Restore" the user has not been offered yet. `sessionRestored`
(`app/useSessionRestore.ts`) is false from the first render until the question settles one of
five ways: suppressed, nothing stored, the read failed, restored, declined. It is the flag the
session autosave already gates on, and its own doc comment calls it settled-ness; there is no
second flag. Both it and `showSessionPrompt` are `App` component state, so this costs `App` no
store subscription. With the question settled — every `?suppressRestore=1` load included — the
take is placed on the same tick it always was. A host that drives its own state should still
pass `?suppressRestore=1`, which switches the prompt and the autosave off together.

The whole path is pinned by `app/takeImport.test.ts`, `app/useHostIntegration.test.ts`,
`store/__tests__/projectStore.takePlacement.test.ts` and `utils/overlayPlacement.test.ts` /
`utils/takeParts.test.ts`, and end to end by `apps/e2e/tests/escapeartist/take-import.spec.ts`,
which seeds two-part takes straight into the shared database and reads the webcam clip's
corner back out of the inspector — once for a share the size of the project, once for a
1280x720 share in a 1920x1080 project (76% / 75% at 40%, the corner of the centred picture
rather than the canvas's 88% / 87% at 60%) — and, in its last case, restores a seeded session
with one clip on it before answering the prompt, so that the take is seen appending after the
restored clip and coming off again in a single Ctrl+Z. That spec is skipped in WebKit — Playwright's WebKit cannot
store a `Blob` in IndexedDB, the same reason `tests/integration/indexeddb-sharing.spec.ts`
skips there.

### Build Configuration
- `vite-plugin-singlefile`: Builds entire app into a single HTML file (all assets inlined)
- Target: ESNext, no code splitting
- `build:standalone` produces an offline single-file build for air-gapped use
- **`isSingleFileBuild(env)`** (`singleFileBuild.js`, beside `vite.config.ts`; unit tested from
  `src/build/singleFileBuild.test.ts`, since `vitest`'s `test.include` only looks under `src/`)
  names, once, which
  builds must ship as exactly one HTML file with `decodeWorker` inlined as a blob URL rather
  than a separate chunk: true for `VITE_HEADLESS=true` or `VITE_BUILD_MODE=standalone`, false for
  the hosted (`saas`) default. Both single-file targets run from `file://` — the headless render
  bundle (opened by Playwright and the headless-artist CLI) and the standalone offline build
  (downloaded from a GitHub Release and opened directly) — where Chromium blocks a page from
  loading a worker script as a separate `file://` resource; the hosted build is served over
  http(s), where a separate worker chunk is an ordinary same-origin fetch. `vite.config.ts` gates
  `headlessClassicWorkersPlugin`, `headlessInlineWorkersPlugin` (now parameterised on the output
  directory and entry HTML filename rather than assuming the headless build's own
  `dist-headless/headless.html`) and the `worker: { format: 'iife' }` override on this one
  predicate. ESCSUITE-153: before this, only `VITE_HEADLESS` was checked, so the standalone build
  shipped `dist/index.html` plus a second, un-inlined `decodeWorker-*.js` that
  `standalone-release.yml` never attaches to the release — a downloaded build's MP4 export had no
  worker file to start at all. `singleFileBuild.js` is plain JS, not TypeScript, with a
  hand-written `singleFileBuild.d.ts` beside it: `vite.config.ts` is type-checked under
  `tsconfig.node.json`, which lacks `allowImportingTsExtensions`, so a `.ts`-suffixed import from
  it fails `tsc -b` (TS5097) — and an extensionless import instead trips Vite's
  `configLoader: 'native'` warning on every invocation. A plain `.js` file carries its own real
  extension (no warning) without ever being a `.ts` import (no TS5097). Guarded end to end by
  `apps/e2e/tests/standalone/dist-single-file.spec.ts`, a node-side assertion (no browser fixture)
  that each of `apps/artist/dist` and `apps/craft/dist` contains exactly one file after
  `build:standalone` — `playwright.standalone.config.ts` serves the whole directory with `npx
  serve`, which is why the browser-driven standalone specs never caught a second file sitting
  next to `index.html`.

### Overlay System
- **ShapeType**: `'rectangle' | 'ellipse' | 'line' | 'arrow' | 'blur'`
- **Blur overlay**: Dedicated shape type that blurs underlying content without fill/stroke
- Blur uses offscreen canvas capture to avoid self-reference issues
- Blur rotation transforms the clip region without rotating the blurred content

#### Legacy overlay arrays
Older ARTIST versions stored overlays in `timeline.textOverlays` / `timeline.shapeOverlays`
instead of as clips. Those arrays are **input-only — write-never, read-once**: nothing in the
app creates, renders, edits or selects a legacy overlay; apart from `ensureTimelineHasTracks`
normalising a missing array to `[]` first, the only code that touches either array is
`store/legacyOverlays.ts`'s `convertLegacyOverlays(timeline)`; and the `TextOverlay` /
`ShapeOverlay` types survive in `store/types.ts` solely so an old file on disk still parses.
The conversion folds them into ordinary overlay clips and empties them. It runs on **every**
load path — both return paths of
`ensureTimelineHasTracks` (`projectMigration.ts`, so every `setProject` caller: Open Project, the
media library, session restore and the host's `LOAD_PROJECT`) and `headless/renderProject.ts`'s
`render()`, which does not go through the store. Before this, a legacy overlay drew in the
preview and was then silently missing from every export and every headless render, because the
exporters only iterate `timeline.clips`.

- **Pure and deterministic** — no store, no React, **no `uuid`**: ids derive from the legacy
  ids (`legacy-text-<id>` / `legacy-shape-<id>`), so the same file always converts to the same
  project and a headless render of it is reproducible. An entry whose derived id is already a
  clip is skipped, which makes the function idempotent and lets a half-converted file converge.
- **Identity on empty input** — with both arrays empty or absent it returns the *same*
  `Timeline` object, so a modern project (the headless kit's fixture included) is provably
  untouched.
- **Track placement is load-bearing.** The legacy preview drew all clips by ascending track
  index and then, on top of everything, all shapes followed by all text. So the conversion
  processes **shapes before texts** and puts them on tracks it creates *above every existing
  track* (`legacy-overlay-track-N`, named `Overlay`, `Overlay 2`, …), reusing one of its own
  tracks only when the windows do not overlap — and the reuse pool is **per kind**, so every
  text track is created after (and indexed above) every shape track; one shared pool would let
  a text land on a low track created for a shape while a later shape spilled above it,
  inverting the stacking. The cost is one extra track where a shape and a non-overlapping text
  could have shared one. `findEmptyTrack` — what `addTextOverlayClip`
  uses — is deliberately NOT used here: it would reuse a low-index empty track and hide the
  overlays underneath media clips, silently changing the picture of every such project.
  Converted overlays are ordinary clips, so they now take part in the normal
  clip/transition compositing order — `drawTransition` runs after the track loop — which
  differs from the old always-on-top loop only while a transition is active: a converted
  overlay is covered by a dissolve where the legacy one drew over it.
- **Degenerate data is clamped, not dropped**: `endTime <= startTime` becomes a 0.1 s clip,
  a negative `startTime` becomes position 0. A legacy `'blur'` shape drew **nothing at all**
  (the legacy loop passed no canvas, and `case 'blur'` draws neither fill nor stroke), so
  rather than convert it into an invisible clip the conversion gives it `blurAmount: 10` — the
  live default, so the inspector's slider agrees with the picture — while carrying its stored
  fill and stroke through unchanged (`addShapeOverlayClip`'s `#00000000` fill and
  `strokeWidth: 0` overrides are **not** applied, so they survive a later type change). The
  timeline `duration` is recomputed, so an overlay reaching past the stored duration extends
  the timeline (that is what gets it exported).

### Keyframe Animation System (`src/utils/animation.ts`)
Clips support animated properties via keyframes:
- **Animatable properties**: `x`, `y`, `scaleX`, `scaleY`, `rotation`, `opacity`, `blur`, `volume` (audio clips)
- **Easing types**: `linear`, `ease-in`, `ease-out`, `ease-in-out`, plus quadratic/cubic variants
- **Preset animations**: Clips can have in/out presets (`fade`, `slide-*`, `scale-*`, `pop`, `blur`)
- **Custom keyframes**: Per-property keyframe arrays override presets when present; each keyframe's
  easing is editable on its own in the keyframe panel, not only per preset
- `getAnimatedValues(time, clipDuration, animation, transform, effects, options?)`: Returns interpolated values for a given time — the one entry point, for both the preview and the exporters
- **One preset side can be left out of an evaluation (`AnimatedValuesOptions.suppressPreset`,
  ESCSUITE-139)**, and that is the whole of the option argument. `'in'` skips the in-preset,
  `'out'` skips the out-preset, and anything else about the evaluation — the other preset, every
  authored keyframe track, the base transform/effects — is exactly as it was. It exists for one
  caller, the renderer's two transition paths: a transition owns the entrance of its incoming clip
  and the exit of its outgoing clip, so the side's own matching preset must not fight it (the
  Transitions note in the Export Pipeline section has the ruling and the plumbing). Deliberately
  **not** a second interpolation routine, and deliberately not a set of "steady state" values
  either: an in-preset's last keyframe and an out-preset's first keyframe already hold the clip's
  base values, so *not generating* the side is identical to treating it as finished / not started,
  for every property that preset drives. It costs nothing — a suppressed side's generator is not
  called at all, `NO_PRESET_KEYFRAMES` is one frozen object for the module, and the perf files'
  animation-lookup counts per frame are unchanged because this is an argument to the one lookup
  each draw already made.
- Keyframes are stored relative to clip start time (0 = clip start)
- There is **no memo cache**. There used to be one (`getAnimatedValuesCached`, keyed
  `clipId:time`, cleared at export start), but an export draws each clip time exactly once,
  so the key never came round and the cache answered nothing while costing a `toFixed`, a
  string concat and a `Map.set` per clip per frame; a preview cannot use a time-keyed cache
  at all, because it redraws the same clip at the same time after every edit. Deleted
  2026-09-12 — `exportMP4.perf.test.ts` pins the lookup count at frames x active clips.
- **Splitting a clip rebases its animation, it does not copy it (ESCSUITE-95)**. Before this,
  `splitClip` built both halves with `{ ...clip }`, so both inherited the parent's whole
  `animation` — same keyframe times, since those are clip-relative, so a fade near the start of
  the original clip replayed from the second half's own start too; and the same in/out presets,
  regenerated against each half's own shorter duration, so one fade-in/out became two.
  `utils/animation.ts`'s `splitAnimation(animation, splitOffset)` is the pure fix `splitClip`
  calls: per property track, the first half keeps every keyframe with `time < splitOffset` and —
  only when the parent has a keyframe at or past the split — appends one synthesised keyframe at
  `splitOffset` holding `interpolateKeyframes`' own value there, so the picture does not jump at
  the new end (when nothing sits at or past the cut, the last kept value already holds, and
  nothing is appended); the second half keeps every keyframe with `time >= splitOffset` shifted by
  `-splitOffset`, prepending a synthesised keyframe at 0 the same way when the parent has a
  keyframe before the split and none at it. A keyframe within `KEYFRAME_TIME_EPSILON` (0.001s,
  the same tolerance `mergeKeyframes` uses to decide two keyframe times are "the same") of
  `splitOffset` counts as sitting at the split either way, so it shifts onto the second half at an
  exact 0 rather than a small residual, and the first half still gets its usual synthesised
  boundary in its place. A synthesised keyframe's easing copies the neighbour it stands in for —
  the keyframe that followed it in the parent for the first half, the one that preceded it for the
  second. Presets split by ownership rather than by geometry: the in-preset stays with the first
  half and the out-preset with the second (fade in at the start, fade out at the end, exactly that
  literally), and the half that loses a preset resets that side to `DEFAULT_ANIMATION`'s "none"
  shape — but a **kept** preset's `duration` is left exactly as authored, even past its own half's
  new, shorter length. That was a deliberate call, not an oversight: the inspector's own slider
  bound (`maxPresetDuration()`, moved to `utils/animation.ts` by ESCSUITE-110 below — still
  re-exported from `clipEditorModel.ts` for every existing import) is a UI limit on new input, not
  an invariant every writer must also enforce, and an unclamped 3s fade-in on a 2s first half still
  renders bit-identically to what the parent clip showed over those same two seconds — clamping the
  duration would have changed the picture instead of preserving it. A **trim**, below, makes the
  opposite call, because it has no "what the parent showed" to fall back on: the trimmed-off
  content is simply gone. `split`
  builds each half with `cloneClip` (the same `structuredClone` helper `duplicateClip` uses)
  rather than `{ ...clip }`, so `transform`, `effects`, `transition`, `mask` and `stroke` are all
  deep-copied too, closing the latent aliasing where every field above shared one object between
  the two halves and only survived it because every writer replaces rather than mutates.
  **What a split does not preserve exactly**: only the two boundary values (and a keyframe already
  sitting at the split) carry over exact. A segment that straddled the cut is re-eased over a
  shorter span on each side — the parent's easing ran end-to-end over its own two real keyframes,
  while each half now runs the same easing function over a fraction of that gap — so for any
  easing other than `linear`, the curve between a synthesised boundary keyframe and its neighbour
  differs slightly from the parent's curve over that same stretch, even though both halves meet at
  the same value at the cut.
- **Trimming a clip rebases its animation too (ESCSUITE-110)**. Shortening a clip from either
  timeline handle used to touch neither the clip's keyframes nor its preset durations: a keyframe
  past the new end sat there as dead weight (still listed in the keyframe panel, never played), and
  a preset longer than the trimmed clip could leave `generateOutPresetKeyframes` computing a
  negative `startTime` — a 2s fade-out on a clip trimmed to 1s opened the clip already part-faded,
  with the keyframe panel plotting that keyframe off the left edge. `utils/animation.ts`'s
  `trimAnimation(animation, { start, end })` fixes both, sharing its keyframe arithmetic with
  `splitAnimation` rather than keeping a second copy of it: `cutEnd`/`cutStart`, the two halves of
  `splitAnimation`'s old inline loop, are now standalone functions both call. `start` and `end` are
  the surviving interval in the clip's ORIGINAL (pre-trim) local-time coordinates, so `end - start`
  is always the trimmed clip's new duration; trimming from the end is `cutEnd(sorted, end)` alone
  (`start` is 0), trimming from the start is that result's `cutStart(_, start, sorted)` (dropping
  and shifting the front — `sorted`, the ORIGINAL uncropped track, is `cutStart`'s `reference`
  argument for the boundary it synthesises at `start`, not `cutEnd`'s already-cropped output: doing
  it the other way re-eases the segment leading up to `start` a second time, over the wrong span,
  and gives a different — for any easing but `linear`, wrong — answer than interpolating the
  original segment once, directly, at `start`), and a combined trim of both edges — not something
  the UI's single-handle drag produces, but the function itself does not assume otherwise —
  composes the two in one pass. Unlike a split, a trim makes only one clip, so there is no ownership
  question for the presets: both `in` and `out` stay on the one clip that remains, each with its
  `duration` clamped to `maxPresetDuration(end - start)` — the same bound the inspector's own
  sliders enforce, and, since this ticket, exported from `utils/animation.ts` rather than
  `clipEditorModel.ts` (still re-exported from there for every existing import) so `trimAnimation`
  does not need a util importing from a component directory — UNLESS the preset's `type` is
  `'none'`, in which case its `duration` is left alone: that field does nothing for a `'none'`
  preset (both generators bail out before reading it), so clamping it would report a number the UI
  never used and would lose whatever it held if the preset were switched back on later. That clamp
  is otherwise the one place a trim's behaviour deliberately parts ways with a split's:
  `splitAnimation` leaves a kept preset's duration untouched even past its own half's new length,
  because an unclamped preset there still renders bit-identically to what the parent clip showed —
  a trim has no such fallback, since the trimmed-off content is simply gone, so the clamp is the
  only way to keep the picture sane. Lengthening a clip (dragging a handle outward) changes nothing
  about its animation at all — the store only calls `trimAnimation` when the new duration is
  strictly shorter than the old one, by construction rather than by any special-case check.
- **Choosing a preset clamps its duration too, not only a trim (ESCSUITE-125)**. `trimAnimation`'s
  clamp above only ever runs when a trim shortens a clip that already has a preset; it never ran
  when a preset was *chosen* in the first place. `useClipEditorActions.ts`'s four preset handlers —
  `handleAnimationInTypeChange`, `handleAnimationInEasingChange`, `handleAnimationOutTypeChange`,
  `handleAnimationOutEasingChange` — carry a `duration` forward from either the clip's existing
  preset or the handler's own `?? 0.5` fallback, and neither of those was ever bounded: picking any
  preset in Animate Out on a clip under 1s stored a duration the clip could not hold, and
  `generateOutPresetKeyframes`' `startTime = clipDuration - duration` went negative — the clip
  opened mid-animation, the same picture ESCSUITE-110 had already fixed for a trim. (The other two
  handlers, `handleAnimationInDurationChange` / `handleAnimationOutDurationChange`, take their
  `duration` straight from the slider that calls them, whose own `max={maxPresetDuration(clipDuration)}`
  already bounds it, so they needed no change.) The fix is the same clamp trimming already makes —
  `Math.min(duration, maxPresetDuration(selectedClip.duration))`, exempting a `type: 'none'` preset
  for the same reason `trimAnimation` does — applied at all four write sites instead of only at
  trim time. Belt and braces: `generateOutPresetKeyframes` itself now also clamps its `duration` to
  `clipDuration` (not the tighter `maxPresetDuration` the UI enforces — just enough to keep
  `startTime` from going negative), so a hand-edited project or a file saved before this fix cannot
  reach the negative-`startTime` picture either, regardless of which handler wrote it.

  **The write goes through `trimClip`, not `updateClip` (review round 1).** The first version of
  this fix put the rebase inside `updateClip` — the one action that moves a clip's `startTime`/
  `endTime` — rebasing from the clip's CURRENT `animation` on every write. A trim writes on every
  mousemove, though, so "current" meant "whatever the previous move of the SAME gesture had already
  cropped it to": dragging a handle in past a keyframe and back out past where the gesture started
  compounded the crop on every move instead of undoing it, and the dropped keyframe never came
  back. `trimClip(clipId, edge, updates, origin, skipHistory?)` is `updateClip`'s replacement for
  this one write, and fixes it two ways. First, GESTURE SAFETY: `origin` — the clip's trim/position
  **and animation** exactly as they stood when the gesture began, threaded from `useTrimDrag`'s
  `TrimOrigin` (captured once, on mousedown) all the way to the store — is what every move rebases
  from, never the clip's live one, so the write is a pure function of (origin, current pointer
  position) rather than of the gesture's history: moving back to exactly where the drag started
  restores the original animation exactly, however many moves came between. Second, EXPLICITNESS:
  which edge moved is `edge`, passed straight through from `TrimState.edge` (the value `useTrimDrag`
  already tracks) rather than inferred inside the action from which of `updates`' fields happen to
  be set — the inference was correct (`updates.startTime` for a source clip's own trim point,
  `updates.timelinePosition` for an extendable overlay/image clip, which has no source to trim so
  its front-trim moves `timelinePosition` instead) but invisible from the type, and its
  `timelinePosition` arm went untested. `updateClip` itself is back to carrying no animation logic
  at all, for its one other caller (`useClipEditorActions.ts`'s mask/stroke handlers, which never
  touch `startTime`/`endTime`) to trip over.

  **Review round 2 finished the job.** `edge` was already explicit for the animation rebase, but
  `trimClip` still guarded its duration recompute on `updates.startTime !== undefined ||
  updates.endTime !== undefined || updates.duration !== undefined` — a second sniff, and, since
  this action has exactly one caller and that caller always sends `startTime` and/or `endTime`, a
  branch no real call could ever take the "false" side of: untestable dead code, and coverage
  said so (the base's `clipSlice.ts` measured 2 uncovered branches; round 1's measured 5). Duration
  is now recomputed unconditionally, with no guard at all, and the front cut for a start-edge trim
  reads `(updates.timelinePosition as number) - origin.timelinePosition` — asserted rather than
  defaulted with `??`, since `computeTrimUpdate` always supplies `timelinePosition` on a start-edge
  update and a caller that broke that contract should get a loud `NaN` rather than a silently-wrong
  `start`. `TrimOrigin` itself moved from `components/Timeline/timelineGeometry.ts` to
  `store/types.ts` — a store action's parameter type belongs in the store, and a second,
  independently-typed copy of the same shape (what round 1 had — `trimClip`'s literal object type
  happened to match `timelineGeometry.ts`'s `TrimOrigin` structurally, but nothing enforced that)
  is exactly the kind of drift that turns into a real bug the day one changes and the other does
  not. `timelineGeometry.ts`'s own `TrimOrigin` is now `export type { TrimOrigin } from
  '../../store/types'` — a re-export, not a second declaration — since a component may import from
  the store but the reverse is not allowed.

### Keyframe Panel (`src/components/KeyframePanel/`)
- **KeyframePanel.tsx**: Main editor with property list, graph view, and keyframe timeline
- **ClipPreview.tsx**: Playback scrubber controls (uses main PreviewPlayer for rendering)
- **KeyframeGraph.tsx**: Visual keyframe editor with Bezier curve display
- **Per-keyframe easing**: select a keyframe in the graph and its easing `<select>` appears below it
  (`EASING_TYPES` from `src/utils/easingOptions.ts`, shared with the animate-in/out presets); new
  keyframes default to `ease-in-out` and a value drag preserves the stored easing
- When keyframe panel is open, manipulating overlays in the main preview creates keyframes instead of direct updates
- **The playhead follows the timeline, not a local scrub state (ESCSUITE-126)**. `KeyframePanel.tsx`
  used to keep a `previewTime` local override, set only by `handlePreviewTimeChange` (the callback
  `ClipPreview`'s scrubber and Play button both call) and never reset back to `null` by anything —
  so one scrub or Play press latched the panel's playhead at that offset for good: `playheadTime`
  kept returning the stale `previewTime` instead of tracking `currentTime`, the graph's playhead
  line and the scrubber both froze, and `Enter` (`useKeyframeGraphKeyboard.ts`'s `addAtPlayhead`)
  added a keyframe at the stale offset instead of where the timeline actually was. The override was
  also never scoped to a clip, so it survived a clip switch too. There was nothing for an override
  to add: `handlePreviewTimeChange` already calls `setCurrentTime` synchronously, so the store's
  `currentTime` *is* the preview the instant a scrub happens — `playheadTime` is now derived from it
  alone, the same way `clipRelativeTime` beside it already was (reporting 0 rather than clamping to
  an edge when the playhead sits outside the clip, the one difference between the two derivations).
- **KeyframeGraph.tsx keyboard map** — the `<svg>` is one focusable
  `role="listbox"` (`tabIndex={0}`, `aria-activedescendant`) rather than one `tabIndex` per
  keyframe: a single tab stop matches the APG listbox pattern, and `tabindex` on SVG *child*
  elements has a shakier cross-browser/AT story (Safari especially) than a focusable root with
  `aria-activedescendant`. Every keyframe — presets included — is a `role="option"` `<circle>`
  so the whole curve is walkable and perceivable by a screen-reader user; a preset is visitable
  but never selectable or editable, and is announced with a trailing "preset, not editable". The
  grid, curve `<path>`, playhead line and help `<text>` are all `aria-hidden="true"` so axe's
  `aria-required-children` rule accepts the listbox's non-option children. The hook implementing
  all of this, `useKeyframeGraphKeyboard` (`hooks/useKeyframeGraphKeyboard.ts`), lives beside the
  panel rather than inside the component so the graph's own render stays about drawing.

  | Keys | Action | Step / unit |
  |---|---|---|
  | `Tab` | into the graph, then on to the easing select when one is shown | — |
  | `ArrowLeft` / `ArrowRight` | previous / next keyframe in time; selection follows the active option; clamps at the ends (no wrap) | — |
  | `Home` / `End` | first / last keyframe | — |
  | `ArrowUp` / `ArrowDown` | nudge the selected keyframe's **value** | fine step (table below) |
  | `Shift+ArrowUp` / `Shift+ArrowDown` | nudge value, coarse | coarse step |
  | `Alt+ArrowLeft` / `Alt+ArrowRight` | nudge the selected keyframe's **time** | ∓ 0.01 s |
  | `Alt+Shift+ArrowLeft` / `Alt+Shift+ArrowRight` | nudge time, coarse | ∓ 0.1 s |
  | `Enter` | add a keyframe at the playhead, clamped to the clip, at the curve's value *there* | — |
  | `Delete` / `Backspace` | delete the selected keyframe (custom only) | — |
  | `Escape` | clear the active keyframe and the selection; passes through when nothing is active | — |

  `NUDGE_STEPS` (`useKeyframeGraphKeyboard.ts`), each property's own unit:

  | Property | fine | coarse | unit |
  |---|---|---|---|
  | `x`, `y` | 0.01 | 0.1 | fraction of canvas (1% / 10%) |
  | `scaleX`, `scaleY` | 0.01 | 0.1 | scale factor |
  | `rotation` | 1 | 15 | degrees |
  | `opacity` | 0.01 | 0.1 | 0–1 (1% / 10%) |
  | `blur` | 1 | 5 | px |
  | `volume` | 0.01 | 0.1 | 0–1 (1% / 10%) |

  `TIME_NUDGE` is `{ fine: 0.01, coarse: 0.1 }` seconds for every property: 0.01 s is ten times
  the graph's own 0.001 s "same keyframe" tolerance, so a fine nudge can never silently land on a
  neighbour, and 0.1 s is a tenth of the graph's one-second gridlines. A nudge that *would* land
  within 0.001 s of another keyframe (presets included) is refused rather than merging the two —
  nothing moves, and the live region announces why. A nudge the clamp puts back on the value or
  the time the keyframe already holds writes nothing either — no store call, so no undo entry
  that undoes nothing, and no announcement, since nothing changed — though the key is still
  swallowed. A **held** arrow key is one undo step, not one per key-repeat: the hook passes each
  keydown's own `repeat` flag to the panel, which passes it to `setClipKeyframe` /
  `moveClipKeyframe` as their trailing `skipHistory` — so the first press pushes the snapshot
  taken before the run, every auto-repeat edits in place, and releasing and pressing again starts
  a new step. It is the same `skipHistory` mechanism `updateClipTransform` uses to keep a preview
  drag to one entry. Separate presses are still separate steps, which matches the inspector's
  numeric controls.

  **Propagation contract**: while the graph has focus it owns `ArrowLeft`/`Right`/`Up`/`Down`,
  `Home`, `End` and `Enter` unconditionally, and claims `Delete`/`Backspace`/`Escape` only when a
  keyframe is *active* (custom or preset) — swallowing them even for a preset so an active-but-
  uneditable selection can't fall through and delete the whole clip. With nothing active, Delete
  is not claimed and reaches the editor's global shortcuts as before. Everything else (`Tab`,
  `Space`, `?`, letters) falls through untouched. The shield is React's synthetic
  `stopPropagation()` on the root-container listener, which runs before the two `window`-level
  cascades (`useAppKeyboardShortcuts` and `Preview/PlaybackControls.tsx`) ever see the native
  event. Fixes a bug (ESCSUITE-49) where Delete with a keyframe selected deleted both the
  keyframe *and* the selected clip, because the graph's old listener was itself on `window`
  alongside the editor's.

  **The graph is not covered by the editor's modal gate** (see "Dialogs" below) and does not
  need to be — but it took *two* fixes to earn that, not one, and only the second closed it.
  Those two `window` cascades stop while a dialog is up; this element-level handler does not. The
  focus trap every modal now has closes the **Tab** route in. It cannot close the **pointer**
  route, because that is a question of stacking, not focus: the keyframe panel is a
  `createPortal` sibling of `#root` (which creates no stacking context), and it carried a bare
  `z-index: 1000` against every modal's `--z-modal` (200) — so it painted *over* the dialog's
  backdrop, `elementFromPoint` at the graph returned the listbox, and a click there focused the
  graph and let Enter add a keyframe from behind an `aria-modal` dialog. `KeyframePanel.module.css`
  now uses **`--z-panel` (150)**, below the modals and above the timeline and dropdowns. Both
  routes are closed, and still no gate here.

  **What counts as active**: every key that acts on "the active keyframe" — `Delete`,
  `Backspace`, `Escape` — is gated on the *rendered* active option (`activeIndex !== -1`), not on
  the remembered active time, so the keyboard can never disagree with what the graph draws; an
  edit from outside the graph (an undo, a right-click delete) can leave that time pointing at a
  keyframe that is gone, and a stale active time is treated as nothing active, falling the key
  through to the editor's cascade — including to its "delete the selected clip" shortcut, and
  leaving the stale time in state until the next click or arrow key replaces it. The selection is
  the other half of the same rule: it follows the active option and never rests on a preset, in
  `activateIndex` and in the pointer's `handleKeyframeClick` alike, so clicking a preset after a
  custom keyframe clears the selection rather than leaving `Delete` and the value nudges pointed
  at a keyframe that is not the active option. `KeyframePanel` also gives `<KeyframeGraph>` a
  ``key={`${selectedClip.id}:${selectedProperty}`}``, so choosing another property — or another
  clip — mounts a fresh graph and the active option and selection cannot bleed across two
  properties, or two clips, that happen to hold a keyframe at the same time.

  **Re-announcing an identical edit**: the graph's live region is `aria-atomic`, and an atomic
  region whose text does not change is not re-read — two identical edits in a row (the same nudge
  repeated, the same add) would be announced once. Every announcement therefore goes through the
  hook's `announce()`, which appends a zero-width space (`ANNOUNCE_MARK`, `\u200B`) to alternate
  announcements — the previous message's own last character decides — so consecutive identical
  messages differ as strings while reading out the same and looking the same. The suffix is
  applied in `announce` rather than on the way out because the graph re-renders every animation
  frame while the clip preview plays. Tests that compare the live region's text exactly strip
  `\u200B` first.

  **Known limitation**: `useDialogBehaviour` listens on `document` in the capture phase, which
  runs *before* the graph's handler and so can't be shielded by its `stopPropagation()`. This is
  moot in practice — the graph can neither be Tabbed to (the trap) nor clicked (`--z-panel` sits
  under `--z-modal`) while any of the five modals that use the hook is open. See "Dialogs" below.

  **A locked track in the keyframe panel** (ESCSUITE-88). The store has refused every keyframe
  edit to a clip on a locked row since ESCSUITE-84; the panel used to let the user try and say
  nothing. `KeyframePanel` derives `trackLocked` with `store/trackLock.ts`'s `clipOnLockedTrack`
  beside `selectedClip` — from the **whole-store read it already does**, so this adds no
  subscription and deliberately uses no selector — and threads one `locked: boolean` down to
  `KeyframeTrack`, `KeyframeGraph` and `useKeyframeGraphKeyboard`. The rule is **refuse at the
  gesture's start, keep every read**: a plain `<p>` under the title bar (not a status region — it
  is a standing fact about the selected clip, the same shape as `ClipEditorHeader`'s) reading
  "Track locked — unlock it in the timeline to edit keyframes"; a diamond and a graph point refuse
  at *mousedown*, because a drag that started would follow the pointer and snap back, which reads
  as a bug; the double-click add on a track row and on the graph, and the right-click delete,
  return early (the right-click still `preventDefault`s, so no browser menu appears over a
  keyframe either way); the easing `<select>` is `disabled`. Clicking a row to open its graph,
  clicking a point to select it, hovering, scrubbing the clip preview and reading the easing value
  all still work. The keyboard keeps the whole propagation contract above — **which** keys are
  claimed does not change, only what the claimed ones do: walking (the bare arrows, `Home`,
  `End`), the selection that follows the active option, and `Escape` behave exactly as always,
  while the five editing keys (`ArrowUp`/`ArrowDown`, `Alt+ArrowLeft`/`Alt+ArrowRight`, `Enter`,
  `Delete`/`Backspace`) are still swallowed but call nothing and announce **"Track is locked"** —
  the same words `useAppKeyboardShortcuts` toasts, so the lock sounds the same wherever the user
  meets it. `Delete` also closed a gap ESCSUITE-87 left: `removeClipKeyframe` joined that ticket's
  `=> boolean` contract, `KeyframePanel`'s `handleDeleteKeyframe` hands its answer back through
  `onDeleteKeyframe`, and the hook only announces "deleted" and clears the active option and the
  selection when the store actually removed the keyframe — the shape `nudgeValue` and `nudgeTime`
  already had.

### Preview (`src/components/Preview/`)
`PreviewPlayer.tsx` is wiring only — store subscriptions, the `<canvas>`, and a thin
`drawFrame` that sizes the raster and delegates. Everything it used to do
inline lives in one module each, all of them pure or hook-shaped; the pure modules, the hooks and `PlaybackControls.tsx` have their own test files, while `drawFrame.ts` and `cursor.ts` are covered through the component tests:

| Module | Owns |
|--------|------|
| `drawFrame.ts` | Compositing one frame: track order, transitions, overlay clips and the blur scratch canvas. It knows nothing about the legacy overlay arrays — they are overlay clips by the time any project reaches the preview |
| `previewGeometry.ts` | Where a clip is on the canvas (`getOverlayBounds`), which clips can be manipulated, the one object-fit: contain mapping between the canvas' pixels and its element's (`contentBox`, `getCanvasPosition`), and the inverse rotation every box test shares (`toLocalPoint`) |
| `hitTest.ts` | What is under the pointer: which clip, which handle, which drag it would start. One cascade (`hitHandlesOnClip`) serves both passes — keyframe mode asks it for the selected clip alone, body included; outside it the same cascade runs handles-only before the z-order body pass |
| `selectionOverlay.ts` | Drawing the selection chrome — bounding box, the eight resize handles, the rotation handle, multi-select boxes |
| `dragGeometry.ts` | The maths of a drag in progress: start measurements, resize/rotate deltas, marquee intersection, text hit for the double-click |
| `transitions.ts` | Which transition, if any, is active at a given time |
| `cursor.ts` | The CSS cursor a drag mode advertises |
| `types.ts` | The shapes the above share (`DragMode`, `OverlayBounds`, `HandleHit`, `PreviewSceneContext`). **Types only** — it is excluded from coverage, so a single runtime value in it would go unmeasured |
| `InlineTextEditorAnchor.tsx` | Positioning `InlineTextEditor` over the text it edits, through the canvas' object-fit mapping |
| `PlaybackControls.tsx` | The transport buttons and their keyboard shortcuts (Space, the arrows, Home, End — bound on `window` here, not in the App cascade); no canvas at all. Takes `modalOpen`, the same gate the App cascade carries, so Space cannot start playback from behind a dialog |
| `PreviewTimecode.tsx` | The playhead readout `<span>` — the only thing that re-renders on a playback tick (see below) |

Hooks:

| Hook | Owns |
|------|------|
| `usePreviewMedia.ts` | One object URL and one `<video>`/`<img>`/`<audio>` per source, reconciled as the timeline changes and released on unmount |
| `usePreviewRenderLoop.ts` | When the canvas repaints: the rAF playback loop, seek-driven redraws, the debounced redraw after a media change; also the display-time publish/subscribe pair the timecode reads (below) |
| `useTransformHandles.ts` | The pointer state machine — drag/resize/rotate, marquee, double-click into the text editor — and the cursor it reports. A press on a clip whose track is locked **selects it and starts nothing** (no `gestureHistory.begin()`, no drag state, no window listeners), and the cursor over it is `not-allowed` — ESCSUITE-88, see "A locked track is locked for every component" below |

**The canvas backing store follows the size it is displayed at, not the project's.**
`previewGeometry.previewRaster(project, box, devicePixelRatio)` computes it: the *contained*
box (the letterboxed rectangle `object-fit: contain` would draw into, so the raster keeps the
project's aspect ratio and never needs its own letterbox maths) times `devicePixelRatio`,
capped so it never exceeds the project's own resolution (a small project in a large box is
never rasterised sharper — or slower — than the project itself), falling back to the project
size before the first `ResizeObserver` callback fires. `PreviewPlayer` tracks the box in a
ref (not state — resizing it is imperative, and re-rendering the subtree on a window drag
would cost real work for nothing) and only ever assigns `canvas.width`/`.height` when the
computed size actually changes, because assigning either clears the canvas and resets all
context state. Everything in this directory still computes in **project pixels** — nothing
in `previewGeometry`, `hitTest`, `selectionOverlay`, `dragGeometry` or `drawFrame`'s draw
calls changed coordinate systems. The one thing that carries project space onto the raster is
`drawPreviewFrame` opening every frame with `openOutputFrame(ctx, projectSize, canvas)` —
**`core/outputTransform.ts`, shared with both exporters since ESCSUITE-94** (see the Export
section) — which sets `ctx.setTransform(k, 0, 0, k, 0, 0)` and clears the raster in one step.
`k` is read back off the canvas' actual backing store (so it can never disagree with a resize
that hasn't been redrawn yet).

`ctx.filter` is the one thing the transform does not reach: a CSS filter's length (a blur
radius) is in output-bitmap pixels, unaffected by the CTM. Left alone, every blur in the
preview would render `k`× too wide at any raster smaller than the project. `MediaDrawOptions.filterScale`
(default `1`) converts a project-space blur radius into device pixels at every `ctx.filter` site on the preview's draw
call sites. **Since ESCSUITE-94 an export passes it too** — it was written for the preview, on the
belief that an export's canvas is always its own project, which the resolution presets disproved —
so it is `1` only when the output raster *is* the project, and a 4px blur of a 720p project comes
out `blur(6px)` in a 1080p export.
`devicePixelRatio` is read at draw time, not subscribed to, so moving the window
to a different-DPI display re-rasterises only on the next resize or edit, not immediately.

**The selection chrome is a constant size on screen** (ESCSUITE-90). `HANDLE_SIZE` (8) and
`ROTATION_HANDLE_OFFSET` (25) are screen pixels, not project pixels, so
`drawSelectionHandles` / `drawMultiSelectHandles` and `hitTestHandles` / `hitHandlesOnClip`
all take a final **`screenScale`** — project pixels per CSS pixel — and multiply by it every
constant that is a screen size: the handle squares and the 80% side handles, the rotation grip
and its offset above the box, `lineWidth`, and the dash arrays. Positions (corners, edges,
centre) are the clip's own geometry and never scale, and the body hit test is untouched. A 4K
project in a 700px preview drew ~1.5px handles before this; it now draws 44-project-pixel ones,
which are the same 8px under the pointer as a 720p project's.

`screenScale` defaults to **1** — the right answer for a canvas that *is* its own screen (both
exporters, the headless bundle, the unit tests that build one) and for the preview before its
first `ResizeObserver` callback — so every caller that passes nothing behaves exactly as it did.
The preview's two callers get the real number, each from a measurement it already had and
**neither by reading layout again**: the draw callbacks from `1 / contentBox(canvas,
displayBoxRef.current, canvasDimensions).scaleX` (`contentBox` is pure arithmetic over the rect
it is handed, and the box is the one the observer above already reports, so no frame forces a
reflow), and the pointer path from `getCanvasPosition`, which carries the content box' `scaleX`
out on its result — the hit test wants `1 / scale`, and asking for it separately would mean a
second `getBoundingClientRect` per pointer move for a number that call had already computed.
It is derived at draw time and held in no state.

**A left/right-aligned text overlay's box is rotated about the text's anchor, not its own
centre** (ESCSUITE-128). `core/canvasRenderer.ts` draws a text overlay by translating to its
anchor — `textData.x`/`.y`, the point `fillText` is issued at — rotating, then translating
back, so the glyphs pivot around that anchor regardless of alignment. Left/right alignment
means the anchor sits at the run's edge rather than its centre, so `getOverlayBounds` shifts
the reported box by `±textWidth / 2` — but that offset has to be rotated along with the box
(`anchor + R(rotation)·(offset, 0)`) rather than added before rotating, or the box drawn by
`selectionOverlay.ts` and read by `hitTest.ts` and `dragGeometry.ts` (all three take their
`centerX`/`centerY`/`rotation` from this one function) drifts away from the drawn text as
rotation grows — a full half-width off at 90°. Centre-aligned text is unaffected: its anchor
and centre already coincide, so the offset is zero either way.

**A keyframed clip is opaque to the pointer, not invisible to it** (ESCSUITE-3). Outside
keyframe mode a clip carrying custom keyframes has no live handles in the one handle pass that
runs there — RESTRICTION 2 in `hitTestHandles` passes `skipKeyframed: true` to `hitHandlesOnClip`
for the selected clip's own handle pass (`hitTest.ts:179`), since it is only movable from the
keyframe panel; the keyframe-mode pass passes `false` there on purpose (`hitTest.ts:147`), which
is how a keyframed clip's handles stay live once its own panel is open — but `hitTestHandles`'
second pass (the z-order body test over every clip, outside keyframe mode) no longer `continue`s
past it the way it used to. It reports the same `{ clipId, clipType, mode: 'move' }` any other
clip's body would, at the clip's **animated** position for the current time (`getOverlayBounds`
already evaluates `getAnimatedValues` for this, with no `suppressPreset`). A bare `continue`
there used to let the click fall through to whatever clip was on the track below, or, with
nothing behind it, start a marquee whose release deselected everything. `useTransformHandles.ts`'s
`handleMouseDown` and `getCursor` are what turn that body hit into a refusal, reusing
ESCSUITE-88's shape verbatim: `geometry.hasCustomKeyframes(clip) && !isKeyframeMode` selects the
clip and starts nothing — no `gestureHistory.begin()`, no drag state, no window listeners — and
the cursor reads `not-allowed`, exactly as a clip on a locked track does. `isKeyframeMode`
(`keyframePanelOpen && clip.id === selectedClipId`) is the exemption: inside keyframe mode, for
the clip the panel has open, a drag is how a keyframe gets set, so it is not refused there.
`getCursor` runs on every pointer move, so it finds the hit's clip once and hands it to both
checks — `isTrackLocked(tracks, clip.trackId)` and `hasCustomKeyframes(clip)` — rather than
having each repeat the lookup `hitTestHandles` already did to produce the hit (ESCSUITE-3 review
round 1, NIT-4; `handleMouseDown` already had the clip in hand and needed no change).

No `suppressPreset` outside a transition is not the same as "a hit test is never inside one" —
the preview does draw transitions, and the pointer works during them. The renderer suppresses
one preset side per side of an active transition (`core/canvasRenderer.ts`), and
`getOverlayBounds` has no way to be told, so inside a transition the hit box, the selection
chrome, the marquee and the drag seed can all disagree with the drawn frame. That is
ESCSUITE-147's gap; it applied to every clip carrying a preset before this ticket and now
applies to keyframed ones too — this ticket neither introduces nor fixes it.

The body test is geometry only — `getOverlayBounds` never reads opacity — so a clip animated to
`opacity: 0` is still picked rather than clicked through, the same way a clip with a static
`transform.opacity: 0` (or mid an out-preset fade) always was; a follow-up ticket covers making
the hit test opacity-aware. And because `selectionOverlay.ts` declines to draw any chrome for a
keyframed clip until its own panel is open, selecting one this way shows in the inspector and on
the timeline row, not on the canvas — unlike the locked-track case it otherwise mirrors, where
the full box and handles are drawn and simply inert.

**The playhead position does not re-render the preview, the timeline body, or `App`.**
`usePreviewRenderLoop` used to hold it as `displayTime` state and call `setDisplayTime` every
animation frame — a React render (and a forced layout) fifty times a second so a timecode
readout could change three digits. It is now a ref plus a tiny publish/subscribe pair:
`publishDisplayTime(time, immediate?)` writes the ref and notifies listeners, throttled to
≤10 Hz except at a scrub, a loop-back, or the end of the timeline, where `immediate` publishes
without waiting so the readout never lags the value it is meant to show.
`PreviewTimecode.tsx` is the only subscriber — one `<span>` using
`useSyncExternalStore(subscribe, getTime, getTime)` — so a playback tick now re-renders one
`<span>` at most ten times a second instead of the whole preview subtree at fifty.

The timeline's own playhead follows the same shape, one level up, because `Timeline.tsx`
was not the only thing re-rendering on the store's throttled 200 ms `currentTime` write —
`App.tsx` subscribed to it too and re-rendered `<Timeline/>` regardless of what `Timeline`
itself did. Both were fixed: `Timeline.tsx` no longer reads `currentTime` at all — the
playhead position lives in `TimelinePlayhead.tsx` and the "0:00 / 1:30" readout in
`TimelineTimeReadout.tsx`, each `React.memo`'d and each subscribing to the store itself, so a
playback tick re-renders only those two small components. `App.tsx` no longer holds a
`currentTime` selector either; its four handlers that used the live render value (razor split
at the playhead, add marker, set in/out point) read `useEditorStore.getState().currentTime`
on demand inside the handler instead, and the debounced session-autosave effect (which
depends on `currentTime` to know when to re-arm its debounce, deliberately not on every
render) now does that via a `useEditorStore.subscribe` listener added inside the effect
rather than through a render-triggering dependency.

**Two more subscriptions were found in round 2, and both are gone the same two ways.**
`Toolbar.tsx` held a `currentTime` selector that no rendered element read — only three
handlers (add marker, set in point, set out point) — which is `App.tsx`'s case exactly, so
those three now read `useEditorStore.getState().currentTime` inside themselves and the
component subscribes to nothing per tick. `useClipEditorActions` held one whose value *was*
rendered, so it took the leaf shape instead; see the ClipEditor section. Measured on the
`preview-playback` benchmark by paired alternation, three rounds per arm, the toolbar fix
alone is **−9.1% of the renderer's task duration** (1037.55 → 942.62 ms, ranges disjoint)
with the rendered fps pinned at the 60 fps vsync ceiling in both arms — after round 1 this
scene has no frame-rate headroom left to show a win in, so anything further shows up as work
not done, never as frames. `Toolbar.rerender.test.tsx` pins the contract at ≤1 render over ten
ticks (it measures 0), with one `act()` per tick: batch the ten writes into one `act()` and a
re-introduced selector costs one render and slips under the ceiling. Round 2's write-up is
[docs/performance/2026-09-13-timeline-profile.md](../../docs/performance/2026-09-13-timeline-profile.md).

A scrub's seek check in `usePreviewRenderLoop.ts` works **per `<video>` element, not
per clip**. `usePreviewMedia` keeps one element per source, so two live clips off one
source — a picture-in-picture arrangement, or the same clip duplicated on two tracks —
share it; a per-clip loop moved that element for the first clip, measured it against the
second clip's target, decided a seek was still needed and took the event-driven branch,
painting the frame twice for one move of the playhead. The desired time is collected into
a `Map` keyed by element (later writes win, and the incoming side of a transition is
applied after the clips, so the frame on screen is the one that was always drawn), then
each element is compared and seeked at most once.

**Loop-back seeks nothing itself** (ESCSUITE-129). `loopStart` is a timeline time; a media
element's own position is `clip.startTime + (loopStart - clip.timelinePosition)`, which is
only equal to `loopStart` by coincidence, for a clip that starts untrimmed at timeline 0. The
loop-back branch in `usePreviewRenderLoop.ts`'s `animate()` used to assign `loopStart` straight
to every `<video>`/`<audio>` element's `currentTime` — wrong for a trimmed clip or one that
doesn't start at 0, and clamped to the last frame for a source shorter than `loopStart`. It now
only pauses each element and clears `lastActiveClipIds`, which was already happening right
after — that forces the very next frame's `clipsChanged` branch, which already computes
`clip.startTime + clipTime` per clip, to do the seeking, so a loop never touches the wrong
position even for one frame.

**The preview draws through `core/canvasRenderer.ts`**, the same renderer an export
uses, with `PREVIEW_DRAW_OPTIONS` (in `drawFrame.ts`) for the difference that is the
preview's alone: `quiet` (not-yet-decoded media is ordinary mid-scrub, and this frame
redraws sixty times a second, so the exporter's one warning per frame would be a console
flood), plus `filterScale` when the frame is rasterised at other than 1:1. Never fork a
drawing function for the preview — if the two need to differ, that is another draw option.
`MediaDrawOptions` once carried `uncachedAnimation`, which skipped the export's animation
memo cache; that cache is gone (see the keyframe section above) and so is the option. It
also once carried `resetFilter`, which made a clip with no blur of
its own assign `filter = 'none'`. That cancelled the blur a dissolve had just set on the
context, so the preview's dissolve never blurred while an export's did. The preview stopped
passing it, and the option is gone: a clip with no blur now leaves the context's filter
alone in both pipelines.

Interactive overlay manipulation in the preview canvas:
- **Drag**: Move overlay position (updates `x`, `y`)
- **Resize handles**: 8 handles (corners + sides) for scaling (`scaleX`, `scaleY`)
- **Rotation handle**: Circular handle above overlay for rotation
- **Keyframe mode**: When keyframe panel is open, transforms create keyframes at current playhead time
- Selection handles follow animated values during playback

**One undo entry per gesture, captured before the first write.** A drag makes many store
writes — one per animation frame through the throttled updaters, or two to four per mousemove
when the keyframe panel is open — and all of them belong to one edit. `useTransformHandles`
gives the gesture a single history entry by passing the store actions' `skipHistory` flag
(`updateClipTransform`, `updateTextOverlayData`, `updateShapeOverlayData`, `setClipKeyframe`)
on every write **except the first**: every write runs through `commit` from the shared
`hooks/useGestureHistory.ts` (ESCSUITE-87, below), which hands out `false` once per gesture and
`true` thereafter, and it is called inside the updater the throttler runs — not at the
mousemove that scheduled one — because a frame's moves coalesce into a single write and
"first" has to mean the first write that actually reaches the store. Since ESCSUITE-87 it means
the first write that **landed**: a write the store refuses hands the push back. `handleMouseUp` only
flushes the pending update and clears the drag state; it must not write anything of its own.
It used to, un-flagged, as the gesture's one push — but `pushToHistory` snapshots the state it
is *handed*, so a push at release recorded the already-moved clip and undo after a drag landed
back on the position the drag had just produced. A press released without a move writes
nothing and so pushes nothing.

### Timeline (`src/components/Timeline/`)
`Timeline.tsx` is wiring only — the store selectors, the refs for the three scrolling panes,
one call per module below, and the JSX around them. It owns no gesture state and binds no
document listeners itself. The hooks are called in a fixed order — playhead, in/out, scroll
sync, clip drag, trim, track actions, marquee, seek — and the order is the one the effects ran
in when they all lived inline, kept so that the hooks that bind listeners or observers still
mount and clean up in that sequence. It is a weaker constraint than it used to be: since the
gesture hooks stopped re-binding per pointer frame (below), the only ordered events are each
gesture's own bind and unbind, so a re-ordering would change which hook binds first at a
gesture boundary rather than on every render.

**One listener pair, one measurement, one snap array — per gesture, not per pointer frame.**
All five gesture hooks bind their `document` pair through `src/hooks/useDocumentListener.ts`
(or an effect shaped like it) on a **boolean** that flips twice a gesture — `dragState !== null`,
`trimState !== null`, `tlMarqueeStart !== null` — so nothing the moves write can re-bind them.
The live gesture is held in a ref beside its `useState` value: the state drives the render (the
ghost clip, the live trim, the rectangle), the ref is what the handlers read, and the handler
itself is still rebuilt every render and swapped in through `useDocumentListener`'s own ref, so
the moves and the release see exactly the props the old deps arrays gave them. Because the pair
is unbound by an effect rather than synchronously, a mousemove batched with the mouseup still
reaches a handler whose gesture is over; each one checks its ref and does nothing
(`useClipDrag.test.ts`, `timelineGestureCaching.test.ts`). The mouseup stays a plain
bubble-phase `document` listener — no capture, no `once` — because `marqueeJustFinished` has to
be set before the click that follows it. `timelineGestures.perf.test.ts` asserts the counts
exactly: 2 listeners, 1 `getSnapPoints`, one pass over the track rows, per gesture. Three of the
five hooks used to re-bind per pointer frame — 42 adds and 42 removes over a 20-move gesture —
and `usePlayheadDrag` and `useInOutDrag` never did; their 2/2 is pinned exactly too, so a
refactor cannot drop them into the churn. `useDragListeners` (the other export of
`src/hooks/useDocumentListener.ts`) is deliberately **not** what any of them use: its
imperative start/stop would unbind the pair synchronously inside the mouseup and move
`marqueeJustFinished` relative to the click that follows. It currently has no caller at all,
and should be adopted across the five or deleted. Two things the
directory uses come from outside it: `useVirtualizedTimeline` (`src/hooks`), which decides
which clips are near enough the viewport to draw, and `MarqueeSelection`
(`src/components/Preview/`), the rectangle the preview and the timeline share. Every module
here has its own test file except `types.ts`, which is types only (and excluded from
coverage); `Timeline.tsx` itself is covered through `Timeline.test.tsx`,
`Timeline.editing.test.tsx` and `Timeline.chrome.test.tsx`, which drive the rendered
component.

| Module | Owns |
|--------|------|
| `Timeline.tsx` | The composition: the store selectors, the container/ruler/headers/track refs, the hook calls in their fixed order, the in/out region and snap-line overlays, and the info bar. Also `clipsByTrack`, the memo that gives each row an identity-stable `clips` array — see the memo-boundary note below |
| `timelineGeometry.ts` | All of the timeline's maths as pure functions — ruler tick spacing, pointer-to-time, clamping, snap resolution for a drag, the trim's re-derivation from its origin, and the marquee's time/Y ranges and hit tests. No ref, no store, no render |
| `types.ts` | `DragState` and `TrimState` — the two gesture shapes the hooks own and `TimelineTrack` draws from, so neither has to import the other. **Types only** — it is excluded from coverage, so a single runtime value in it would go unmeasured |
| `TimelineRuler.tsx` | The ruler: ticks and labels, the marker flags, the in/out handles and the region they bracket. `React.memo`'d — nothing on it can change during a gesture. Also exports `TimelineMarkerLines`, the marker verticals drawn down over the tracks (not memo'd: it re-renders with `Timeline` and is two divs) |
| `TimelinePlayhead.tsx` | The playhead line — `React.memo`'d and subscribing to `currentTime` itself, so a playback tick moves this element instead of re-rendering the timeline |
| `TimelineTimeReadout.tsx` | The `current / total` readout in the info bar, split out for the same reason |
| `TimelineTrack.tsx` | One track row: its clips (only the ones the virtualiser passed), the drag preview, the trim's live sizing, and each clip's label, **masked thumbnail**, waveform and keyframe diamonds. `React.memo`'d, which holds for a marquee or a scrub but not for a clip drag — `dragState` is one of its props |
| `visibleRangeCache.ts` | `pruneVisibleRangeCache` (ESCSUITE-13 round 3): deletes `TimelineTrack`'s per-clip `visibleRangePx` cache entries for clips no longer on the row. Its own file rather than living in `TimelineTrack.tsx` purely so it can be `export`ed and unit-tested directly without breaking that file's Fast Refresh (`react-refresh/only-export-components` disallows a component file exporting anything else) |
| `TrackHeader.tsx` | One header row: volume and mute, the track name (double-click to rename, Enter commits, Escape discards — the only state in the directory that is not a gesture), the reorder arrows and the visibility/lock/delete controls. `React.memo`'d — its props are stable through a clip drag, a marquee and playback, so the whole column sits those out. **Not through a trim**: `useTrackHeaderActions`' `handleDeleteTrack` depends on `clips`, and a trim writes the store every move, so `onDeleteTrack` changes identity per frame and the column re-renders anyway |
| `ClipKeyframeDiamonds.tsx` | The keyframe markers along a clip: every animated property's times, deduplicated and placed |
| `AudioWaveform.tsx` | The canvas waveform inside a clip. Resamples the clip's *visible window* — not its whole box — so detail follows zoom instead of being frozen at a whole-clip cap (ESCSUITE-13); the CSS size and the backing store are always the same clamped number, so a canvas never stretches past what it actually holds |
| `useScrollSync.ts` | Keeping the ruler, the headers and the track container pointed at the same place, and the `ResizeObserver` that tells the virtualiser how wide the container is |
| `useTrackAreaCache.ts` | One gesture's worth of track-area geometry: the container's client origin and each `[data-track-id]` row's box in the container's own **layout space**, taken on mousedown so a move reads only `scrollLeft`/`scrollTop`. Dropped and re-taken on `scroll` (captured — scroll does not bubble) and on window `resize`, the two things that move the box under a live gesture. Invalidation is **event-based**, so a layout change that fires neither — an autosave or an undo changing a row's height mid-drag — would leave it stale where the old per-frame measurement absorbed it; unreachable through the UI today (a clip drag writes nothing until release, and no control resizes a track while a pointer is down), and if row heights ever become dynamic the hook to reach for is the `ResizeObserver` `useScrollSync` already installs on this container, not a third listener |
| `usePlayheadDrag.ts` | The playhead scrub: `isDraggingPlayhead` (which the marquee and the track click both read) and the document listeners that write `currentTime` |
| `useInOutDrag.ts` | The in and out marker drags — one pair of listeners for both handles, asking which flag is up to decide which point it writes |
| `useClipDrag.ts` | Dragging a clip, and the three other readings of the same mousedown (razor split, ctrl/cmd toggle, locked-track refusal). `dragState` is the preview; the store is written on release — which is why the snap points and the track rows are both taken once, on the mousedown, and never re-taken per frame. A drop that changed both the row and the time writes twice there, and the second write carries `skipHistory` so the whole drag is one undo step (ESCSUITE-79, below). A drop by a **multi-selection** is the other branch of that same commit: one `moveSelectedClips` carrying both deltas, all-or-nothing (ESCSUITE-80, below) |
| `useTrimDrag.ts` | Dragging a clip's edge: a store write on every move, always re-derived from the origin recorded on mousedown, plus the ripple tool's shift of everything after it. The per-move write makes `clips` a fresh array every frame, which is exactly why the listeners hang off `trimState` and not off the clips |
| `useTimelineMarquee.ts` | Rubber-band selection: the drag threshold that tells a marquee from a click, the hit test over rows and time, and the `marqueeJustFinished` flag that keeps the closing click from seeking. The rows are still walked on the release only — once per gesture, never per frame |
| `useTrackHeaderActions.ts` | What the header buttons do: raising and lowering a track (with the reversal between display order and the store's bottom-up indices) and deleting one, asking first if it still holds clips |
| `useTimelineSeek.ts` | The two click-to-seek handlers — the ruler's, and the track area's with every reason it stands down (a drag, a scrub, the click that ended a marquee, a click on the playhead) and the deselection it does when the click really was on bare track |

**Three memo boundaries, and why they are where they are.** A timeline gesture's state —
`dragState`, `trimState`, the marquee rectangle — lives in the hooks `Timeline` calls, so every
pointer frame re-renders `Timeline` and, before this, everything under it: four rows, four
headers and a ruler that rebuilt 61 tick objects, 20 times a drag. `TimelineRuler`,
`TrackHeader` and `TimelineTrack` are each `React.memo`'d, and the memoisation that makes the
third one work is `Timeline`'s own `clipsByTrack`: `getTrackClips` used to `map` a fresh array
per track per render, and a fresh `clips` prop defeats a memo entirely. **Memoise the array
before, or with, the row — never the row alone.** What each boundary actually catches, measured
2026-09-13 in `timelineGestures.perf.test.ts` (renders per pointer frame, before → after):

| | clip drag | marquee |
|---|---|---|
| `TimelineTrack` | 4 → 4 (`dragState` is its prop) | 4 → 0 |
| `TrackHeader` | 4 → 0 | 4 → 0 |
| `TimelineRuler` / `getRulerTicks` | 1 → 0 | 1 → 0 |

In the browser (`pnpm perf`, paired alternation, three rounds per arm) that is **clipDrag
10.91 → 8.77 ms of JS per frame (−19.6%)** and **marquee 10.39 → 5.54 ms (−46.7%)**, both with
disjoint ranges; `playheadScrub` is unchanged, because a scrub writes `currentTime` and
`Timeline` does not subscribe to it. Forced layouts are untouched at 0.82 and 0.98 per frame —
those were round 2's Task 2, and this is the render half. Those two gestures, plus playback,
are what the header memo holds for; a **trim** is the gesture it does not, for the reason in
its table row above. `TimelinePane` stays **unmemoised** on purpose (see the App section). The
three ceilings for a drag are asserted as exact zeroes, not at 2x: a single re-render per frame
means a prop has become unstable again. The whole round is written up in
[docs/performance/2026-09-13-timeline-profile.md](../../docs/performance/2026-09-13-timeline-profile.md),
including the caveat that the millisecond figures are dev-build numbers while the render
counts are what a release build keeps.

**A media clip carries its own masked thumbnail (ESCSUITE-65, decision 5).** `TimelineTrack`
draws one `<img>` of the clip's *source* thumbnail at the head of the clip and shapes it with an
inline CSS `clip-path` from `utils/maskClipPath.ts`: `circle(<h/2>px at <h/2>px 50%)` for a
circle mask, `inset(0 round <fraction x h>px)` for a rounded one, and nothing at all for
neither. The circle is **hugged to the thumbnail's left edge** rather than centred in the 91px
box, and that is a deliberate fix rather than an oversight: a clip is as wide as its duration
and `.clip` is `overflow: hidden`, so a 0.2s clip is 10px wide and shows only the thumbnail's
first 10 pixels — a centred circle spans x 20-72 and that clip would show an empty rectangle
where an unmasked clip shows its picture. Only the *centre* moves; the radius is still
`maskPathFor`'s, so it is a placement choice and not a second piece of geometry, and
`inset(0 round r)` already starts at the left edge and needs no equivalent. The
geometry is not a second copy — `maskClipPathFor` asks `core/clipMask.ts`'s `maskPathFor` for
the shape of a 16:9 box of the thumb's height and only says the answer in CSS, so the inscribed
circle, the clamp to half the shorter side and "a rounded rectangle with square corners is a
rectangle" have one implementation each, and one test asserts the thumbnail's radius *is*
`maskPathFor`'s. The thumb's shorter side is its height, which is why one number is enough and
why the stored radius (a fraction of the clip's shorter side) resolves here against exactly what
it resolves against in the frame. DOM and CSS, never a canvas: the timeline drew no picture at
all before this, and a canvas per clip would put a second rasteriser on the gesture path.

Four properties of that `<img>` are load-bearing and each is asserted in
`TimelineTrack.test.tsx`. It is **`position: absolute` inside `.clipContent`**, so it is out of
flow — in flow it would be the tallest item in a `flex-wrap: wrap` row whose duration is
`width: 100%`, and it would push that duration past `overflow: hidden` and out of sight; out of
flow the name/duration layout is byte-identical, the trim handles keep their `z-index: 5` above
it, and no pointer frame has anything new to lay out. It is **`pointer-events: none`** and
**`draggable={false}`**, so it can never be an event target nor start a native drag racing the
clip drag — the hit geometry is `target.closest('[data-clip-id]')` plus a measurement of
`[data-track-id]` rows (`useTrackAreaCache.ts`), and an element inside a clip changes neither.
Its box is **one number each, on the `width`/`height` attributes**, computed from `track.height`
in the component because CSS cannot read a track's height and a `clip-path` circle needs a pixel
radius — leaving the inline `style` to carry the `clip-path` alone, which is what lets one
assertion on the whole style attribute prove the thumbnail is masked *and* not stroked. And it
is **`aria-hidden` with `alt=""`**: the clip's name is already its label, and this is decoration.
It also carries `decoding="async"`, because the virtualiser unmounts and remounts clips as the
timeline scrolls and so creates these `<img>`s in bursts; nothing on the page waits for the
picture, so a burst has no business on the main thread.
It costs the row no store read — `sourceMedia` is the lookup the waveform already needs — and
`timelineGestures.perf.test.ts` and `App.rerender.test.tsx` were byte-unchanged and green when
it landed, which is the proof it costs no listener, no rect read, no render and no subscription.
The `timeline-interaction` benchmark was re-run before and after and its three per-frame
forced-layout figures did not move.

**That run did witness a drawn thumbnail** — corrected here by ESCSUITE-76, which set out to add
the arm it thought was missing and found it already there. `loadPerfScene` imports a real MP4
through the media library's own file input, so `processVideoFile` gives the browser scene's
source a `thumbnailUrl` and all twelve media clips draw one; the spec now counts them
(`thumbnailsDrawn`, asserted `=== 12` before a gesture runs, and reported in
`perf-report.json`), so the arm can never go blind unnoticed. Measured 2026-09-26: 12
thumbnails drawn, and the per-move forced layouts still 0.82 / 1.00 / 1.00 —
[docs/performance/2026-09-13-timeline-baseline.md](../../docs/performance/2026-09-13-timeline-baseline.md#2026-09-26-the-benchmark-arm-was-never-blind-escsuite-76).
The half that really was blind is the **jsdom** one: `perfScene.ts`'s `sceneSource` carries no
`thumbnailUrl`, so the per-frame *counts* had never seen an `<img>`. ESCSUITE-76 closed that too,
with `sceneSourceWithThumbnail` and a variant arm in `timelineGestures.perf.test.ts` that
drags the scene twice — 0 thumbnails then 12 — and asserts the listener adds and removes, the
container and row rect reads and the renders per frame are **equal**, plus zero rect reads on any
of the twelve `<img>`s. The a-priori argument (out of flow, a fixed attribute box that neither
reads nor contributes to in-flow layout, `pointer-events: none` so it is on no hit path) is
therefore now asserted in the counting half and measured in the timing half.

**Paint order is three offsetless `position: relative` rules, and they are load-bearing too.**
`.clipThumb` is positioned with `z-index: auto`, which paints in CSS 2.1 Appendix E **step 8** —
after *all* in-flow, non-positioned content of its stacking context — regardless of tree order,
so being `.clipContent`'s first child bought it nothing and the thumbnail painted *over* the
clip's own name at 45% opacity. `.clipName`, `.clipDuration` and `.clipIcon` are therefore
`position: relative` with **no offsets**, which moves them into step 8 as well, where tree order
decides and they win as later siblings; no geometry moves, which is why no existing test changed.
One visible side effect, worth saying rather than leaving to be discovered: giving `.clipContent`
a containing block made it *positioned*, so a clip's label now paints **over** its waveform
instead of under it — the reverse of what `AudioWaveform.module.css`'s comment claimed before
this slice, when the canvas at `z-index: 0` was in step 8 and the in-flow label was not. Arguably
the right order, and small, but it is a real visible change on an audio clip. jsdom computes no
paint order at all (it has neither layout nor paint), so this is pinned in those two files'
comments and nowhere else.

Three deliberate limits, so none of them reads as a bug. **The stroke is not drawn on the
thumbnail** — v1 shows the shape; the border stays in the frame. **The preview's
selection box and hit test stay rectangular** (`components/Preview/hitTest.ts`,
`selectionOverlay.ts`): a circle-masked clip is still selected, dragged, resized and rotated by
its drawn rectangle. And **the media library's card stays unmasked** (`VideoUploader.tsx`),
because that thumbnail belongs to the *source* file and one source can back several clips with
different masks — which is also why the mask could not simply be put there instead.

**A media clip can also carry a crop (ESCSUITE-6), and it is the one static
property that changes the clip's rectangle.** `core/clipCrop.ts` owns the
arithmetic; `drawWithMaskAndStroke` takes the source rectangle and issues the
**nine-argument** `drawImage(source, sx, sy, sw, sh, x, y, w, h)` — the
five-argument form is gone from `core/clipMask.ts`, unconditionally, because a
branch there would be a second rule about crops inside the one function meant
to have no opinion about them. The drawn size is the cropped region times the
clip's scale, still anchored on its normalised centre, so **cropping shrinks
the picture in place** rather than stretching the remainder over the old box;
mask and stroke are computed from that smaller box, so a cropped circle-masked
clip gets the smaller circle and `clipMask.ts` needed to learn nothing about
crops for that to be true. The `drawImage` *count* per frame is unchanged,
which is why the three per-frame ceiling files are byte-identical.

Because a crop *is* the rectangle, `getOverlayBounds`
(`components/Preview/previewGeometry.ts`) reports the cropped size for a media
clip — the opposite of the mask's treatment above. One edit covers the
selection box, the eight handles, the marquee's AABB and a drag's seed
measurements, because `hitTest.ts`, `selectionOverlay.ts` and `dragGeometry.ts`
all read that one function; each has a case of its own so that stays a
contract. **Fit to Canvas reads the crop too** (MINOR 2, final review):
`handleFitToCanvas` passes `clipEditorModel.ts`'s `fitToCanvasScale` the
cropped region from `croppedSourceRect`, not the source video's own
dimensions, so pressing it on a cropped clip fills the frame with the picture
that is actually drawn rather than reserving room for the part that is no
longer on screen.

**Two deliberate v1 limits.** The **timeline thumbnail is not cropped** —
`utils/maskClipPath.ts` is untouched, so a cropped clip's tile still shows the
whole frame's picture (masked, if it is masked). And there are **no on-canvas
crop handles**: v1 is inspector-only, and the preview's resize handles still
change `scaleX`/`scaleY` as they always did. Both are the v2 ticket's.

### ClipEditor (`src/components/ClipEditor/`)
`ClipEditor.tsx` is wiring only — one call to `useClipEditorActions()`, the `!selectedClip`
early return, and the JSX that hands each section the handful of props it needs. It holds no
state, subscribes to nothing directly and computes nothing; every store read and every store
write in the panel lives in the hook, and every control lives in one of the section
components. The guards that show and hide the sections (`!isAudio`, `!isOverlay`,
`isTextOverlay && selectedClip.textData`, …) stay in `ClipEditor.tsx` at the positions they
have always had — see the note on `CollapsibleSection` below for why moving one is a
behaviour change rather than a tidy-up. Every module here has its own test file, and
`ClipEditor.tsx` itself is covered through `ClipEditor.test.tsx` and
`ClipEditor.overlay.test.tsx`, which drive the rendered panel.

| Module | Owns |
|--------|------|
| `ClipEditor.tsx` | The composition: the hook call, the empty-state early return, and the per-section guards in their fixed order. Owns `div.container` itself in both the empty and selected states, so that element's identity is stable across the empty↔selected transition |
| `useClipEditorActions.ts` | Every store read and write the panel makes — the selectors, the derived `sourceVideo`/`track`, the clip classification, and one handler per control. Adds no state and no subscription of its own; the hook calls are the ones that used to sit at the top of `ClipEditor.tsx`, in the same order and with the same dependency arrays (plus the stable `commit`, which changes no identity). **No `currentTime` selector** — see the note below |
| `useSliderGesture.ts` | Where one slider gesture starts and stops, and `commit`, which runs one write inside it with the `skipHistory` flag it is owed — a `useGestureHistory` and six listeners, no state. One instance serves the whole panel; see "One drag of a slider is one undo step" below |
| `clipEditorModel.ts` | The panel's pure derivations: `describeClip` (which kind of clip, and the header's label), `relativeTimeInClip`, `overlayPositionValue`, `maxPresetDuration`, `fitToCanvasScale`, `keyframeCount`. No store, no React |
| `clipColorValues.ts` | The colour and font-size maths the text and shape controls share: the font-size clamp, the text background's fixed `cc` alpha, a fill's rgb-with-carried-alpha rewrite, the no-fill toggle, and the fill alpha as a 0–100 percentage |
| `clipEditorOptions.ts` | The **five** `{ value, label }` option lists the dropdowns render — transitions, blend modes, clip mask kinds, animation presets, easings (the last re-exported from `utils/easingOptions.ts`) — plus `CROP_ASPECT_PRESETS` (ESCSUITE-6), which is buttons rather than a dropdown because a preset is an action and not a stored value |
| `CollapsibleSection.tsx` | One titled, collapsible block: its own open/closed flag, seeded from `defaultOpen` at mount and never re-read |
| `ClipEditorEmptyState.tsx` | The panel's contents when nothing is selected: the prompt plus the five buttons that create an overlay from nothing. `ClipEditor.tsx` supplies the surrounding `div.container` |
| `ClipEditorHeader.tsx` | The title block — clip type, name, delete button, and the duration/position/track rows underneath |
| `TextContentSection.tsx` | "Text Content": the text, its font family and size, bold/italic/alignment, and the two colours. The textarea grows by writing `style.height` on the element, so no measured height lives in React state |
| `ShapeSection.tsx` | "Shape": the shape type, then either the blur region's amount slider or the fill/stroke controls, plus size, rotation and blur. "No fill" is an alpha of `00` on the fill colour, not a separate flag. All seven sliders carry the undo gesture |
| `TransformSection.tsx` | "Transform": position, then — media clips only — scale with its aspect-ratio lock, Fit to Canvas and Reset, and opacity last |
| `BlendModeSection.tsx` | "Blend Mode": one dropdown over `BLEND_MODES`, collapsed by default |
| `MaskSection.tsx` | "Mask & Stroke": the mask kind over `CLIP_MASK_KINDS`, a corner-radius slider shown for `rounded` only, and the stroke's width and colour — the width labelled in **pixels at the project's resolution**, because what is stored is a fraction of the frame width and a fraction is not a number anyone can act on. Collapsed by default. Media clips only, gated exactly as Blend Mode is. It normalises nothing: "`none` with a radius" and "a width of 0 with a colour" are things a user can express, and turning them into absent fields is `useClipEditorActions`' job |
| `CropSection.tsx` | "Crop" (ESCSUITE-6): which rectangle of its source frame the clip shows — four rows of slider plus number field, each inset a whole percentage capped at `MAX_CROP_INSET` (90%), five aspect-preset buttons over `CROP_ASPECT_PRESETS` (None, 1:1, 16:9, 9:16, 4:3) and a header Reset. Collapsed by default. Media clips only, gated exactly as Mask & Stroke is and placed **immediately after it**, before Effects — an overlay has no source frame for an inset to be a fraction of, and the condition is byte-identical to its neighbours' so no existing section's positional open/closed slot changes meaning. Like `MaskSection` it normalises nothing: 90% off two opposite edges is something a user can express, and the **one** new handler `handleCropChange` is what decides what gets stored. The **presets are computed here**, from `cropForAspect` — this is the only place holding both the source's shape and the clip's current crop — which is why they are not a second handler, and why "None" and the header Reset make literally the same write: four zeroes, which `normaliseCrop` turns into `crop: undefined`. The four sliders carry the undo gesture; the number fields and the preset buttons keep an entry each — a number field has no gesture listeners, so it reports on every keystroke and typing `45` into an empty one lands two undo entries, same as `TextContentSection`'s font-size field |
| `EffectsSection.tsx` | "Effects": one blur slider, collapsed by default |
| `AnimationSection.tsx` | "Animation": the Animate In and Animate Out groups (each hiding its duration and easing until a preset is chosen), the "Active" badge, and the button that opens the keyframe panel with its keyframe count |
| `TransitionSection.tsx` | "Transition Out": which transition ends the clip and, for anything but `none`, how long it takes. Collapsed by default |
| `ActionsSection.tsx` | "Actions": go to, duplicate, and — video and audio only — split. Takes the clip's position and duration rather than a `timeInClip`, and hands them to `SplitButton` |
| `SplitButton.tsx` | The Split button alone, and the only part of the panel that depends on the playhead. Subscribes to the derived *disabled boolean* itself, so a playback tick re-renders this one button only when the answer changes |

**The clip inspector must never subscribe to `currentTime`.** `useClipEditorActions` used to
hold a `useEditorStore((s) => s.currentTime)` selector feeding a `timeInClip` that only the
Split button's `disabled` attribute read, so the whole panel — a few hundred elements — re-rendered
five times a second while the project played; and because the hook runs *above*
`ClipEditor.tsx`'s `!selectedClip` early return, the empty panel paid exactly the same. The
post-round-1 CPU profile ranked `ClipEditor` #10 of the app-code frames a playback window
executes (23.1 ms, 4.4%). `Toolbar`'s `getState()` fix is wrong here because the disabled state
*is* rendered and a stale read would show the wrong one; the fix is `TimelinePlayhead`'s shape
instead — `SplitButton` subscribes for itself, and to the boolean rather than to the playhead,
so zustand's `Object.is` ends the tick and the button re-renders twice over a pass across a clip
instead of ten times. `handleSplitAtPlayhead` reads `useEditorStore.getState().currentTime`,
which is what a click needs and a render does not. Measured 2026-09-13 by
`ClipEditor.rerender.test.tsx`: ten playback ticks cost the panel 0 renders, selected or not,
against 10 before.

**Every control has a name** (ESCSUITE-89). The panel's rows are laid out as a `<label>` and a
sibling control, and for most of its life none of those labels was wired to anything: a screen
reader met the inspector as a couple of dozen unnamed sliders, dropdowns and swatches, and the
e2e label audit never saw it because that audit runs with nothing selected. Every section now
takes **one `useId()`**, gives each control an `id` built from it, and points that row's
`<label htmlFor>` at the id; where there was no visible label at all — Blend Mode's and Mask & Stroke's and
Shape's dropdowns, Text Content's text area, font family, font size and alignment — the control
carries an `aria-label` instead, and where the visible word was a `<span>` that is plainly a
label (the colour swatches' "Fill", "Stroke", "Stroke Color", "Text", "BG"; each animation
group's "Animate In" / "Animate Out") the span **became** a `<label>` with the same class, the
same text and the same position. Nothing else about the DOM moved, for the reason at the bottom
of this section: `CollapsibleSection` seeds a section's open/closed state positionally, so a
moved element is a behaviour change. `ClipEditor.module.css`'s `.colorInput span` rule followed
its five labels and is now `.colorInput label`, so those rows look exactly as they did. Sections added since follow the same rule: Crop's four sliders take the
visible edge word through `htmlFor`, and the number field beside each one — which has no
visible label of its own — carries `aria-label="<Edge> crop percent"`, so its eight value
controls have eight distinct names.

**Two controls may not share a name**, and three rows in the panel would have. Both animation
groups call theirs "Duration" and "Easing", so those four take `aria-labelledby` naming the
group heading *and* the row's own label — "Animate In Duration", "Animate Out Easing" — built
from the text on screen rather than from a string in the component that the visible label could
drift away from; Transition Out's plain "Duration" is then unambiguous. Shape's stroke *width*
slider and its stroke *swatch* both say "Stroke", so the two swatches take the fuller
`aria-label` ("Fill color", "Stroke color") and the sliders keep the words beside them. Three
buttons were named by something that is not a name: the delete button and the aspect-ratio
padlock by their `title` alone, and the no-fill toggle by the glyph "⊗". The delete button now
says what its title said. The padlock is **not** named after its title, which changes with the
state ("Unlock aspect ratio" while locked): it is `aria-label="Lock aspect ratio"` plus
`aria-pressed`, because a name that moves with the state announces "Unlock aspect ratio,
pressed" and contradicts itself — the name says what the control is, `aria-pressed` says what
state it is in, and the title goes on saying what a click will do. Bold and italic are still
"B" and "I" — that is what a sighted user calls them — and they gained `aria-pressed` too.
A name also has to *contain* the word on screen (WCAG 2.5.3), which is why the background
swatch is "BG color" and not "Background color".

**`ClipEditor.a11y.test.tsx` is the contract**: with every
section open it walks each input, select, textarea and button the panel renders for five clip
shapes and demands a non-empty name for each and distinct names for the value controls, so a
control added later is covered the day it lands. It computes the name itself, in about thirty
lines, rather than with `dom-accessibility-api`'s `computeAccessibleName`: that package is a
transitive dependency of @testing-library/dom and is **not resolvable from `apps/artist`**, so
using it would mean a new devDependency and a lockfile change for one assertion. The one thing
the hand-rolled version leaves out is the `placeholder` fallback that accname — and therefore
axe — accepts, which makes the sweep *stricter* than the e2e audit rather than looser: the text
area's "Enter text..." would have satisfied axe on its own, and the sweep made it earn
`aria-label="Text"`. The sibling suites were *not* rewritten to
`getByLabelText` — `test/domQueries`' `rowControl` / `rowSelect` / `rowColor` still walk from
the visible text to the control in the same row, which is what they have always done — and
`apps/e2e`'s `the clip inspector's controls have associated labels` runs `checkFormLabels` and
axe over the panel with a media clip, a text overlay and a shape overlay selected, which is the
first time that audit has seen these controls at all.

**One drag of a slider is one undo step** (ESCSUITE-75). A range input writes on every `input`
event — the blur slider steps in halves from 0 to 50, so a full drag is around a hundred writes
— and the store actions behind the inspector's sliders pushed an undo entry each time. One drag
therefore filled the whole 50-entry `MAX_HISTORY_SIZE` stack with its own intermediate values,
evicted everything the user had done before it, and paid a full-project `structuredClone` per
entry; Ctrl+Z then stepped back half a pixel at a time. The rule is ESCSUITE-52's, the one
`Preview/useTransformHandles.ts` already applies to a transform drag: **the gesture's first
write pushes history — so the entry snapshots the state as it was before the drag — and every
write after it passes `skipHistory`. Nothing extra happens on release**, so a drag abandoned
half way is already undoable to where it started.

`useSliderGesture` is that gesture and nothing else. A gesture opens on `pointerdown` or
`keydown` and closes on `pointerup`, `pointercancel`, `keyup` or `blur` — `pointercancel`
because a touch or pen gesture the browser takes away (a scroll takes over, the pen leaves
range) gets no `pointerup`, and a gesture left open with its entry already pushed would swallow
the *next* write's entry. A **held** arrow key is one gesture, not
one per repetition, because a `keydown` carrying `repeat: true` leaves an open gesture alone
(the rule the keyframe drags took in #373). Unlike `Preview/useTransformHandles.ts`, whose writes
are throttled to an animation frame and so must read the flag inside the updater the throttler
runs, a slider's writes are synchronous — the `input` event calls the handler, which writes — so
here "decide at the call" and "decide at the write" are the same moment.
`useClipEditorActions` calls it once and returns its
listeners as `sliderGesture`, which `ClipEditor` spreads onto **every slider on the panel** —
`TransformSection`, `ShapeSection`, `EffectsSection`, `MaskSection`, `CropSection`,
`AnimationSection` and `TransitionSection`; the handlers those sliders reach —
`handleTransformChange`, `handleBlurChange`, `handleMaskChange`, `handleStrokeChange`,
`handleCropChange` (ESCSUITE-6 — the one handler in this list that can **refuse**: a crop that
would leave less than one source pixel, or a clip with no source media at all, writes nothing),
`handleAnimationInDurationChange`, `handleAnimationOutDurationChange`,
`handleTransitionDurationChange` and, for
an overlay's Pos X/Y, `handleTextDataChange` / `handleShapeDataChange` — run their write
through `commit` at the moment they write. The selects beside those sliders (preset,
easing, transition type) deliberately do not ask: a select is a single change and keeps its own
entry. One instance for the whole panel is
deliberate: a user drags one slider at a time, and a press on the next closes whatever the last
one left open. **A write that belongs to no gesture pushes its own entry**, exactly as before —
every other control on the panel, a section rendered on its own in a test, and a value set from
code. It holds refs and no state, so no slider adds a subscription and no render count moves:
`ClipEditor.rerender.test.tsx` is unchanged by this work, and the rule itself is held by
`ClipEditor.sliderHistory.test.tsx` (the real panel and the real store) and
`useSliderGesture.test.ts` (the contract, without a DOM).

The flag reaches the store through the trailing optional `skipHistory` parameter on
`updateClipTransform`, `updateClip`, `updateClipEffects`, `updateTextOverlayData`,
`updateShapeOverlayData`, `updateClipAnimation`, `updateClipTransition`,
`shiftClipsAfter` and `setClipTimelinePosition` — the first, fourth
and fifth already had it; ESCSUITE-75 added it to
`updateClip` and `updateClipEffects`, ESCSUITE-77 the next three and ESCSUITE-79
`setClipTimelinePosition`, all six in the same shape
(`history: skipHistory ? state.history :
pushToHistory(state)`). It is optional and last, so every existing caller is one undo step
exactly as before. `trimClip` (ESCSUITE-110 review round 1) takes it the same way, having taken
over the timeline trim's own write from `updateClip` — which still carries the flag today, now
purely for the mask/stroke sliders in `useClipEditorActions.ts`.

**Every slider in the inspector and the trim drag on the timeline now follow the one-entry-per-gesture
rule** (ESCSUITE-77 finished what ESCSUITE-75 started). `Timeline/useTrimDrag.ts` is the one that
is not a slider: it writes the store on every mousemove, so it carries
`useTransformHandles`' shape instead of the hook's — a per-gesture `useGestureHistory` begun on
mousedown, the first write unskipped and the rest passing `true`. It throttles nothing, but the
write is still `commit`ted *inside* the `if (update)` rather than at the move, because
`computeTrimUpdate` refuses a move that would leave the clip too short and such a move writes
nothing at all: a gesture whose opening move was rejected must still push on the write that does
land. The one thing a trim does on release — the ripple tool's `shiftClipsAfter`, which closes
the gap the trim left — takes the flag too, and `shiftClipsAfter` grew it for that:
the shift belongs to the trim that produced it, and pushing an entry of its own made
one ripple trim two undo steps, the first Ctrl+Z sliding the downstream clips back and
leaving the clip trimmed.
`useTrimDrag.test.ts` holds it (one entry for five moves, two for two trims, one for a
whole ripple trim with both halves coming back together, the undo
landing on the pre-trim in and out points, and the refused opening move). The same ticket made the
Transform section header's Reset one entry rather than two on an overlay clip: its second write,
the overlay's own coordinates, passes `skipHistory: true` as a **literal** — that is a button, not
a gesture, so there is nothing to ask.

**Dragging a clip to another track is one undo step too** (ESCSUITE-79 — the last gesture that
was not). `Timeline/useClipDrag.ts` writes nothing while the drag runs, so both of its writes
happen in the one `handleMouseUp`: a drop that changed the clip's row *and* its time called
`moveClipToTrack` and then `setClipTimelinePosition`, and each pushed an entry. The first Ctrl+Z
then put the time back and left the clip on its **new** row — a half-state the drag had never
produced — and a second was needed to get home. `moveClipToTrack` now pushes the gesture's entry,
which therefore snapshots the clip on the track and at the position the gesture found it, and
`setClipTimelinePosition` takes the same trailing `skipHistory` the others do and passes `true`
whenever the row changed. There is no `useGestureHistory` here, unlike `useTrimDrag`: with both
writes in one handler, "has the entry been pushed?" *is* "did the row change, and did that write
land?" — which the commit already computes, the second half of it since ESCSUITE-87 below. A drop that only moved the clip in time, and one that only changed its row, are
each a single write and a single entry exactly as before. The bulk move a multi-selection drag
commits was never affected — `selectionSlice.moveSelectedClips` moves every selected clip inside
one `set` with one `pushToHistory`, so a five-clip drag was always one entry —
and `useClipDrag.test.ts` now holds all four shapes (one entry each, the cross-track drop's undo
landing on both the original row and the original position, and the flag `false` on the first
write and `true` on the second).

**A multi-selection drags in rows as well as in time, all of it or none of it** (ESCSUITE-80).
The bulk branch of that same commit in `Timeline/useClipDrag.ts` was gated on `deltaTime !== 0`
and passed a hard-coded row delta of `0`, so it got both cross-track cases wrong. A group
dropped on another row at the *same time* did not match the gate at all and fell through to the
single-clip commit below it, which fired `moveClipToTrack` for the clip the pointer was holding
and nothing else — the selection split, silently. A **diagonal** drag did take the bulk path,
and moved every clip in time and none of them in row. The commit is now gated on either delta
and carries the real one: `trackIndexDelta` reads the drop's row change in
`selectionSlice.moveSelectedClips`' own index space (tracks sorted by ascending `index`, which
is bottom-to-top on screen), and `moveSelectedClips(deltaTime, deltaTrack)` moves every selected
clip inside one `set` with one `pushToHistory`, so the whole group is still **one undo entry** —
which is why the row half is not a second write here the way it is for a single clip.

**The group's veto is all-or-nothing**, and `canMoveSelectedClips` is what answers it, before
anything is written. Three ways a member refuses (four since ESCSUITE-82, below): its current row is not on the timeline, the
row it would land on is off the top or the bottom of the stack, or its landing spot is taken by
a clip that is not moving with it. Any one of them and the drop commits nothing — the
alternative is a group arriving with some of its clips piled against the edge of the stack,
which is what the store's own per-clip clamp (`Math.max(0, Math.min(len - 1, idx + delta))`,
left as it is: it is that action's contract and its tests pin it) would otherwise produce. A
member's **old** placement is never in the way, since the group vacates it in the same write, so
a selection sliding along its own run does not veto itself. The positions checked are the ones
that would be written, `Math.max(0, …)` clamp included, which is also what catches a group
dragged back past the start of the timeline: the clamp would stack its members, and that reads
as the overlap it is. A refused drop is **silent** — the clips spring back and no notice is
raised — which is parity with the single-clip veto one branch down, the only other drop that
can be refused; neither has ever notified, and making one of them talk is a product decision
about both. There is no audio-versus-video row check in any of this, and that is not an
omission: ARTIST's `Track` has no kind. A clip is audio because its *source* media is
(`TimelineTrack` reads `sourceMedia?.mediaType`), and any clip may sit on any track, which is
exactly what a single-clip drop allows. `useClipDrag.test.ts` holds the drag half (a same-time
group drop moving every clip, a diagonal one moving rows and times together, one Ctrl+Z
restoring all of it, and the refusals — four then, six with ESCSUITE-82's) and `store/timelineSnapping.test.ts` the arithmetic.

**A locked row takes no drop** (ESCSUITE-82). The mousedown has always refused to *start* a
drag on a locked row, but neither commit path asked about the row the clip was **dropped** on:
a clip could be dragged onto a locked track, and a selection holding a clip on a locked row
(ctrl+click adds one; the mousedown guard only sees the row of the clip the pointer holds)
could be dragged off it by a free member. `trackRefusesDrop(tracks, trackId)` in
`store/timelineSnapping.ts` — true for a locked row and for one that is not on the timeline —
is the rule the single-clip commit now asks of the row under the pointer, beside the overlap
check it already made; `canMoveSelectedClips` applies the same locked rule inline, over a Set of
the locked rows, to every member's origin row and landing row (it already refused a row that is
not on the timeline by index), so the group's veto has a fourth way to refuse. Silent, like the
other three. A rule added to `trackRefusesDrop` has to be added to that loop too. The ticket also named the ripple trim, and that half was wrong: `shiftClipsAfter`
is asked for the trimmed clip's *own* row (so is `rippleDeleteClip`'s shift), and a trim cannot
start on a locked one, so a ripple never reaches a locked row's clips — `useTrimDrag.test.ts`
pins it beside the new refusals in `useClipDrag.test.ts` and `timelineSnapping.test.ts`.

**A locked track is locked for every component** (ESCSUITE-84). ESCSUITE-82 closed the pointer
gestures; Delete, paste, split, duplicate, the inspector, the keyframe panel and a new clip
landing on an empty locked track did not know the row was locked. The fix is one enforcement
point: `store/trackLock.ts`'s five pure questions (`lockedTrackIds`, `isTrackLocked`,
`clipOnLockedTrack`, `anyClipOnLockedTrack`, `lockedSourceVideoIds` — no store, no React) are asked as the first statement
of a mutating action's `set` updater, and a refused action `return`s the unchanged state: no
`modified` write, no history entry. Every clip- and keyframe-slice action over a clip already on
the timeline refuses when its track is locked (`moveClipToTrack` checks both origin and target);
`addTextOverlayClip`/`addShapeOverlayClip` refuse an explicit locked `trackId` by returning
**`null`** instead of a clip, hence `Clip | null` though neither UI caller passes a `trackId`
today. `findEmptyTrack` (`projectFactory.ts`) never picks a locked track for a placement naming
none, so the media library, the overlay buttons and the ESCAPECRAFT handoff skip locked rows
without knowing "locked" exists. Selection-slice group actions are **all-or-nothing**:
`anyClipOnLockedTrack` vetoes `deleteSelectedClips`, `pasteClips` (asked about the clones' own
`trackId`, since they haven't landed — ESCSUITE-100 added a second, identically-shaped
all-or-nothing check right beside it, for a clone whose `trackId` names no track at all) and
`moveSelectedClips` as one yes/no over the whole set.
`muteSelectedClips`/`unmuteSelectedClips`, `updateTrack` and `reorderTracks` stay untouched —
track properties, not clip contents — and `removeTrack` refuses, since deleting a locked track
deletes its clips. So does the project slice's `removeSourceVideo`, all-or-nothing: it removes
every clip that references the source, so if one of them is on a locked track the source and
every clip stay (`lockedSourceVideoIds` is the question). `shiftClipsAfter` is the one guard
that is *not* the all-or-nothing question, deliberately: the shift below it only moves clips
whose `trackId` matches, so an undefined `trackId` moves nothing and the guard asks
`isTrackLocked` about the one row.

**A refused write says so** (ESCSUITE-87). ESCSUITE-84's guards were invisible to the caller:
an action that refused and an action that wrote were both `void`, and three gestures were
already threading a `skipHistory` flag through a *second* store write on the strength of the
first having pushed the undo entry. A refused first write pushes nothing, so those gestures
would hand `skipHistory` to the write that did land and leave the whole gesture off the undo
stack — one Ctrl+Z after it would then eat the edit *before* it instead. The twelve actions that
take a trailing `skipHistory` (`shiftClipsAfter`, `updateClip`, `trimClip`,
`setClipTimelinePosition`, `updateClipTransform`, `updateClipEffects`, `updateClipTransition`,
`updateClipAnimation`, `setClipKeyframe`, `moveClipKeyframe`, `updateTextOverlayData`,
`updateShapeOverlayData`) plus `moveClipToTrack` — which takes no flag but is the *first* write of
the clip drag's two-write commit — therefore return `boolean`: `true` when they wrote, `false`
when the lock guard refused (or, `shiftClipsAfter` alone, when the delta was zero and nothing
moved). ESCSUITE-88 added a
thirteenth, for the same reason at one remove: `removeClipKeyframe` threads no flag either, but
the keyframe graph's `Delete` *announces* the removal, so it has to be able to tell a refusal
from a write. Their guard moves out of the `set` updater and in front of it, reading through
`get()` the way `addTrack` already does, so the action can answer without writing; every updater
body is otherwise unchanged, and the other locked-track guards — the ones nothing threads a flag
through — stay inside their updaters as `return state`. The shared doc comment on `EditorState`
in `store/types.ts` is the contract: **`false` means no state changed and no undo entry was
pushed, and a caller passing `skipHistory` to a later write must look at it.**

A third reason a write answers `false` joined the lock with ESCSUITE-101: **nothing to do**.
`pasteClips` started this (below) refusing when a clone's track is no longer on the timeline;
`deleteSelectedClips` refuses when its selection names no clip on the timeline, or when any one
that does exist sits on a locked track; `muteSelectedClips`/`unmuteSelectedClips` refuse when
every relevant track already has the mute state being asked for; and `removeClipKeyframe` —
already on the list above for the lock — also refuses for three reasons that have nothing to do
with it: an unknown clip, a property the clip has no keyframes on, or no keyframe within
`KEYFRAME_TIME_EPSILON` of the given time. All of them still mean exactly what `false` means
above. ESCSUITE-115 gave `removeClipFromTimeline` the same treatment: it used to filter the
clips, bump `modified` and push an undo entry for an id naming no clip, unable to say so because
it returned `void`; it now reads through `get()` the same as the guards above, refuses (`false`,
nothing written) for an unknown id — the "nothing to do" `rippleDeleteClip` already recognised
(`if (!clipToDelete) return state`) without a way to report it — and only then runs its `set`.
`useAppKeyboardShortcuts`'s Delete key follows the return the same way it already follows
`deleteSelectedClips`'s: a refusal toasts nothing, because there is nothing to announce.

`hooks/useGestureHistory.ts` is the one mechanism that does. `createGestureHistory()` (and the
`useGestureHistory()` that holds one per component) is `begin` / `resume` / `end` / `commit`,
two booleans in a closure and no state or subscription of any kind: `commit(write)` runs one
store write, hands it the flag the gesture owes it, and — if the write reports it did not land —
takes the "already pushed" mark back, so the gesture's entry follows the first write that **does**
land. All three gestures that used to keep that bit themselves now share it:
`ClipEditor/useSliderGesture.ts` exposes `commit` in place of its old flag getter and keeps only
the six DOM listeners (a key `repeat` maps to `resume`, which continues a gesture without
forgetting that it pushed), `Preview/useTransformHandles.ts` commits inside the throttled
updaters exactly where it read the flag before, and `Timeline/useTrimDrag.ts` inside its
`if (update)`. The contract is `hooks/useGestureHistory.test.ts`; each hook's own suite adds the
end-to-end case of a row locked under an open gesture and unlocked mid-way, and the entry riding
the write that landed.

The keyframe graph's keyboard is the other caller that had to read the answer.
`KeyframePanel/hooks/useKeyframeGraphKeyboard.ts`'s two nudges called the host and then
unconditionally announced the new value into the live region and moved the active option and the
selection to the new time. On a locked track the store refused and the announcement was a lie —
"Opacity 49% at 1.00 seconds" for an edit that never happened — while the selection walked off
to a time no keyframe occupied, leaving the next key acting on nothing. `onKeyframeMoved` and
`onKeyframeValueChanged` are therefore `=> boolean` all the way up through `KeyframeGraph`'s
props to `KeyframePanel`'s two handlers, which hand back what `moveClipKeyframe` /
`setClipKeyframe` answered (and `false` when there is no selected clip to write to), and each
nudge returns early on a refusal. Silent, like every other refusal the lock produces, and the
key stays swallowed because the graph still owns it.

The clip drag is the exception that proves it, because its two writes are not a `commit` loop
but one `if`/`else`: `if (movedTrack && !moveClipToTrack(...)) { }` — the row refused, so
`Timeline/useClipDrag.ts` commits **nothing**. Moving the clip in time on its *old* row would be
a half-drop nobody aimed at, and one carrying `skipHistory` for an entry that was never pushed.
The clip springs back, silently, like every other refused drop.

Refusal is **silent** in the store, like every pointer veto. Five components read the lock to
say something anyway.

The **inspector** disables each section's *contents*, never the panel. `useClipEditorActions`
exposes `trackLocked: boolean` on demand (a plain `track?.locked` read, no new subscription) and
`ClipEditor.tsx` hands it to every section; `CollapsibleSection` takes `disabled` and wraps that
section's children in one `<fieldset className={styles.sectionBody} disabled>`, with its header
toggle and its `footer` slot outside. One fieldset around the whole panel was the first shape
and was wrong three ways: `.container` is the flex column that supplies the gap between the
sections, so a single fieldset child collapsed that gap on **every** clip's inspector, locked or
not; the section headers are `<button>`s, so on a locked clip the four sections that default
closed could not be opened and read at all; and it killed the two controls that are reading
rather than editing. Those two stay live — Actions' "Go to" moves the playhead (that section
therefore puts the flag on its own Duplicate and Split buttons and hands `CollapsibleSection`
nothing) and Animation's "Open Keyframe Editor" opens a panel (it renders through `footer`).
Transform's header "Reset" writes the transform and sits outside the fieldset in `headerRight`,
so it carries the flag itself, as does `ClipEditorHeader`'s delete button; the header also
renders a plain `<p>` — not a second status region — "Track locked — unlock it in the timeline
to edit this clip".

The **media library** (`VideoUploader.tsx`) asks `lockedSourceVideoIds` and disables the
per-item Remove button (`title="Used by a clip on a locked track"`), which still calls the
undoable `removeSourceVideo`. Clear All (ESCSUITE-142) is the bulk form of Clear Unused — per id,
`deleteVideo` over the editor's own `sourceVideos`, skipping a source a locked track's clip still
uses the same way Clear Unused already skips it by never counting an in-use source "unused" — but
neither button calls `removeSourceVideo` at all: a storage clear deletes bytes from IndexedDB
itself, so it is not an edit, and undoing it must not be able to hand a source back whose bytes
are already gone (ESCSUITE-149). Both collect the ids whose `deleteVideo` actually succeeded
across the whole loop and hand them to `removeSourceVideosPermanently` once, in `finally`,
rather than removing each source from the store as its own delete lands. The button itself
disables when there is nothing it could touch — an empty library ("Nothing to clear") or every
source locked-in-use ("Every file is on a locked track") — rather than a live-looking control
that does nothing when clicked (ESCSUITE-142 review, MAJOR 1); when it is enabled, its loop
re-derives the locked set fresh from the store before each id's own delete, not the render-time
snapshot the click closed over, so a track locked while an earlier id's delete is still in
flight cannot cost a later id its bytes (MINOR 3). A per-id failure does not stop the ids after
it, and is reported once, by count, through the notice channel rather than the console alone,
with the storage meter refreshed in `finally` alongside the permanent-removal write, so a partial
failure still leaves it current (MINOR 2) — Clear Unused's own `finally` was aligned to the same
order a review round later (ESCSUITE-149 review, NIT 2): it used to refresh only on the loop's
clean-success path, so a mid-loop failure left the meter stale even though the ids before the
failure were still permanently removed. Unlike Clear Unused, Clear All can take clips with it —
every clip that referenced a cleared source — so its confirm copy says so ("including any clip
that still uses it").

**The media library's motion and type scale** (ESCSUITE-4). The upload progress bar's
`.progressFill` pulses opacity 1 → 0.5 → 1 forever while a file is `'processing'` — a real
progress bar it is not, since the fill is already full width — and an unconditional
`animation: pulse 1.5s ease-in-out infinite` ran for a viewer who had asked the OS for reduced
motion (`grep -rn "prefers-reduced-motion" apps/ packages/` found nothing anywhere else in the
repo either). `VideoUploader.module.css` now adds `@media (prefers-reduced-motion: reduce) {
.progressFill { animation: none } }` *beside* the unconditional declaration, rather than only
scoping the `@keyframes pulse` rule itself under `(prefers-reduced-motion: no-preference)` —
an unscoped, merely-unreferenced `@keyframes` would still leave the computed `animation-name`
reading `pulse`, and it is the explicit `animation: none` override that makes it read `none`.
A finished upload's row used to pop out of the list outright, 2 s after `'complete'`, with no
transition; `.uploadItem` now transitions `opacity` (`var(--transition-normal)`), the row is
given `removing: true` (`.uploadItemRemoving { opacity: 0 }`) for one more
`UPLOAD_ROW_FADE_MS` (200ms) before `VideoUploader.tsx`'s removal timer actually drops it from
`uploads`, and `.uploadStatus` — the "Processing...", "Complete" and error text, which had no
accessible announcement of any kind — now carries `role="status"` (an implicit
`aria-live="polite"`, so no separate `aria-live` attribute is needed beside it). Separately,
the library's six ad-hoc font sizes between 8px and 13px — `.mediaTypeBadge` at 8px,
`.storageInfo` and `.storageClearButton` at 10px (plus the unused, `display: none`
`.dropZoneHint`, also 10px), `.videoMeta` at 11px and `.videoName` at 13px — are now a small
scale: badge and per-file metadata at 11px, the storage row at 11px, small buttons/controls at
12px, and the filename stays the scale's largest size at 13px. `.mediaTypeBadge`'s padding is
trimmed from `1px 4px` to `1px 3px` alongside the font bump (review round 1, QUALITY-2): it is
`position: absolute` with only `bottom`/`right` set inside the 64x36px thumbnail, which has its
own `overflow: hidden`, so nothing but the badge's own box size keeps it off the thumbnail's
left and top edges — an `overflow: hidden` ancestor hides a box that spills past it rather than
stopping it from spilling. Nothing else in the sidebar (`ResolutionPicker.module.css`,
`App.module.css`) was already below 11px, so the floor holds across the whole panel. Pinned by
`VideoUploader.test.tsx` (`role="status"`, and the fade's `removing` class surviving the first
2000ms of the removal timer before the row actually leaves) and, end to end, by two
`apps/e2e/tests/accessibility/core.spec.ts` cases: "the upload progress animation turns off
under reduced motion and stays on without it" reads the compiled `.progressFill` class name
straight out of the loaded stylesheet and asserts a probe element wearing it computes
`animation-name: none` under `reducedMotion: 'reduce'` and `pulse` under `'no-preference'` in a
second browser context — deliberately not timing-dependent on catching a real upload's brief
`'processing'` window, which review round 1 found a first version of this test could miss
entirely and silently pass without checking anything (QUALITY-1); and "no library text is
smaller than 11px, and the media-type badge stays inside its thumbnail" uploads an inline 1x1
PNG (the cheapest media kind that renders a `.mediaTypeBadge` at all — a plain video gets none)
and asserts every leaf text node in the sidebar is at or above 11px and the badge's bounding box
lies entirely within its thumbnail's.

The **keyframe panel** (ESCSUITE-88, see "Keyframe Panel" above): `KeyframePanel` derives
`trackLocked` from the whole-store read it already does and threads `locked` down to
`KeyframeTrack`, `KeyframeGraph` and `useKeyframeGraphKeyboard`. A plain `<p>` under the title
bar — "Track locked — unlock it in the timeline to edit keyframes" — every pointer edit refused
at mousedown rather than snapped back on release, the easing `<select>` disabled, and an edit key
announcing "Track is locked" while every reading key still works.

The **preview**: `useTransformHandles`' `handleDoubleClick` asks `clipOnLockedTrack` before
opening the inline text editor — it already subscribes to both `clips` and `tracks`, so the
question costs nothing — because the editor would otherwise open and then lose every keystroke
to `updateTextOverlayData`'s refusal, silently. Since ESCSUITE-88 `handleMouseDown` asks the same
question: a press on a locked clip **selects** it (so the inspector can show it and say why it is
read-only) and returns there — no `gestureHistory.begin()`, no drag state, nothing bound to the
window — and `getCursor` reads `not-allowed` over it, in the hover branch and in the `dragState`
branch, the latter for a row locked *mid-gesture*. Marquee selection on empty canvas is
untouched.

The **track header** (`TrackHeader.tsx`): the delete button is `disabled`,
`title="Unlock the track to delete it"`. `useAppKeyboardShortcuts.ts` does the same on-demand
read before its five editing branches — Delete/Backspace on a multi-selection, Delete/Backspace
on a single clip, Ctrl+V, Ctrl+D and Ctrl+B — and toasts "Track is locked" instead of calling
the action and letting the store swallow it silently. ESCSUITE-88 closed the limit this ticket
stated: the keyframe panel and the preview's transform handles, which used to let the user try
and show nothing, now both refuse at the gesture's start and say so (the two paragraphs above).
The toolbar's Delete button was the last of them, and ESCSUITE-91 closed it: one **boolean** selector
(`anyClipOnLockedTrack(clips, tracks, selectedClipIds)`, so the toolbar re-renders only when the answer
flips and `Toolbar.rerender.test.tsx`'s pin holds) disables the button and titles it `Track is locked`
while the selection touches a locked track; Mute and Unmute stay live, since a track property is not what
the lock freezes. Every surface that can edit a clip now shows the lock before the store has to refuse.

The one documented exception is the colour swatches
in `MaskSection` and `ShapeSection`: an OS picker reports continuously too, but it opens on the
press and reports after the release, so a pointer gesture does not bound that interaction and
these listeners would not help it.

Two things in here will surprise the next reader, and both are preserved on purpose.
**`CollapsibleSection` owns nothing but its own open/closed flag, which it seeds from
`defaultOpen` at mount and never re-reads** — so whether a section is open survives a
re-render, and which section a given `{condition && <CollapsibleSection/>}` slot maps to is
decided positionally by React. That is why the conditions that show and hide these sections
stay where they are in `ClipEditor`, in the order they are in: moving one would hand its
open/closed state to a different section. **And Transform has two Reset buttons that mean
different things.** The one in the section header resets position, scale and opacity *and* an
overlay's own coordinates, but leaves rotation alone (`handleResetTransform`); the one beside
Fit to Canvas spreads `DEFAULT_TRANSFORM` wholesale — rotation and `scaleLocked` included —
and only exists when the clip has a source video (`handleResetToDefaults`). The only thing
that tells them apart in the DOM is that the second carries a `title`, which is how
`ClipEditor.test.tsx` distinguishes them.

**A paste can refuse for a second reason now, and the playhead default was wrong (ESCSUITE-100).**
`pasteClips` placed its earliest clone at `state.currentTime || minPosition + 0.5` — `currentTime`
is never undefined, so that `||` only ever fired for a playhead sitting at exactly 0, and treated
it as "no playhead": Home, then Ctrl+V, pasted a clip copied from 3s at 3.5s rather than 0. Paste
now always lands at the playhead, 0 included, with every other clone keeping its offset from the
first. Its clones also keep the clipboard's `trackId`, and that track can be gone without the lock
ever being involved — deleted by `removeTrack`, or swapped out from under an existing clipboard by
a project load — so `pasteClips` reads the current tracks through `get()` and refuses whole,
writing nothing, when any clone's `trackId` names none of them; the same all-or-nothing shape as
the lock check beside it. That guard is meant to be a rare belt-and-braces check rather than the
normal path: `removeTrack` and the project slice's `removeSourceVideo` now prune the clipboard
themselves — an entry naming the track (or the source) they just removed is filtered out in the
same `set`, before `pasteClips` is ever asked, the way the source removal already dropped every
clip that used it. `pasteClips` moved out of its `set` updater and into the `get()`-then-`set()`
shape `moveClipToTrack` uses, so it can answer `false` without writing at all — ESCSUITE-87's
boolean contract, one more action added to the list — and `useAppKeyboardShortcuts`'s Ctrl+V
branch toasts "Nothing to paste here" on that `false`; its own pre-check still catches a *locked*
target and toasts "Track is locked" before the call, so this is what catches the case the
pre-check can't see, a target that isn't on the timeline at all.

**A clip that leaves the timeline leaves the selection too, and a no-op write says so
(ESCSUITE-101).** `store/selectionPrune.ts`'s one pure question, `pruneSelection(clips,
selectedClipId, selectedClipIds)`, is asked wherever a clip can leave the timeline some way
other than the id a caller happened to pass it: `removeClipFromTimeline` and `rippleDeleteClip`
generalise their old `selectedClipId === clipId ? null : …` ternary to the whole selection —
dropping `clipId` from `selectedClipIds` too, which neither used to do; `splitClip` prunes the
original (now-retired) id from `selectedClipIds` while still explicitly selecting the first half,
its existing contract; `removeTrack` and the project slice's `removeSourceVideo` prune the
selection beside the clipboard pruning ESCSUITE-100 already added, same shape, same `set`;
`undo`/`redo` prune against the clips *being landed on* (`previous`/`next`, not the state being
left), because an undo or a redo can restore a clip list that no longer holds an id the selection
names; and `setProject` (ESCSUITE-115) prunes against the *incoming* project's clips — it replaces
the whole project, a different clip list wholesale, and project load, `LOAD_PROJECT` from a host
and session restore all go through it, so a selection from the project being replaced used to
outlive it as a ghost. `pruneSelection` returns the SAME `selectedClipIds` Set (and the same
`selectedClipId`
value) when nothing needed dropping, so a caller spreading its result into a `set()` update
triggers no re-render over an unchanged selection — the property `trackLock.ts`'s five questions
have and this one needed too, since every one of these actions already writes on every call.

The bug this closes: paste selects the clip it just placed; Ctrl+Z removes it from the timeline
but used to leave the selection alone; Delete then found a selection naming a clip that was
already gone, deleted nothing, and — because `deleteSelectedClips` and the others in this
paragraph never asked whether there was anything to delete — pushed an undo entry anyway. That
entry cleared the redo stack the Ctrl+Z had just built and left `history.past` one entry longer
for an edit that never happened, so the next Ctrl+Z appeared to do nothing. Three actions close
the other half of ESCSUITE-87's contract for the same reason: `deleteSelectedClips` now answers
`false` and writes nothing when the ids it finds among `selectedClipIds` all name no clip on the
timeline (belt-and-braces, the same shape as `pasteClips`'s "track no longer on the timeline"
check — pruning running everywhere else means a ghost should rarely reach here at all) or when
any one of the ids that DO still exist sits on a locked track (`anyClipOnLockedTrack`,
all-or-nothing, ESCSUITE-84, unchanged); `removeClipKeyframe`
answers `false` for an unknown clip id, a property the clip has no keyframes on, or a time with
no keyframe within `KEYFRAME_TIME_EPSILON` (exported from `utils/animation.ts` for exactly this
question) — the three ways it used to push an undo entry that removed nothing; and
`muteSelectedClips`/`unmuteSelectedClips` answer `false` and write nothing when every track a
selected clip sits on already has the mute state being asked for (Mute on an already-muted
track was an entry that undid nothing), writing only the tracks that actually change — and
leaving the rest as the same object, not a same-value copy — when some but not all of them do.
`useAppKeyboardShortcuts`'s Delete branch reads `deleteSelectedClips`'s answer and only toasts
"N clip(s) deleted" on `true`: a selection of ghosts refuses silently, like every other refusal
the lock produces, rather than announcing a deletion that did not happen.

### App (`src/App.tsx`)
`App.tsx` is wiring only — the seven `useState` calls the JSX and the hooks need, the store selectors, nine
hook calls, the handful of inline lambdas the JSX needs and the composition itself. It binds no listener, holds
no timer, and computes nothing; every effect, every disk and session write, and every piece of
chrome lives in one module each under `src/app/`.

**The hooks are called in a fixed order, and the order is the behaviour.** The order the hooks
are called in is the order their effects run in, and it is the order the six effects ran in
when they were all inline in this file: theme → session check → autosave → keydown → timeline
resize → host integration. The three hooks that bind no effect (`useNotification`,
`useProjectActions`, `useTimelineZoom`) sit where their results are first needed. Two of those
positions are load-bearing rather than tidy: `useSessionRestore` writes the `sessionRestored`
flag `useSessionAutosave` gates on, so registering the autosave any earlier would change which
render first arms the debounce (`App.session.test.tsx`'s "writes nothing before the debounce
elapses" and "clears the pending write on unmount" are the net); and `useThemeLifecycle` runs
ahead of everything else, so the document is already themed by the time the editor mounts
below it.

**The store selectors stay in `App.tsx` on purpose.** Each hook takes what it needs as plain
parameters rather than subscribing for itself, so the whole subscription set is readable in one
place and every hook is testable without a store. `clips` is the one selector that has to stay
a live array rather than a count: `useAppKeyboardShortcuts`' Ctrl+B (split) branch calls
`clips.find(...)`, while `useProjectActions`' `clipCount` and the header's `canExport` only
ever want `clips.length`.

**The keyboard cascade's 38 deps re-bind the listener, and that is fine — measured, not
assumed.** Every change to one of the 38 values `useAppKeyboardShortcuts` closes over tears the
`keydown` listener off `window` and binds a fresh closure. Round 2 counted it rather than
guessing: `useAppKeyboardShortcuts.rebinds.test.tsx` drives the hook through `App`'s own
selectors over a scripted 20-edit burst and measures **15 re-binds** (2026-09-13) — about one
listener swap per edit and none per frame; five edits (a playhead write, a transform, a clip
move, a marker, a blend mode) changed nothing the cascade depends on, because `clips` is a
dependency only through its `length`. **15 is a lower bound, not the app's figure**: the
harness holds `App`'s own seven callbacks at fixed identities, so the count is the store's
contribution alone, and in the live `App` `handleSaveProject` closes over `clipCount` and the
two zoom handlers over the zoom. The extra churn coincides with edits that already re-bind
through `clips.length`, so it does not change the decision. Fifteen listener swaps spread over
a minute of editing is
not worth changing the Ctrl+B staleness semantics for, so **the array stays verbatim**. The test
pins that finding, with the assertion to lower if the handler is ever moved into a ref.

**`App` reads `currentTime` on demand and must never subscribe to it.** There is no
`currentTime` selector anywhere in `App.tsx` or `src/app/`: the shortcut handlers that need the
live value (razor split at the playhead, add marker, set in/out point) read
`useEditorStore.getState().currentTime` inside the handler, and `useSessionAutosave` re-arms
its debounce through a `useEditorStore.subscribe` listener added inside its effect rather than
through a render-triggering dependency. See the note in the Preview section above for the whole
story — `App` renders `<Timeline/>`, so a selector here would drag the entire tree through a
re-render every ~200 ms of playback regardless of what `Timeline` itself reads.
`App.rerender.test.tsx` pins exactly this, and nothing else does: a well-meaning change that
turns one of those reads into a selector passes every other App test and fails only that file's
single `toBeLessThanOrEqual(1)`.

Every module below has its own test file. `App.tsx` itself is covered through the six
`App.*.test.tsx` files that drive the rendered editor — `App.test.tsx` (the shell),
`App.project.test.tsx` (new/open/save, the load-safety dialog and the one-dialog rule), `App.session.test.tsx`
(restore prompt and autosave), `App.shortcuts.test.tsx` (the keydown cascade),
`App.messages.test.tsx` (the host integration surface) and `App.rerender.test.tsx` (the
`currentTime` contract above). `src/App.module.css` is deliberately not split: all ten
components import it from `../App.module.css`, and `App.project.test.tsx` imports it directly
and queries `styles.menuBackdrop`.

| Module | Owns |
|--------|------|
| `appConstants.ts` | The shell's plain numbers: the autosave debounce delay, the timeline panel's min/max/default height and the localStorage key it is persisted under. No behaviour, so `timelineHeight.ts`, the hooks and `App` read the same values instead of each spelling them out |
| `timelineHeight.ts` | The timeline panel's height maths: `clampTimelineHeight` (which propagates `NaN` rather than clamping it), the localStorage read/write pair, and `heightFromPointer`, the resize drag's pointer-to-height conversion. Pure but for the two storage calls, so the maths is testable without a DOM |
| `appFormat.ts` | The three notification strings: `formatTimeForNotification` (a one-line pass-through to `formatTime`, kept because three call sites read better for it), `clipCountMessage`, which spells the pluralisation rule once, and `takeLoadedMessage`, the handoff's one sentence, which folds "how many tracks" and "what was missing" into the single toast slot |
| `sessionSnapshot.ts` | `buildSessionSnapshot` — what of the editor's state the autosave writes, and in what shape. Takes the state and the timestamp as values rather than reading `getState()`/`Date.now()` itself, so the call site keeps control of *when* they are read. Strips every source video's `thumbnailUrl` before it is written (ESCSUITE-96): the field is only ever an `URL.createObjectURL` handle, and persisting one would just be writing down a URL nothing can ever open again |
| `useThemeLifecycle.ts` | Starting the shared theme module on mount and stopping it on unmount. The editor's **first** effect, so `App` calls it first |
| `useNotification.ts` | The transient status toast: one slot, not a queue. `showNotification` overwrites whatever is showing and opens a fresh three-second timer, which is deliberately neither stored nor cleared — carried behaviour, pinned by the App suite. Binds no effect; sits second because every hook after it takes `showNotification` |
| `useProjectActions.ts` | Project lifecycle: save to disk, open from disk with the "you have unsaved work" dialog in front of it, and start over. Owns `isSaving`, `isLoading`, `showProjectLoadDialog` and the pending file — and the editor's **only** project-load dialog: `handleProjectFile(file)` is the "given a project file" entry the uploader's drop/pick path calls, with `handleLoadProject` being that same entry behind the file picker (see "Dialogs"). Takes `clipCount` as a number, the dependency both callbacks carried inline. Binds no effect; sits third because the shortcut hook takes `handleSaveProject` and `handleLoadProject`. `loadProjectFile` (shared by every path above) runs `parseProject` on what `loadProject(file)` read back **before** calling `resetProject()` (ESCSUITE-102): a malformed file used to throw out of `setProject`'s migration *after* the reset had already emptied the editor, leaving the failure notice over a blank timeline; now a bad file shows "Failed to load project: \<reason\>" and the current project is never touched. `loadProject(file)` already minted a `thumbnailUrl` for every incoming source before validation ever runs, so a REFUSED load (a `parsed.ok === false`, or anything that throws before the sources are actually handed to `addSourceVideo`) revokes those incoming thumbnails itself — nothing is ever going to render them. A load that *succeeds* does **not** also revoke the outgoing library here: that is `resetProject()`'s own job (ESCSUITE-113, `store/projectSlice.ts`), and revoking it twice from two places was the review round's own finding |
| `useSessionRestore.ts` | The "Resume Previous Session?" lookup on startup and the two answers to it, and the `sessionRestored` flag the autosave gates on. The editor's **second** effect. `handleRestoreSession` rebuilds every source's `thumbnailUrl` before writing the store — the snapshot no longer carries one — resolving each with `Promise.all` (the reads are independent) so the library renders once with live pictures rather than once broken and once fixed (ESCSUITE-96). It does **not** revoke anything itself: the library is not reliably empty when a restore lands — the CRAFT handoff (`useHostIntegration` → `importTake`) adds a take's parts to it as soon as they arrive, well before the placement that waits on `sessionDecisionPending` — so a blanket revoke of "whatever is here" would kill the handoff's still-live thumbnails. `addSourceVideo` (`store/projectSlice.ts`) is the one place that owns freeing a replaced source's *old* thumbnailUrl, exactly when a restored source happens to share an id the handoff already added (ESCSUITE-113). Restoring is therefore asynchronous, not the single-tick write it used to be, and is guarded against both ways that window can be walked into: a `restoreAttemptRef` set at entry makes a second `handleRestoreSession` call while one is already reading thumbnails a no-op, and `handleDeclineSession` clears it, so "Start Fresh" clicked mid-restore wins — the restore finds its answer overruled when its reads come back and does not commit. `SessionRestorePrompt` disables both buttons the moment either is clicked, as the first line of defence against the same race. A rejected thumbnail read is answered the same way a decline is — the ref is cleared, the prompt closes, `sessionRestored` settles, and the user is left with a fresh project — except the notification says the restore failed and the saved session is left in storage rather than cleared, so a reload can still offer it |
| `useSessionAutosave.ts` | The debounced session write. The editor's **third** effect, registered immediately after `useSessionRestore` for the reason above; re-arms on `currentTime` through a subscription inside the effect, never a selector |
| `useTimelineZoom.ts` | The two zoom steps, one factor of 1.25 each way. Binds no effect; sits sixth because the shortcut hook and the timeline footer call the same two handlers |
| `useAppKeyboardShortcuts.ts` | The global `keydown` listener: one ordered cascade of `if`s where the order *is* the semantics — `c`/`v`/`o` sit below their Ctrl chords so each bare letter only sees what fell through, and the Escape cascade runs shortcuts sheet → in/out points → multi-selection → single selection. Above all of it sits `modalOpen`, which stops the cascade dead while a dialog is up (see "Dialogs"). The editor's **fourth** effect. Its deps array is the inline one character for character plus `modalOpen`, `clips.length` included while the Ctrl+B branch reads `clips.find` — a known staleness, carried deliberately. **38 deps, measured and left verbatim** — see below. Its five editing branches — Delete/Backspace on a multi-selection, Delete/Backspace on a single clip, Ctrl+V, Ctrl+D and Ctrl+B — ask `store/trackLock.ts` about the lock on demand before calling the store and toast "Track is locked" instead when it would refuse (ESCSUITE-84) |
| `useTimelineHeight.ts` | The resize drag, the double-click reset and the persisted height. The editor's **fifth** effect; its `[isResizing, timelineHeight]` deps re-bind both document listeners on every clamped pixel of a drag, which is load-bearing — it is how `handleResizeEnd` closes over the final height. `src/hooks/useDocumentListener.ts` keeps its handler in a ref and would break exactly that, so it is not used here |
| `useHostIntegration.ts` | The inbound `postMessage` handler and the startup work the URL parameters ask for. The editor's **sixth and last** effect. Its deps are `[]` even though it closes over four values: the handler is installed once, `GET_STATE` works around the staleness with an explicit `getState()`, and the rest rely on those four being stable for the component's life. Keeps no thumbnail owner: the take's parts and their thumbnails are the library's from the moment `importTake` hands them over, so neither the cleanup, nor the cancelled-import path, nor a take dropped at placement time revokes them (ESCSUITE-117) |
| `takeImport.ts` | The storage half of the `?loadVideo=` handoff: resolve the take's parts, read each one's blob and thumbnail, add it to the library with a resolved duration, and return the parts to place (`ImportedTake`: `clipParts`, `missingParts`). Every thumbnail URL it mints goes to `addSourceVideo` with its part and is the store's to free from there (ESCSUITE-117) — it keeps its own list only long enough to revoke it if the import throws part-way, and does not report it, since ESCSUITE-140 nothing outside its own tests read that report. Lives beside the hook rather than inside it because the hook's effect is already the app's longest and these are the arms worth testing on their own |
| `AppHeader.tsx` | The top bar: the dashboard link (hidden in the standalone build, which this component asks about itself), the wordmark, the project-name field, and the File menu plus the quick Save and Export buttons |
| `FileMenu.tsx` | The header's File dropdown: the button, the click-outside backdrop, and the four items with their shortcut hints. Each item acts and then closes; what "acts" means belongs to the caller |
| `MediaLibrarySidebar.tsx` | The left sidebar: its header and collapse button, and — while open — the uploader, the resolution picker and the library listing. Three of its props are pure pass-throughs it has no behaviour of its own for — `onConfirmOpenChange` to `ResolutionPicker`, `onProjectFile` to `VideoUploader`, and `showNotification` to `VideoUploader` (ESCSUITE-142: how Clear All reports a partial failure) — and all three are **required** here, so a caller that forgets to wire any of them fails to compile (see "Dialogs" for the first two) |
| `InspectorSidebar.tsx` | The right sidebar: the inspector's header and collapse button, with `ClipEditor` underneath while it is open |
| `MobileInspectorToggle.tsx` | The floating inspector toggle shown at narrow widths, rendered inside `<main>` as a sibling of the inspector it controls |
| `TimelineResizeHandle.tsx` | The grab strip between the editor body and the timeline. It reports the two gestures and nothing else; the drag belongs to `useTimelineHeight` |
| `TimelinePane.tsx` | The bottom pane: add-track, zoom out, the zoom readout and zoom in, above `Timeline` itself. **Deliberately not memoised** — `App.rerender.test.tsx` counts `Timeline` renders, and a memo here would make that pass for the wrong reason and hide a future `currentTime` subscription |
| `NotificationToast.tsx` | The status toast in the corner. The `{notification && …}` guard stays in `App`, so it never renders an empty live region |
| `LoadingOverlay.tsx` | The modal spinner shown while a project loads. The `{isLoading && …}` guard likewise stays in `App` |
| `SessionRestorePrompt.tsx` | The "Resume Previous Session?" modal and its two buttons. The `{showSessionPrompt && pendingSession && …}` guard stays in `App`, so `session` is always present here — and so "closed" is "unmounted", which is why its `useDialogBehaviour` keeps the default `isOpen`. **Escape is swallowed** by a no-op: declining deletes the saved session, so a dismissal key must not reach it. See "Dialogs". Both buttons disable themselves the moment either is clicked (ESCSUITE-96) — restoring reads thumbnails before it answers, and a click on the other button (or a second click on the same one) in that window must not reach `useSessionRestore` a second time |

### Analytics
- Vercel Analytics via `@vercel/analytics`, **in the hosted build only**. The standalone
  build ships no analytics runtime at all: `BUILD_MODE === 'saas'` gates both `trackEvent()`
  and the `<Analytics />` mount in `packages/shared`, and because `BUILD_MODE` folds to a
  literal at build time the bundler drops `@vercel/analytics` from the offline bundle
  rather than shipping it inert. See the root `CLAUDE.md`'s "Vercel Analytics"
- `<Analytics />` is mounted by `bootstrapApp()`, not by `src/main.tsx` directly
- Custom events in `src/utils/analytics.ts`:
  - `Video Imported` (with type: video/image/audio) — `VideoUploader.tsx`'s `handleFiles`, after
    `addSourceVideo` succeeds for that file; not reported when processing throws (ESCSUITE-31).
    Counts a user-initiated import only — a file dropped or picked in the media library — so
    the CRAFT handoff, a project load and a session restore all stay silent: none of them is
    an import
  - `Project Created`
  - `Project Saved`
  - `Export Started` (with format)
  - `Export Completed` (with format and duration)

  `Overlay Added` was declared and unit-tested but never called from any overlay-adding action,
  so it was deleted along with its test rather than wired (ESCSUITE-31) — adding an overlay is
  not judged a critical-enough path to instrument, unlike an import or a delete.

### Dialogs

**All five of the editor's modals** — `ExportDialog`, the shortcut sheet
(`components/KeyboardShortcuts/KeyboardShortcuts.tsx`), the project-load safety dialog
(`components/ProjectLoadDialog.tsx`), the session-restore prompt
(`app/SessionRestorePrompt.tsx`) and the resolution-change confirm
(`components/ResolutionPicker.tsx`) — get their keyboard behaviour from
**`useDialogBehaviour`** in `packages/shared/src/hooks`, imported as
`@escapesuite/shared/hooks`. ESCAPECRAFT's two modals use the same hook; it is the one
implementation for every dialog in the suite, and the place to change any of this.

Each carries the same five things: the hook's `ref` on the **panel** (not the backdrop),
`role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing at its own heading's `id`,
and `tabIndex={-1}` on that same element — the last because the hook's Shift+Tab trap has an
arm for focus parked on the container, which is where a click on the dialog's own padding
lands. In return each gets initial focus inside itself, a Tab/Shift+Tab cycle that cannot
leave, Escape claimed in the capture phase, and focus restored to whatever opened it.

**Escape means something different in each, and that is a decision, not a default.** The hook
calls whatever it is handed, so the five answers are the five arguments:

| Modal | Escape calls | Why |
|-------|--------------|-----|
| `ExportDialog` | `handleCancel` | closes, aborting an export in flight exactly as the × and Cancel do (ESCSUITE-98: `handleExport`'s own promise chain checks a per-run identity — a fresh `AbortController` plus a `latestExportRef` that only ever advances to a *newer* run and is also cleared by `handleCancel` — before writing progress or error state, before its post-export download and `EXPORT_COMPLETE` host notification, and before clearing its own abort controller, so a run that has been cancelled or superseded can never clobber the export the user is actually looking at, nor resurrect its own download after the fact) |
| `KeyboardShortcuts` | `onClose` | the sheet holds no state and destroys nothing, so dismissing it is free |
| `ProjectLoadDialog` | `onCancel` | the other two answers both replace the current timeline; cancelling is the only one that leaves the editor as the user left it |
| `ResolutionPicker`'s confirm | `handleCancel` | confirming rewrites the project's resolution, which "may affect overlay positions and scaling" and cannot be undone automatically; cancelling costs nothing, and the select is controlled by the store's resolution so it snaps back to the preset still in force |
| `SessionRestorePrompt` | **nothing** — a module-level `swallowEscape()` no-op | `useSessionRestore`'s `handleDeclineSession` calls `clearSessionState()`, so "Start Fresh" **deletes** the saved session. Escape is the key people press to dismiss a thing; routing it to either button would either discard work or silently accept it. The hook still claims the key (so the editor's cascades behind the prompt never see it) and then does nothing: the prompt stays up, focus stays trapped, and the only two ways out are the two buttons — the right shape for a question that must be answered |

**The fifth modal is the odd one out in exactly one way: its open flag is not `App`'s own
state** (ESCSUITE-64, which adopted it — it used to have no role, no name, no trap, no Escape
and no place in `modalOpen`). `ResolutionPicker` owns `showConfirm`, and `App` has to know about
it to gate the editor's keys, so the picker reports it: an optional
`onConfirmOpenChange?: (open: boolean) => void`, handed down `App → MediaLibrarySidebar →
ResolutionPicker` (**two hops**, which is why it is a prop and not a field in the store's ui
slice — nothing else would ever read that field). `App` holds `resolutionConfirmOpen` and passes
`setResolutionConfirmOpen` itself, so the identity is stable. Inside the picker the report is
**derived from `showConfirm` in an effect**, not announced by the three handlers: it cannot then
drift from the state it describes, and the effect's cleanup means an unmount with the confirm up
— collapsing the sidebar — still reports it gone instead of leaving `modalOpen` stuck true and
the editor deaf. (Nothing can reach the collapse control from behind the overlay today; the
cleanup is there so that stays a fact about the CSS rather than a load-bearing assumption.) The
prop is optional on the picker, because the dialog is complete without a listener and the
picker's own tests render it bare; it is **required** on `MediaLibrarySidebar`, so `App` cannot
forget it.

There is no sixth: `ResolutionMismatchDialog`, the "ask on import" the project decided against
(media auto-fits instead), sat unimported for months and was deleted with its stylesheet and test.

Two shapes worth knowing, both about `isOpen`: `SessionRestorePrompt` is rendered only while
open (`App` holds the `{showSessionPrompt && pendingSession && …}` guard), so "closed" is
"unmounted" and it leaves the hook's second argument on its `true` default, like both CRAFT
modals. `ExportDialog`, `KeyboardShortcuts`, `ProjectLoadDialog` and `ResolutionPicker`'s
confirm are mounted for the life of their parent (the picker itself always is; the overlay is
the conditional part) and pass a flag — `isOpen`, or `showConfirm` — so the effect opens and
closes with it.

The shortcut sheet needed one thing beyond the wiring: its `.content` grid scrolls and holds
no controls, so it carries `tabIndex={0}` for a keyboard to scroll it at all (axe:
`scrollable-region-focusable`, which the new audit below caught). That also makes it the
sheet's second and last stop in the trap.

Two more things the audits turned up, both now fixed: the session-restore and project-load
dialogs' primary buttons were white on the `--accent-primary` fill at **2.75:1** and now use
`--accent-on-fill` like `ExportDialog` already did; and both dialogs titled themselves with an
`<h3>` under a page whose only `<h1>` is the logo, which skips a level (axe: `heading-order`).
Both are `<h2>` now, matching `ExportDialog` — the session prompt's `.sessionPrompt h3` selector
moved with it, and the project-load dialog's styling is on a `.title` class, so neither changed
how anything renders. The resolution confirm had **both** of the same two faults and took both
fixes with its adoption (`.confirmTitle` is a class too, so its `<h3>` → `<h2>` changed nothing
visual either).

**An open question, deliberately left alone**: `SessionRestorePrompt` swallows Escape, so it is a
dialog that demands an answer — which is what `role="alertdialog"` exists to tell assistive
technology. It keeps `role="dialog"`, so the dead Escape is an undeclared deviation from the APG
pattern. Changing it would move three test call sites and the audits' `include('[role="dialog"]')`
selector, and it is arguable either way (a restore *offer* is not an alert), so it was not taken
with the trap work.

The hook started life *here*, as an inline effect in `ExportDialog`, and was lifted into
CRAFT and then into `packages/shared`. The copy that stayed here had drifted in one way:
its Shift+Tab trap had arms for focus on the first control, focus null and focus outside
the dialog, but none for focus parked on the dialog **container** — which is where a click
on the dialog's own padding lands. Shift+Tab from there walked backwards out of an
`aria-modal` dialog. The shared hook treats the container as "at the start" and wraps to
the last control; `ExportDialog` carries `tabIndex={-1}` so the container is a focus target
at all.

#### The modal gate on the global shortcuts

**While a modal is up, the editor behind it takes no key at all.** `App` computes one flag —
`const modalOpen = showExport || showShortcuts || showSessionPrompt || showProjectLoadDialog ||
resolutionConfirmOpen`
— and hands it to *both* of the app's `window` cascades: `useAppKeyboardShortcuts` and
`PlaybackControls` (which owns Space, the arrows, Home and End). Each returns from its handler immediately when it is true,
below the typing check and above every other branch — the same shape, and the same
comment, as ESCAPECRAFT's `useKeyboardShortcuts` (PR #381). That typing check names
`HTMLInputElement`, `HTMLTextAreaElement` **and `HTMLSelectElement`** in both cascades: until
the select was added, ArrowLeft/ArrowRight in the resolution picker, the export dialog's
dropdowns or the keyframe panel's easing `<select>` stepped the playhead a frame instead of
changing the option, because a native select changes its option on those keys *and* lets the
event bubble to `window`. Pinned by a test in each cascade's suite (keys pressed into a
focused `<select>` reach neither handler). Before it, Space started playback,
Delete removed the selected clip and Ctrl+Z undid, all from behind a dialog the user could not
see past.

**Escape is the dialog's, never the global handler's** — and since all five modals use
`useDialogBehaviour`, that is now literally true of all five. The hook listens on `document` in
the **capture** phase and `stopPropagation()`s that one key, above every `window` bubble
listener, which is why Escape was the only key that already behaved correctly and why the gate
changes nothing about it.

The shortcut sheet keeps **one** key of its own on `window`: the second `?` (and Shift+`/`)
that toggles it shut, behind the same input/textarea typing guard the other two listeners open
with. The guard is still needed even though the sheet traps focus, because the listener is on
`window`, which every field in the document reaches. It needs no `stopPropagation`, because the
two cascades below it are already gated. That is what keeps the footer's "Press `?` to toggle
this panel" true. **Escape was bound there too until the sheet adopted the hook**; two
listeners for one key was one Escape path too many, and the `window` one was the one to go —
it could not `stopPropagation` anything useful and it sat below the hook's.

**Two cascade branches are consequently unreachable from `App`**: the hook's own `?` toggle and
the first arm of its Escape cascade (close the sheet). `showShortcuts` can only ever be `false`
by the time the gated handler runs, so `setShowShortcuts(!showShortcuts)` is permanently
`setShowShortcuts(true)`. They are **retained only for the hook's own unit tests and for the
branch-order contract** this file describes as the semantics of that file — nothing in the
running app reaches them. Folding the sheet's two keys back above the gate inside the one
cascade would remove the dead arms at the cost of the gate no longer sitting above every other
branch; if that trade is ever taken, this paragraph and the sheet's listener go together.

**`LoadingOverlay` is deliberately not in the flag, and is the one overlay with no trap.**
It carries `role="dialog" aria-modal="true"` for the screen reader, but it traps no focus,
holds nothing to interact with and is gone the moment the project finishes loading — there is
no dialog in front of the user to be confused by. `SessionRestorePrompt` and
`ProjectLoadDialog` (`useProjectActions`' `showProjectLoadDialog`) are both in the flag and
both trap focus: each is a question with buttons that waits for an answer.

**There is one `ProjectLoadDialog`, served from `useProjectActions`** (ESCSUITE-63). It used to
be rendered *twice*: `App`'s, plus a second instance inside `VideoUploader` with its own
`showProjectLoadDialog` / `pendingProjectFile` state and its own copies of the replace/merge
handlers, opened by dropping a `.veditor` on the uploader. That second flag was **not** in
`modalOpen`, so the editor behind the uploader's copy took every key — and Ctrl+O from there
opened `App`'s copy on top of it: two mounted dialogs, a duplicate `id="project-load-title"`
(the second dialog's `aria-labelledby` then silently resolving to the first heading), a duplicate
`data-testid="project-load-dialog"`, and two focus traps competing for Tab.

`useProjectActions` now exposes **`handleProjectFile(file)`** — the "given a project file: ask if
the timeline holds work, load it outright if not" half of `handleLoadProject`, which is all
`handleLoadProject` does after picking a file. It is threaded `App → MediaLibrarySidebar →
VideoUploader` as a **required** `onProjectFile`, so a caller that forgets it fails to compile
rather than silently swallowing a dropped project, and the uploader keeps no project state at
all: it recognises a `.veditor`, hands it up, and is done. Three behaviours the drop path used to
have differently went with the duplication, all of them the App path's and all of them better:
the load now shows the blocking `LoadingOverlay`, a success reports `Project loaded successfully`
through the notice channel rather than nothing at all, and a file that cannot be read reports
`Failed to load project` there too instead of a blocking `alert('Failed to load project file.')`
— the last `alert()` on any ARTIST *load* path (the uploader still raises one to reject a file
that is not media at all, and `confirm()` still guards Clear All and New Project). Save-and-load
also announces its save, and a failed save, which the uploader's copy swallowed to the console.
The one thing that swap costs, for the record: `useNotification` is a single slot on a
three-second timer, so a failure the user happens not to be looking at is now missed, where an
`alert` demanded acknowledgement. It is the only one of the four that is arguably worse for the
user, and it is named in the changeset for that reason. `App.project.test.tsx`'s
`one project-load dialog` describe pins it — a dropped file that cannot be parsed reports through
the notice channel and calls no `alert`.

The flag and the trap are still worth having together — the flag stops the editor taking keys
from behind a dialog, the trap stops Tab walking out of one.

**The keyframe-graph gap is closed — by two fixes, because it had two routes in** (it was
recorded here as open: the F4 finding of the modal-gate review). Nothing gates the *keyframe
graph* on `modalOpen`: it is a focusable `role=listbox` with its own element-level handler, so a
user who reached it could still nudge, delete and add keyframes with the arrows, Delete and Enter
from behind a dialog.

1. **The Tab route** — `KeyboardShortcuts`, `SessionRestorePrompt` and `ProjectLoadDialog`
   trapped no focus, so Tab walked out of them and into the graph. All three now adopt
   `useDialogBehaviour`. **The fix was the trap, not another flag.**
2. **The pointer route** — and this is the half the trap cannot touch, and the half the original
   F4 note got wrong when it said "`ExportDialog` is immune because it really traps focus". A
   trap governs focus, not hit-testing. The keyframe panel is a `createPortal` sibling of `#root`
   and carried a bare `z-index: 1000`; every modal overlay is `--z-modal` (200). The panel
   therefore painted over the backdrop, the backdrop never received the click, and
   `document.elementFromPoint` at the graph returned the listbox — so a click focused the graph
   and Enter added a keyframe through an open `aria-modal` dialog, `ExportDialog` included. The
   palette gained **`--z-panel` (150)** — between `--z-dropdown` and `--z-modal` — and
   `KeyframePanel.module.css` uses it.

Neither half is provable in jsdom (there is no layout and no hit-testing), so both are held in
Chromium: `apps/e2e/tests/accessibility/core.spec.ts` has one axe audit per overlay for the role,
name and `aria-modal`, plus "an open modal covers the keyframe panel, so a pointer cannot reach
the graph behind it", which checks `elementFromPoint` at the graph's centre before and after the
sheet opens and then clicks there. **If `--z-panel` is ever raised above `--z-modal`, that test is
what fails.**

### Export Resolution (`src/core/outputTransform.ts`, `src/core/exportTypes.ts`)

**The exporters draw in project pixels and one transform per frame puts them on the output
raster** (ESCSUITE-94). `core/canvasRenderer` sizes a media clip as its native source pixels
times its scale and positions it as a fraction of the frame, and the two exporters' overlay
loops place text and shapes the same way — so the numbers those calls take are **project**
pixels, not the canvas'. The canvas is whatever size the chosen resolution asked for. Nothing
joined the two spaces until this ticket, so Export → Advanced → Resolution was wrong at every
setting but its default: a 1080p export of a 1280x720 project drew the clip at `0, 0, 1280,
720` in a 1920x1080 frame (pillar/letterboxed in black) and a 480p one drew it at `-213, -120,
1280, 720` in an 854x480 frame (cropped). "Project" was right, which is why it survived.

`openOutputFrame(ctx, project, output)` is the whole mechanism, and the preview calls it too —
it was the preview's inline `setTransform`, lifted rather than copied, because a drawing
behaviour one pipeline has to remember to reproduce is a behaviour that drifts. It delegates the
matrix to `setOutputTransform` — `ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY)` —
then clears the raster to black and returns the scale, which is also the
frame's `filterScale`. `projectToOutputScale` is `Math.min` of the two ratios, so **a frame is
never stretched**: what a rounding disagreement can leave is a sub-pixel bar, never a crop. A
degenerate project (a zero resolution, which the store never writes but a hand-built headless
request could) scales by 1 rather than dividing by zero.

**The letterbox mechanism stays, but nothing reachable produces it any more.** Where the output
aspect differs from the project's, the project rect is fitted inside the raster, centred, and the
leftover is black bar. The clear is the *whole raster expressed in project coordinates* rather
than the project rect, so one fill paints the picture's ground and its bars together. A
resolution preset no longer produces that case beyond sub-pixel rounding, because `getResolution`
derives a preset's width from the **project's** aspect: preset height is fixed (1080/720/480),
width is round-to-even(height x project aspect), and `'project'` stays exact. It used to take the
aspect from `getBaseDimensions` — the bottom clip's source — so a 16:9 project whose bottom clip
was 4:3 exported 960x720 for "720p". Only a caller with no project resolution at all falls back
to the source aspect, the same fallback `'project'` itself takes — and that fallback is used by
both the output size and the project's own drawing space together, so the two can never disagree.
There used to be a fourth option, `'original'`, whose output *was* the bottom clip's source size
regardless of the project's own shape — the one case that could produce a real, deliberate
letterbox, and one the export dialog never offered (only a hand-built headless job spec could
reach it). ESCSUITE-111 dropped it rather than fix it: every resolution left in
`ExportOptions['resolution']` ties its output aspect to the project's, to no more than
rounding — about one output pixel of bar, never a real letterbox — and `core/outputTransform.test.ts`
still exercises the mechanism itself directly with hand-built, genuinely mismatched sizes. That
one-pixel bar is `getResolution`'s own round-to-even step, not a fallback: 480p of a 1280x720
project is 854x480 (853.33 rounded up to the nearest even width), and 854/1280 (0.66719) is not
quite 480/720 (0.66667), so `projectToOutputScale`'s `Math.min` leaves a third of an output pixel
of bar on each side even with a project resolution given throughout — pinned at the exporter
level by `exportWebM.test.ts` / `exportMP4.test.ts`'s "leaves a sub-pixel bar..." case. A job spec
that asks for `resolution: 'original'` is now a validation error (`services/headless-artist`'s
`parseJobSpec`), not a silently-accepted value.

`ctx.filter` is the one length the transform does not reach, so both exporters pass
`MediaDrawOptions.filterScale` now (see the Preview section, where it was born). That needed
`drawMediaWithFrame` and `drawTransitionWithFrames` to take `MediaDrawOptions` as well — the
comment on the latter saying "an export's canvas is always its own project" was exactly the
premise this ticket falsified.

**Nothing else composites.** `workers/decodeWorker.ts` decodes and holds frames; it has no
canvas at all. The compositing is in
`exportWebM.ts` and `exportMP4.ts` and nowhere else, which is why two call sites were the whole
fix. The headless kit drives these same exporters through `window.__renderProject`, so it gets
the fix for free — including the manifest, which `headless/renderProject.ts` sizes with the same
`getResolution`.

**The exporters draw media and overlays in one interleaved track-order pass, the same pass
`drawFrame.ts` draws for the preview** (ESCSUITE-124). Both exporters used to draw every media
clip first (in track order), then the active transition, then **every** overlay clip afterwards
— sorted among themselves but unconditionally on top of all media, regardless of the overlay's
own track index. The preview was never wrong: `drawPreviewFrame` sorts every active clip
(media and overlay together) by track index and draws that one list top-to-bottom, so an
overlay on a lower track than a video is exactly as hidden behind it as the video is opaque, and
a blur shape (`shapeBlursBackground`, which samples "the canvas so far") only ever blurs the
media actually below it. An export disagreed on both counts: an overlay parked on an empty
track under a full-height video — reachable with no deliberate effort, since
`findEmptyTrack` (`store/overlaySlice.ts`) hands a new overlay the first track with *no* clips
at all, which is often one under existing video — was invisible in the editor and visible, on
top, in the file; and a blur shape one track below a video blurred that video too, the opposite
of both exporters' own "blur overlays only affect content below them" comments. The fix is the
same shape in both: `activeClips` (`getClipsAtTime`'s result, already track-sorted) is looped
once, branching on `clip.overlayType`, instead of split into a media pass and a hoisted overlay
pass. The transition itself still draws where it always did in both pipelines — after that one
loop — which already matched the preview and needed no change; only the interleaving of media
and overlays within it did. The ruling that decided the direction: the preview is what the user
arranges the timeline by, so it is the two exporters (and the headless bundle, which shares them
for free) that had to be made to match the preview, not the reverse.

**The incoming side's animation is clamped to the same clip time as its frame (ESCSUITE-133).**
`drawTransition` and `drawTransitionWithFrames` (`core/canvasRenderer.ts`) each draw two sides
per frame, and the incoming side's clip time used to be `currentTime - incomingClip.timelinePosition`
with no floor — negative for the whole transition whenever the incoming clip's `timelinePosition`
is at or after the outgoing clip's end, which is the ordinary case for two clips placed back to
back on one track (the same-track case `getActiveTransition` looks for first). The frame drawn
underneath was already clamped in that case (`exportMP4.ts`'s own frame fetch falls back to
`incomingClip.startTime`, the clip's first frame, whenever its unclamped source time would be
negative); the animated opacity/transform/blur was not, so the two halves of the same draw
disagreed about which instant of the clip they were showing. `getIncomingClipTime`
(`core/exportTypes.ts`) is the shared clamp — `Math.max(0, currentTime - incomingClip.timelinePosition)`
— both functions call now, so the preview and both exporters (which draw a transition's incoming
side through these same two functions) can't drift apart on it. Its own doc comment is explicit
about what this does and does not change: `interpolateKeyframes` already floors any time at or
before a property's first keyframe to that keyframe's own value, so a `fade` in-preset (whose
first keyframe sits at time 0, value 0) reads as opacity 0 whether the clip time handed to it is
0 or -0.5 — clamping fixes the inconsistency, not that preset's own opacity during the overlap.

**A transition owns the entrance of its incoming clip and the exit of its outgoing clip
(ESCSUITE-139).** ESCSUITE-133's last sentence above named what it deliberately did not fix, and
this is it: a clip with its own `fade` in-preset, sitting on the incoming side of a `fade`
transition, was faded *twice* — once by the transition (the whole point of it) and once by its own
preset, which reads opacity 0 for the entire overlap when the incoming clip's clip time is the
clamped 0. The arriving picture stayed invisible until the transition was over, and then snapped
in. The outgoing side had the mirror of it: its own fade-out multiplied the transition's, so the
departing picture vanished early, and a `blur` or `scale` preset on either side compounded the
same way (every property the preset drives, not opacity alone). The ruling: **while a clip is the
incoming side of an active transition its in-preset is treated as complete (steady state), and
while it is the outgoing side its out-preset is treated as not started. The clip's own keyframes
still apply, and a preset outside a transition window is untouched.**

There is still exactly ONE evaluation path. `getAnimatedValues` takes an optional sixth argument,
`AnimatedValuesOptions`, whose only member is `suppressPreset?: 'in' | 'out'`; the suppressed
side's generator is simply not called, and `NO_PRESET_KEYFRAMES` (one frozen `{}` for the module)
stands in for its output, so the merge below leaves that property's track to the other preset and
to the clip's own keyframes. Leaving a side out **is** the steady state the ruling asks for, with
no invented values and no second interpolation routine: every in-preset's LAST keyframe and every
out-preset's FIRST keyframe already hold the clip's base transform/effects. It composes with
ESCSUITE-125's clamps for free — the generator that would have clamped is the one not being
called.

The renderer says which side it is drawing through `TransitionModifiers.suppressPreset`
(`core/exportTypes.ts`), the one field there that is not geometry. `transitionSideModifiers` in
`core/canvasRenderer.ts` is where it is set — `'out'` for the outgoing side, `'in'` for the
incoming — written onto whatever object `transitionModifiersFor` leaves behind (or the frames
pipeline's `crossfade` fallback, or `{}` for the element pipeline's draw-untouched case), because
the suppression applies to a side of *any* active transition including a type with no geometry of
its own. Mutating that object is free and safe: both producers build a fresh one per call, so a
transition frame still allocates exactly the one modifiers object per side, and
`animatedValuesFor` maps the field onto one of two frozen `PRESET_SUPPRESSION` option objects
rather than building a literal per draw. `drawClipToCanvas` and `drawImageToCanvasWithModifiers`
read it and pass it on, which is why the fix reaches the preview and both exporters at once and
why a **non-transition** draw — which passes no modifiers at all — cannot be affected.

The compositing order is untouched: the incoming clip is still skipped by the ordinary track-order
pass (in `drawFrame.ts` and in both exporters — ESCSUITE-124's one interleaved pass) and drawn only
as the transition's own side, so nothing double-draws. The animation-lookup counts the three
`*.perf.test.ts` files pin are unchanged too, by construction: suppression is an argument to the
same one `getAnimatedValues` call each draw already made, never an extra lookup — it in fact does
strictly *less* work, skipping one preset generator per suppressed side.

**Two known consequences, both deliberate.** *The selection chrome disagrees with the picture during
a transition.* The preview's selection box (`components/Preview/previewGeometry.ts`) and a drag's
keyframe-mode starting point (`components/Preview/dragGeometry.ts`) each call `getAnimatedValues`
WITHOUT the suppression, so while a transition is running, a **geometric** preset (`slide-*`,
`scale-*`, `pop`) on the suppressed side puts the box — and the point a drag starts from — where the
picture no longer is; under a `fade` or `dissolve` (which move nothing) the two agreed before this
ticket and disagree after it. Tracked as ESCSUITE-147; the fix means handing those two modules
the active transition, which is a lookup on a path the perf ceilings do not cover, so it was kept out
of this change rather than smuggled in.

*A preset longer than the transition steps at the boundary.* The suppression is decided per frame
from whether a transition is active, so it ends exactly when the transition window does, and the
preset it was hiding resumes mid-curve. A 3 s `fade` in-preset under a 1 s transition is fully
opaque through the overlap (its own fade suppressed, the transition's alpha doing the work), then
drops to roughly a third at the boundary and fades up again over its remaining two seconds; the
out-side mirror pops back to full opacity the instant the transition starts. Equal durations — the
ordinary case, and what the inspector's own sliders encourage — are continuous, because the preset
resumes exactly where it ends. This follows from the ruling rather than working around it: the
alternative is rescaling the user's authored preset to fit the transition, which is a different
feature and a different ticket.

`exportMP4.perf.test.ts` pins the cost: **exactly one `setTransform` per frame** (a version
that set it per clip would slip under a per-frame call ceiling and would have to be wrong about
what it multiplied), and the per-frame call ceiling itself re-measured 24 → 25 for that one
call, with every other figure — `drawImage`, save/restore pairs, animation lookups,
`getContext`, `VideoFrame`s created and closed — unchanged.

**The dropdown says what it does (ESCSUITE-111).** Every option in `ExportDialog`'s Resolution
`<select>` — "Project", "1080p", "720p" and "480p" — prints its actual output dimensions
(`resolutionOptionLabel`, one `getResolution` call per option, against the current project's
resolution), not just its name: "1080p — 1920×1080". A bare "1080p" was surprising on a portrait
project once ESCSUITE-94 made a preset's width follow the project's aspect — it would export
608×1080, narrower than 1920, and the label gave no hint. The dimensions are recomputed on every
render, so switching projects or resizing the canvas updates every option's label immediately.

### Export Performance Optimizations (`src/core/exportMP4.ts`, `src/core/exportWebM.ts`, `src/core/frameSource.ts`, `src/core/frameManager.ts`)
The export pipeline includes several optimizations to improve performance:
- **Background tab export (MP4)**: Uses WebCodecs `VideoDecoder` in a Web Worker for frame decoding, enabling full-speed exports even when the browser tab is in the background. Web Workers are not subject to browser throttling that affects `setTimeout` and `video.play()` on the main thread.
- **FrameSource abstraction**: `frameSource.ts` provides a unified interface for frame fetching with automatic fallback:
  - `WebCodecsFrameSource`: Uses `VideoDecodeManager` for MP4 files (background-capable)
  - `HTMLVideoFrameSource`: Falls back to `<video>` element seeking for WebM or unsupported browsers
- **Frame tolerance**: `HTMLVideoFrameSource.getFrame()` skips the seek entirely when the request is already within one frame (1/30s) of the element's current time
- **Encoder backpressure**: MP4's loop waits while `videoEncoder.encodeQueueSize > 5`, paired with
  the 30-second backpressure timeout below; WebM's own loop waits above `> 20`. Both exist to
  prevent memory exhaustion
- **Decoded frame ownership (`frameManager.ts`, ESCSUITE-123)**: every `VideoFrame` `getFrameAtTime`
  fetches is tracked in `currentFrames` — a `Set`, not a map keyed by `${sourceId}:${timestamp}` —
  and `cleanupIterationFrames` closes every one of them once the export frame is drawn. The key used
  to collide: a whole-clip transition's outgoing clip is fetched once as an ordinary active clip and
  again as the transition's own outgoing side, at the bit-identical source time, and each fetch is a
  distinct decoded frame (the decode worker hands back a fresh `frame.clone()` per request). A
  string-keyed map silently dropped the first fetch, leaking a full decoded frame per frame of every
  transition; the `Set` keeps and closes both.

### MP4 Export Reliability (`src/core/exportMP4.ts`)
MP4 export includes robust error handling and codec compatibility:
- **H.264 codec validation**: Uses `VideoEncoder.isConfigSupported()` to verify codec support before encoding
- **Codec fallback chain**: Tries five H.264 profiles across two hardware-acceleration passes —
  `prefer-hardware` first, then `no-preference` so the headless/CI path works without a GPU. Each
  pass walks High Profile (`avc1.640028`) → Main Profile (`avc1.4d0028`) → Baseline Profile
  (`avc1.42001f`) → High Profile Level 5.1 (`avc1.640033`) → Main Profile Level 5.1
  (`avc1.4d0033`); the first three are Level 4.0/3.1, which `isConfigSupported` rejects above
  1920x1080, so the two Level 5.1 entries are listed last and exist to cover 1440p and 4K
- **Encoder error tracking**: Captures errors from encoder callbacks and propagates them instead of silent failures
- **Backpressure timeout**: 30-second timeout on encoder queue wait to detect stuck encoders, via
  the same `waitForEncoderBackpressure()` (`exportTypes.ts`) `exportWebM.ts` calls — see "WebM
  Export Reliability" below for why it is one function rather than two copies of the same loop
- **Quality-based audio bitrate**: Audio bitrate scales with quality setting (128k/192k/256k) instead of hardcoded value
- **Error checkpoints**: Validates encoder state at loop start, during backpressure, and before finalization
- **The decode worker starting up can no longer hang the export (`core/videoDecodeManager.ts`,
  `core/frameSource.ts`, `core/frameManager.ts`, ESCSUITE-153 / ESCSUITE-29 Mechanism 2).**
  `VideoDecodeManager.initialize()` used to resolve only on the worker's `WORKER_READY` message;
  a worker that never started — missing from a standalone download (its own fix is below), blocked
  by a CSP, or that fired `error`/`messageerror` instead — left the promise unsettled forever, and
  `FrameSourceFactory.initialize()` awaited it directly, so the export parked at "Loading media
  files…" with nothing thrown, nothing logged, and no way for Cancel to free it (`checkAborted()` is
  only consulted at points the export had not yet reached). `initialize()` now always settles:
  reject immediately on the worker's own `error` or `messageerror` event (the message names the
  worker), reject after a bounded 10s timeout if it posts nothing at all, and reject immediately if
  an optional `AbortSignal` is already aborted or aborts while the wait is pending — threaded down
  from `exportToMP4`'s own `signal` through `createFrameManager` so Cancel does not have to wait out
  the full timeout. `FrameSourceFactory.initialize()` catches that rejection, logs it, and sets
  `useWebCodecs` false instead of letting it escape — so `createSource()` takes the HTMLVideoElement
  path for every source, the same degradation it already takes per-source for an unsupported codec,
  rather than failing or hanging the whole export.

`exportWebM.ts`'s `encode()` call (ESCSUITE-131) is wrapped in
`try { videoEncoder.encode(frame, { keyFrame }) } finally { frame.close() }`, mirroring the
frame-closing shape of MP4's own encode block (which closes the canvas-drawn frame on both its
success and its fatal-retry paths): an encoder that throws mid-export no longer leaves the frame
it was encoding for the GC to finalise on top of the error that is already failing the export.

### WebM Export Reliability (`src/core/exportWebM.ts`, `src/core/exportTypes.ts`)

ESCSUITE-29 Mechanism 1 closed the error-tracking asymmetry the paragraph above used to describe:
a VP9 encoder error used to be only `console.error`-ed, where MP4 tracked `videoEncoderError` and
checked it every frame, and the exporter never probed a codec at all — `videoEncoder.configure()`
was called with a hard-coded `'vp09.00.10.08'`, with no `isConfigSupported()` call anywhere in the
file and no fallback. WebM's shape now matches MP4's:

- **Codec ladder, shared with MP4's.** `exportTypes.ts`'s `findSupportedVideoConfig()` — try each
  `VideoEncoderConfig` in order, skip one whose probe throws, return the first one
  `VideoEncoder.isConfigSupported()` answers `supported: true` for — is the one function both
  ladders walk: `exportMP4.ts`'s ten-entry H.264 ladder (five profiles × two
  hardware-acceleration passes) and `exportWebM.ts`'s two-entry one, `webMVideoCodecConfigs()`:
  VP9 (`vp09.00.10.08`) first, VP8 as the fallback every Matroska-capable browser still has. The
  probe and the real `configure()` call ask about the **same** configuration — width, height,
  bitrate, framerate, all the export's own — so there is no gap between what was asked and what
  gets encoded. Neither VP9 nor VP8 supported throws an `ExportError` before any encoder is
  constructed at all, not partway through building one. It returns `{ config, candidate }`
  (review round 1, MINOR 3) rather than `config` alone: `config` is what `.configure()` is called
  with — the browser's own normalised answer when it offers one — and `candidate` is the exact
  entry from the input list that was found supported, never touched by the browser. A caller that
  needs to know *which* configuration it asked about — `exportWebM.ts` labelling its muxer track
  `'vp9'` or `'vp8'` — reads `candidate`, because nothing guarantees `config.codec` still looks
  like the string that was asked about once a browser has normalised it.
- **Opus, probed independently of video** — the same `AudioEncoder.isConfigSupported()` shape
  MP4's own AAC check uses: no Opus support drops the audio and still produces a working, silent
  WebM (`console.warn('Opus not supported, exporting without audio')`), never refuses the export
  outright.
- **Encoder error tracking.** The video encoder's `error:` callback now stores the exception in
  `videoEncoderError`, checked at the top of every frame iteration and inside the backpressure
  wait, exactly where MP4 checks its own; the audio encoder's `error:` callback does the same,
  checked once more before finalising.
- **Backpressure timeout, factored into one `waitForEncoderBackpressure()` (`exportTypes.ts`)
  both exporters call** — not copied inline a second time, and (review round 1, MINOR 1) not left
  as a third copy either: `exportMP4.ts`'s own inline loop was replaced with the same call,
  `threshold: 5` where WebM passes `threshold: 20`, everything else identical — same mid-wait
  error check, same 30-second stuck-encoder timeout, same `ExportError` message. `now`/`sleep` are
  injectable parameters so both the timeout and the error-during-wait paths are direct unit tests
  rather than needing a real encoder double to actually stall for 30 real seconds; MP4's own
  twelve codec tests and both export `*.perf.test.ts` files are unchanged by the refactor, since
  nothing about what gets called or logged differs from the loop they replaced.
- **`ExportError` and `ExportLogEntry` moved to `exportTypes.ts`** (both exporters import them from
  there now; `exportMP4.ts` re-exports them so every existing `from './exportMP4'` import keeps
  working) so `exportWebM.ts` can throw the same diagnosed-failure shape — message, structured
  log, frame index, total frames — without importing the MP4 module just for its error class. A
  WebM failure that is not already an `ExportError` or an `ExportAbortedError` is wrapped in one
  on the way out, the same catch-all `exportMP4.ts`'s own catch block has always done.

### Export Dialog Browser Support (`src/components/Export/ExportDialog.tsx`, `src/core/exportTypes.ts`)

`isMP4ExportSupported()` and `isWebMExportSupported()` answer two different questions, on
purpose, and the dialog reads each one differently:

- **`isMP4ExportSupported()`** is a synchronous read of which globals exist —
  `VideoEncoder`/`VideoDecoder`/`VideoFrame` — unchanged by ESCSUITE-22/29. It says nothing about
  whether this browser's `VideoEncoder` can actually configure H.264; that question is answered
  only at export time, by the ladder above, with its own recovery screen on failure (below). This
  is a real, if narrow, asymmetry with WebM's probe (next bullet), not an oversight — see "What is
  still asymmetric" below.
- **`isWebMExportSupported(width, height)`** is a real, asynchronous probe (ESCSUITE-22/29: it
  used to be `return isMP4ExportSupported();`, which could not tell a browser that merely has
  WebCodecs from one that can actually encode VP9 or VP8 — exactly the gap ESCSUITE-29 traced).
  `hasWebMEncodeGlobals()` is the one predicate it and `exportWebM.ts`'s own early guard both
  read: only `VideoEncoder`/`VideoFrame` need to exist, not `VideoDecoder` — WebM never decodes
  through WebCodecs; it seeks `HTMLVideoElement`s directly. From there it asks the same
  `findSupportedVideoConfig()` ladder `exportWebM.ts` configures from, at **the size the export
  will actually use** — `getResolution(advancedOptions.resolution, …)`'s answer, not the raw
  project resolution, so a project whose native size this browser cannot configure but whose
  720p/480p preset it can does not read as unsupported outright (review round 1, MINOR 2).
  `ExportDialog` calls it in a `useEffect` keyed on `isOpen`, the project's own width/height and
  the *selected resolution preset* — so it re-probes when the preset changes, not on every
  render — into a `webmSupported` state that starts optimistically `true` (so the common case —
  Chrome/Edge, both formats work — never flashes a disabled button) and flips to `false`, with a
  reason, only once the probe actually says no. The effect's `cancelled` flag is the ESCSUITE-98
  run-identity shape: closing the dialog before a probe resolves, then reopening it before the
  stale one settles, must not let the stale answer overwrite the fresh one.

The dialog's **three support states**:

| State | Shown |
|---|---|
| Both formats possible (the common case) | No notice; both are offered as usual |
| Only one is possible | The unsupported one's primary button is `disabled`, with its reason in both a `title` and a visible line in the main body: `WEBM_NO_CODEC_REASON` ("This browser cannot encode WebM video — Chrome or Edge can.") for WebM. MP4's own "Not supported in this browser" is unchanged by this ticket and still lives only in the Advanced panel's radio — the one place MP4 can be chosen at all — so the main body gets *louder* for the WebM-unsupported half and no louder for the MP4-unsupported half (that asymmetry is section ESCSUITE-22's own finding and is still open; see below) |
| Neither is possible (no WebCodecs at all) | `EXPORT_NO_WEBCODECS_REASON` ("Exporting needs WebCodecs, which this browser does not provide. Chrome or Edge can export this project.") as a `role="alert"` row in the dialog's **main body**, not behind "Advanced options" — every download button, primary **and** Advanced, stays on screen, `disabled`, the same say-why-do-not-hide shape ESCAPECRAFT's MP4/M4A buttons and `separateTracksBlockedReason` use (`apps/craft/CLAUDE.md`'s "Download Formats") |

Before ESCSUITE-22, the dialog's only "not supported" notice was MP4's, and it lived behind the
collapsed Advanced panel — so a browser with no WebCodecs at all still showed an enabled "Download
WebM" button front and center, which failed the instant it was clicked. `EXPORT_NO_WEBCODECS_REASON`
and `WEBM_NO_CODEC_REASON` both live in `exportTypes.ts`, beside the probe, for the same reason
ESCAPECRAFT's own disabled-reason constants live beside their gates rather than in a shared notices
file: nothing has gone wrong yet.

**The Advanced "Download {format}" button gates on the format the click will actually run, not
the one selected in the radio** (review round 1, MAJOR 1). `handleExport` already falls back from
`'mp4'` to `'webm'` whenever MP4 is unsupported — the intentional behaviour behind a restored
`{format:'mp4'}` setting in a now-MP4-less browser still exporting, as WebM, when the Advanced
button is clicked — so `effectiveAdvancedFormat` recomputes that same fallback
(`advancedOptions.format === 'mp4' && mp4Supported ? 'mp4' : 'webm'`) and the button disables
exactly when *that* format is blocked, with the blocking reason as its `title`. The button's
*label* still reads the selected format, not the effective one, deliberately: relabelling it would
read correctly but breaks nothing for the user, since the one existing case where they can diverge
(a stale `'mp4'` setting with MP4 now unsupported) already explains itself via the one-format
sentence above the primary section.

**A WebM failure can offer MP4 as a retry, the mirror of MP4's own "Try WebM Instead."** MP4's
failure has always replaced the dialog with a dedicated recovery screen (`mp4FailedError`) offering
WebM as the alternative, regardless of what kind of error it was — gated on `webmSupported`
(review round 1, MINOR 5: the browser the WebM probe exists to catch — WebCodecs present, no
usable codec — is exactly the one where a failed MP4 export used to still offer a WebM retry that
could not work either). WebM's failure stays inline — the usual `error` alert above the
still-present primary button — because WebM is already this dialog's own default/fallback format;
but when the failure is specifically an `ExportError` (a diagnosed codec problem: the ladder found
nothing, or the encoder failed mid-export) *and* MP4 is actually available, a "Try MP4 Instead"
button appears beside the alert, running `exportToMP4` with the same quality/resolution settings.
A plain `Error` (an abort, a generic crash) or MP4 being unavailable offers nothing further — there
is nothing more useful to suggest.

**What is still asymmetric, on purpose.** `isMP4ExportSupported()` was not upgraded to a real
per-codec probe by this ticket — only WebM's was (ESCSUITE-29 Mechanism 1's actual scope). A
browser that has WebCodecs globals but no H.264 encoder still reads `mp4Supported: true` up front
and only discovers otherwise at export time, via MP4's own ladder and its `mp4FailedError`
recovery screen. This is why MP4's "Not supported in this browser" reason can still only appear
in the Advanced panel: there is no up-front answer to show in the main body for MP4 the way there
now is for WebM. Giving MP4 the same up-front treatment is unclaimed follow-up work, not a defect
in this ticket.

### Black Flash Prevention (`src/core/exportWebM.ts`, `src/core/canvasRenderer.ts`)
To prevent black frames during export:
- **Seek timeout**: 500ms for reliable seeking
- **Frame readiness**: `exportWebM.ts`'s frame loop waits inline for `video.readyState >= 2`
  (`HAVE_CURRENT_DATA`), event-based with a `requestAnimationFrame` poll and a 300ms fallback
- **Post-seek verification**: Always waits for frame data after successful seek
- **Transition safety**: `drawTransition()` (`canvasRenderer.ts`) warns when a transition's video
  is below `readyState >= 1` — "forgiving" on purpose, per its own comment, to match the preview
  player's threshold rather than the frame loop's stricter `>= 2`

### Responsive Inspector (`src/app/InspectorSidebar.tsx`, `src/app/MobileInspectorToggle.tsx`, `src/App.module.css`)
The inspector panel (ClipEditor) adapts to different screen sizes. `App.tsx` owns the
`inspectorCollapsed` flag and hands it to both components; the markup lives in
`src/app/InspectorSidebar.tsx` (the sidebar and its collapse button) and
`src/app/MobileInspectorToggle.tsx` (the floating toggle), and the breakpoints in
`src/App.module.css`:
- **Collapsible**: Toggle button to collapse/expand inspector on any screen size
- **Media queries**: Responsive breakpoints at 1200px, 1024px, 900px, and 640px
- **Slide-out panel**: On screens < 900px, inspector becomes a fixed slide-out panel
- **Mobile toggle**: Floating action button for mobile inspector access
- **Auto-collapse**: Left sidebar collapses automatically on small screens

### Audio Waveform Visibility (`src/components/Timeline/AudioWaveform.tsx`)

**Where the peaks come from**: `utils/waveform.ts`'s `extractWaveformData`, the one
implementation — called by `core/videoProcessor.ts` for every file the media library imports
(audio *and* video) and by `app/takeImport.ts` for every part of a handed-over take
(ESCSUITE-71). Those are the only two writers, and neither recomputes: a source's peaks are
computed once, when the media arrives, so a source that arrived without them never gets any.
`TimelineTrack` draws a waveform only when the source carries **both** `hasAudio` and a
non-empty `waveformData`, so a source with peaks and no flag shows nothing — which is why the
take import fills the flag in for a recording stored before ESCAPECRAFT wrote one.

**Resolution follows the visible window, not the clip box** (ESCSUITE-13). Before this, the
component always resampled the clip's *whole* trimmed range to at most 2000 samples and drew
it across a canvas capped at `MAX_CANVAS_WIDTH` (4000 CSS px), with `canvas.style.width`
stretched to the clip's full (unclamped) width beyond that. Zooming in bought nothing: a 60s
clip read exactly 2000 distinct peak values at zoom 1 (3000px box) *and* at zoom 10 (30,000px
box, a 7.5x CSS stretch of the same 4000px bitmap) — the resample never got finer, only wider.
Three ceilings stacked to cause it: the 2000-sample cap, the 4000px backing-store clamp, and
(unreachable without raising the other two) `utils/waveform.ts`'s 100 peaks/sec source
envelope.

The fix moves the unit of resampling from "the clip" to "the slice of the clip actually on
screen": `TimelineTrack` computes each clip's `visibleRangePx` — the intersection of its box
with `Timeline`'s `scrollLeft`/`containerWidth` (both exposed from `useVirtualizedTimeline`,
previously unused outside it) — and passes it to `AudioWaveform`. A clip whose whole box fits
on screen gets `undefined` (a zero-allocation shortcut: there is no window narrower than the
clip to speak of). A clip wider than the viewport gets `{ offset, width }` in clip-local
pixels. Either way, `AudioWaveform` resamples only `getPeaksForRange`'s slice for that window
— the whole clip's range in the `undefined` case — so scrolling or zooming in on a wide clip
keeps shrinking the *time span* one resample covers, which is what actually buys detail, rather
than stretching the same whole-clip array wider. (Round 2, below, replaced the sample-count
formula sketched in the original PR here with a continuous one and added scroll-side
throttling; see that section for what actually ships.) The resample itself is a `useMemo` over primitives
derived from props (never the `visibleRangePx` object's identity, so a `TimelineTrack`
re-render that leaves the window unchanged — a clip drag elsewhere on the same row, a
playback tick — costs nothing); each `AudioWaveform` instance also keeps a small
`(zoom bucket, window) → resampled peaks` cache on a ref, invalidated outright the moment its
`peaks` array reference changes, so scrubbing back and forth over one clip at one zoom does not
re-resample every pixel of scroll. `TimelineTrack.waveform.perf.test.ts` pins the call-count
property: one resample per zoom or scroll change, zero per animation frame.

The CSS/backing-store stretch is gone too, on **both** paths: the backing store and
`canvas.style.width` are now always derived from the same number — the requested width (the
window's, or the whole clip's in the fallback) clamped to `MAX_BACKING_DIMENSION / dpr` — so
they can never disagree. The canvas is also repositioned with an explicit `style.left` (the
window's offset, 0 in the fallback) rather than relying on `.waveform`'s CSS default, since it
no longer spans the clip's full box when windowed.

**Round 2 (same ticket, same day): the fix above was correct but too expensive on scroll, and
left a visible seam.** A scroll fires faster than it renders — a trackpad or inertial scroll can
raise many `scroll` events inside one animation frame — and each one wrote `scrollLeft` into
React state that every on-screen audio clip's window depends on, so one scroll *event* (not
frame) cost one full `resamplePeaks` allocation per visible clip, with the request itself
overshooting the source's real 100 peaks/sec envelope by 5–10x (a 6s window asked for
thousands of samples a 600-peak source cannot supply, and `resamplePeaks` dutifully
duplicated what it had to answer). There was also a visible discontinuity exactly at the
fallback/windowed boundary — a clip that had just filled the viewport read 2000 samples, the
same clip scrolled one pixel further read several thousand, and the envelope visibly flattened
at that frame. Four changes, all in `AudioWaveform.tsx` unless noted:

- **The window is quantised to a 64px grid** (`WINDOW_BUCKET_PX`, `bucketWindow`) before
  anything downstream reads it — rounding the start down and the end up, so the bucketed window
  always contains what was actually asked for. A scroll that moves by less than one bucket
  changes nothing: not the memo's dependencies, not the cache key, not the canvas's size or
  position. This also closes the discontinuity above as a side effect: the bucketed window is
  usually a little *wider* than the viewport, which hides a frame or two of scroll/render lag
  behind its edges.
- **There is no separate "fallback mode" any more.** `targetSamplesFor` runs one formula
  everywhere: at least `FALLBACK_SAMPLE_FLOOR` (2000) samples when the window's own data
  supports it, otherwise one sample per device pixel of the window — but *never* more samples
  than `getPeaksForRange` actually returned for that window (`windowPeakCount`, no overshoot).
  Because the formula is continuous in the window's own pixel width rather than switching on
  "is this windowed at all", there is no boundary left to be discontinuous across, and
  `TimelineTrack`'s `visibleRangeFor` still reports no window (`undefined`) for a clip that
  fully fits on screen purely as a zero-allocation shortcut, not because the arithmetic differs.
- **The scroll handler itself is rAF-coalesced** (`useScrollSync.ts`'s `handleTrackScroll`):
  the ruler and the track headers are synchronous DOM writes as before, but the call that feeds
  React state (and therefore every visible clip's resample) is deferred to at most once per
  animation frame, latest `scrollLeft` wins — the same pattern `useVirtualizedTimeline.ts`'s
  `useScrollTracker` already used elsewhere in this file, just not on this path.
- **`resamplePeaks` (`utils/waveform.ts`) takes an optional reusable output array.** Each
  `AudioWaveform` instance keeps a small pool of evicted entries' arrays
  (`WaveformCache.freeBuffers`) and hands one to a cache-miss resample instead of letting it
  allocate fresh — `resamplePeaks` mutates each `{min,max}` slot already at an index rather
  than replacing it, and never aliases a source peak object (the old single-sample branch
  returned `peaks[i]` directly, which would have let a later mutation of a reused buffer
  corrupt the caller's own data).

  The cache itself (`WaveformCache`) is also now a real LRU, not FIFO: a hit deletes and
  re-inserts its `Map` key, which places it at the end, so eviction — always from the front —
  never removes a window the user keeps scrolling back to. It is bounded by total samples held
  (`MAX_CACHE_SAMPLES` = 2,000,000, a circuit breaker rather than a tight budget now that a
  window's own size is capped at its source peak count) rather than by entry count, and its key
  additionally includes `startTime`/`endTime`/`sourceDuration` — the window's pixels alone
  under-specify what `getPeaksForRange` actually reads, so a trim that moves those without
  moving the clip's pixel window must still miss rather than reading back a stale slice.
- **`useScrollSync.ts`'s container-width measurement moved from a passive effect to
  `useLayoutEffect`.** A passive effect runs after the first paint, so `containerWidth` stayed
  at its initial 0 for one frame, `viewportRight` read `Infinity`, and every clip — including
  one wide enough that the (then-)fallback path clamped its canvas — took the whole-clip path
  for that one frame, visibly compressing a wide clip's waveform into the left part of its box
  until the real width arrived. A layout effect runs before paint, so the browser never shows
  that frame.

**What the fix is actually worth**: production peaks are still extracted at 100/sec
(`utils/waveform.ts`), which is now **the** binding ceiling above roughly one screen pixel per
10ms of clip (\~100px/sec of clip on screen) — past that point `targetSamplesFor` is capped by
`windowPeakCount`, not by pixels, and more zoom buys nothing further without raising the
extraction rate too. Below that point, a 60s clip's finest window improves from 30ms/sample
(whole clip ÷ 2000) to the source's own 10ms/sample floor — about **3x**, not the order of
magnitude a dense synthetic test source can show. The ticket's own worst case is where it
matters most: a 10-minute clip's whole-clip fallback was 300ms/sample, so the same 10ms floor
there is about **30x**.

**Round 3 (same ticket, re-review of round 2): the free-buffer pool wasn't actually tested, the
sample budget was still too large in absolute terms, two defects, and a loose end on the
seam.**

- **Buffer reuse, made real.** Round 2's `MAX_FREE_BUFFERS` pool was fed only by eviction, and
  with entries near `MAX_BACKING_DIMENSION` in size, one eviction always covered the next
  insert's overshoot — so the pool only ever held 0 or 1 buffer, never tested past its own cap.
  `MAX_CACHE_ENTRIES` (1024) is a second, independent eviction trigger alongside
  `MAX_CACHE_SAMPLES`: a *count* of windows kept, which bounds a session of many small/sparse
  entries (a near-silent recording, a heavily zoomed-in short clip) that the sample budget alone
  would never catch, since nothing else bounds how many tiny entries accumulate. 1024 is
  deliberately *larger* than what the sample budget needs for realistically-sized entries
  (which it already bounds at 32–660 distinct windows, depending on entry size) specifically so
  the two caps don't collide — a small count cap would itself become the binding constraint and
  prevent the sample budget, and the free-buffer pool's own overflow behaviour, from ever being
  exercised by a realistic-entry-size test.
- **The sample budget is 500,000, not 2,000,000, now with the arithmetic that number implies.**
  Round 2 reasoned the 2,000,000-sample figure as "nowhere near what a realistic session
  reaches" without converting it to bytes; it is 64–96 MB of retained peaks **per mounted audio
  clip**. 500,000 (~16–24 MB) is still generous against what a realistic window costs. The
  actual fix — storing peaks as two parallel `Float32Array`s instead of an array of `{min,max}`
  objects, which the draw loop could read with zero allocation — touches `resamplePeaks`'s
  public return type and every existing caller/test of it, a larger refactor than this round
  had room for; lowering the budget is the stopgap, and the `Float32Array` conversion is the
  documented next step.
- **Defect: bucketing could manufacture a window out of nothing.** `bucketWindow` rounds its end
  up, which — applied to a *genuinely* zero-width request (a clip just past the strict viewport
  edge but still inside the virtualiser's wider overscan, so it is mounted and drawing at all) —
  could produce a window of up to `WINDOW_BUCKET_PX - 1` pixels where none should exist. The
  zero-width check now runs on the raw, pre-bucket width, before `bucketWindow` ever sees it.
- **Defect: `TimelineTrack`'s per-clip `visibleRangePx` cache (NIT-2, round 2) never shrank.**
  A clip scrolled away and never revisited — or, the common case, trimmed away or deleted
  outright — left its cached object in the `Map` forever. `pruneVisibleRangeCache`
  (`visibleRangeCache.ts` — its own file, not `TimelineTrack.tsx`, so it can be `export`ed
  without breaking that file's Fast Refresh) deletes entries for clips no longer in `clips`,
  run whenever `TimelineTrack`'s own `clips` prop changes identity (no more often than that).
- **The fallback/windowed seam (MINOR-3, round 2) gained a direct test**: a window explicitly
  covering the whole clip (`{ offset: 0, width: fullWidthPx }`) now has a test asserting it
  draws the same detail as the implicit whole-clip case (no `visibleRangePx` at all) — the
  clearest possible proof there is no separate code path left for the two to disagree across.
- **`Timeline.tsx`'s `viewportRight` no longer reads `Infinity`.** Round 2's `useLayoutEffect`
  fix measured `containerWidth` before a *real* browser's first paint, but jsdom never reports a
  non-zero `clientWidth` at all — so a test render saw `containerWidth` stay 0 forever and
  `viewportRight` read `Infinity` for its entire life, not just one frame, meaning every clip
  always took the whole-clip path in every test that didn't explicitly stub a width.
  `DEFAULT_VIEWPORT_WIDTH` (1280, an ordinary desktop width) replaces `Infinity` outright when
  `containerWidth` is 0, so the first (and every) resample windows to something sane instead of
  a clip's entire, possibly enormous, box.

Waveform visualization adapts to clip selection state:
- **Default colors**: Purple (`rgba(138, 43, 226, 0.6)`) for audio, blue tint for video with audio
- **Selected state**: White (`rgba(255, 255, 255, 0.85)`) for high contrast against blue selection background
- **Custom color**: `color` prop overrides default/selected colors when provided
- **Height is the exception to that, and must fit exactly** (ESCSUITE-76): the component writes
  one number to both the backing store and `style.height`, so nothing is rescaled vertically —
  what matters is that the number is the **clip box**, because `.clip` is `overflow: hidden` and
  a taller canvas is simply cut off at the bottom with its centreline left sitting low. The
  caller passes `TimelineTrack`'s `clipBoxHeight`: `track.height` less `.track`'s 1px
  `border-bottom` (which `.clip`'s `height: calc(100% - 8px)` resolves against, `.track` being
  `border-box`) less that 8px inset, clamped to `.clip`'s own `min-height: 40px` — 51px at a
  standard 60px row. It was `track.height - 4`, i.e. 56px, until ESCSUITE-76. The thumbnail's
  attribute box is the same expression, so the two cannot drift.

### Testing

Vitest + Testing Library in jsdom, with a v8 coverage floor enforced by `pnpm test:coverage`
(see the root `CLAUDE.md`'s coverage policy for the numbers and the rule that they only go up).

**Tests never mock the module under test.** Doubles stand in for boundaries the browser owns —
canvas, media elements, WebCodecs, Web Audio, workers, IndexedDB, layout — never for ARTIST's
own orchestration. A double records what it was asked to do and the test asserts on the
outcome, not on the double.

- **`src/test/doubles/`** — one file per browser API jsdom does not implement, each with a
  header saying what it stands in for and why it has to exist: `canvas.ts` (a recording
  `CanvasRenderingContext2D` plus `toBlob`), `media.ts` (the `<video>`/`<img>`/`<audio>`
  elements the code creates, which jsdom never loads or fires events for), `audio.ts`
  (`AudioContext`/`OfflineAudioContext` and real sample data to decode), `webcodecs.ts`
  (`VideoFrame`, the encoder/decoder capability probes, and working encoders for the export
  pipeline), `mediabunny.ts` (the muxer, recorded rather than run), `resizeObserver.ts`, `fileReader.ts`,
  `files.ts` (a `File` on Node's `Blob`, which survives fake-indexeddb's structured clone),
  `globals.ts` (take a global away, the way a browser without that API looks) and `layout.ts`
  (`setRect`/`setRects` — jsdom performs no layout, so every `getBoundingClientRect()` is
  all-zero until a test gives an element a box).
- **`src/test/fixtures/`** — shared data and the store reset. `projectStore.ts` exports
  `store()`, `addClip()` and **`resetStoreForTest()`**, which puts the module-singleton store
  back to a freshly loaded editor holding one source video (`resetProject()` alone leaves
  `zoom`, `activeTool`, `loopPlayback`, the keyframe panel and the history behind).
  `store()`'s action calls run inside `act()`, because a zustand change with a component
  mounted is a React update. `animation.ts` and `clipFixtures.ts` hold the clip/transform
  and export shapes their suites share.
- **Render helpers** — `src/test/renderApp.tsx` exports **`renderApp()`** (mount `App` and let
  its mount-time session lookup and URL-parameter work resolve inside `act()`) and
  `settleApp()` for the same wait mid-test. `src/test/renderPreview.tsx` exports
  **`renderPreview()`**, which mounts `PreviewPlayer` against every double it needs, gives its
  canvas a layout box, waits out the debounced redraw, and returns the recorded canvas calls
  split into composited frames, plus `settle(ms)` (advance the fake clock, run the animation
  frames that fall due, flush the promises, all inside `act()`).
- **`src/test/appDoubles.ts`** holds the collaborator modules the `App.*.test.tsx` files
  hand to `vi.mock` (storage, project manager, integration, video processor);
  `src/test/domQueries.ts` holds the label-based control queries the editor panels share.

## Key Constraints

- WebCodecs API (exports) only works in Chrome/Edge
- Video blobs stored in IndexedDB; large files may hit storage limits
- MP4 decoding uses Web Worker with WebCodecs for background-capable export; WebM falls back to HTMLVideoElement on main thread
- WebCodecs background export only works for MP4 source files; WebM sources use HTMLVideoElement seeking

## Headless Render Bundle

`pnpm --filter @escapesuite/artist build:headless` (env `VITE_HEADLESS=true`) builds
`dist-headless/headless.html`: a no-UI single file that loads from `file://` in
headless Chromium and exposes `window.__renderProject(input, onProgress?)`.

- Entry: `src/headless/main.ts`; contract types in `src/headless/types.ts`
  (`RenderInput` → `RenderResult` with base64 bytes + output `RenderMeta`).
- Streaming variant `window.__renderProjectToFile(input, onProgress?)`
  (`RenderFileInput` → `RenderMeta`): sources arrive as `File`s in the hidden
  `<input type="file" id="__sources">` (Playwright `setInputFiles`) and the result
  leaves as a browser download named `<outputName>.<mp4|webm>`, so large media
  never crosses the `evaluate()` boundary. `sourceVideos` entries may carry only
  `id`/`name`/`mimeType`; `seedSources` probes the rest from the bytes.
- `renderProject.ts` validates the input (every media clip must have a source and
  bytes — it fails instead of rendering black), seeds sources into IndexedDB via
  `seedSources.ts`, then calls the **same** `exportToMP4`/`exportToWebM` the editor
  uses. No engine fork.
  That is a claim `services/headless-artist/src/verify.chromium.test.ts` now **tests** rather
  than asserts: a clip masked to a circle and given an outline is rendered through this bundle
  in real Chromium and probed with ffmpeg — the frame's corner comes back black, its centre red
  and a point on the circle's own edge white (ESCSUITE-65). There are **two** edge samples, not
  one. The one centred on the outline straddles the circle, so half of it is the clip's own red
  whatever the stroke does: deleting the stroke leaves that sample's **red** above its floor and
  fails on **green and blue** at 0, which is why the predicate is all three channels and not the
  red one. The second sample sits wholly in the band's *outer* half, outside the circle
  altogether, and it is the one that proves the stroke is drawn **outside** the clip region — the
  inner `restore()` in `core/clipMask.ts`. Moving the stroke inside that region is caught by the
  on-outline sample by 22 counts (128 against a floor of 150) and by the outer one by 150 (0
  against 150), which is the whole reason for the second point. The case patches the loaded
  fixture rather than the file on disk, which is what keeps the two golden single-clip cases as
  its control: they assert the whole frame is red, which a masked frame cannot be.
  `verify.chromium.test.ts` makes the same argument for a **crop** (ESCSUITE-6):
  the fixture clip is patched to show its right half, and the rendered frame
  comes back with the export's black background in the two 16-pixel columns the
  uncropped render fills with red, and the fixture's red in the middle. The
  output raster is unchanged — a crop shrinks the picture inside the frame, it
  does not resize the frame — and, as with the mask, the two golden single-clip
  cases are the control, because they assert the **whole** frame is red.
- `render()` runs the store's `convertLegacyOverlays` on the incoming timeline before anything
  reads it, so a `project.json` carrying the legacy `textOverlays`/`shapeOverlays` arrays
  renders and exports identically with or without the store. A project with neither array is
  untouched (the conversion returns the same `Timeline` object).
- `vite.config.ts`'s single-file-build plugins (shared with the standalone build —
  `isSingleFileBuild`, see "Build Configuration" above) emit workers as classic scripts and
  inline them as blob URLs, because `file://` pages cannot load module or file workers.
- **The two call-site shapes, and the fail-loud contract.** `headlessInlineWorkersPlugin`
  reads each emitted worker `.js`, embeds it as a blob URL in `window.__wb`, deletes the file
  and rewrites the `new Worker(...)` call sites to read that map. Vite has emitted two
  different URL expressions for the same source, so the rewrite treats the leading ` ``+ `
  and the trailing `.href` as optional and handles both — `` new Worker(``+new URL(`w.js`,
  import.meta.url).href, …) `` (vite ≤ 8.2) and `` new Worker(new URL(`w.js`,import.meta.url)
  .href, …) `` (vite ≥ 8.3) — then collapses the decode worker's doubled
  `` new URL(window.__wb[K],[``+]import.meta.url) `` wrapper. Replacements are scoped to the
  filenames actually inlined, never a blanket rewrite of other `new URL(...)` uses. Because
  the files are deleted, a rewrite that silently stops matching is a broken bundle, so the
  plugin **throws** rather than warning: if a discovered worker file is missing on disk, if
  any inlined filename survives inside a `new URL(...)`/`new Worker(...)` expression after the
  rewrite, or if any `.js` file is left behind in the output directory (`dist-headless/` for the
  headless build, `dist/` for standalone). That turns a future
  emission change red in CI's `build` job (which runs for Dependabot PRs) instead of only in
  `e2e`/`kit-docker`, which Dependabot skips. Vite 8.3 broke exactly this and shipped a
  headless bundle whose workers 404'd from `file://` with
  `SecurityError: Failed to construct 'Worker'`.
- `options.resolution` defaults to `'project'`; `meta` describes the encoded output
  (honours `resolution` and `timeRange`).
- Verified in real Chromium by `apps/e2e/tests/headless/render-bundle.spec.ts`
  (builds the bundle itself in `beforeAll`).
- Design and plans: `docs/superpowers/specs/2026-06-07-headless-artist-design.md`.
- `services/headless-artist` is the packaged CLI + kit that drives this bundle outside the
  browser — one-shot Node process, Playwright-launched Chromium, job JSON in, rendered file
  out. It builds this same `dist-headless/headless.html` (via `pnpm --filter=@escapesuite/artist
  run build:headless`) and calls `__renderProjectToFile` through the file input, never
  `__renderProject`'s base64 path — see `services/headless-artist/README.md` for the job spec,
  sinks, and how to build/pack the kit.
