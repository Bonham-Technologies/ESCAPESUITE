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
- **URL parameters**: `?video=url` to preload videos, `?project=base64` for project state

Message types: `LOAD_VIDEO`, `LOAD_PROJECT`, `GET_STATE`, `EXPORT` (inbound); `READY`, `VIDEO_LOADED`, `STATE`, `EXPORT_COMPLETE`, `ERROR` (outbound)

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
- **Background tab export (MP4)**: Uses WebCodecs `VideoDecoder` in a Web Worker for frame decoding, enabling full-speed exports even when the browser tab is in the background. Web Workers are not subject to browser throttling that affects `setTimeout` and `video.play()` on the main thread.
- **FrameSource abstraction**: `frameSource.ts` provides a unified interface for frame fetching with automatic fallback:
  - `WebCodecsFrameSource`: Uses `VideoDecodeManager` for MP4 files (background-capable)
  - `HTMLVideoFrameSource`: Falls back to `<video>` element seeking for WebM or unsupported browsers
- **Seek position tracking**: `seekVideoOptimized()` skips redundant video seeks if already within one frame of target position
- **Frame tolerance**: Uses 1/frameRate (e.g., 0.033s at 30fps) to determine if seek is needed
- **Animation caching**: Uses `getAnimatedValuesCached()` to avoid recomputing keyframe interpolations
- **Cache lifecycle**: `clearSeekPositions()` and `clearAnimationCache()` called at export start
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

## Key Constraints

- WebCodecs API (exports) only works in Chrome/Edge
- Video blobs stored in IndexedDB; large files may hit storage limits
- MP4 decoding uses Web Worker with WebCodecs for background-capable export; WebM falls back to HTMLVideoElement on main thread
- WebCodecs background export only works for MP4 source files; WebM sources use HTMLVideoElement seeking
