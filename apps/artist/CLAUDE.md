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
- **Zustand store** (`src/store/projectStore.ts`): Single source of truth for all editor state
- Core types defined in `src/store/types.ts`: `Project`, `Timeline`, `Clip`, `SourceVideo`, `EditorState`, `Track`
- Timeline is a flat array of `Clip` objects; each clip references a `sourceVideoId` and defines `startTime`/`endTime` within that source
- **Track properties**: `id`, `name`, `index`, `visible`, `locked`, `muted`, `volume` (0-1), `height`
- **Auto-track creation**: When adding clips/overlays without specifying a track, a new track is created automatically

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

### Keyframe Animation System (`src/utils/animation.ts`)
Clips support animated properties via keyframes:
- **Animatable properties**: `x`, `y`, `scaleX`, `scaleY`, `rotation`, `opacity`, `blur`
- **Easing types**: `linear`, `ease-in`, `ease-out`, `ease-in-out`, plus quadratic/cubic variants
- **Preset animations**: Clips can have in/out presets (`fade`, `slide-*`, `scale-*`, `pop`, `blur`)
- **Custom keyframes**: Per-property keyframe arrays override presets when present
- `getAnimatedValues(time, clipDuration, animation, transform, effects)`: Returns interpolated values for a given time
- `getAnimatedValuesCached(cacheKey, ...)`: Cached version for export performance (keyed by clipId:time)
- `clearAnimationCache()`: Clears animation cache (called at export start)
- Keyframes are stored relative to clip start time (0 = clip start)
- **Animation cache**: Cache (10,000 entries max) prevents redundant keyframe interpolation during exports

### Keyframe Panel (`src/components/KeyframePanel/`)
- **KeyframePanel.tsx**: Main editor with property list, graph view, and keyframe timeline
- **ClipPreview.tsx**: Playback scrubber controls (uses main PreviewPlayer for rendering)
- **KeyframeGraph.tsx**: Visual keyframe editor with Bezier curve display
- When keyframe panel is open, manipulating overlays in the main preview creates keyframes instead of direct updates

### Preview (`src/components/Preview/`)
`PreviewPlayer.tsx` is wiring only — store subscriptions, the `<canvas>`, and a thin
`drawFrame` that consults the frame cache before delegating. Everything it used to do
inline lives in one module each, all of them pure or hook-shaped; the pure modules and hooks have their own test files, while `drawFrame.ts`, `PlaybackControls.tsx` and `cursor.ts` are covered through the component tests:

| Module | Owns |
|--------|------|
| `drawFrame.ts` | Compositing one frame: track order, transitions, overlays, the legacy overlay arrays, and the blur scratch canvas |
| `previewGeometry.ts` | Where a clip is on the canvas (`getOverlayBounds`), which clips can be manipulated, the one object-fit: contain mapping between the canvas' pixels and its element's (`contentBox`, `getCanvasPosition`), and the inverse rotation every box test shares (`toLocalPoint`) |
| `hitTest.ts` | What is under the pointer: which clip, which handle, which drag it would start. One cascade (`hitHandlesOnClip`) serves both passes — keyframe mode asks it for the selected clip alone, body included; outside it the same cascade runs handles-only before the z-order body pass |
| `selectionOverlay.ts` | Drawing the selection chrome — bounding box, the eight resize handles, the rotation handle, multi-select boxes |
| `dragGeometry.ts` | The maths of a drag in progress: start measurements, resize/rotate deltas, marquee intersection, text hit for the double-click |
| `transitions.ts` | Which transition, if any, is active at a given time |
| `cursor.ts` | The CSS cursor a drag mode advertises |
| `types.ts` | The shapes the above share (`DragMode`, `OverlayBounds`, `HandleHit`, `PreviewSceneContext`). **Types only** — it is excluded from coverage, so a single runtime value in it would go unmeasured |
| `InlineTextEditorAnchor.tsx` | Positioning `InlineTextEditor` over the text it edits, through the canvas' object-fit mapping |
| `PlaybackControls.tsx` | The transport buttons and their keyboard shortcuts; no canvas at all |

Hooks:

| Hook | Owns |
|------|------|
| `usePreviewMedia.ts` | One object URL and one `<video>`/`<img>`/`<audio>` per source, reconciled as the timeline changes and released on unmount |
| `usePreviewRenderLoop.ts` | When the canvas repaints: the rAF playback loop, seek-driven redraws, the debounced redraw after a media change |
| `useTransformHandles.ts` | The pointer state machine — drag/resize/rotate, marquee, double-click into the text editor — and the cursor it reports |

**The preview draws through `core/canvasRenderer.ts`**, the same renderer an export
uses, with `PREVIEW_DRAW_OPTIONS` (in `drawFrame.ts`) for the two differences:
`uncachedAnimation` (the export's animation memo would serve pre-edit values to an
editor that redraws the same clip at the same time) and `quiet` (not-yet-decoded media
is ordinary mid-scrub, and this frame redraws sixty times a second). Never fork a drawing
function for the preview — if the two need to differ, that is another draw option.
`MediaDrawOptions` also carries `resetFilter`, which the preview used to pass: it made a
clip with no blur of its own assign `filter = 'none'`, which cancelled the blur a dissolve
had just set on the context, so the preview's dissolve never blurred while an export's
did. Nothing passes it now.

Interactive overlay manipulation in the preview canvas:
- **Drag**: Move overlay position (updates `x`, `y`)
- **Resize handles**: 8 handles (corners + sides) for scaling (`scaleX`, `scaleY`)
- **Rotation handle**: Circular handle above overlay for rotation
- **Keyframe mode**: When keyframe panel is open, transforms create keyframes at current playhead time
- Selection handles follow animated values during playback

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
- **Animation caching**: Uses `getAnimatedValuesCached()` to avoid recomputing keyframe interpolations
- **Cache lifecycle**: `clearAnimationCache()` is called at export start
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

### Responsive Inspector (`src/App.tsx`, `src/App.module.css`)
The inspector panel (ClipEditor) adapts to different screen sizes:
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
  mounted is a React update. `animation.ts` and `exportPipeline.ts` hold the clip/transform
  and export-pipeline shapes their suites share.
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
- `vite.config.ts` headless plugins emit workers as classic scripts and inline them
  as blob URLs, because `file://` pages cannot load module or file workers.
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
