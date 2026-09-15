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
- **Track properties**: `id`, `name`, `index`, `visible`, `locked`, `muted`, `volume` (0-1), `height`
- **Auto-track creation**: When adding clips/overlays without specifying a track, a new track is created automatically
- **Snapping helpers** (`src/store/timelineSnapping.ts`): `getSnapPoints`, `findNearestSnapPoint` and `wouldOverlap` — pure functions over the clips they are handed, with no store access, so `components/Timeline/timelineGeometry.ts` and `useClipDrag.ts` can import them without pulling the store module into their graph. `projectStore.ts` re-exports all three, so the paths that always reached them through the store still work

**Pure helpers** — no zustand, no React, no store access:

| Module | Owns |
|--------|------|
| `storeHistory.ts` | The undo mechanism: `getUndoableState` (what one snapshot holds), `pushToHistory` (push it and drop the redo stack) and the module-private `MAX_HISTORY_SIZE` of 50 that caps the past. The single definition of an undo step — every mutating action in every slice goes through it |
| `projectFactory.ts` | The empty shapes and the duration sum: `createDefaultTrack`, `createTrackAtTop`, `findEmptyTrack`, `createEmptyTimeline`, `createEmptyProject`, `calculateTimelineDuration`, and `DEFAULT_PROJECT_NAME`, which `projectStore.ts` re-exports so the old import path still resolves |
| `sourceVideoEquality.ts` | `sameSourceVideo` (and the `sameWaveform` it needs) — the field-by-field comparison that lets `addSourceVideo` treat a re-add of identical metadata as no change at all, rather than as an undo step that restores an identical library |
| `projectMigration.ts` | `ensureTimelineHasTracks` — normalising a loaded project onto the current timeline shape: missing resolution, missing tracks, missing overlay arrays, clips without a `trackId`, and the `convertLegacyOverlays` call on **both** return paths. Runs on every `setProject` |
| `clipQueries.ts` | `getClipsAtTime`, `getClipAtTime`, `getClipPosition` — reads over a clips array they are handed, never over the store. Re-exported by `projectStore.ts` |

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
- `videoProcessor.ts`: Video metadata extraction and thumbnail generation using native `<video>` element and canvas
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
| `?loadVideo=<id>` | Load a recording from IndexedDB (ESCAPECRAFT handoff) |
| `?suppressRestore=1` | Skip the "Resume Previous Session?" prompt. Accepts `1` or `true`. ESCAPEARTIST **neither offers nor writes** the saved session under this flag — the session autosave is switched off too, so a host-driven session leaves storage exactly as it found it |
| `?title=<name>` | Initial project name. Trimmed, capped at 120 chars, trimmed again after the cut, blank ignored. Applied only while the project name is still the default `'Untitled Project'`, so it never overrides a name from `?project=` data or a restored session. `clearHistory()` runs right after, so the host naming the project is not an undo step |
| `?hostOrigin=<origin>` | The host's own origin, e.g. `https://host.example`. **Recommended for production hosts.** Must be a bare origin (a URL whose serialisation equals its own origin); anything else is ignored with one console warning. Outbound posts go to it instead of `'*'`, and inbound messages from any other origin are dropped. It protects the **host's** deployment, *not* against being framed — a hostile page that frames the app also controls this URL and would just supply its own origin. Refusing to be framed is `Content-Security-Policy: frame-ancestors` on the deployment serving the app  The hosted deployment sends `frame-ancestors 'self'` (see `vercel.json`); self-hosted builds must set their own. |

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

  **Known limitation**: `ExportDialog` listens on `document` in the capture phase, which runs
  *before* the graph's handler and so can't be shielded by its `stopPropagation()`. This is moot
  in practice — the graph can't hold focus while that dialog is open.

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
| `PlaybackControls.tsx` | The transport buttons and their keyboard shortcuts; no canvas at all |
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
| `TimelineTrack.tsx` | One track row: its clips (only the ones the virtualiser passed), the drag preview, the trim's live sizing, and each clip's label, waveform and keyframe diamonds. `React.memo`'d, which holds for a marquee or a scrub but not for a clip drag — `dragState` is one of its props |
| `TrackHeader.tsx` | One header row: volume and mute, the track name (double-click to rename, Enter commits, Escape discards — the only state in the directory that is not a gesture), the reorder arrows and the visibility/lock/delete controls. `React.memo`'d — its props are stable through a clip drag, a marquee and playback, so the whole column sits those out. **Not through a trim**: `useTrackHeaderActions`' `handleDeleteTrack` depends on `clips`, and a trim writes the store every move, so `onDeleteTrack` changes identity per frame and the column re-renders anyway |
| `ClipKeyframeDiamonds.tsx` | The keyframe markers along a clip: every animated property's times, deduplicated and placed |
| `AudioWaveform.tsx` | The canvas waveform inside a clip, capped at 4000 CSS px of backing store and CSS-scaled beyond it, because browsers refuse a canvas much wider |
| `useScrollSync.ts` | Keeping the ruler, the headers and the track container pointed at the same place, and the `ResizeObserver` that tells the virtualiser how wide the container is |
| `useTrackAreaCache.ts` | One gesture's worth of track-area geometry: the container's client origin and each `[data-track-id]` row's box in the container's own **layout space**, taken on mousedown so a move reads only `scrollLeft`/`scrollTop`. Dropped and re-taken on `scroll` (captured — scroll does not bubble) and on window `resize`, the two things that move the box under a live gesture. Invalidation is **event-based**, so a layout change that fires neither — an autosave or an undo changing a row's height mid-drag — would leave it stale where the old per-frame measurement absorbed it; unreachable through the UI today (a clip drag writes nothing until release, and no control resizes a track while a pointer is down), and if row heights ever become dynamic the hook to reach for is the `ResizeObserver` `useScrollSync` already installs on this container, not a third listener |
| `usePlayheadDrag.ts` | The playhead scrub: `isDraggingPlayhead` (which the marquee and the track click both read) and the document listeners that write `currentTime` |
| `useInOutDrag.ts` | The in and out marker drags — one pair of listeners for both handles, asking which flag is up to decide which point it writes |
| `useClipDrag.ts` | Dragging a clip, and the three other readings of the same mousedown (razor split, ctrl/cmd toggle, locked-track refusal). `dragState` is the preview; the store is written once, on release — which is why the snap points and the track rows are both taken once, on the mousedown, and never re-taken per frame |
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
| `useClipEditorActions.ts` | Every store read and write the panel makes — the selectors, the derived `sourceVideo`/`track`, the clip classification, and one handler per control. Adds no state and no subscription of its own; the hook calls are the ones that used to sit at the top of `ClipEditor.tsx`, in the same order and with the same dependency arrays. **No `currentTime` selector** — see the note below |
| `clipEditorModel.ts` | The panel's pure derivations: `describeClip` (which kind of clip, and the header's label), `relativeTimeInClip`, `overlayPositionValue`, `maxPresetDuration`, `fitToCanvasScale`, `keyframeCount`. No store, no React |
| `clipColorValues.ts` | The colour and font-size maths the text and shape controls share: the font-size clamp, the text background's fixed `cc` alpha, a fill's rgb-with-carried-alpha rewrite, the no-fill toggle, and the fill alpha as a 0–100 percentage |
| `clipEditorOptions.ts` | The four `{ value, label }` option lists the dropdowns render — transitions, blend modes, animation presets, easings |
| `CollapsibleSection.tsx` | One titled, collapsible block: its own open/closed flag, seeded from `defaultOpen` at mount and never re-read |
| `ClipEditorEmptyState.tsx` | The panel's contents when nothing is selected: the prompt plus the five buttons that create an overlay from nothing. `ClipEditor.tsx` supplies the surrounding `div.container` |
| `ClipEditorHeader.tsx` | The title block — clip type, name, delete button, and the duration/position/track rows underneath |
| `TextContentSection.tsx` | "Text Content": the text, its font family and size, bold/italic/alignment, and the two colours. The textarea grows by writing `style.height` on the element, so no measured height lives in React state |
| `ShapeSection.tsx` | "Shape": the shape type, then either the blur region's amount slider or the fill/stroke controls, plus size, rotation and blur. "No fill" is an alpha of `00` on the fill colour, not a separate flag |
| `TransformSection.tsx` | "Transform": position, then — media clips only — scale with its aspect-ratio lock, Fit to Canvas and Reset, and opacity last |
| `BlendModeSection.tsx` | "Blend Mode": one dropdown over `BLEND_MODES`, collapsed by default |
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

**The keyboard cascade's 37 deps re-bind the listener, and that is fine — measured, not
assumed.** Every change to one of the 37 values `useAppKeyboardShortcuts` closes over tears the
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
`App.project.test.tsx` (new/open/save and the load-safety dialog), `App.session.test.tsx`
(restore prompt and autosave), `App.shortcuts.test.tsx` (the keydown cascade),
`App.messages.test.tsx` (the host integration surface) and `App.rerender.test.tsx` (the
`currentTime` contract above). `src/App.module.css` is deliberately not split: all ten
components import it from `../App.module.css`, and `App.project.test.tsx` imports it directly
and queries `styles.menuBackdrop`.

| Module | Owns |
|--------|------|
| `appConstants.ts` | The shell's plain numbers: the autosave debounce delay, the timeline panel's min/max/default height and the localStorage key it is persisted under. No behaviour, so `timelineHeight.ts`, the hooks and `App` read the same values instead of each spelling them out |
| `timelineHeight.ts` | The timeline panel's height maths: `clampTimelineHeight` (which propagates `NaN` rather than clamping it), the localStorage read/write pair, and `heightFromPointer`, the resize drag's pointer-to-height conversion. Pure but for the two storage calls, so the maths is testable without a DOM |
| `appFormat.ts` | The two notification strings: `formatTimeForNotification` (a one-line pass-through to `formatTime`, kept because three call sites read better for it) and `clipCountMessage`, which spells the pluralisation rule once |
| `sessionSnapshot.ts` | `buildSessionSnapshot` — what of the editor's state the autosave writes, and in what shape. Takes the state and the timestamp as values rather than reading `getState()`/`Date.now()` itself, so the call site keeps control of *when* they are read |
| `useThemeLifecycle.ts` | Starting the shared theme module on mount and stopping it on unmount. The editor's **first** effect, so `App` calls it first |
| `useNotification.ts` | The transient status toast: one slot, not a queue. `showNotification` overwrites whatever is showing and opens a fresh three-second timer, which is deliberately neither stored nor cleared — carried behaviour, pinned by the App suite. Binds no effect; sits second because every hook after it takes `showNotification` |
| `useProjectActions.ts` | Project lifecycle: save to disk, open from disk with the "you have unsaved work" dialog in front of it, and start over. Owns `isSaving`, `isLoading`, `showProjectLoadDialog` and the pending file. Takes `clipCount` as a number, the dependency both callbacks carried inline. Binds no effect; sits third because the shortcut hook takes `handleSaveProject` and `handleLoadProject` |
| `useSessionRestore.ts` | The "Resume Previous Session?" lookup on startup and the two answers to it, and the `sessionRestored` flag the autosave gates on. The editor's **second** effect |
| `useSessionAutosave.ts` | The debounced session write. The editor's **third** effect, registered immediately after `useSessionRestore` for the reason above; re-arms on `currentTime` through a subscription inside the effect, never a selector |
| `useTimelineZoom.ts` | The two zoom steps, one factor of 1.25 each way. Binds no effect; sits sixth because the shortcut hook and the timeline footer call the same two handlers |
| `useAppKeyboardShortcuts.ts` | The global `keydown` listener: one ordered cascade of `if`s where the order *is* the semantics — `c`/`v`/`o` sit below their Ctrl chords so each bare letter only sees what fell through, and the Escape cascade runs shortcuts sheet → in/out points → multi-selection → single selection. The editor's **fourth** effect. Its deps array is the inline one character for character, `clips.length` included while the Ctrl+B branch reads `clips.find` — a known staleness, carried deliberately. **37 deps, measured and left verbatim** — see below |
| `useTimelineHeight.ts` | The resize drag, the double-click reset and the persisted height. The editor's **fifth** effect; its `[isResizing, timelineHeight]` deps re-bind both document listeners on every clamped pixel of a drag, which is load-bearing — it is how `handleResizeEnd` closes over the final height. `src/hooks/useDocumentListener.ts` keeps its handler in a ref and would break exactly that, so it is not used here |
| `useHostIntegration.ts` | The inbound `postMessage` handler and the startup work the URL parameters ask for. The editor's **sixth and last** effect. Its deps are `[]` even though it closes over four values: the handler is installed once, `GET_STATE` works around the staleness with an explicit `getState()`, and the rest rely on those four being stable for the component's life |
| `AppHeader.tsx` | The top bar: the dashboard link (hidden in the standalone build, which this component asks about itself), the wordmark, the project-name field, and the File menu plus the quick Save and Export buttons |
| `FileMenu.tsx` | The header's File dropdown: the button, the click-outside backdrop, and the four items with their shortcut hints. Each item acts and then closes; what "acts" means belongs to the caller |
| `MediaLibrarySidebar.tsx` | The left sidebar: its header and collapse button, and — while open — the uploader, the resolution picker and the library listing |
| `InspectorSidebar.tsx` | The right sidebar: the inspector's header and collapse button, with `ClipEditor` underneath while it is open |
| `MobileInspectorToggle.tsx` | The floating inspector toggle shown at narrow widths, rendered inside `<main>` as a sibling of the inspector it controls |
| `TimelineResizeHandle.tsx` | The grab strip between the editor body and the timeline. It reports the two gestures and nothing else; the drag belongs to `useTimelineHeight` |
| `TimelinePane.tsx` | The bottom pane: add-track, zoom out, the zoom readout and zoom in, above `Timeline` itself. **Deliberately not memoised** — `App.rerender.test.tsx` counts `Timeline` renders, and a memo here would make that pass for the wrong reason and hide a future `currentTime` subscription |
| `NotificationToast.tsx` | The status toast in the corner. The `{notification && …}` guard stays in `App`, so it never renders an empty live region |
| `LoadingOverlay.tsx` | The modal spinner shown while a project loads. The `{isLoading && …}` guard likewise stays in `App` |
| `SessionRestorePrompt.tsx` | The "Resume Previous Session?" modal and its two buttons. The `{showSessionPrompt && pendingSession && …}` guard stays in `App`, so `session` is always present here |

### Analytics
- Vercel Analytics via `@vercel/analytics`
- Custom events in `src/utils/analytics.ts`:
  - `Video Imported` (with type: video/image/audio)
  - `Project Created`
  - `Project Saved`
  - `Overlay Added` (with type: text/shape/blur)
  - `Export Started` (with format)
  - `Export Completed` (with format and duration)

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
Waveform visualization adapts to clip selection state:
- **Default colors**: Purple (`rgba(138, 43, 226, 0.6)`) for audio, blue tint for video with audio
- **Selected state**: White (`rgba(255, 255, 255, 0.85)`) for high contrast against blue selection background
- **Custom color**: `color` prop overrides default/selected colors when provided
- **Extreme zoom handling**: Canvas width clamped to `MAX_CANVAS_WIDTH` (4000px) to prevent exceeding browser limits (~32,767px). CSS scales the canvas up for wider clips while maintaining visual quality.

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
