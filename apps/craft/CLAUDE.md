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

## Key Constraints

- MediaRecorder API required (all modern browsers)
- System audio capture only works with getDisplayMedia (Chrome/Edge)
- AudioContext needs resume() call due to Chrome autoplay policy
- WebM from MediaRecorder needs post-processing for proper scrubbing
- WebCodecs API only works in Chrome/Edge. Where it is missing, `recorder-factory.ts` falls
  back to MediaRecorder, so recording still works — it is the WebCodecs recorder and the
  conversion paths in `converter.ts` (the library's MP4 and M4A downloads) that are Chrome/Edge
  only
- Recording the webcam as a separate track needs `MediaStreamTrackProcessor` on top of
  WebCodecs (`canRecordSeparateTracks()`). It is the one feature with no fallback: the toggle
  stays on screen and `disabled`, carrying the reason, and the take is recorded as a composited
  overlay instead

## Verify

```bash
pnpm --filter=@escapesuite/craft exec vitest run
pnpm --filter=@escapesuite/craft exec tsc -b --noEmit
pnpm --filter=@escapesuite/craft exec eslint .
```

## Reference docs

Detailed behaviour lives in `docs/reference/`, one file per subsystem. Read the file for the
area you are changing before you edit it. Code comments that cite a section of "this app's
CLAUDE.md" by name mean the file with that heading below.

**Keep this file an index.** When behaviour changes, update the matching reference file (or add
one and list it here). Don't add narrative, ticket history or measurements to this file.

| Section | File |
|---|---|
| App (`src/App.tsx`) | [`app.md`](docs/reference/app.md) |
| Errors and notices | [`errors-and-notices.md`](docs/reference/errors-and-notices.md) |
| The record button only offers what it can deliver | [`the-record-button-only-offers-what-it-can-deliver.md`](docs/reference/the-record-button-only-offers-what-it-can-deliver.md) |
| Dialogs | [`dialogs.md`](docs/reference/dialogs.md) |
| State Management | [`state-management.md`](docs/reference/state-management.md) |
| Core Modules (`src/core/`) | [`core-modules.md`](docs/reference/core-modules.md) |
| VideoPlayer Component (`src/components/VideoPlayer/`) | [`videoplayer-component.md`](docs/reference/videoplayer-component.md) |
| Capability Detection (`src/core/permissions.ts`) | [`capability-detection.md`](docs/reference/capability-detection.md) |
| Recording Modes | [`recording-modes.md`](docs/reference/recording-modes.md) |
| The PiP frame gate | [`the-pip-frame-gate.md`](docs/reference/the-pip-frame-gate.md) |
| Recorder lifecycle | [`recorder-lifecycle.md`](docs/reference/recorder-lifecycle.md) |
| Frame timestamps and keyframes | [`frame-timestamps-and-keyframes.md`](docs/reference/frame-timestamps-and-keyframes.md) |
| Audio level meters | [`audio-level-meters.md`](docs/reference/audio-level-meters.md) |
| Integration with ESCAPEARTIST | [`integration-with-escapeartist.md`](docs/reference/integration-with-escapeartist.md) |
| Embedding | [`embedding.md`](docs/reference/embedding.md) |
| Build Configuration | [`build-configuration.md`](docs/reference/build-configuration.md) |
| Download Formats | [`download-formats.md`](docs/reference/download-formats.md) |
| A take can be several files | [`a-take-can-be-several-files.md`](docs/reference/a-take-can-be-several-files.md) |
| WebM Handling | [`webm-handling.md`](docs/reference/webm-handling.md) |
| Analytics | [`analytics.md`](docs/reference/analytics.md) |
| Testing | [`testing.md`](docs/reference/testing.md) |
| Keyboard Shortcuts | [`keyboard-shortcuts.md`](docs/reference/keyboard-shortcuts.md) |
