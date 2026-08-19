# ESCAPECRAFT

Client-side video recorder for the ESCAPE Suite. Records screen, webcam, and audio directly in the browser with no server required.

**Part of the [ESCAPESUITE monorepo](../../README.md)**

## Features

- **Screen Capture**: Record your entire screen, a window, or a browser tab
- **Webcam**: Record from your camera
- **Picture-in-Picture**: Overlay webcam on screen recording with adjustable position, size, and shape
- **Audio**: Capture microphone and/or system audio
- **Environment Adaptive**: Gracefully handles restricted environments where some features aren't available
- **Offline Ready**: Works entirely in the browser with no server dependency
- **ESCAPEARTIST Integration**: Send recordings directly to the editor via shared IndexedDB storage

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| R | Start recording |
| P | Pause/Resume |
| S | Stop recording |
| Esc | Cancel |

## Development

```bash
# From monorepo root (recommended)
pnpm dev:craft           # Start on localhost:5174

# Or from this directory
pnpm dev
```

## Build

```bash
# From monorepo root
pnpm build:craft

# Standard web build
pnpm build

# Offline single-file build
pnpm build:standalone
```

The standalone build outputs a single `index.html` file that can be used offline.

## Tech Stack

- React 19 + TypeScript + Vite
- Zustand for state management
- MediaRecorder API for recording
- Shared IndexedDB with ESCAPEARTIST
- Vercel Analytics

## ESCAPE Suite

| App | Port | Description |
|-----|------|-------------|
| ESCAPEPLAN | 5173 | Landing page & hub |
| ESCAPECRAFT | 5174 | This app - recorder |
| ESCAPEARTIST | 5175 | Video editor |

Both ESCAPECRAFT and ESCAPEARTIST share the same IndexedDB storage, allowing seamless transfer of recordings to the editor.
