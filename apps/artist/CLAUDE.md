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

## Key Constraints

- Video blobs stored in IndexedDB; large files may hit storage limits
- MP4 decoding uses Web Worker with WebCodecs for background-capable export; WebM falls back to HTMLVideoElement on main thread
- WebCodecs background export only works in Chromium and Firefox (the engines measured against their own `<video>`; WebKit was measured and is not admitted, ESCSUITE-285) and only for H.264 MP4 source files the worker can present exactly as `<video>` does (see "Video Decode Worker" for what it refuses); WebM sources and refused MP4s use HTMLVideoElement seeking, and an MP4 export says so once ("Decoding in the page; keep this tab in the foreground"), a WebM source included (ESCSUITE-261)

## Verify

```bash
pnpm --filter=@escapesuite/artist exec vitest run
pnpm --filter=@escapesuite/artist exec tsc -b --noEmit
pnpm --filter=@escapesuite/artist exec eslint .
```

## Reference docs

Detailed behaviour lives in `docs/reference/`, one file per subsystem. Read the file for the
area you are changing before you edit it. Code comments that cite a section of "this app's
CLAUDE.md" by name mean the file with that heading below.

**Keep this file an index.** When behaviour changes, update the matching reference file (or add
one and list it here). Don't add narrative, ticket history or measurements to this file.

| Section | File |
|---|---|
| State Management | [`state-management.md`](docs/reference/state-management.md) |
| Core Modules (`src/core/`) | [`core-modules.md`](docs/reference/core-modules.md) |
| Video Decode Worker (`src/workers/decodeWorker.ts`) | [`video-decode-worker.md`](docs/reference/video-decode-worker.md) |
| Integration API (`src/utils/integration.ts`) | [`integration-api.md`](docs/reference/integration-api.md) |
| Linked clips (`src/store/linkedClips.ts`) | [`linked-clips.md`](docs/reference/linked-clips.md) |
| Build Configuration | [`build-configuration.md`](docs/reference/build-configuration.md) |
| Overlay System | [`overlay-system.md`](docs/reference/overlay-system.md) |
| Captions (`src/core/captions.ts`, ESCSUITE-293) | [`captions.md`](docs/reference/captions.md) |
| Keyframe Animation System (`src/utils/animation.ts`) | [`keyframe-animation-system.md`](docs/reference/keyframe-animation-system.md) |
| Keyframe Panel (`src/components/KeyframePanel/`) | [`keyframe-panel.md`](docs/reference/keyframe-panel.md) |
| Preview (`src/components/Preview/`) | [`preview.md`](docs/reference/preview.md) |
| Timeline (`src/components/Timeline/`) | [`timeline.md`](docs/reference/timeline.md) |
| ClipEditor (`src/components/ClipEditor/`) | [`clipeditor.md`](docs/reference/clipeditor.md) |
| App (`src/App.tsx`) | [`app.md`](docs/reference/app.md) |
| Analytics | [`analytics.md`](docs/reference/analytics.md) |
| Dialogs | [`dialogs.md`](docs/reference/dialogs.md) |
| The File menu (`src/app/FileMenu.tsx`, `src/app/menuNavigation.ts`) | [`the-file-menu.md`](docs/reference/the-file-menu.md) |
| Export Resolution (`src/core/outputTransform.ts`, `src/core/exportTypes.ts`) | [`export-resolution.md`](docs/reference/export-resolution.md) |
| Export Performance Optimizations (`src/core/exportMP4.ts`, `src/core/exportWebM.ts`, `src/core/frameSource.ts`, `src/core/frameManager.ts`) | [`export-performance-optimizations.md`](docs/reference/export-performance-optimizations.md) |
| MP4 Export Reliability (`src/core/exportMP4.ts`) | [`mp4-export-reliability.md`](docs/reference/mp4-export-reliability.md) |
| WebM Export Reliability (`src/core/exportWebM.ts`, `src/core/exportTypes.ts`) | [`webm-export-reliability.md`](docs/reference/webm-export-reliability.md) |
| GIF Export (`src/core/exportGIF.ts`, `src/core/gifEncoder.ts`, `src/core/exportTypes.ts`) | [`gif-export.md`](docs/reference/gif-export.md) |
| Export Dialog Browser Support (`src/components/Export/ExportDialog.tsx`, `src/core/exportTypes.ts`) | [`export-dialog-browser-support.md`](docs/reference/export-dialog-browser-support.md) |
| Export Loudness (`src/core/loudness.ts`) (ESCSUITE-292) | [`export-loudness.md`](docs/reference/export-loudness.md) |
| Black Flash Prevention (`src/core/elementFrames.ts`, `src/core/canvasRenderer.ts`) | [`black-flash-prevention.md`](docs/reference/black-flash-prevention.md) |
| Responsive Inspector (`src/app/InspectorSidebar.tsx`, `src/app/MobileInspectorToggle.tsx`, `src/App.module.css`) | [`responsive-inspector.md`](docs/reference/responsive-inspector.md) |
| Audio Waveform Visibility (`src/components/Timeline/AudioWaveform.tsx`) | [`audio-waveform-visibility.md`](docs/reference/audio-waveform-visibility.md) |
| Testing | [`testing.md`](docs/reference/testing.md) |
| Headless Render Bundle | [`headless-render-bundle.md`](docs/reference/headless-render-bundle.md) |
| Media type is decided by a probe, once (ESCSUITE-255) | [`media-type-is-decided-by-a-probe-once.md`](docs/reference/media-type-is-decided-by-a-probe-once.md) |
| Seek index repair at import (ESCSUITE-305) | [`seek-index-repair-at-import.md`](docs/reference/seek-index-repair-at-import.md) |
| Keyboard shortcuts (ESCSUITE-247) | [`keyboard-shortcuts.md`](docs/reference/keyboard-shortcuts.md) |
| Import rows, the refusal notice and the metadata deadline (ESCSUITE-249) | [`import-rows-the-refusal-notice-and-the-metadata-deadline.md`](docs/reference/import-rows-the-refusal-notice-and-the-metadata-deadline.md) |
