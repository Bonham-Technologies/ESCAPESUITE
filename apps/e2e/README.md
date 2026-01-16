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
```

## Test Structure

```
tests/
├── escapeplan/              # ESCAPEPLAN tests
│   ├── landing.spec.ts      # Landing page and navigation
│   └── dashboard.spec.ts    # Dashboard functionality
├── escapecraft/             # ESCAPECRAFT tests
│   └── recording-flow.spec.ts # Recording features
├── escapeartist/            # ESCAPEARTIST tests
│   ├── video-import.spec.ts # Video import functionality
│   └── timeline-editing.spec.ts # Timeline operations
├── integration/             # Cross-app integration tests
│   └── craft-to-artist.spec.ts # CRAFT → ARTIST workflow
└── standalone/              # Standalone build tests
    ├── craft.spec.ts        # ESCAPECRAFT standalone
    └── artist.spec.ts       # ESCAPEARTIST standalone
```

See also: [Standalone Test Battery](../../docs/STANDALONE-TEST-BATTERY.md) for manual testing checklists.

## CI Behavior

In CI (`process.env.CI=true`):
- Only smoke tests run (tests tagged `@smoke`)
- Auth-dependent tests are skipped
- Tests run against development servers started by Playwright

## Configuration

The `playwright.config.ts` configures:
- **Browser**: Chromium only (WebCodecs requirement)
- **Base URLs**: localhost:5173, 5174, 5175 for each app
- **Web Servers**: Auto-starts all three dev servers

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
