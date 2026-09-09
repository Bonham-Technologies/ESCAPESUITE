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

### State Management
- **Zustand store** (`src/store/recorderStore.ts`): Single source of truth for recorder state
- Core types defined in `src/store/types.ts`: `RecordingState`, `RecordingConfig`, `Recording`, `EnvironmentCapabilities`, `DetailedCapabilities`, `CapabilityInfo`
- Recordings stored in shared IndexedDB with ESCAPEARTIST

### Core Modules (`src/core/`)
- `storage.ts`: Shared IndexedDB layer (same database as ESCAPEARTIST: `video-editor-db`)
- `recorder.ts`: MediaRecorder wrapper with audio mixing and level monitoring
- `permissions.ts`: Environment capability detection with detailed unavailability reasons
- `compositor.ts`: Canvas-based PiP compositing for webcam overlay on screen
- `thumbnailGenerator.ts`: Thumbnail generation and video metadata extraction
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
`Content-Security-Policy: frame-ancestors` on the deployment serving CRAFT.

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

## Key Constraints

- MediaRecorder API required (all modern browsers)
- System audio capture only works with getDisplayMedia (Chrome/Edge)
- AudioContext needs resume() call due to Chrome autoplay policy
- WebM from MediaRecorder needs post-processing for proper scrubbing
- WebCodecs API (MP4/Compatible WebM conversion) only works in Chrome/Edge

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| R | Start recording |
| P | Pause/Resume |
| S | Stop recording |
| Esc | Cancel |
