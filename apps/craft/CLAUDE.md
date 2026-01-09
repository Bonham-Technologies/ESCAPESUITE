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
pnpm build:standalone    # Single HTML file, no auth
pnpm test:run            # Run tests
pnpm lint                # Run ESLint
```

## Architecture

### State Management
- **Zustand store** (`src/store/recorderStore.ts`): Single source of truth for recorder state
- Core types defined in `src/store/types.ts`: `RecordingState`, `RecordingConfig`, `Recording`, `EnvironmentCapabilities`
- Recordings stored in shared IndexedDB with ESCAPEARTIST

### Core Modules (`src/core/`)
- `storage.ts`: Shared IndexedDB layer (same database as ESCAPEARTIST: `video-editor-db`)
- `recorder.ts`: MediaRecorder wrapper with audio mixing and level monitoring
- `permissions.ts`: Environment capability detection and stream acquisition
- `compositor.ts`: Canvas-based PiP compositing for webcam overlay on screen
- `thumbnailGenerator.ts`: Thumbnail generation and video metadata extraction
- `watermark.ts`: Watermark rendering for trial/free users

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

### Build Configuration
- `vite-plugin-singlefile`: Builds entire app into a single HTML file (all assets inlined)
- Target: ESNext, no code splitting
- `build:standalone` creates an auth-free version for offline use

### WebM Handling
- MediaRecorder produces WebM without proper seek metadata
- `fix-webm-duration` library patches duration/cues after recording
- Thumbnails captured from live preview (more reliable than from blob)
- Metadata extraction has fallbacks for problematic WebM files

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

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| R | Start recording |
| P | Pause/Resume |
| S | Stop recording |
| Esc | Cancel |
