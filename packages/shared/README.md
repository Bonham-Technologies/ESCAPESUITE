# @escapesuite/shared

Shared utilities, components, and types for the ESCAPE Suite monorepo.

## Installation

This package is internal to the monorepo. Add it as a workspace dependency:

```json
{
  "dependencies": {
    "@escapesuite/shared": "workspace:*"
  }
}
```

## Modules

### Theme (`@escapesuite/shared/theme`)

Theme management utilities and components for light/dark mode support.

```tsx
import { ThemeToggle, initializeTheme, type ThemeStorage } from '@escapesuite/shared/theme'

// Initialize theme on app load
const themeStorage: ThemeStorage = {
  load: async () => localStorage.getItem('theme') as ThemePreference | null,
  save: async (pref) => localStorage.setItem('theme', pref),
}
initializeTheme(themeStorage)

// Use the toggle component
<ThemeToggle storage={themeStorage} />
```

**Exports:**
- `ThemeToggle` - React component for switching themes
- `initializeTheme(storage)` - Initialize theme from storage
- `applyTheme(theme)` - Apply a specific theme
- `getSystemTheme()` - Get system preference
- `type ThemePreference` - `'light' | 'dark' | 'system'`
- `type ThemeStorage` - Storage adapter interface

---

### Config (`@escapesuite/shared/config`)

Build-time mode detection. `saas` (default) is the hosted build at escapesuite.io with Vercel
Analytics enabled; `standalone` is the offline single-file build with no analytics and no
network requests.

```ts
import { BUILD_MODE, isSaaSMode, isStandaloneMode } from '@escapesuite/shared/config'

if (isStandaloneMode()) {
  // running as an offline single-file build
}
```

**Exports:**
- `BUILD_MODE` - `'saas' | 'standalone'`, read from `VITE_BUILD_MODE`
- `isSaaSMode()` / `isStandaloneMode()` - Build mode detection

---

### Analytics (`@escapesuite/shared/analytics`)

Vercel Analytics wrapper for event tracking.

```ts
import { trackEvent } from '@escapesuite/shared/analytics'

trackEvent('Video Exported', { format: 'mp4', duration: 120 })
```

**Exports:**
- `trackEvent(name, props?)` - Track a custom event

---

### Storage (`@escapesuite/shared/storage`)

IndexedDB utilities for video/thumbnail storage.

```ts
import {
  getDB,
  storeVideo,
  getVideo,
  deleteVideo,
  getAllVideos,
  getSetting,
  setSetting,
} from '@escapesuite/shared/storage'

// Store a video
await storeVideo('video-123', blob, metadata)

// Retrieve a video
const { blob, metadata } = await getVideo('video-123')

// Store settings
await setSetting('theme-preference', 'dark')
```

**Exports:**
- `DB_NAME` / `DB_VERSION` - Database constants
- `getDB()` - Get database connection
- `storeVideo(id, blob, metadata)` - Store video blob and metadata
- `getVideo(id)` - Retrieve video by ID
- `deleteVideo(id)` - Delete video
- `getAllVideos()` - List all videos
- `storeThumbnail(id, blob)` / `getThumbnail(id)` - Thumbnail operations
- `getSetting(key)` / `setSetting(key, value)` - Settings storage

---

### Types (`@escapesuite/shared/types`)

Shared TypeScript type definitions.

```ts
import type {
  MediaType,
  MediaSource,
  WaveformPeak,
  SourceVideo,
} from '@escapesuite/shared/types'
```

**Exports:**
- `MediaType` - `'video' | 'image' | 'audio'`
- `MediaSource` - `'upload' | 'recording'`
- `WaveformPeak` - Audio waveform data point
- `SourceVideo` - Video metadata interface

---

### Utils (`@escapesuite/shared/utils`)

Time formatting and utility functions.

```ts
import {
  formatTimecode,
  formatTime,
  formatDuration,
  parseTimecode,
  clamp,
  roundTo,
  formatFileSize,
} from '@escapesuite/shared/utils'

formatTimecode(65.5)      // "01:05.500"
formatTime(125)           // "2:05"
formatDuration(3661)      // "1:01:01"
parseTimecode("1:30")     // 90
clamp(15, 0, 10)          // 10
formatFileSize(1024*1024) // "1.0 MB"
```

**Exports:**
- `formatTimecode(seconds, showHours?)` - Format as HH:MM:SS.mmm
- `formatTime(seconds)` - Format as MM:SS
- `formatDuration(seconds)` - Human-readable duration
- `parseTimecode(str)` - Parse timecode to seconds
- `clamp(value, min, max)` - Clamp value to range
- `roundTo(value, decimals)` - Round to decimal places
- `pixelsToTime(px, pps)` / `timeToPixels(t, pps)` - Timeline conversions
- `formatFileSize(bytes)` - Human-readable file size

---

### Bootstrap (`@escapesuite/shared/bootstrap`)

App initialization helper for consistent startup. Mounts the app into the root element and
enables Vercel Analytics only in `saas` builds (standalone builds must make no network requests).

```tsx
import { bootstrapApp } from '@escapesuite/shared/bootstrap'

bootstrapApp({ App })
```

**Exports:**
- `bootstrapApp(config)` - Initialize and render the app (`{ App, rootId? }`)

---

## Development

```bash
# Run tests
pnpm test

# Run tests once
pnpm test:run

# Run tests with coverage
pnpm test:coverage

# Lint
pnpm lint
```

## Test Coverage

Run `pnpm test:coverage` to generate a coverage report.
