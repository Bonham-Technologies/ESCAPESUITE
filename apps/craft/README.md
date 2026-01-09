# ESCAPECRAFT

Client-side video recorder for the ESCAPE Suite. Records screen, webcam, and audio directly in the browser with no server required.

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

## Tech Stack

- React 19 + TypeScript
- Vite with single-file build
- Zustand for state management
- MediaRecorder API for recording
- Shared IndexedDB with ESCAPEARTIST

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Outputs a single `index.html` file in `dist/` that can be deployed anywhere.

## ESCAPE Suite

ESCAPECRAFT is part of the ESCAPE Suite:
- **ESCAPECRAFT** - Video recorder (this project)
- **ESCAPEARTIST** - Video editor

Both apps share the same IndexedDB storage, allowing seamless transfer of recordings to the editor.
