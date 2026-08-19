# ESCAPE Suite - Complete Documentation

## Overview

The ESCAPE Suite is a collection of free, open-source (MIT), privacy-first, client-side media
creation tools that run entirely in the browser. The suite consists of:

| App | Purpose | Port (Dev) |
|-----|---------|------------|
| **ESCAPEPLAN** | Landing page & hub | 5173 |
| **ESCAPECRAFT** | Screen & webcam recorder | 5174 |
| **ESCAPEARTIST** | Video editor with timeline & effects | 5175 |
| **ESCAPE-E2E** | End-to-end test suite | N/A |

**Key Value Proposition:**
- Lightning fast (local hardware processing)
- 100% private — all processing happens on-device, no cloud uploads, ever
- Hosted free at escapesuite.io with no account required
- Offline single-file builds available from GitHub Releases for fully air-gapped use
- No installation required (browser-based)

---

## Project Summaries

### ESCAPEPLAN
**Role:** Landing page & hub for the ESCAPE Suite

**Tech Stack:** React 19, TypeScript, Vite, React Router, Vercel Analytics

**Key Features:**
- Landing page linking to ESCAPECRAFT and ESCAPEARTIST
- Privacy and terms pages
- No accounts, no authentication, no backend

**Test Coverage:** unit tests covering routing, analytics, and components — run `pnpm test --filter=@escapesuite/plan` for the current count

---

### ESCAPECRAFT
**Role:** Browser-based screen and webcam recorder

**Tech Stack:** React 19, TypeScript, Vite, Zustand, WebRTC APIs

**Key Features:**
- Screen capture (getDisplayMedia)
- Webcam recording with PiP overlay
- Microphone & system audio capture
- Audio level monitoring
- WebM output with metadata fixing
- Shared IndexedDB storage with ESCAPEARTIST
- Full-featured video player with keyboard shortcuts
- Capability detection with detailed unavailability reasons

**Test Coverage:** unit tests covering storage, permissions, thumbnails, store, VideoPlayer, and capability detection — run `pnpm test --filter=@escapesuite/craft` for the current count

---

### ESCAPEARTIST
**Role:** Full-featured client-side video editor

**Tech Stack:** React 19, TypeScript, Vite, Zustand, WebCodecs API

**Key Features:**
- Multi-track timeline editing
- 50-level undo/redo
- Keyframe animation system (position, scale, rotation, opacity, blur)
- Text & shape overlays
- 11 transition types
- WebM (VP9+Opus) and MP4 (H.264+AAC) export with codec fallbacks
- Project save/load
- Audio waveform visualization with extreme zoom support

**Test Coverage:** unit tests covering exporter, waveform, animation, and more — run `pnpm test --filter=@escapesuite/artist` for the current count

---

### ESCAPE-E2E
**Role:** End-to-end testing for all apps

**Tech Stack:** Playwright, TypeScript

**Key Features:**
- Tests for all three apps
- Integration tests (CRAFT → ARTIST workflow)
- A single end-to-end journey test (record → edit → export)
- Media API mocking utilities
- IndexedDB test utilities
- CI/CD workflow with artifact uploads

---

## Running Locally (Development)

### Prerequisites
- Node.js 20+ LTS
- pnpm
- Chrome/Edge browser (for WebCodecs export support)

No environment variables are required — the suite has no backend, no auth, and no third-party
services to configure.

### Starting Development Servers

```bash
git clone https://github.com/Bonham-Technologies/ESCAPESUITE.git
cd ESCAPESUITE
pnpm install

pnpm dev            # all apps: plan :5173, craft :5174, artist :5175

# Or individually
pnpm dev:plan       # → http://localhost:5173
pnpm dev:craft      # → http://localhost:5174
pnpm dev:artist     # → http://localhost:5175
```

### Running Unit Tests

```bash
pnpm test                                    # All apps
pnpm test --filter=@escapesuite/plan
pnpm test --filter=@escapesuite/craft
pnpm test --filter=@escapesuite/artist
```

### Running E2E Tests

```bash
cd apps/e2e
pnpm exec playwright install chromium

pnpm test                    # All E2E tests
pnpm test:headed             # With visible browser
pnpm test:escapeplan
pnpm test:escapecraft
pnpm test:escapeartist
pnpm report                  # View test report
```

---

## CI/CD Pipelines

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push and PR. It installs
dependencies, lints and type-checks, runs unit tests with coverage, builds all apps (and the
offline standalone builds), and runs the Playwright E2E suite — the whole suite, journey test
included, on every PR and on every push to `main`/`dev`.

A separate workflow (`.github/workflows/standalone-release.yml`) runs after CI succeeds on
`main`: it builds the offline single-file builds for ESCAPECRAFT and ESCAPEARTIST and attaches
them to a GitHub Release.

See the root [CLAUDE.md](CLAUDE.md#cicd-pipeline) for the full job table.

---

## Offline (Standalone) Builds

ESCAPECRAFT and ESCAPEARTIST support offline single-file builds that work without internet
connectivity — a single HTML file per app with everything inlined, for organizations or
individuals who want to run the tools air-gapped.

### Building Standalone Versions

```bash
# From monorepo root — builds both apps
pnpm build:standalone

# Or individually
cd apps/craft && pnpm build:standalone
cd apps/artist && pnpm build:standalone
```

### Distributing Standalone Builds

The standalone build produces a single HTML file that:
- Contains all CSS, JS, and assets inlined
- Requires no external dependencies
- Can be opened directly from the filesystem (`file://`)
- Can be hosted on any static server
- Works in air-gapped/restricted environments

Every merge to `main` automatically builds and attaches these files to a
[GitHub Release](https://github.com/Bonham-Technologies/ESCAPESUITE/releases/latest) — no
account or purchase needed to download them.

---

## Possible Improvements

### ESCAPEPLAN

| Area | Improvement | Priority |
|------|-------------|----------|
| Testing | Add component tests for Home page | Medium |
| Features | Add project gallery/showcase | Low |
| SEO | Add meta tags, OG images | Medium |

### ESCAPECRAFT

| Area | Improvement | Priority |
|------|-------------|----------|
| Testing | Add recorder.ts unit tests | High |
| Testing | Add compositor.ts tests (PiP rendering) | Medium |
| Features | Add recording presets (1080p, 720p, etc.) | Medium |
| Features | Add countdown timer customization | Low |
| Features | Add recording annotations (draw while recording) | Medium |
| Performance | Use Web Workers for thumbnail generation | Low |
| UX | Add recording schedule/timer | Low |

### ESCAPEARTIST

| Area | Improvement | Priority |
|------|-------------|----------|
| Features | Add more transitions (zoom, spin, blur) | Medium |
| Features | Add color correction/grading | Medium |
| Features | Add green screen/chroma key | Medium |
| Features | Add speed ramping (variable speed) | Medium |
| Performance | Use Web Workers for export encoding | High |
| Performance | Implement GPU-accelerated rendering | Medium |
| UX | Add project templates | Low |
| Testing | Add KeyframePanel component tests | Medium |

### ESCAPE-E2E

| Area | Improvement | Priority |
|------|-------------|----------|
| Coverage | Add more journey tests | High |
| Coverage | Add export flow E2E tests | Medium |
| Fixtures | Add sample video files for import tests | Medium |
| Performance | Parallelize tests across apps | Low |

### Cross-Cutting

| Area | Improvement | Priority |
|------|-------------|----------|
| Docs | Add user documentation/help system | Medium |
| Docs | Add API documentation for integration | Low |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        ESCAPEPLAN                                │
│                   (Landing Page & Hub)                           │
│                  Static site, no backend                         │
└────────────────────────┬────────────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          │                             │
          ▼                             ▼
┌─────────────────────┐     ┌─────────────────────┐
│    ESCAPECRAFT      │     │    ESCAPEARTIST     │
│    (Recorder)       │     │     (Editor)        │
│                     │     │                     │
│ • Screen capture    │     │ • Multi-track       │
│ • Webcam/mic        │────▶│ • Keyframes         │
│ • PiP compositing   │     │ • Overlays          │
│ • WebM output       │     │ • WebM/MP4 export   │
└─────────┬───────────┘     └──────────┬──────────┘
          │                            │
          └──────────┬─────────────────┘
                     │
                     ▼
           ┌─────────────────┐
           │    IndexedDB    │
           │ (Shared Storage)│
           │                 │
           │ • Videos        │
           │ • Thumbnails    │
           │ • Projects      │
           │ • Settings      │
           └─────────────────┘
```

---

## License

ESCAPE Suite is MIT-licensed — see [LICENSE](LICENSE) for the full text.

---

*Documentation updated: August 18, 2026*
