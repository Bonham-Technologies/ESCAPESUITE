# Changelog

## 2.0.0

### Major Changes

- ESCAPEARTIST is now free and open source under the MIT license.

  **Breaking changes:**

  - Removed all licensing, subscription, and account gating. There is no sign-in,
    no trial, no plan check — the full timeline editor, overlays, keyframes, and
    both export formats are available to everyone.
  - Removed export watermarks. MP4 and WebM exports are unbranded regardless of
    how the app is run.
  - Removed the license-key entry flow from the offline build. The standalone
    single-file build now runs with no key and no activation step.

  **Distribution:**

  - Offline single-file builds are attached directly to each GitHub Release,
    replacing the gated download portal. Grab `ESCAPEARTIST-2.0.0.html` from the
    latest release and open it on any machine — including air-gapped networks.

## 1.3.0

### Minor Changes

- 36edd68: Add export cancellation support with AbortController

  - Cancel button now properly stops in-progress exports instead of just hiding the dialog
  - Export functions accept optional AbortSignal parameter
  - Resources (video elements, blob URLs, encoders) are properly cleaned up on cancellation
  - No error message shown for user-initiated cancellation

## 1.2.0

### Minor Changes

- Add resizable timeline, export performance improvements, and responsive inspector

  - **Resizable Timeline Panel**: Drag handle to adjust timeline height (120-600px), double-click to reset, persisted to localStorage
  - **Export Performance**: Real-time playback instead of frame-by-frame seeking, encoder backpressure to prevent memory exhaustion
  - **Responsive Inspector**: Collapsible panel with slide-out on mobile, floating toggle button
  - **Animation Caching**: Memoized keyframe interpolation (10,000 entry cache)
  - **Seek Optimization**: Skip redundant video seeks within frame tolerance
  - **Waveform Visibility**: White color when clip selected for better contrast
  - **Black Flash Prevention**: Event-based frame readiness waiting before encoding

- Add audio volume keyframe animation support

  - Volume property now animatable with keyframes like other properties
  - Keyframes applied continuously during playback and export
  - Supports all easing functions (linear, ease-in, ease-out, etc.)
  - Volume range 0-200% (0 = mute, 100% = original, 200% = 2x gain)

- Add standalone licensing system with pre-licensed downloads

  ### ESCAPEPLAN

  - **Pre-Licensed Downloads**: Server-side license injection - users download HTML with license already embedded
  - **Downloads Page**: "Download (Pre-Licensed)" button for instant-use downloads, "Generic" for manual key entry
  - **Edge Functions**: `get-licensed-download` for personalized builds, `get-user-licenses` for portal, `send-license-email` for purchase emails
  - **Database Migrations**: `license_activations` table, `downloads` storage bucket

  ### ESCAPECRAFT & ESCAPEARTIST

  - **License Input Modal**: Runtime license key entry UI for standalone builds
  - **Machine Hash**: Browser fingerprinting for activation tracking
  - **Dashboard Link**: Hidden in standalone mode (no dashboard exists)
  - **Analytics**: Removed from standalone builds (runs offline)

  ### Shared Package

  - **LicenseInputModal**: Reusable license entry component
  - **machineHash**: Cross-browser machine identification
  - **Bootstrap**: Analytics excluded from standalone mode

### Patch Changes

- Updated dependencies
  - @escapesuite/shared@1.2.0

## 1.1.1

### Patch Changes

- 0020d0e: Extract analytics trackEvent to @escapesuite/shared package

  - Add @escapesuite/shared/analytics module with shared trackEvent function
  - All apps now import trackEvent from shared package
  - App-specific analytics events remain in each app

- 246a63c: Extract auth UI components (AuthGate, ErrorScreen, LoadingScreen) to shared package

  - Move AuthGate, ErrorScreen, LoadingScreen components to @escapesuite/shared/auth
  - AuthGate now accepts appName, logo, and product props for customization
  - LoadingScreen accepts appName and logo props for app-specific branding
  - Apps use thin wrapper components that provide app-specific defaults
  - Removes ~240 lines of duplicated code across craft and artist

- 8c64a95: Extract auth utilities to @escapesuite/shared package

  - Add @escapesuite/shared/auth module with:
    - Config utilities (BUILD_MODE, isSaaSMode, isStandaloneMode)
    - AuthContext and useAuth hook
    - License validation with product parameter
    - Subscription API client
  - craft/artist now import from shared package

- dc3194d: Add app bootstrap utility for consistent initialization

  - Add `@escapesuite/shared/bootstrap` with `bootstrapApp()` function
  - Handles SaaS vs Standalone mode detection and auth wrapping
  - Dynamic loading of Clerk and Sentry (excludes from standalone bundle)
  - Simplifies main.tsx in craft and artist from ~53 lines to ~14 lines

- d5477d3: Extract Sentry configuration to @escapesuite/shared package

  - Add @escapesuite/shared/sentry module with shared initSentry function
  - Support product tagging via options parameter
  - All apps now import from shared package with app-specific product tags

- 08422a9: Extract IndexedDB storage operations to @escapesuite/shared package

  - Add @escapesuite/shared/storage module with:
    - Shared database configuration (DB_NAME, DB_VERSION)
    - Common video/thumbnail operations
    - Settings operations
    - Storage utilities
  - craft/artist now import from shared package
  - App-specific operations remain in each app

- 27869d5: Extract theme system to @escapesuite/shared package

  - Add @escapesuite/shared/theme module with storage-agnostic theme utilities
  - Add ThemeToggle component to shared package
  - All apps now use the shared theme module with app-specific storage adapters
  - Reduces ~500 lines of duplicated theme code

- 4fb6bd3: Extract shared types to @escapesuite/shared package

  - Add @escapesuite/shared/types module with:
    - MediaType, MediaSource types
    - WaveformPeak interface
    - SourceVideo interface
  - craft/artist now import shared types from shared package

- 33adadf: Extract time utilities and watermark module to shared package

  - Add @escapesuite/shared/utils with time formatting functions (formatTimecode, formatTime, formatDuration, parseTimecode, etc.)
  - Add @escapesuite/shared/watermark with drawWatermark function and StreamWatermarker class
  - Apps now re-export from shared, reducing duplication
  - Removes ~200 lines of duplicated code

- Updated dependencies [0020d0e]
- Updated dependencies [246a63c]
- Updated dependencies [8c64a95]
- Updated dependencies [dc3194d]
- Updated dependencies [d5477d3]
- Updated dependencies [08422a9]
- Updated dependencies [27869d5]
- Updated dependencies [4fb6bd3]
- Updated dependencies [33adadf]
  - @escapesuite/shared@1.1.0

## 1.1.0

### Minor Changes

- b633d3e: Add Changesets for version and release management

  - Automated version bumping and changelog generation
  - GitHub Action creates "Version Packages" PR when changesets accumulate
  - All main apps (plan, craft, artist) version together

### Patch Changes

- 0b2af1f: Dependency cleanup and version synchronization

  - Remove unused gh-pages dependency and deploy scripts from PLAN
  - Sync @clerk/clerk-react to ^5.59.2 across all apps
  - Sync React to ^19.2.3 across all apps
  - Standardize TypeScript constraint to ~5.9.3 (patch-only updates)

All notable changes to ESCAPEARTIST are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.4.0](https://github.com/bonham-technologies/ESCAPESUITE/compare/v1.3.0...v1.4.0) (2026-01-05)

### Features

- add Clerk auth integration and trial watermarks ([101edea](https://github.com/bonham-technologies/ESCAPESUITE/commit/101edea5dee3b9e4c116a7ebd9e9598ed8921a4a))
- add Clerk auth integration and trial watermarks ([7882e85](https://github.com/bonham-technologies/ESCAPESUITE/commit/7882e85d9b6986b28fd3f064cf2b2bccd72d2e68))
- add ESCAPECRAFT recorder integration ([dc321ad](https://github.com/bonham-technologies/ESCAPESUITE/commit/dc321ad4c397ecf7cab5a1a47a73ad9de2264103))
- add ESCAPECRAFT recorder integration ([6b08bbd](https://github.com/bonham-technologies/ESCAPESUITE/commit/6b08bbdc7e64442f7f27b8fa3a3338f24a0e7f26))
- add storage management - clear unused media and frame cache ([0f46b30](https://github.com/bonham-technologies/ESCAPESUITE/commit/0f46b303907bbf467cecb65f46c87e01a78c6ebc))
- integrate frame cache for instant scrubbing ([a38cba9](https://github.com/bonham-technologies/ESCAPESUITE/commit/a38cba99e156b5868b414e0cc3309abb8f37d017))
- integrate frame cache for instant scrubbing ([81754b6](https://github.com/bonham-technologies/ESCAPESUITE/commit/81754b6f1d5cad2611738f49dee183cc27c4d1a1))
- replace hand tool with ripple edit tool ([66e64f8](https://github.com/bonham-technologies/ESCAPESUITE/commit/66e64f8d649ad79ef3968e50bc50893c95d0f30b))
- replace hand tool with ripple edit tool ([2071f11](https://github.com/bonham-technologies/ESCAPESUITE/commit/2071f11dd105fa5a9a790ad579b70974fac5027d))

### Bug Fixes

- add dashboard navigation link in header ([b0b9d02](https://github.com/bonham-technologies/ESCAPESUITE/commit/b0b9d02c8496da50aa5bf1e7ec2bfcc9b20064d2))
- razor tool cuts at correct position after first split ([06b34b8](https://github.com/bonham-technologies/ESCAPESUITE/commit/06b34b82ec06794d4d00d9977c3d8ca3df0aeb11))
- resolve lint errors in AuthGate.tsx ([f5a4fbb](https://github.com/bonham-technologies/ESCAPESUITE/commit/f5a4fbbd15b8d77de6d2a90ead8fbe490e89af40))
- show Clear All button based on actual storage usage ([99beeaf](https://github.com/bonham-technologies/ESCAPESUITE/commit/99beeafe741f2b912cd28288057403b6f10bddc5))

## [1.3.0](https://github.com/bonham-technologies/ESCAPESUITE/compare/v1.2.0...v1.3.0) (2026-01-03)

### Features

- add toolbar, keyboard shortcuts, markers, and preview manipulation improvements ([7ce49cf](https://github.com/bonham-technologies/ESCAPESUITE/commit/7ce49cfc2cc9267fb0b5af90984ca2fdb5ba61ee))
- improve track UI with vertical volume slider and editable names ([c2b3e6a](https://github.com/bonham-technologies/ESCAPESUITE/commit/c2b3e6a24f0518c718cf56e08aea5ddff15642bc))
- improve track UI with vertical volume slider and editable names ([81ff143](https://github.com/bonham-technologies/ESCAPESUITE/commit/81ff143e41833e7bad685e39f7fe6770f4d94c0e))
- UX improvements - toolbar, keyboard shortcuts, markers, and preview manipulation ([d942f83](https://github.com/bonham-technologies/ESCAPESUITE/commit/d942f83e6cc68b4356ffc52ad3508caf88ea708a))

### Bug Fixes

- auto-create start keyframe for proper animation interpolation ([0c53561](https://github.com/bonham-technologies/ESCAPESUITE/commit/0c535611815918700f5bd0b521757b7ac9fb21c0))
- blur overlays now respect z-order and only affect lower layers ([52250e7](https://github.com/bonham-technologies/ESCAPESUITE/commit/52250e73e40d81241f44012736e2b70524a4c583))
- resolve nested button accessibility error in CollapsibleSection ([8ae87c6](https://github.com/bonham-technologies/ESCAPESUITE/commit/8ae87c63134201d87e67993c5832110db7e3e01f))

### Performance Improvements

- add advanced performance optimizations with full test coverage ([24f7438](https://github.com/bonham-technologies/ESCAPESUITE/commit/24f74382c0525727566ecbd011f44793938cfc4d))
- implement performance quick wins ([9a5415c](https://github.com/bonham-technologies/ESCAPESUITE/commit/9a5415cabaad5c654f38b386937f4e4ac2152cac))

## [1.2.0](https://github.com/bonham-technologies/ESCAPESUITE/compare/v1.1.0...v1.2.0) (2026-01-02)

### Features

- add Adobe Premiere-style keyframe editor ([a99b8de](https://github.com/bonham-technologies/ESCAPESUITE/commit/a99b8de14d989018c652f12308aa63ccb664fb53))
- add collapsible media library sidebar ([81e8bfb](https://github.com/bonham-technologies/ESCAPESUITE/commit/81e8bfbdfb99ce8484d6eec5fd0b36f05f710ac8))
- add collapsible media library sidebar ([a5d72cd](https://github.com/bonham-technologies/ESCAPESUITE/commit/a5d72cd8017c605be7494639e89020a27da11213))
- add interactive overlay transform controls on preview ([28fcd0b](https://github.com/bonham-technologies/ESCAPESUITE/commit/28fcd0bb5b477a1363259587d92a89a1b0fb52f6))
- add interactive overlay transform controls on preview ([e4bb211](https://github.com/bonham-technologies/ESCAPESUITE/commit/e4bb21179b437d77ea0771786e0ee1ef30ad8222))
- add keyframe preview manipulation with composite frame rendering ([5a3143b](https://github.com/bonham-technologies/ESCAPESUITE/commit/5a3143b18bd23df229144fb7c157893e4d0387a6))
- Adobe Premiere-style keyframe editor ([389f0ac](https://github.com/bonham-technologies/ESCAPESUITE/commit/389f0acfc14106cddfa6592d4c6b04ac9831c3d8))
- keyframe preview manipulation ([583cd43](https://github.com/bonham-technologies/ESCAPESUITE/commit/583cd4372342f6231ca78b88f98d8bfc5eb415ec))
- reuse empty tracks and UI improvements ([f23b9b6](https://github.com/bonham-technologies/ESCAPESUITE/commit/f23b9b6dc60829ea4f7eca5fc96a5bbfeb6be2b8))
- reuse empty tracks and UI improvements ([03fda3e](https://github.com/bonham-technologies/ESCAPESUITE/commit/03fda3e7024c4c9c6fad6bae60caad6e98699c71))

### Bug Fixes

- add rotation support to preview playback and export ([fa037e8](https://github.com/bonham-technologies/ESCAPESUITE/commit/fa037e80b130c6752e48ab0f33a3e029a8467c20))
- correct keyframe positioning and enable value dragging ([cba2711](https://github.com/bonham-technologies/ESCAPESUITE/commit/cba2711c1e874b6b652a181445ee8c12d42108bb))
- correct SVG coordinate calculation for preserveAspectRatio ([6c1e291](https://github.com/bonham-technologies/ESCAPESUITE/commit/6c1e291e716e022efbe0c7e6675d1a3e0469eecf))
- improve graph keyframe dragging and add delete functionality ([f3f71a0](https://github.com/bonham-technologies/ESCAPESUITE/commit/f3f71a076c1a880f91721d1042863f2f3c5fce33))
- improve keyframe editor UX with better drag handling and sizing ([4ed0452](https://github.com/bonham-technologies/ESCAPESUITE/commit/4ed04522ad51d316fce5b0b246f7a7222407bd35))
- selection handles follow animated keyframe values ([cd2fd37](https://github.com/bonham-technologies/ESCAPESUITE/commit/cd2fd37db51cf6d451f4b01bb00c8ce78a780148))
- wait for video seeks before drawing in keyframe preview ([b49b04a](https://github.com/bonham-technologies/ESCAPESUITE/commit/b49b04a6b083d59c35dba9d4ef289c896389fa39))

## [1.1.0](https://github.com/bonham-technologies/ESCAPESUITE/compare/v1.0.0...v1.1.0) (2026-01-01)

### Features

- add track audio control, auto-track creation, no-fill option, and blur overlay ([295e85a](https://github.com/bonham-technologies/ESCAPESUITE/commit/295e85a2c31c5df21fb400dea3e2cd0532c88c5c))

### Bug Fixes

- audio mixing and blur overlay behavior ([50cbe59](https://github.com/bonham-technologies/ESCAPESUITE/commit/50cbe593928e19a2825e0a991c4b587585ff201a))
- blur rotation no longer rotates underlying content ([dc28675](https://github.com/bonham-technologies/ESCAPESUITE/commit/dc286752b8af9a0dbf975423be245d5c6ef374c2))

## 1.0.0 (2026-01-01)

### Features

- add README badges, LICENSE, release-please, and CodeQL ([1635a48](https://github.com/bonham-technologies/ESCAPESUITE/commit/1635a48abb3141dc3a13eb0bd9f66ccdbac5b71f))
- add README badges, LICENSE, release-please, and CodeQL ([0e4d3f4](https://github.com/bonham-technologies/ESCAPESUITE/commit/0e4d3f4d5e888b47754b27acba2d86a1c5857ede))

### Bug Fixes

- replace CodeQL with npm audit for security scanning ([8222f1d](https://github.com/bonham-technologies/ESCAPESUITE/commit/8222f1d54f1ecf4f8630ce5ab80ba6ac247fc795))
- replace CodeQL with npm audit for security scanning ([c551f60](https://github.com/bonham-technologies/ESCAPESUITE/commit/c551f60be023853619b13fac7d5f8423e0829746))

---

## Pre-Monorepo History

The following versions were released before ESCAPEARTIST joined the ESCAPESUITE monorepo.

## [0.4.2] - 2024-12-11

### Added

- **Animation Section in Clip Inspector**
  - Animate In/Out dropdown selectors
  - Duration and easing controls per animation
  - Active animation badge indicator

### Changed

- Removed trim section from clip inspector (trimming done directly on timeline clips)

### Fixed

- Undo causing black preview window
- Stable dependency tracking for media URL changes

---

## [0.4.1] - 2024-12-10

### Added

- **Shape Overlay Blur Tool**

  - Region blur effect for shapes (rectangle, ellipse)
  - Blur amount slider (0-50px)
  - Useful for privacy blur and focus effects

- **Track Management**
  - Delete tracks with confirmation
  - Reorder tracks via drag handles
  - Clips automatically move to remaining track when track deleted

### Changed

- Improved transform controls with aspect ratio lock toggle
- Better reset transform behavior for overlays

### Fixed

- Export resolution matching preview resolution
- Track syncing issues during multi-track editing
- Transition rendering at clip boundaries

---

## [0.4.0] - 2024-12-09

### Added

- **Multi-Track Timeline**

  - Unlimited video/audio tracks
  - Per-track visibility, lock, and mute controls
  - Track height adjustment
  - Automatic clip compositing by track order

- **Blend Modes**

  - 8 blend modes: Normal, Multiply, Screen, Overlay, Darken, Lighten, Difference, Add
  - Per-clip blend mode selection

- **Transitions**

  - 11 transition types between clips
  - Fade, Dissolve, Wipe (4 directions), Slide (4 directions)
  - Configurable duration per transition

- **Transform Controls**

  - Position (X, Y) as percentage of canvas
  - Scale (X, Y) with lock toggle
  - Opacity control
  - Reset to defaults button

- **Effects**
  - Blur effect (0-50px range)
  - Applied during preview and export

### Changed

- Unified clip system (media and overlays as same entity)
- Improved timeline rendering performance

---

## [0.3.0] - 2024-12-08

### Added

- **MP4 Export**

  - H.264 video encoding via WebCodecs
  - AAC audio encoding
  - Full audio mixing from all tracks

- **Text Overlays**

  - Custom text with font selection
  - Font size, weight, style controls
  - Text color and background color
  - Text alignment (left, center, right)
  - Position anywhere on canvas

- **Shape Overlays**
  - Rectangle, Ellipse, Line, Arrow shapes
  - Fill color with opacity
  - Stroke color and width
  - Rotation support

### Changed

- Overlay clips now integrated into track system
- Improved export progress reporting

---

## [0.2.0] - 2024-12-07

### Added

- **WebM Export**

  - VP9 video encoding
  - Opus audio encoding
  - Quality presets (Low, Medium, High)
  - Resolution presets (Original, 1080p, 720p, 480p)

- **Image Support**

  - Import PNG, JPG, GIF, WebP
  - Default 5-second duration
  - Thumbnail generation

- **Audio Support**
  - Import MP3, WAV, OGG
  - Waveform thumbnail visualization
  - Audio mixing in export

### Changed

- Improved video metadata extraction
- Better storage quota handling

---

## [0.1.0] - 2024-12-06

### Added

- **Core Video Editing**

  - Video import and storage in IndexedDB
  - Single-track timeline with clips
  - Clip trimming (start/end points)
  - Clip splitting at playhead
  - Drag-and-drop clip repositioning

- **Preview Player**

  - Real-time video preview
  - Play/pause controls
  - Timeline scrubbing
  - Frame-accurate seeking

- **Project Management**

  - Save projects with embedded media
  - Load projects from file
  - Auto-save session state
  - Session restore on reload

- **Undo/Redo System**

  - 50-level history
  - Works with all editing operations

- **Media Library**
  - Thumbnail previews
  - Drag to timeline
  - Delete unused media

### Technical

- React 19 with TypeScript
- Zustand state management
- Vite build system
- Single-file output build

---

## Version History Summary

| Version | Date   | Highlights                                                              |
| ------- | ------ | ----------------------------------------------------------------------- |
| 1.2.0   | Jan 16 | Resizable timeline, volume keyframes, standalone licensing, export perf |
| 1.1.1   | Jan 10 | Shared package extraction, code deduplication                           |
| 1.1.0   | Jan 8  | Changesets, dependency sync                                             |
| 1.0.0   | Jan 1  | First monorepo stable release                                           |
| 0.4.2   | Dec 11 | Animation UI, bug fixes (pre-monorepo)                                  |
| 0.4.1   | Dec 10 | Shape blur, track management                                            |
| 0.4.0   | Dec 9  | Multi-track, transitions, blend modes                                   |
| 0.3.0   | Dec 8  | MP4 export, overlays                                                    |
| 0.2.0   | Dec 7  | WebM export, image/audio support                                        |
| 0.1.0   | Dec 6  | Initial release                                                         |

---

## Roadmap

### Planned Features

- [ ] Color correction and adjustment layers
- [ ] Audio waveform editor
- [ ] Advanced masking system
- [ ] Motion tracking
- [ ] Subtitle support (SRT/VTT)
- [ ] Template system
- [ ] Mobile/touch support
- [ ] WebGPU acceleration

### Under Consideration

- Collaborative editing
- Cloud storage integration
- Plugin architecture
- Advanced keyframe curves (bezier)
- Nested compositions
