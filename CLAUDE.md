# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ESCAPE Suite is a **Turborepo monorepo** containing privacy-first, client-side media creation tools that run entirely in the browser. All video processing happens locally - no cloud uploads required.

| App | Package | Purpose | Dev Port |
|-----|---------|---------|----------|
| ESCAPEPLAN | `@escapesuite/plan` | Landing page & hub | 5173 |
| ESCAPECRAFT | `@escapesuite/craft` | Screen & webcam recorder | 5174 |
| ESCAPEARTIST | `@escapesuite/artist` | Video editor with timeline & effects | 5175 |
| E2E Tests | `@escapesuite/e2e` | End-to-end test suite | N/A |
| Headless ARTIST kit | `@escapesuite/headless-artist` | Server-side render CLI + kit | N/A |

Each app's dev (and preview) port is pinned in its `vite.config.ts` with `strictPort: true`, so a taken port fails loudly instead of sliding to the next one and the table above always holds.

## Monorepo Structure

```
escapesuite/
├── apps/
│   ├── plan/           # ESCAPEPLAN - landing page & hub
│   ├── craft/          # ESCAPECRAFT - recorder
│   ├── artist/         # ESCAPEARTIST - video editor
│   └── e2e/            # End-to-end tests (Playwright)
├── packages/
│   └── shared/         # Shared types and utilities
├── services/
│   └── headless-artist/ # Server-side ARTIST render CLI + kit
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
pnpm test:e2e            # Playwright E2E tests (Chromium only in CI)
pnpm test:e2e:browsers   # Cross-browser E2E (Chromium + Firefox + WebKit)
pnpm test:e2e:browsers:all # Cross-browser E2E including responsive variants
pnpm test:e2e:standalone # E2E against the offline single-file builds (run pnpm build:standalone first)
pnpm test:e2e:production # E2E against the combined single-origin dist (run pnpm build:deploy first)

# Linting & types
pnpm lint                # Lint all apps
pnpm -r run typecheck    # Type-check every package, test files included

# Cleanup
pnpm clean               # Remove all node_modules and dist
```

## Verify

Per package (what a change must pass before it is done):

```bash
pnpm --filter=@escapesuite/<pkg> exec vitest run
pnpm --filter=@escapesuite/<pkg> exec tsc -b --noEmit
pnpm --filter=@escapesuite/<pkg> exec eslint .
```

Whole repo: `pnpm test`, `pnpm lint`, `pnpm -r run typecheck`. CI's single required check is
`ci-status` (see `docs/reference/ci-cd-pipeline.md`).

## Coverage policy

- `pnpm test:coverage` enforces each package's v8 thresholds (`test.coverage.thresholds` in its
  vitest/vite config) and fails if any package drops below its floor. `pnpm coverage:report`
  prints actual vs floor.
- **Thresholds only go up.** Floors are achieved coverage rounded down to a whole percent. Never
  lower one to make CI pass: test the branch, or justify a wrong floor explicitly in the PR.
- **Every `src` file counts.** Any `coverage.exclude` entry carries a comment naming the suite
  that does cover it.
- Current figures and the full rules: `docs/reference/coverage-policy.md`. Re-measurements are
  appended to `docs/reference/coverage-history.md`, **never to a CLAUDE.md**.

## Key Constraints

- Export codec support varies by browser (Firefox has no AAC encoder). MP4 and WebM export are
  async probes answering `{ video, audio }`; see ARTIST's `export-dialog-browser-support.md`.
- MediaRecorder WebM lacks seek metadata and is post-processed (`webm-duration-fix`, then
  `apps/craft/src/core/webmCues.ts` for the Cues index).
- AudioContext needs `resume()` (Chrome autoplay policy).
- System audio capture only works with `getDisplayMedia` (Chrome/Edge).

Full text: `docs/reference/key-constraints.md`.

## Reference docs

Detail lives in `docs/reference/`. Read the file for the area you are changing before editing.

| Topic | File |
|---|---|
| Vercel Deployment | [`vercel-deployment.md`](docs/reference/vercel-deployment.md) |
| Shared Infrastructure | [`shared-infrastructure.md`](docs/reference/shared-infrastructure.md) |
| ESCAPEPLAN (apps/plan) | [`escapeplan.md`](docs/reference/escapeplan.md) |
| ESCAPECRAFT (apps/craft) | [`escapecraft.md`](docs/reference/escapecraft.md) |
| ESCAPEARTIST (apps/artist) | [`escapeartist.md`](docs/reference/escapeartist.md) |
| Data Flow | [`data-flow.md`](docs/reference/data-flow.md) |
| Integration API (embedding CRAFT / ARTIST in a host page) | [`integration-api.md`](docs/reference/integration-api.md) |
| Headless render service (services/headless-artist) | [`headless-render-service.md`](docs/reference/headless-render-service.md) |
| Environment Variables | [`environment-variables.md`](docs/reference/environment-variables.md) |
| Testing | [`testing.md`](docs/reference/testing.md) |
| Performance benchmarks | [`performance-benchmarks.md`](docs/reference/performance-benchmarks.md) |
| Coverage policy | [`coverage-policy.md`](docs/reference/coverage-policy.md) |
| Coverage re-measurement history | [`coverage-history.md`](docs/reference/coverage-history.md) |
| Key Constraints | [`key-constraints.md`](docs/reference/key-constraints.md) |
| CI/CD Pipeline | [`ci-cd-pipeline.md`](docs/reference/ci-cd-pipeline.md) |
| Vercel Analytics | [`vercel-analytics.md`](docs/reference/vercel-analytics.md) |

**Keep every CLAUDE.md an index, under 200 lines.** CLAUDE.md files load into every session and
every subagent, so each line costs on every request. Put behaviour, ticket history and
measurements in the matching `docs/reference/` file (root or per app), and add a row here when
you create one.

## Issue Tracking

Issues and work items are tracked in Jira:
- **Project**: [ESCSUITE](https://bonham.atlassian.net/jira/software/projects/ESCSUITE/summary)
- **Board**: https://bonham.atlassian.net/jira/software/projects/ESCSUITE/boards

## Per-App Documentation

Each app has its own CLAUDE.md (an index into that app's `docs/reference/`):
- `apps/artist/CLAUDE.md`: Overlay system, keyframe animation, transform controls
- `apps/craft/CLAUDE.md`: Recording modes, PiP compositing, keyboard shortcuts
- `apps/plan/CLAUDE.md`: Routes, page structure, theme support
