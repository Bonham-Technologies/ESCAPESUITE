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
pnpm build:standalone    # Single HTML file, no auth
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
  - **MP4**: H.264 video + AAC audio, frame-by-frame encoding
- `projectManager.ts`: Project save/load to JSON files with embedded video references
- `exportScheduler.ts`: Background export queue management
- `frameCache.ts`: LRU cache for decoded video frames

### Integration API (`src/utils/integration.ts`)
The editor can be embedded in other applications via:
- **PostMessage**: Bidirectional communication with parent window
- **URL parameters**: `?video=url` to preload videos, `?project=base64` for project state

Message types: `LOAD_VIDEO`, `LOAD_PROJECT`, `GET_STATE`, `EXPORT` (inbound); `READY`, `VIDEO_LOADED`, `STATE`, `EXPORT_COMPLETE`, `ERROR` (outbound)

### Build Configuration
- `vite-plugin-singlefile`: Builds entire app into a single HTML file (all assets inlined)
- Target: ESNext, no code splitting
- `build:standalone` creates an auth-free version for offline use

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

### Transform Controls (`src/components/Preview/PreviewPlayer.tsx`)
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
- **Seek position tracking**: `seekVideoOptimized()` skips redundant video seeks if already within one frame of target position
- **Frame tolerance**: Uses 1/frameRate (e.g., 0.033s at 30fps) to determine if seek is needed
- **Animation caching**: Uses `getAnimatedValuesCached()` to avoid recomputing keyframe interpolations
- **Cache lifecycle**: `clearSeekPositions()` and `clearAnimationCache()` called at export start
- **Encoder backpressure**: Waits if `videoEncoder.encodeQueueSize > 10` to prevent memory exhaustion

### Black Flash Prevention (`src/core/exporter.ts`)
To prevent black frames during export:
- **Seek timeout**: 500ms per attempt for reliable seeking
- **Retry logic**: Up to 2 attempts per seek with quick frame readiness checks
- **Frame readiness verification**: `waitForVideoReady()` ensures video.readyState >= 2 before drawing
- **readyState logging**: Warnings logged when videos aren't ready during transitions
- **Transition safety**: `drawTransition()` returns success status for debugging

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

## Key Constraints

- WebCodecs API (exports) only works in Chrome/Edge
- Video blobs stored in IndexedDB; large files may hit storage limits
- All encoding/decoding happens on main thread via HTMLVideoElement; no Web Workers currently
