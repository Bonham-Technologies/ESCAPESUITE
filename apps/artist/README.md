# ESCAPEARTIST

[![CI](https://github.com/bonham-technologies/ESCAPESUITE/actions/workflows/ci.yml/badge.svg)](https://github.com/bonham-technologies/ESCAPESUITE/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)

A powerful, client-side video editor built entirely for the browser. No server required, no uploads needed - edit videos directly in your browser using modern web technologies.

**Part of the [ESCAPESUITE monorepo](../../README.md)**

<!--
## Demo

![ESCAPEARTIST Demo](docs/demo.gif)

TODO: Add screenshot or demo GIF showing the editor interface
-->

## Features

### Core Editing
- **Multi-Track Timeline**: Unlimited tracks with drag-and-drop clip management
- **Non-Destructive Editing**: Trim, split, and rearrange clips without modifying source files
- **Undo/Redo**: Full 50-level history for all operations
- **Auto-Save**: Session persistence with restore on reload

### Media Support
- **Video**: All browser-supported formats (MP4, WebM, MOV, etc.)
- **Images**: PNG, JPG, GIF, WebP with configurable duration
- **Audio**: MP3, WAV, OGG for soundtrack and voiceover

### Visual Effects
- **Transforms**: Position, scale, rotation, and opacity per clip
- **Blend Modes**: Normal, Multiply, Screen, Overlay, Darken, Lighten, Difference, Add
- **Blur Effect**: Adjustable blur (0-50px) with animation support

### Animation System
- **Preset Animations**: Fade, Slide (4 directions), Scale, Pop, Blur
- **In/Out Animations**: Separate entrance and exit animations per clip
- **Custom Keyframes**: Full keyframe editor for precise control
- **Easing Functions**: 10 curves including linear, ease-in/out, and cubic variants

### Transitions
- **11 Transition Types**: None, Fade, Dissolve, Wipe (4 directions), Slide (4 directions)
- **Configurable Duration**: Adjust transition timing per clip

### Overlays
- **Text Overlays**: Custom fonts, colors, sizes, backgrounds, and alignment
- **Shape Overlays**: Rectangle, Ellipse, Line, Arrow with fill/stroke options
- **Blur Overlay**: Dedicated blur region that masks underlying content
- **No-Fill Option**: Quick toggle for transparent shape fills (outline-only)
- **Region Blur**: Blur effect behind shapes for privacy/focus effects

### Export
- **WebM**: VP9 video + Opus audio (with audio mixing)
- **MP4**: H.264 video + AAC audio (Chrome/Edge, WebCodecs required)
- **Quality Presets**: Low, Medium, High bitrate options
- **Resolution Options**: Original, 1080p, 720p, 480p

### Project Management
- **Save/Load Projects**: Self-contained project files with embedded media
- **Export Metadata**: Lightweight project sharing without video data
- **Session Restore**: Automatic recovery of unsaved work

## Technology Stack

- **React 19** - UI framework
- **TypeScript** - Type-safe development
- **Zustand** - State management
- **Vite** - Build tooling
- **WebCodecs API** - Video encoding (Chrome/Edge)
- **IndexedDB** - Client-side storage
- **Canvas 2D** - Frame rendering

## Getting Started

### Prerequisites
- Node.js 20+
- pnpm 9+
- Chrome/Edge (for MP4 export)

### Installation

```bash
# Clone the monorepo
git clone https://github.com/bonham-technologies/ESCAPESUITE.git
cd ESCAPESUITE

# Install dependencies
pnpm install

# Start development server
pnpm dev:artist          # localhost:5175
```

Or from this directory:

```bash
pnpm dev
```

### Build

```bash
# From monorepo root
pnpm build:artist

# Or from this directory
pnpm build               # Standard web build
pnpm build:standalone    # Offline single-file build
```

The standalone build outputs a single `index.html` file containing all code, styles, and assets inlined.

## Usage

> **New to ESCAPEARTIST?** Check out the [Quickstart Guide](docs/QUICKSTART.md) for a fast introduction.

### Basic Workflow

1. **Import Media**: Drag and drop videos, images, or audio files into the media library
2. **Add to Timeline**: Click media items to add them to the timeline
3. **Arrange Clips**: Drag clips to reposition, use handles to trim
4. **Apply Effects**: Select a clip to access transform, blend mode, and animation options
5. **Add Overlays**: Create text or shape overlays from the inspector panel
6. **Preview**: Use playback controls or scrub the timeline
7. **Export**: Choose format, quality, and resolution, then export

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play/Pause |
| `←` / `→` | Step backward/forward 1 second |
| `Home` / `End` | Go to start/end |
| `Delete` | Delete selected clip |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+S` | Save project |
| `Ctrl+E` | Export |
| `Ctrl+D` | Duplicate clip |

### Track Management

- **Add Track**: Click the + button in the track header area
- **Auto-Create Tracks**: Adding clips/overlays without a track automatically creates a new track
- **Reorder Tracks**: Drag track headers up/down
- **Track Controls**:
  - Eye icon: Toggle visibility
  - Lock icon: Prevent editing
  - Speaker icon: Mute audio
  - Volume slider: Adjust audio level (0-100%)
- **Audio Mixing**: All unmuted tracks play simultaneously with independent volume control
- **Delete Track**: Right-click or use track menu

### Animation Tips

- **Quick Animations**: Use In/Out presets for common effects
- **Custom Timing**: Adjust duration and easing per animation
- **Keyframe Editor**: Appears when animations are active, allows fine-tuning
- **Combine Effects**: Layer animations with transforms and blend modes

## Architecture

```
src/
├── components/           # React UI components
│   ├── App.tsx          # Main layout
│   ├── Timeline/        # Timeline and tracks
│   ├── Preview/         # Video preview player
│   ├── ClipEditor/      # Inspector panel
│   └── Export/          # Export dialog
├── core/                 # Core functionality
│   ├── storage.ts       # IndexedDB layer
│   ├── videoProcessor.ts # Media processing
│   ├── exporter.ts      # Video export engine
│   └── projectManager.ts # Save/load projects
├── store/               # State management
│   ├── projectStore.ts  # Zustand store
│   └── types.ts         # TypeScript types
└── utils/               # Utilities
    ├── animation.ts     # Keyframe interpolation
    ├── integration.ts   # Embed API
    └── timeUtils.ts     # Time formatting
```

## Browser Support

| Browser | Video Editing | WebM Export | MP4 Export |
|---------|--------------|-------------|------------|
| Chrome 94+ | Full | Full | Full |
| Edge 94+ | Full | Full | Full |
| Firefox 100+ | Full | Full | Not supported |
| Safari 16+ | Limited | Limited | Not supported |

**Note**: MP4 export requires WebCodecs API, which is only available in Chromium-based browsers.

## Embedding

ESCAPEARTIST can be embedded in other applications via PostMessage API:

```javascript
// Load a video
iframe.contentWindow.postMessage({
  type: 'LOAD_VIDEO',
  url: 'https://example.com/video.mp4'
}, '*');

// Listen for events
window.addEventListener('message', (e) => {
  if (e.data.type === 'EXPORT_COMPLETE') {
    const videoBlob = e.data.blob;
    // Handle exported video
  }
});
```

### URL Parameters

- `?video=url` - Preload video(s)
- `?project=base64` - Load project state
- `?autoplay=true` - Start playback automatically

## Storage

All data is stored locally in the browser using IndexedDB:

- **videos**: Source media blobs
- **thumbnails**: Cached preview images
- **projects**: Saved project files
- **settings**: User preferences

Typical storage quota: 50GB+ (Chrome), 10GB+ (Firefox)

## Performance Considerations

- **Large Files**: Videos are stored in IndexedDB; very large files may hit quota limits
- **Export Time**: Encoding is CPU-intensive; longer videos take proportionally longer
- **Memory Usage**: Multiple large videos may consume significant RAM
- **Preview Playback**: Real-time preview may drop frames with complex compositions

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes using [conventional commits](https://www.conventionalcommits.org/)
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation changes
   - `chore:` for maintenance tasks
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT — see the root [LICENSE](../../LICENSE) for details.

## Acknowledgments

- [Mediabunny](https://github.com/nicknomads/mediabunny) - MP4/WebM container muxing
- [idb](https://github.com/jakearchibald/idb) - IndexedDB wrapper
- [Zustand](https://github.com/pmndrs/zustand) - State management

---

**ESCAPEARTIST** - Professional video editing in your browser.
