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
```

## Test Structure

```
tests/
├── escapeplan/              # ESCAPEPLAN tests
│   ├── landing.spec.ts      # Landing page and navigation
│   ├── dashboard.spec.ts    # Dashboard functionality
│   ├── pricing.spec.ts      # Pricing page and tiers
│   ├── downloads.spec.ts    # License downloads
│   ├── invite.spec.ts       # Team invitations
│   └── team.spec.ts         # Team management
├── escapecraft/             # ESCAPECRAFT tests
│   └── recording-flow.spec.ts # Recording features
├── escapeartist/            # ESCAPEARTIST tests
│   ├── video-import.spec.ts # Video import functionality
│   └── timeline-editing.spec.ts # Timeline operations
├── integration/             # Cross-app integration tests
│   └── craft-to-artist.spec.ts # CRAFT → ARTIST workflow
├── standalone/              # Standalone build tests
│   ├── craft.spec.ts        # ESCAPECRAFT standalone
│   └── artist.spec.ts       # ESCAPEARTIST standalone
└── journeys/                # User journey tests
    ├── 01-visitor-to-trial.spec.ts
    ├── 02-trial-record-edit-export.spec.ts
    ├── 03-trial-to-pro-upgrade.spec.ts
    ├── 04-pro-cancellation-flow.spec.ts
    ├── 05-standalone-purchase-download.spec.ts
    ├── 06-team-admin-workflow.spec.ts
    └── 07-standalone-license-activation.spec.ts
```

## User Journey Tests

The `journeys/` directory contains comprehensive E2E tests covering critical user paths:

| Journey | Description | Tests |
|---------|-------------|-------|
| 01 | Visitor → Browse → Pricing → Trial | 3 |
| 02 | Trial → Record (CRAFT) → Edit (ARTIST) → Export | 4 |
| 03 | Trial → Upgrade to Pro | 4 |
| 04 | Pro → Cancel → Access until period end → Expired | 4 |
| 05 | User → Purchase standalone license → Download | 5 |
| 06 | Team admin → Create org → Invite → Member accepts | 3 |
| 07 | Standalone → Manual license entry → Activation | 6 |

**Total: 29 journey tests**

### Running Journey Tests

```bash
pnpm test:journeys           # Run all journey tests
pnpm test:journeys:headed    # Run with browser visible
pnpm test:journeys:ui        # Run with Playwright UI
pnpm report:journeys         # View HTML report
```

Journey tests use extended timeouts (60s per test) and run serially to maintain proper flow state.

## Test Utilities

The `utils/` directory provides reusable testing utilities:

| Utility | Purpose |
|---------|---------|
| `auth.ts` | Mock Clerk authentication |
| `indexeddb.ts` | IndexedDB management |
| `media-mocks.ts` | Mock getUserMedia and MediaRecorder |
| `stripe-mocks.ts` | Mock Stripe checkout and portal |
| `subscription-mocks.ts` | Mock subscription states |
| `license-mocks.ts` | Mock license validation |
| `watermark-verification.ts` | Verify watermark presence |

### Test Fixtures

The `fixtures/auth-fixtures.ts` provides pre-configured user fixtures:

```typescript
import { test, expect } from '../../fixtures/auth-fixtures'

// Available fixtures:
// - trialUser: Trial user with 14 days remaining
// - proUser: Pro Monthly subscriber
// - foundingUser: Founding Member (lifetime)
// - expiredUser: Expired subscription
// - canceledUser: Canceled but access until period end
// - licensedUser: Valid standalone license
// - signedOutUser: Visitor (no auth)

test('trial user sees upgrade prompt', async ({ trialUser }) => {
  const { page } = trialUser
  await page.goto('http://localhost:5173/dashboard')
  // Test with pre-mocked trial subscription state
})
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
