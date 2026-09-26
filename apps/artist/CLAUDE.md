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
| `storeHistory.ts` | The undo mechanism: `getUndoableState` (what one snapshot holds), `pushToHistory` (push it and drop the redo stack) and the module-private `MAX_HISTORY_SIZE` of 50 that caps the past. The single definition of an undo step — every mutating action in every slice goes through it |
| `projectFactory.ts` | The empty shapes and the duration sum: `createDefaultTrack`, `createTrackAtTop`, `findEmptyTrack`, `createEmptyTimeline`, `createEmptyProject`, `calculateTimelineDuration`, and `DEFAULT_PROJECT_NAME`, which `projectStore.ts` re-exports so the old import path still resolves |
| `sourceVideoEquality.ts` | `sameSourceVideo` (and the `sameWaveform` it needs) — the field-by-field comparison that lets `addSourceVideo` treat a re-add of identical metadata as no change at all, rather than as an undo step that restores an identical library |
| `projectMigration.ts` | `ensureTimelineHasTracks` — normalising a loaded project onto the current timeline shape: missing resolution, missing tracks, missing overlay arrays, clips without a `trackId`, and the `convertLegacyOverlays` call on **both** return paths. Runs on every `setProject` |
| `clipQueries.ts` | `getClipsAtTime`, `getClipAtTime`, `getClipPosition` — reads over a clips array they are handed, never over the store. Re-exported by `projectStore.ts` |
| `trackLock.ts` | Five questions over the clips and tracks a caller hands it — `lockedTrackIds`, `isTrackLocked`, `clipOnLockedTrack`, `anyClipOnLockedTrack` and `lockedSourceVideoIds` (the media a locked row's clips use, which `removeSourceVideo` and the media library's two buttons both ask about) — that every locked-track guard is built from (ESCSUITE-84, see Timeline) |

**Slices** — each one `export const createXSlice: StateCreator<EditorState, [], [], XSlice>`, composed in this order:

| Module | Owns |
|--------|------|
| `historySlice.ts` | `history`, and `undo`/`redo`/`canUndo`/`canRedo`/`clearHistory`. The only slice that reads the history stacks, and the only one whose actions restore state instead of recording it |
| `projectSlice.ts` | `project` and `sourceVideos`: `setProject` (through `ensureTimelineHasTracks`), `resetProject`, `setProjectResolution`, `addSourceVideo`, `removeSourceVideo` |
| `trackSlice.ts` | The four track actions — `addTrack` (returns the new track, so it reads through `get`), `removeTrack`, `updateTrack`, `reorderTracks`. Declares no state of its own; tracks live inside `project.timeline` |
| `clipSlice.ts` | The thirteen clip actions (`addClipToTimeline`, `removeClipFromTimeline`, `rippleDeleteClip`, `shiftClipsAfter`, `updateClip`, `splitClip`, `moveClipToTrack`, `setClipTimelinePosition`, `updateClipTransform`, `updateClipBlendMode`, `updateClipEffects`, `updateClipTransition`, `updateClipAnimation`), plus `duplicateClip` and `recalculateTimelineDuration` — the one mutating action that touches neither `history` nor `modified` |
| `keyframeSlice.ts` | Keyframe data (`setClipKeyframe`, `removeClipKeyframe`, `moveClipKeyframe`, `clearClipKeyframes`) **and** the keyframe panel's own UI state: `keyframePanelState` with its five `setKeyframePanel*` setters. Panel UI, but *keyframe* panel UI, so it sits beside the data it edits rather than in `uiSlice` |
| `overlaySlice.ts` | The overlay clip actions: `addTextOverlayClip` and `addShapeOverlayClip` (both return the new clip, so both read through `get`), `updateTextOverlayData`, `updateShapeOverlayData`. Overlay *clips* only — the legacy overlay arrays are `legacyOverlays.ts`'s business and are already folded into clips by the time a project reaches here |
| `selectionSlice.ts` | `selectedClipId`, `selectedClipIds`, `selectedTrackId`, `clipboard`, and the eleven actions over them: `setSelectedClipId`, `setSelectedTrackId`, `toggleClipSelection`, `selectClipsInRange`, `clearMultiSelection`, `moveSelectedClips`, `deleteSelectedClips`, `copySelectedClips`, `pasteClips`, `muteSelectedClips`, `unmuteSelectedClips` |
| `playbackSlice.ts` | `currentTime`, `isPlaying`, `inPoint`, `outPoint` and their five setters. No history: moving the playhead is not an undoable edit |
| `markerSlice.ts` | `markers` and the six marker actions, `goToNextMarker`/`goToPreviousMarker` included — which write `currentTime`, playback's field, off the `state` argument rather than importing anything |
| `uiSlice.ts` | The five shell preferences the store carries — `zoom` (clamped to 0.1–10 by `setZoom`), `snapEnabled`, `snapThreshold`, `activeTool`, `loopPlayback` — and their four setters. Twenty-one lines, no history, no `get` |

### Core Modules (`src/core/`)
- `storage.ts`: IndexedDB layer using `idb` library. Stores video blobs, thumbnails, projects, and settings in separate object stores
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
- `projectManager.ts`: Project save/load to JSON files with embedded video references
- `exportScheduler.ts`: Background export queue management
- `frameCache.ts`: LRU cache for decoded video frames
- `videoDecodeManager.ts`: Main thread API for WebCodecs video decoding via Web Worker
- `frameSource.ts`: Abstraction layer for frame sources (WebCodecs or HTMLVideoElement fallback)

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

```ts
{ type: 'EXPORT_COMPLETE', payload: { blob: Blob, format: 'mp4' | 'webm', name: string } }
// name is `${projectName || 'export'}.${format}`
```

**URL parameters**:

| Param | Effect |
|-------|--------|
| `?video=<url>` | Load a video from a URL (repeatable) |
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
- `getAnimatedValues(time, clipDuration, animation, transform, effects)`: Returns interpolated values for a given time — the one entry point, for both the preview and the exporters
- Keyframes are stored relative to clip start time (0 = clip start)
- There is **no memo cache**. There used to be one (`getAnimatedValuesCached`, keyed
  `clipId:time`, cleared at export start), but an export draws each clip time exactly once,
  so the key never came round and the cache answered nothing while costing a `toFixed`, a
  string concat and a `Map.set` per clip per frame; a preview cannot use a time-keyed cache
  at all, because it redraws the same clip at the same time after every edit. Deleted
  2026-09-12 — `exportMP4.perf.test.ts` pins the lookup count at frames x active clips.

### Keyframe Panel (`src/components/KeyframePanel/`)
- **KeyframePanel.tsx**: Main editor with property list, graph view, and keyframe timeline
- **ClipPreview.tsx**: Playback scrubber controls (uses main PreviewPlayer for rendering)
- **KeyframeGraph.tsx**: Visual keyframe editor with Bezier curve display
- **Per-keyframe easing**: select a keyframe in the graph and its easing `<select>` appears below it
  (`EASING_TYPES` from `src/utils/easingOptions.ts`, shared with the animate-in/out presets); new
  keyframes default to `ease-in-out` and a value drag preserves the stored easing
- When keyframe panel is open, manipulating overlays in the main preview creates keyframes instead of direct updates
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

### Preview (`src/components/Preview/`)
`PreviewPlayer.tsx` is wiring only — store subscriptions, the `<canvas>`, and a thin
`drawFrame` that consults the frame cache before delegating. Everything it used to do
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
| `useTransformHandles.ts` | The pointer state machine — drag/resize/rotate, marquee, double-click into the text editor — and the cursor it reports |

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
`drawPreviewFrame` opening every frame with `ctx.setTransform(k, 0, 0, k, 0, 0)`, where
`k = canvas.width / projectSize.width` is read back off the canvas' actual backing store (so
it can never disagree with a resize that hasn't been redrawn yet). The frame cache's
cached-frame path sets the same transform before blitting, so a bitmap captured at one box
size is simply rescaled if the window has changed size since — there is no cache
invalidation on resize, only a redraw at the new scale.

`ctx.filter` is the one thing the transform does not reach: a CSS filter's length (a blur
radius) is in output-bitmap pixels, unaffected by the CTM. Left alone, every blur in the
preview would render `k`× too wide at any raster smaller than the project. `MediaDrawOptions.filterScale`
(default `1`) converts a project-space blur radius into device pixels at every `ctx.filter` site on the preview's draw
call sites; every export passes nothing and gets `blur(Xpx)` byte-identical to before. Handles
stay sized in project pixels deliberately (no behaviour change) — their on-screen size is
unchanged today only because `project px × k` cancels back out to the same CSS pixels CSS
used to scale them to; making them a **constant screen size** regardless of project
resolution is a follow-up, not yet done (divide the handle size by `k` at the draw site and in
`hitTest`). `devicePixelRatio` is read at draw time, not subscribed to, so moving the window
to a different-DPI display re-rasterises only on the next resize or edit, not immediately.

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
on every write **except the first**: `skipHistoryForWrite()` returns `false` once per gesture
and `true` thereafter, and it is called inside the updater the throttler runs — not at the
mousemove that scheduled one — because a frame's moves coalesce into a single write and
"first" has to mean the first write that actually reaches the store. `handleMouseUp` only
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
| `TrackHeader.tsx` | One header row: volume and mute, the track name (double-click to rename, Enter commits, Escape discards — the only state in the directory that is not a gesture), the reorder arrows and the visibility/lock/delete controls. `React.memo`'d — its props are stable through a clip drag, a marquee and playback, so the whole column sits those out. **Not through a trim**: `useTrackHeaderActions`' `handleDeleteTrack` depends on `clips`, and a trim writes the store every move, so `onDeleteTrack` changes identity per frame and the column re-renders anyway |
| `ClipKeyframeDiamonds.tsx` | The keyframe markers along a clip: every animated property's times, deduplicated and placed |
| `AudioWaveform.tsx` | The canvas waveform inside a clip, capped at 4000 CSS px of backing store and CSS-scaled beyond it, because browsers refuse a canvas much wider |
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
| `useClipEditorActions.ts` | Every store read and write the panel makes — the selectors, the derived `sourceVideo`/`track`, the clip classification, and one handler per control. Adds no state and no subscription of its own; the hook calls are the ones that used to sit at the top of `ClipEditor.tsx`, in the same order and with the same dependency arrays (plus the stable `skipHistoryForWrite`, which changes no identity). **No `currentTime` selector** — see the note below |
| `useSliderGesture.ts` | Where one slider gesture starts and stops, and the `skipHistory` flag each write inside it gets — two refs and five listeners, no state. One instance serves the whole panel; see "One drag of a slider is one undo step" below |
| `clipEditorModel.ts` | The panel's pure derivations: `describeClip` (which kind of clip, and the header's label), `relativeTimeInClip`, `overlayPositionValue`, `maxPresetDuration`, `fitToCanvasScale`, `keyframeCount`. No store, no React |
| `clipColorValues.ts` | The colour and font-size maths the text and shape controls share: the font-size clamp, the text background's fixed `cc` alpha, a fill's rgb-with-carried-alpha rewrite, the no-fill toggle, and the fill alpha as a 0–100 percentage |
| `clipEditorOptions.ts` | The **five** `{ value, label }` option lists the dropdowns render — transitions, blend modes, clip mask kinds, animation presets, easings (the last re-exported from `utils/easingOptions.ts`) |
| `CollapsibleSection.tsx` | One titled, collapsible block: its own open/closed flag, seeded from `defaultOpen` at mount and never re-read |
| `ClipEditorEmptyState.tsx` | The panel's contents when nothing is selected: the prompt plus the five buttons that create an overlay from nothing. `ClipEditor.tsx` supplies the surrounding `div.container` |
| `ClipEditorHeader.tsx` | The title block — clip type, name, delete button, and the duration/position/track rows underneath |
| `TextContentSection.tsx` | "Text Content": the text, its font family and size, bold/italic/alignment, and the two colours. The textarea grows by writing `style.height` on the element, so no measured height lives in React state |
| `ShapeSection.tsx` | "Shape": the shape type, then either the blur region's amount slider or the fill/stroke controls, plus size, rotation and blur. "No fill" is an alpha of `00` on the fill colour, not a separate flag. All seven sliders carry the undo gesture |
| `TransformSection.tsx` | "Transform": position, then — media clips only — scale with its aspect-ratio lock, Fit to Canvas and Reset, and opacity last |
| `BlendModeSection.tsx` | "Blend Mode": one dropdown over `BLEND_MODES`, collapsed by default |
| `MaskSection.tsx` | "Mask & Stroke": the mask kind over `CLIP_MASK_KINDS`, a corner-radius slider shown for `rounded` only, and the stroke's width and colour — the width labelled in **pixels at the project's resolution**, because what is stored is a fraction of the frame width and a fraction is not a number anyone can act on. Collapsed by default. Media clips only, gated exactly as Blend Mode is. It normalises nothing: "`none` with a radius" and "a width of 0 with a colour" are things a user can express, and turning them into absent fields is `useClipEditorActions`' job |
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
`TransformSection`, `ShapeSection`, `EffectsSection`, `MaskSection`, `AnimationSection` and
`TransitionSection`; the handlers those sliders reach —
`handleTransformChange`, `handleBlurChange`, `handleMaskChange`, `handleStrokeChange`,
`handleAnimationInDurationChange`, `handleAnimationOutDurationChange`,
`handleTransitionDurationChange` and, for
an overlay's Pos X/Y, `handleTextDataChange` / `handleShapeDataChange` — ask
`skipHistoryForWrite()` at the moment they write. The selects beside those sliders (preset,
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
exactly as before.

**Every slider in the inspector and the trim drag on the timeline now follow the one-entry-per-gesture
rule** (ESCSUITE-77 finished what ESCSUITE-75 started). `Timeline/useTrimDrag.ts` is the one that
is not a slider: it writes the store on every mousemove, so it carries
`useTransformHandles`' shape instead of the hook's — a per-gesture `historyPushedRef` reset on
mousedown, the first write unskipped and the rest passing `true`. It throttles nothing, but the
flag is still asked for *inside* the `if (update)` rather than at the move, because
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
whenever the row changed. There is no `historyPushedRef` here, unlike `useTrimDrag`: with both
writes in one handler, "has the entry been pushed?" *is* "did the row change?", which the commit
already computes. A drop that only moved the clip in time, and one that only changed its row, are
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
`trackId`, since they haven't landed) and `moveSelectedClips` as one yes/no over the whole set.
`muteSelectedClips`/`unmuteSelectedClips`, `updateTrack` and `reorderTracks` stay untouched —
track properties, not clip contents — and `removeTrack` refuses, since deleting a locked track
deletes its clips. So does the project slice's `removeSourceVideo`, all-or-nothing: it removes
every clip that references the source, so if one of them is on a locked track the source and
every clip stay (`lockedSourceVideoIds` is the question). `shiftClipsAfter` is the one guard
that is *not* the all-or-nothing question, deliberately: the shift below it only moves clips
whose `trackId` matches, so an undefined `trackId` moves nothing and the guard asks
`isTrackLocked` about the one row.

Refusal is **silent** in the store, like every pointer veto. Four components read the lock to
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
per-item Remove button (`title="Used by a clip on a locked track"`) and Clear All
(`title="Media is used by a clip on a locked track"`). Clear All refuses in its handler as well
as being disabled, and it is the one refusal enforced at the UI rather than in the store:
`clearAllVideos()` deletes the blobs from IndexedDB *before* the per-source `removeSourceVideo`
calls, so a store refusal afterwards would leave a locked clip pointing at bytes that are gone.

The **preview**: `useTransformHandles`' `handleDoubleClick` asks `clipOnLockedTrack` before
opening the inline text editor — it already subscribes to both `clips` and `tracks`, so the
question costs nothing — because the editor would otherwise open and then lose every keystroke
to `updateTextOverlayData`'s refusal, silently.

The **track header** (`TrackHeader.tsx`): the delete button is `disabled`,
`title="Unlock the track to delete it"`. `useAppKeyboardShortcuts.ts` does the same on-demand
read before its five editing branches — Delete/Backspace on a multi-selection, Delete/Backspace
on a single clip, Ctrl+V, Ctrl+D and Ctrl+B — and toasts "Track is locked" instead of calling
the action and letting the store swallow it silently. The stated limit: the keyframe panel and
the toolbar's delete button raise no notice and rely on the store's refusal alone, showing
nothing for a no-op edit — a visible keyframe-panel state is a follow-up, not this ticket.

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
| `sessionSnapshot.ts` | `buildSessionSnapshot` — what of the editor's state the autosave writes, and in what shape. Takes the state and the timestamp as values rather than reading `getState()`/`Date.now()` itself, so the call site keeps control of *when* they are read |
| `useThemeLifecycle.ts` | Starting the shared theme module on mount and stopping it on unmount. The editor's **first** effect, so `App` calls it first |
| `useNotification.ts` | The transient status toast: one slot, not a queue. `showNotification` overwrites whatever is showing and opens a fresh three-second timer, which is deliberately neither stored nor cleared — carried behaviour, pinned by the App suite. Binds no effect; sits second because every hook after it takes `showNotification` |
| `useProjectActions.ts` | Project lifecycle: save to disk, open from disk with the "you have unsaved work" dialog in front of it, and start over. Owns `isSaving`, `isLoading`, `showProjectLoadDialog` and the pending file — and the editor's **only** project-load dialog: `handleProjectFile(file)` is the "given a project file" entry the uploader's drop/pick path calls, with `handleLoadProject` being that same entry behind the file picker (see "Dialogs"). Takes `clipCount` as a number, the dependency both callbacks carried inline. Binds no effect; sits third because the shortcut hook takes `handleSaveProject` and `handleLoadProject` |
| `useSessionRestore.ts` | The "Resume Previous Session?" lookup on startup and the two answers to it, and the `sessionRestored` flag the autosave gates on. The editor's **second** effect |
| `useSessionAutosave.ts` | The debounced session write. The editor's **third** effect, registered immediately after `useSessionRestore` for the reason above; re-arms on `currentTime` through a subscription inside the effect, never a selector |
| `useTimelineZoom.ts` | The two zoom steps, one factor of 1.25 each way. Binds no effect; sits sixth because the shortcut hook and the timeline footer call the same two handlers |
| `useAppKeyboardShortcuts.ts` | The global `keydown` listener: one ordered cascade of `if`s where the order *is* the semantics — `c`/`v`/`o` sit below their Ctrl chords so each bare letter only sees what fell through, and the Escape cascade runs shortcuts sheet → in/out points → multi-selection → single selection. Above all of it sits `modalOpen`, which stops the cascade dead while a dialog is up (see "Dialogs"). The editor's **fourth** effect. Its deps array is the inline one character for character plus `modalOpen`, `clips.length` included while the Ctrl+B branch reads `clips.find` — a known staleness, carried deliberately. **38 deps, measured and left verbatim** — see below. Its five editing branches — Delete/Backspace on a multi-selection, Delete/Backspace on a single clip, Ctrl+V, Ctrl+D and Ctrl+B — ask `store/trackLock.ts` about the lock on demand before calling the store and toast "Track is locked" instead when it would refuse (ESCSUITE-84) |
| `useTimelineHeight.ts` | The resize drag, the double-click reset and the persisted height. The editor's **fifth** effect; its `[isResizing, timelineHeight]` deps re-bind both document listeners on every clamped pixel of a drag, which is load-bearing — it is how `handleResizeEnd` closes over the final height. `src/hooks/useDocumentListener.ts` keeps its handler in a ref and would break exactly that, so it is not used here |
| `useHostIntegration.ts` | The inbound `postMessage` handler and the startup work the URL parameters ask for. The editor's **sixth and last** effect. Its deps are `[]` even though it closes over four values: the handler is installed once, `GET_STATE` works around the staleness with an explicit `getState()`, and the rest rely on those four being stable for the component's life |
| `takeImport.ts` | The storage half of the `?loadVideo=` handoff: resolve the take's parts, read each one's blob and thumbnail, add it to the library with a resolved duration, and return the parts to place (`ImportedTake`: `clipParts`, `thumbnailUrls`, `missingParts`). Lives beside the hook rather than inside it because the hook's effect is already the app's longest and these are the arms worth testing on their own |
| `AppHeader.tsx` | The top bar: the dashboard link (hidden in the standalone build, which this component asks about itself), the wordmark, the project-name field, and the File menu plus the quick Save and Export buttons |
| `FileMenu.tsx` | The header's File dropdown: the button, the click-outside backdrop, and the four items with their shortcut hints. Each item acts and then closes; what "acts" means belongs to the caller |
| `MediaLibrarySidebar.tsx` | The left sidebar: its header and collapse button, and — while open — the uploader, the resolution picker and the library listing. Two of its props are pure pass-throughs it has no behaviour of its own for — `onConfirmOpenChange` to `ResolutionPicker` and `onProjectFile` to `VideoUploader` — and both are **required** here, so a caller that forgets to wire either fails to compile (see "Dialogs" for both) |
| `InspectorSidebar.tsx` | The right sidebar: the inspector's header and collapse button, with `ClipEditor` underneath while it is open |
| `MobileInspectorToggle.tsx` | The floating inspector toggle shown at narrow widths, rendered inside `<main>` as a sibling of the inspector it controls |
| `TimelineResizeHandle.tsx` | The grab strip between the editor body and the timeline. It reports the two gestures and nothing else; the drag belongs to `useTimelineHeight` |
| `TimelinePane.tsx` | The bottom pane: add-track, zoom out, the zoom readout and zoom in, above `Timeline` itself. **Deliberately not memoised** — `App.rerender.test.tsx` counts `Timeline` renders, and a memo here would make that pass for the wrong reason and hide a future `currentTime` subscription |
| `NotificationToast.tsx` | The status toast in the corner. The `{notification && …}` guard stays in `App`, so it never renders an empty live region |
| `LoadingOverlay.tsx` | The modal spinner shown while a project loads. The `{isLoading && …}` guard likewise stays in `App` |
| `SessionRestorePrompt.tsx` | The "Resume Previous Session?" modal and its two buttons. The `{showSessionPrompt && pendingSession && …}` guard stays in `App`, so `session` is always present here — and so "closed" is "unmounted", which is why its `useDialogBehaviour` keeps the default `isOpen`. **Escape is swallowed** by a no-op: declining deletes the saved session, so a dismissal key must not reach it. See "Dialogs" |

### Analytics
- Vercel Analytics via `@vercel/analytics`, **in the hosted build only**. The standalone
  build ships no analytics runtime at all: `BUILD_MODE === 'saas'` gates both `trackEvent()`
  and the `<Analytics />` mount in `packages/shared`, and because `BUILD_MODE` folds to a
  literal at build time the bundler drops `@vercel/analytics` from the offline bundle
  rather than shipping it inert. See the root `CLAUDE.md`'s "Vercel Analytics"
- `<Analytics />` is mounted by `bootstrapApp()`, not by `src/main.tsx` directly
- Custom events in `src/utils/analytics.ts`:
  - `Video Imported` (with type: video/image/audio)
  - `Project Created`
  - `Project Saved`
  - `Overlay Added` (with type: text/shape/blur)
  - `Export Started` (with format)
  - `Export Completed` (with format and duration)

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
| `ExportDialog` | `handleCancel` | closes, aborting an export in flight exactly as the × and Cancel do |
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

### Export Performance Optimizations (`src/core/exporter.ts`)
The export pipeline includes several optimizations to improve performance:
- **Background tab export (MP4)**: Uses WebCodecs `VideoDecoder` in a Web Worker for frame decoding, enabling full-speed exports even when the browser tab is in the background. Web Workers are not subject to browser throttling that affects `setTimeout` and `video.play()` on the main thread.
- **FrameSource abstraction**: `frameSource.ts` provides a unified interface for frame fetching with automatic fallback:
  - `WebCodecsFrameSource`: Uses `VideoDecodeManager` for MP4 files (background-capable)
  - `HTMLVideoFrameSource`: Falls back to `<video>` element seeking for WebM or unsupported browsers
- **Frame tolerance**: `HTMLVideoFrameSource.getFrame()` skips the seek entirely when the request is already within one frame (1/30s) of the element's current time
- **Encoder backpressure**: Waits while `videoEncoder.encodeQueueSize > 20` to prevent memory exhaustion

### MP4 Export Reliability (`src/core/exporter.ts`)
MP4 export includes robust error handling and codec compatibility:
- **H.264 codec validation**: Uses `VideoEncoder.isConfigSupported()` to verify codec support before encoding
- **Codec fallback chain**: Tries profiles in order: High Profile (`avc1.640028`) → Main Profile (`avc1.4d0028`) → Baseline Profile (`avc1.42001f`)
- **Encoder error tracking**: Captures errors from encoder callbacks and propagates them instead of silent failures
- **Backpressure timeout**: 30-second timeout on encoder queue wait to detect stuck encoders
- **Quality-based audio bitrate**: Audio bitrate scales with quality setting (128k/192k/256k) instead of hardcoded value
- **Error checkpoints**: Validates encoder state at loop start, during backpressure, and before finalization

### Black Flash Prevention (`src/core/exporter.ts`)
To prevent black frames during export:
- **Seek timeout**: 500ms for reliable seeking
- **Frame readiness**: `waitForFrameReady()` ensures video.readyState >= 2 with event-based waiting
- **Post-seek verification**: Always waits for frame data after successful seek
- **Transition safety**: `drawTransition()` includes readyState verification

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

Waveform visualization adapts to clip selection state:
- **Default colors**: Purple (`rgba(138, 43, 226, 0.6)`) for audio, blue tint for video with audio
- **Selected state**: White (`rgba(255, 255, 255, 0.85)`) for high contrast against blue selection background
- **Custom color**: `color` prop overrides default/selected colors when provided
- **Extreme zoom handling**: Canvas width clamped to `MAX_CANVAS_WIDTH` (4000px) to prevent exceeding browser limits (~32,767px). CSS scales the canvas up for wider clips while maintaining visual quality.
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
  pipeline), `mediabunny.ts` (the muxer, recorded rather than run), `worker.ts` (the Web
  Worker constructor the export-support probe builds), `resizeObserver.ts`, `fileReader.ts`,
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
- `render()` runs the store's `convertLegacyOverlays` on the incoming timeline before anything
  reads it, so a `project.json` carrying the legacy `textOverlays`/`shapeOverlays` arrays
  renders and exports identically with or without the store. A project with neither array is
  untouched (the conversion returns the same `Timeline` object).
- `vite.config.ts` headless plugins emit workers as classic scripts and inline them
  as blob URLs, because `file://` pages cannot load module or file workers.
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
  rewrite, or if any `.js` file is left behind in `dist-headless/`. That turns a future
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
