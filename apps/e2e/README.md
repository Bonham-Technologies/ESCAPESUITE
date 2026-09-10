# ESCAPE Suite E2E Tests

End-to-end tests for the ESCAPE Suite using Playwright.

**Part of the [ESCAPESUITE monorepo](../../README.md)**

## Overview

This package contains Playwright tests that verify the integration between ESCAPEPLAN, ESCAPECRAFT, and ESCAPEARTIST.

## Running Tests

```bash
# From monorepo root
pnpm test:e2e

# From this directory
pnpm test                # Run all tests
pnpm test:headed         # Run with visible browser
pnpm test:escapeplan     # Test only ESCAPEPLAN
pnpm test:escapecraft    # Test only ESCAPECRAFT
pnpm test:escapeartist   # Test only ESCAPEARTIST
pnpm test:journeys       # Run user journey tests
pnpm test:journeys:headed # Journey tests with visible browser
pnpm test:standalone     # Offline single-file builds (needs pnpm build:standalone)
pnpm test:production     # Production single-origin layout (needs pnpm build:deploy)
```

## Test Structure

```
tests/
├── escapeplan/              # ESCAPEPLAN tests
│   ├── landing.spec.ts      # Landing page, tool launches, GitHub links
│   └── components.spec.ts   # Header, theme toggle, footer, legal routes
├── escapecraft/             # ESCAPECRAFT tests
│   ├── recording-flow.spec.ts # Recording features
│   └── components.spec.ts   # Recorder UI
├── escapeartist/            # ESCAPEARTIST tests
│   ├── video-import.spec.ts # Video import functionality
│   ├── timeline-editing.spec.ts # Timeline operations
│   └── components.spec.ts   # Editor panels and dialogs
├── accessibility/           # axe-core audits, keyboard, screen reader
├── errors/                  # Permission, export, network, input failures
├── responsive/              # Mobile / tablet / desktop layouts
├── integration/             # Cross-app integration tests
│   ├── craft-to-artist.spec.ts # CRAFT → ARTIST workflow
│   ├── indexeddb-sharing.spec.ts
│   └── workflows.spec.ts
├── standalone/              # Offline single-file build tests
│   ├── craft.spec.ts        # ESCAPECRAFT offline build
│   └── artist.spec.ts       # ESCAPEARTIST offline build
├── production/              # Combined single-origin build tests
│   └── indexeddb-sharing.spec.ts # Cross-app IndexedDB (CRAFT ⇄ ARTIST)
└── journeys/                # User journey tests
    └── 01-record-edit-export.spec.ts
```

## User Journey Tests

The `journeys/` directory contains the full-product path, start to finish:

| Journey | Description |
|---------|-------------|
| 01 | Record (CRAFT) → hand off → Edit (ARTIST) → Export a downloaded file |

The journey drives the real pipelines: synthetic camera/screen media feeds the
actual recorder, the recorded bytes are imported into the editor, and the export
is a real WebCodecs encode that ends in a browser download. It runs on Chromium
only, because export needs WebCodecs.

### Running Journey Tests

```bash
pnpm test:journeys           # Run all journey tests
pnpm test:journeys:headed    # Run with browser visible
pnpm test:journeys:ui        # Run with Playwright UI
pnpm report:journeys         # View HTML report
```

Journey tests use extended timeouts (60s per test) and run serially to maintain proper flow state.

## Production-Layout Tests

`tests/production/` runs against the combined build — `pnpm build:deploy` writes
every app into the root `dist/`, exactly as Vercel serves it: ESCAPEPLAN at `/`,
ESCAPECRAFT at `/craft/`, ESCAPEARTIST at `/artist/`. Served on one port, that is
the only setup where the two tools share the `video-editor-db` IndexedDB
database; the dev servers (5174 / 5175) are two origins and never do. The
cross-app IndexedDB tests therefore live here rather than in `integration/`.

```bash
pnpm build:deploy        # from the monorepo root
pnpm test:production     # from this directory (or pnpm test:e2e:production at the root)
pnpm report:production   # view the HTML report
```

`playwright.production.config.ts` starts `scripts/serve-dist.mjs` on port 5190.
That tiny zero-dependency server mirrors `vercel.json`'s rewrites; `npx serve`
cannot — `serve -s` sends `/craft/` and `/artist/` to the ROOT `index.html`, and
a `serve` config with rewrites fixes those two but then 404s on `/`.

## Test Utilities

The `utils/` directory provides reusable testing utilities:

| Utility | Purpose |
|---------|---------|
| `accessibility.ts` | axe-core runner, focus order and visibility checks |
| `error-mocks.ts` | Permission denial, offline/slow network, codec failures |
| `indexeddb.ts` | IndexedDB management |
| `media-mocks.ts` | Inert media stubs plus `mockSyntheticMedia` (real canvas/audio streams) |
| `viewports.ts` | Shared viewport sizes |

There are no auth, billing or licensing utilities: the apps have no accounts,
no subscriptions and no gates, so tests just navigate and use them.

See also: [Standalone Test Battery](../../docs/STANDALONE-TEST-BATTERY.md) for manual testing checklists.

## CI Behavior

The CI workflow is optimized to balance thoroughness with speed:

### Default Behavior
- The **full suite runs on every PR and on every push to `main`/`dev`** — one
  `e2e` job, journey test included (it is chromium-only and adds ~2 min)
- The standalone suite runs in the `standalone` job, against the same offline
  bundles that job builds and publishes
- The production-layout suite runs at the END of that same job, against the
  combined `dist/` (`pnpm build:deploy` clobbers `apps/*/dist`, so it has to come
  after the standalone artifact upload and the standalone suite)
- Playwright browsers are cached to speed up runs
- Concurrent runs are cancelled when new commits are pushed
- E2E is skipped for Dependabot PRs

### CI Optimizations
| Optimization | Benefit |
|--------------|---------|
| Concurrency control | Cancels duplicate runs on new pushes |
| Combined lint + type-check | Saves ~30s runner setup |
| Playwright browser caching | Saves ~1min per E2E job |
| E2E runs on `main` too | Warms the browser cache PR branches restore from |
| Standalone build + E2E in one job | One build serves the artifact and the tests |

### Playwright Install Resilience
The browser download and the apt system-dependency install are separate steps,
each capped at `timeout-minutes: 8` with a single plain-bash retry. A stalled
apt run fails fast and visibly instead of burning the whole job timeout.

### Test Configuration
- Tests run against development servers started by Playwright
- No environment variables are required: the apps have no backend

## Configuration

The `playwright.config.ts` configures:
- **Browsers**: Chromium in CI; Chromium + Firefox + WebKit locally
- **Base URLs**: localhost:5173, 5174, 5175 for each app
- **Web Servers**: Auto-starts all three dev servers

The `playwright.standalone.config.ts` serves the pre-built single-file bundles
from `apps/craft/dist` and `apps/artist/dist` on ports 5184 / 5185, so run
`pnpm build:standalone` before `pnpm test:e2e:standalone`.

The `playwright.production.config.ts` serves the combined root `dist/` on port
5190 (chromium only), so run `pnpm build:deploy` before `pnpm test:e2e:production`.

## Writing Tests

```typescript
import { test, expect } from '@playwright/test';

test('should load ESCAPEPLAN', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await expect(page).toHaveTitle(/ESCAPE Suite/);
});

// CI-only test
test('@smoke should show landing page', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await expect(page.locator('h1')).toBeVisible();
});
```

## Viewing Reports

```bash
# Generate and open HTML report
pnpm report
```

Reports are also uploaded as artifacts in GitHub Actions.

## Prerequisites

- All three apps must be running (Playwright auto-starts them)
- Chromium browser (installed via `pnpm exec playwright install chromium`)

## ESCAPE Suite

| App | Port | Package |
|-----|------|---------|
| ESCAPEPLAN | 5173 | @escapesuite/plan |
| ESCAPECRAFT | 5174 | @escapesuite/craft |
| ESCAPEARTIST | 5175 | @escapesuite/artist |
