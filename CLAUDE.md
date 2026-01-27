# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ESCAPE Suite is a **Turborepo monorepo** containing privacy-first, client-side media creation tools that run entirely in the browser. All video processing happens locally - no cloud uploads required.

| App | Package | Purpose | Dev Port |
|-----|---------|---------|----------|
| ESCAPEPLAN | `@escapesuite/plan` | Hub/landing page, auth, subscriptions | 5173 |
| ESCAPECRAFT | `@escapesuite/craft` | Screen & webcam recorder | 5174 |
| ESCAPEARTIST | `@escapesuite/artist` | Video editor with timeline & effects | 5175 |
| E2E Tests | `@escapesuite/e2e` | End-to-end test suite | N/A |

## Monorepo Structure

```
escapesuite/
├── apps/
│   ├── plan/           # ESCAPEPLAN - hub & auth
│   ├── craft/          # ESCAPECRAFT - recorder
│   ├── artist/         # ESCAPEARTIST - video editor
│   └── e2e/            # End-to-end tests (Playwright)
├── packages/
│   └── shared/         # Shared types and utilities
├── scripts/
│   └── build-all.mjs   # Combined build for Vercel
├── package.json        # Root workspace config
├── pnpm-workspace.yaml # pnpm workspace definition
├── turbo.json          # Turborepo configuration
└── vercel.json         # Vercel deployment config
```

## Build Commands

All commands run from the monorepo root using pnpm and Turbo:

```bash
# Install dependencies (all apps)
pnpm install

# Development servers
pnpm dev                 # All apps in parallel
pnpm dev:plan            # Just ESCAPEPLAN (localhost:5173)
pnpm dev:craft           # Just ESCAPECRAFT (localhost:5174)
pnpm dev:artist          # Just ESCAPEARTIST (localhost:5175)

# Production builds
pnpm build               # Build all apps (Turbo cached)
pnpm build:plan          # Build just ESCAPEPLAN
pnpm build:craft         # Build just ESCAPECRAFT
pnpm build:artist        # Build just ESCAPEARTIST
pnpm build:deploy        # Combined build for Vercel (outputs to /dist)

# Testing
pnpm test                # Unit tests for all apps
pnpm test:coverage       # With coverage reports
pnpm test:e2e            # Playwright E2E tests

# Linting
pnpm lint                # Lint all apps

# Cleanup
pnpm clean               # Remove all node_modules and dist
```

## Vercel Deployment

The monorepo deploys to Vercel with automatic preview deployments:

| Branch | Domain | Purpose |
|--------|--------|---------|
| `main` | escapesuite.io | Production |
| `dev` | escapesuite.dev | Development/staging |
| PRs | `*.vercel.app` | Preview deployments |

**Output Structure:**
```
dist/
├── index.html        # ESCAPEPLAN
├── 404.html          # SPA fallback
├── craft/index.html  # ESCAPECRAFT (single file)
└── artist/index.html # ESCAPEARTIST (single file)
```

## Architecture

### Shared Infrastructure
- **pnpm workspaces**: Efficient dependency management with shared packages
- **Turborepo**: Cached builds, parallel execution, smart rebuilds
- **IndexedDB Database**: CRAFT and ARTIST share `video-editor-db` for seamless data transfer
- **Clerk Authentication**: All apps use the same Clerk instance for unified auth
- **Single-file Builds**: `vite-plugin-singlefile` inlines all assets into one HTML file

### ESCAPEPLAN (apps/plan)
- React Router for client-side routing
- Clerk (auth), Stripe (payments), Supabase (Edge Functions + PostgreSQL)
- In production: serves CRAFT at `/craft/` and ARTIST at `/artist/`

### ESCAPECRAFT (apps/craft)
- Zustand store in `src/store/recorderStore.ts`
- Core modules in `src/core/`: `recorder.ts`, `compositor.ts`, `permissions.ts`, `thumbnailGenerator.ts`, `storage.ts`, `watermark.ts`, `converter.ts`
- Recording modes: screen, webcam, PiP (screen + webcam overlay), with mic/system audio options
- Outputs WebM (requires `webm-duration-fix` for proper seek metadata)
- Export to MP4 (H.264+AAC) or WebM (VP9+Opus) via WebCodecs + Mediabunny
- Export features: cancellation support, background tab support, ~real-time encoding speed

### ESCAPEARTIST (apps/artist)
- Zustand store in `src/store/projectStore.ts`
- Core modules in `src/core/`: `storage.ts`, `videoProcessor.ts`, `exporter.ts`, `projectManager.ts`, `exportScheduler.ts`, `frameCache.ts`, `videoDecodeManager.ts`, `frameSource.ts`
- Video decode worker in `src/workers/decodeWorker.ts` for background-capable MP4 exports
- Keyframe animation system in `src/utils/animation.ts`
- Audio waveform visualization in `src/utils/waveform.ts`
- WebCodecs API for encoding/decoding (Chrome/Edge only)
- Export formats: WebM (VP9+Opus) and MP4 (H.264+AAC)
- Background tab export: MP4 exports run at full speed even in background tabs via Web Worker

### Data Flow
```
ESCAPECRAFT recordings → IndexedDB → ESCAPEARTIST imports
                          ↓
                    Shared videos, thumbnails, projects
```

### Integration API (ESCAPEARTIST)
- PostMessage: bidirectional communication with parent window
- URL params: `?video=url` to preload, `?project=base64` for state
- "Send to Editor" from CRAFT uses `?loadVideo=<id>`

## Environment Variables

Create `.env.local` files in each app directory, or set in Vercel dashboard:

```env
# Required for all apps
VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxx
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJxxx

# ESCAPEPLAN only (for embedded checkout UI)
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_xxx

# Optional
VITE_BUILD_MODE=saas              # or 'standalone' for air-gapped builds
```

> **Note:** Stripe Price IDs are configured server-side in Supabase Edge Function secrets.
> See `apps/plan/CLAUDE.md` for the complete list.

## Testing

- **Unit tests**: Vitest with Testing Library, fake-indexeddb for storage mocking
- **E2E tests**: Playwright with Chromium (fast tests exclude journey tests)
- **Journey tests**: 69 comprehensive user flow tests covering trial, subscription, team, and license workflows
- **Standalone tests**: See [Standalone Test Battery](docs/STANDALONE-TEST-BATTERY.md) for manual testing checklists

Test counts:
- ESCAPEPLAN: 47 tests
- ESCAPECRAFT: 143 tests
- ESCAPEARTIST: 570 tests
- E2E: 62 structural tests + 69 journey tests

## Key Constraints

- WebCodecs API (ESCAPEARTIST exports) only works in Chrome/Edge
- MediaRecorder produces WebM without proper seek metadata (requires post-processing)
- AudioContext needs `resume()` call due to Chrome autoplay policy
- System audio capture only works with getDisplayMedia (Chrome/Edge)
- Edge Functions use Deno runtime (not Node.js)

## CI/CD Pipeline

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push and PR:

| Job | Purpose | Runs On |
|-----|---------|---------|
| `validate` | Install deps, security audit | All PRs |
| `lint-and-typecheck` | ESLint + TypeScript (combined) | All PRs |
| `test` | Unit tests with coverage | All PRs |
| `build` | Production builds, bundle size report | All PRs |
| `build-standalone` | Standalone builds (no auth) | All PRs |
| `e2e` | Fast E2E tests (excludes journeys) | PRs only |
| `e2e-full` | Full E2E including journeys | Main branch or `run-full-e2e` label |
| `test-standalone` | Standalone E2E tests | PRs only |
| `deploy` | Vercel deployment | After E2E passes |
| `ci-status` | Summary/gate job | All PRs |

**CI Optimizations:**
- Concurrency control cancels in-progress runs when new commits are pushed
- Combined lint + type-check saves ~30s of runner setup overhead
- Playwright browsers are cached across runs (~1min savings)
- Journey tests excluded by default (add `run-full-e2e` label to include)

**Standalone Release** (`.github/workflows/standalone-release.yml`):
- Triggers on merge to `main` branch
- Builds ESCAPECRAFT and ESCAPEARTIST in standalone mode (`VITE_BUILD_MODE=standalone`)
- Uploads single-file HTML builds to Supabase Storage (`downloads` bucket)
- Files available at: `escapecraft-standalone.html`, `escapeartist-standalone.html`
- Pre-licensed downloads inject license keys at download time via `get-licensed-download` Edge Function

**Dependabot** (`.github/dependabot.yml`):
- Weekly updates for all apps
- Grouped PRs: React, Clerk, testing, linting
- GitHub Actions version updates

## Vercel Analytics

All apps use `@vercel/analytics` for pageview and custom event tracking:
- `<Analytics />` component in each app's `main.tsx`
- Custom events via `track()` in `*/analytics.ts` files

## Issue Tracking

Issues and work items are tracked in Jira:
- **Project**: [ESCSUITE](https://bonham.atlassian.net/jira/software/projects/ESCSUITE/summary)
- **Board**: https://bonham.atlassian.net/jira/software/projects/ESCSUITE/boards

## Per-App Documentation

Each app has its own CLAUDE.md with detailed architecture:
- `apps/artist/CLAUDE.md`: Overlay system, keyframe animation, transform controls
- `apps/craft/CLAUDE.md`: Recording modes, PiP compositing, keyboard shortcuts
- `apps/plan/CLAUDE.md`: Subscription tiers, routing, Supabase functions
