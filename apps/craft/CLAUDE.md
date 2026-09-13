# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ESCAPECRAFT is a client-side video recorder built with React 19, TypeScript, and Vite. It records screen, webcam, and audio directly in the browser with no server required. Part of the ESCAPE Suite alongside ESCAPEARTIST (video editor).

**Monorepo Location**: `apps/craft` in the ESCAPESUITE monorepo.

## Build Commands

Run from monorepo root using pnpm:

```bash
pnpm dev:craft           # Start development server (localhost:5174)
pnpm build:craft         # Production build
pnpm test --filter=@escapesuite/craft    # Run tests
pnpm lint                # Lint all apps including craft
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

### App (`src/App.tsx`)
`App.tsx` is wiring only — the single `useRecorderStore()` destructure, the two refs the take
and the save share, the `showHelpModal` flag, the `isRecordingActive` derivation and
`toggleSource`, one call per hook below, and the JSX that composes the components. It registers
no effect of its own and binds no listener.

The hooks are called in a fixed order — theme, capability bootstrap, media streams, recording
save, recording controller, keyboard shortcuts, recording library — because that order is the
order the effects ran in when they were all inline, and for the ones that bind something it is
behaviour rather than tidiness: `useMediaStreams` registers the preview attach and then the
`stopAllStreams` mirror, and `useRecordingController`'s unmount teardown — registered after
both, and itself order-dependent (cancelled flag → duration interval → countdown interval →
`recorder.dispose()` → `stopAllStreams()` → store reset) — reaches the live `stopAllStreams`
through that mirror rather than through a stale closure. `useKeyboardShortcuts` binds the one
window listener `App` itself owns, and `useRecordingLibrary` binds nothing and comes last.

`recorderTypeRef` and `capturedThumbnailRef` are created in `App` and handed to two hooks by
reference: `useRecordingController` writes them while a take runs, `useRecordingSave` reads
them when the recorder's `onStop` fires. Every ref in the screen is created in exactly one
place — a second `useRef()` in either hook would leave the save reading a recorder type and a
thumbnail nobody wrote. The same rule puts `compositorRef`, `micStreamRef`, `previewRef` and
`canvasPreviewRef` in `useMediaStreams`, and the recorder, cancelled-flag and interval refs in
`useRecordingController`, each passed on to whoever else reads it.

Every module below has its own test file; `App.tsx` itself is covered through
`App.recording.test.tsx`, `App.saving.test.tsx`, `App.library.test.tsx` and
`App.settings.test.tsx`, which drive the rendered app.

| Module | Owns |
|--------|------|
| `App.tsx` | The composition: the store destructure, `recorderTypeRef` / `capturedThumbnailRef`, `showHelpModal`, `isRecordingActive`, `toggleSource`, the hook calls in their fixed order, and the header/sidebar/content/dialog JSX |
| `utils/recordingFormat.ts` | `formatDuration` (`MM:SS`, floor-truncated) and `safeFileName` — pure string formatting shared by the duration labels, the library rows and the download handler |
| `utils/previewThumbnail.ts` | Capturing a thumbnail frame from the live preview (compositor canvas or `<video>`) and drawing the placeholder used when every other capture path fails. Canvas creation and `toBlob` are its only side effects |
| `utils/recordingMetadata.ts` | The two records a finished take writes — the shared `SourceVideo` stored beside the blob and the recorder's own `Recording` list entry — built from values the caller already computed. No store, and no blob-URL creation |
| `components/icons.tsx` | The inline SVG icon set, every path drawn in `currentColor`. The source icons take a `className` because their size is per call site; the action icons are `aria-hidden` and sized entirely by their button |
| `components/AppHeader/AppHeader.tsx` | The app bar: the suite link (hidden in the standalone build), the wordmark, the `aria-live` status region and the two header buttons. It resolves `isStandaloneMode()` and `editorUrl()` itself, because both are deployment facts rather than App state |
| `components/SourceToggles/SourceToggles.tsx` | The Sources panel: one row per capture source — written out four times rather than mapped, since each has its own icon, capability slice and config flag — plus the audio meters shown while an audio source is recording. Also exports the `RecordingSource` union |
| `components/WebcamOverlaySettings/WebcamOverlaySettings.tsx` | The PiP overlay's position, size and shape, every control reporting a config patch. It draws unconditionally; whether the panel exists at all is the caller's decision |
| `components/RecordingsList/RecordingsList.tsx` | The library panel: each saved take's thumbnail, name, formatted duration and size, and its four action buttons, each labelled with the recording's own name. It touches no storage — it hands ids and names back up |
| `components/RecordingPreview/RecordingPreview.tsx` | The preview stage: the compositor's canvas, a mirrored stream, or the idle placeholder — checked in that order so PiP wins during a composite take — with the countdown laid over the top. It only places the App's two DOM refs |
| `components/RecorderControls/RecorderControls.tsx` | The transport bar and the shortcut legend: which controls exist in each state, and the record button's three-way `onClick` ladder (start when idle, stop while active, nothing at all in `preparing` and `saving`) |
| `components/PlaybackDialog/PlaybackDialog.tsx` | The modal that plays one saved recording back — the frame around `VideoPlayer`, the backdrop-dismiss behaviour, and the saved `duration` the player is told rather than asked for |
| `components/HelpDialog/HelpDialog.tsx` | The Recording Tips modal: static copy in four sections, the same backdrop-dismiss behaviour, named through `aria-labelledby` |
| `hooks/useThemeLifecycle.ts` | One effect: `initTheme` on mount, `cleanupTheme` on unmount. Called first because it was the first effect in the file |
| `hooks/useCapabilityBootstrap.ts` | The way in: capability detection and the initial `loadRecordings()`, both in one effect as they were inline — splitting them would change the order the store is written on mount |
| `hooks/useMediaStreams.ts` | Everything capture is held in and released through: the preview stream, the PiP compositor, the microphone stream the store does not hold, the two preview DOM handles, `acquireStreams`, `stopAllStreams` and the ref that mirrors it. Registers the preview attach and then the mirror |
| `hooks/useRecordingSave.ts` | Turning a finished take into a stored recording: the WebM container repair, metadata extraction, the thumbnail fallback chain, both storage writes, and the new entry at the top of the list. Reads the recorder type and the captured thumbnail through refs, because `onStop` fires from callbacks captured a render earlier |
| `hooks/useRecordingController.ts` | The take itself: countdown, start, pause, resume, stop, cancel, the two interval tickers, and the ordered unmount teardown. Creates the recorder, cancelled-flag and interval refs, and holds the recorder's six callbacks — captured once, at `createRecorder` time, so a late `onStop` releases the capture *that* take was using |
| `hooks/useKeyboardShortcuts.ts` | The window-level R / P / S / Escape shortcuts, each gated on `state`. Its dependency array is copied verbatim rather than trimmed, so the listener re-binds whenever any handler changes identity — including on every `config` change |
| `hooks/useRecordingLibrary.ts` | The recordings already in storage: play, download, send to editor, delete, and the playback dialog's URL, name and duration. The five handlers stay plain functions recreated on every render, as they were inline — memoising them would change how often the sidebar and the dialog re-render. Binds no effect |

### State Management
- **Zustand store** (`src/store/recorderStore.ts`): Single source of truth for recorder state
- Core types defined in `src/store/types.ts`: `RecordingState`, `RecordingConfig`, `Recording`, `EnvironmentCapabilities`, `DetailedCapabilities`, `CapabilityInfo`
- Recordings stored in shared IndexedDB with ESCAPEARTIST

### Core Modules (`src/core/`)
- `storage.ts`: Shared IndexedDB layer (same database as ESCAPEARTIST: `video-editor-db`)
- `recorder.ts`: MediaRecorder wrapper with audio mixing and level monitoring
- `permissions.ts`: Environment capability detection with detailed unavailability reasons
- `compositor.ts`: Canvas-based PiP compositing for webcam overlay on screen
- `thumbnailGenerator.ts`: Thumbnail generation and video metadata extraction. Its size, type
  and quality constants are **imported from `utils/previewThumbnail.ts`**, not declared here:
  five suites (`App.settings`, `App.saving`, `App.recording`, `App.library`,
  `hooks/useRecordingSave`) `vi.mock('./core/thumbnailGenerator')` wholesale, so a constant
  declared in this module would vanish under the mock. `utils/previewThumbnail.ts` is never
  mocked, which is what makes it the single definition — keep it that way
- `converter.ts`: Video format conversion using WebCodecs + Mediabunny

### VideoPlayer Component (`src/components/VideoPlayer/`)
Reusable video player with full playback controls:
- **Play/Pause**: Toggle playback with button or spacebar
- **Seeking**: Click progress bar or use arrow keys (±5s), with Shift for ±10s
- **Volume**: Adjustable with mute toggle (M key)
- **Fullscreen**: Toggle with F key or button
- **Loop detection**: Automatically resets to beginning when video ends
- **Keyboard shortcuts**: Space (play/pause), M (mute), F (fullscreen), arrows (seek)

### Capability Detection (`src/core/permissions.ts`)
Enhanced capability detection with detailed unavailability reasons:
- **CapabilityUnavailableReason**: `'api_not_supported'`, `'permission_denied'`, `'permission_dismissed'`, `'no_device'`, `'not_secure_context'`, `'browser_not_supported'`, `'policy_blocked'`
- **DetailedCapabilities**: Returns both boolean availability and reason/message for each capability
- **UI Integration**: Unavailable options are greyed out with explanatory tooltips
- Checks Permissions API where available for pre-emptive status detection

### Recording Modes
- **Screen Only**: Display capture without audio
- **Screen + Mic**: Display with microphone audio
- **Screen + System**: Display with system audio (where supported)
- **Screen + Both**: Display with mic and system audio
- **Webcam Only**: Camera with microphone
- **Picture-in-Picture**: Screen with webcam overlay (adjustable position, size, shape)

Which sources are captured is `src/hooks/useMediaStreams.ts`; what is done with them — countdown,
start, pause, resume, stop, cancel and teardown — is `src/hooks/useRecordingController.ts`.

### Integration with ESCAPEARTIST
- Both apps share `video-editor-db` IndexedDB database
- Recordings stored with `source: 'recording'` and `recordedAt` timestamp
- "Send to Editor" opens ESCAPEARTIST with `?loadVideo=<id>` parameter
- Same-origin deployment (Vercel) enables seamless data sharing

### Embedding
When CRAFT runs in an iframe (`isEmbedded()` from `@escapesuite/shared/config`),
"Send to Editor" does not open `/artist/` itself — it posts `SEND_TO_EDITOR
{ id }` to the parent window instead, and the host is expected to navigate to
its own editor URL with `?loadVideo=<id>`. Because CRAFT and the host-chosen
editor are same-origin, the shared IndexedDB `video-editor-db` makes the
recorded blob available there without re-uploading it. Outside an iframe,
`VITE_EDITOR_URL` controls where CRAFT opens the editor (defaults to
`/artist/`). See `src/utils/sendToEditor.ts`. Both editor links — "Send to
Editor" and the header's "Open Editor" button — honour `VITE_EDITOR_URL` via
the shared `editorUrl()` helper.

The header's **"Open Editor" button is deliberately not routed through the
host**: embedded or not, it opens the editor itself. Only "Send to Editor",
which hands over one specific recording, becomes a message.

**`?hostOrigin=<origin>`**: when the host names its own origin on CRAFT's URL,
the `SEND_TO_EDITOR` post is addressed to that origin instead of `'*'`. The
value must be a bare origin (`https://host.example`); anything else is ignored
with one console warning and the post falls back to `'*'`. The parser is
`parseHostOrigin()` in `@escapesuite/shared/config`, shared with ESCAPEARTIST.
It protects the **host's** deployment, not against being framed — a hostile
page that frames CRAFT also controls this URL. Refusing to be framed is
`Content-Security-Policy: frame-ancestors` on the deployment serving CRAFT. The hosted deployment (escapesuite.io) sends `frame-ancestors 'self'` plus `X-Frame-Options: SAMEORIGIN` from `vercel.json`, so it cannot be framed by other origins; a self-hosted or standalone build must set its own.

**Behaviour change for existing embedders**: CRAFT in *any* iframe now posts
`SEND_TO_EDITOR` rather than opening a tab. A host that previously relied on
the `window.open()` popup — including one that embedded CRAFT incidentally,
without meaning to integrate — will see no new tab and must listen for the
message and navigate to its own editor itself.

### Build Configuration
- `vite-plugin-singlefile`: Builds entire app into a single HTML file (all assets inlined)
- Target: ESNext, no code splitting
- `build:standalone` produces an offline single-file build for air-gapped use

### Download Formats
Three download options with different speed/compatibility trade-offs:
- **WebM (Instant)**: Fast metadata fix using `webm-duration-fix`, works in browsers/VLC
- **WebM (Compatible)**: Re-encoded with WebCodecs + Mediabunny for Windows Media Player
- **MP4 (Universal)**: H.264 + AAC conversion for maximum compatibility

### Export Features
- **Cancellation**: All exports can be cancelled mid-conversion via AbortController
- **Background Tab Support**: Uses MessageChannel for yielding instead of setTimeout to avoid browser throttling
- **Play-based Frame Capture**: Uses `requestVideoFrameCallback` for fast encoding (~real-time speed vs minutes with seek-based approach)
- **Progress Tracking**: Real-time progress updates during conversion

### WebM Handling
- MediaRecorder produces WebM without proper seek metadata
- `webm-duration-fix` library adds Duration, SeekHead, and Cues elements
- Thumbnails captured from live preview (more reliable than from blob)
- Metadata extraction has fallbacks for problematic WebM files
- Compatible WebM option re-encodes with VP9 + Opus via Mediabunny
- Playback viewer fixes metadata before playback for proper scrubbing

### Analytics
- Vercel Analytics via `@vercel/analytics`
- Custom events in `src/utils/analytics.ts`:
  - `Recording Started`
  - `Recording Completed` (with duration)
  - `Recording Sent to Editor`
  - `Recording Downloaded`
  - `Recording Deleted`

### Testing

Vitest + Testing Library in jsdom, with a v8 coverage floor enforced by `pnpm test:coverage`
(see the root `CLAUDE.md`'s coverage policy for the numbers and the rule that they only go up).

**Tests never mock the module under test.** Doubles stand in for boundaries the browser owns —
screen and camera capture, canvas, WebCodecs, Web Audio, muxing, IndexedDB — never for
CRAFT's own orchestration. A double records what it was asked to do and the test asserts on
the outcome, not on the double.

- **`src/test/doubles/`** — one file per browser API jsdom does not implement, each with a
  header saying what it stands in for and why: `mediastream.ts` (`MediaStream` /
  `MediaStreamTrack`, backed by a real `EventTarget` so an `ended` listener genuinely fires,
  plus `MediaStreamTrackProcessor`), `recorder.ts` (the recorder `core/recorder-factory`
  builds, keeping the same surface over MediaRecorder or WebCodecs), `canvas.ts` (a recording
  `CanvasRenderingContext2D` plus `toBlob`), `video.ts` (the `<video>` elements the code
  creates, which jsdom never loads), `audio.ts` (`AudioContext` and the nodes the recorder and
  converter build on it), `webcodecs.ts` (`VideoEncoder`, `AudioEncoder`, `VideoDecoder`,
  `VideoFrame`, `AudioData`), `mediabunny.ts` (the muxer, recorded rather than run) and
  `browser.ts` (the prototype-level gaps `installBrowserStubs()` fills — media playback,
  navigation from an anchor click, `window.open`).
- **`src/test/appDoubles.ts`** — the collaborator modules the `App.*.test.tsx` files hand to
  `vi.mock`: the recorder factory, permission overrides, thumbnail generation, conversion,
  "send to editor" and analytics. It imports no application code at runtime, so a `vi.mock`
  factory can pull it in while the module it stands in for is still being mocked.
  `resetAppDoubles()` clears every recorded call between tests.
- **`src/test/appHarness.tsx`** — the shared App setup: **`resetRecorderStore(config?)`** puts
  the Zustand store back to a freshly loaded app with every capability present (a missing
  capability is something a test says explicitly), **`renderApp()`** mounts `App` and settles
  its mount-time async work inside `act()`, `flush()` lets promise chains — IndexedDB included
  — settle on a real macrotask even under fake timers, `screenStreamDouble()` /
  `webcamStreamDouble()` / `micStreamDouble()` build the capture streams a take needs, and the
  `installRafDouble()` family drives the PiP compositor's animation frames by hand. It also
  re-exports `installBrowserStubs()` from `doubles/browser.ts`, because every App suite reaches
  for it through this module.
- **Semicolon dialect is mixed, deliberately.** The suites the test decomposition added
  (`src/hooks/*.test.ts`, `src/utils/recordingFormat.test.ts`, and their siblings) omit
  line-ending semicolons; the older files (`src/App.library.test.tsx` and friends) carry them.
  There is no `semi` lint rule and normalising the tree is not worth burying an unrelated diff
  in — **match the file you are editing**. Changing this is its own ticket, and it would have
  to be decided for `apps/artist` and `packages/shared` at the same time.

## Key Constraints

- MediaRecorder API required (all modern browsers)
- System audio capture only works with getDisplayMedia (Chrome/Edge)
- AudioContext needs resume() call due to Chrome autoplay policy
- WebM from MediaRecorder needs post-processing for proper scrubbing
- WebCodecs API (MP4/Compatible WebM conversion) only works in Chrome/Edge

## Keyboard Shortcuts

Bound by `src/hooks/useKeyboardShortcuts.ts` — the only window listener `App` itself binds; `VideoPlayer` binds its own while the playback dialog is open — and listed
for the user by `src/components/RecorderControls/RecorderControls.tsx`.

| Key | Action |
|-----|--------|
| R | Start recording |
| P | Pause/Resume |
| S | Stop recording |
| Esc | Cancel |
