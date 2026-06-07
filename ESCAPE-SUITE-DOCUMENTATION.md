# ESCAPE Suite - Complete Documentation

## Overview

The ESCAPE Suite is a collection of privacy-first, client-side media creation tools that run entirely in the browser. The suite consists of:

| App | Purpose | Port (Dev) |
|-----|---------|------------|
| **ESCAPEPLAN** | Hub/landing page, auth, subscriptions | 5173 |
| **ESCAPECRAFT** | Screen & webcam recorder | 5174 |
| **ESCAPEARTIST** | Video editor with timeline & effects | 5175 |
| **ESCAPE-E2E** | End-to-end test suite | N/A |

**Key Value Proposition:**
- Lightning fast (local hardware processing)
- Air-gapped Site License is 100% private — works offline, no cloud uploads
- Connected Individual Pro side door uses Supabase, Stripe, Resend, and Vercel for auth, billing, and email
- No installation required (browser-based)

---

## Project Summaries

### ESCAPEPLAN
**Role:** Hub/portal site for the ESCAPE Suite

**Tech Stack:** React 19, TypeScript, Vite, Supabase Auth, Stripe (payments), Resend (email), Supabase (backend)

**Key Features:**
- Landing page with pricing tiers (Site License + Individual Pro)
- User authentication via Supabase Auth
- Subscription management (7-day trial, Individual Pro monthly/annual)
- Dashboard with tool launchers
- Analytics (Vercel Analytics)

**Test Coverage:** 120 unit tests (subscription API, analytics, routing, components)

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

**Test Coverage:** 165 unit tests (storage, permissions, thumbnails, store, VideoPlayer, capability detection)

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

**Test Coverage:** 572 unit tests (comprehensive coverage including exporter, waveform, animation)

---

### ESCAPE-E2E
**Role:** End-to-end testing for all apps

**Tech Stack:** Playwright, TypeScript

**Key Features:**
- Tests for all three apps
- Integration tests (CRAFT → ARTIST workflow)
- Media API mocking utilities
- IndexedDB test utilities
- CI/CD workflow with artifact uploads
- Smart CI detection (auth-required tests skip in CI)

**Test Coverage:** 32 E2E test cases (4 run in CI, 28 require local auth)

---

## Running Locally (Development)

### Prerequisites
- Node.js 20+ LTS
- npm 10+
- Chrome/Edge browser (for WebCodecs support)

### Environment Setup

Each app requires environment variables. Create `.env.local` files:

**ESCAPEPLAN/.env.local:**
```env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJxxx
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_xxx
```

> Stripe Price IDs (Individual Pro + Site License bands) live server-side in Supabase Edge
> Function secrets, not in the frontend env.

**ESCAPECRAFT/.env.local & ESCAPEARTIST/.env.local:**
```env
VITE_BUILD_MODE=saas
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJxxx
```

### Starting Development Servers

```bash
# Terminal 1 - ESCAPEPLAN (hub)
cd ESCAPEPLAN && npm install && npm run dev
# → http://localhost:5173

# Terminal 2 - ESCAPECRAFT (recorder)
cd ESCAPECRAFT && npm install && npm run dev
# → http://localhost:5174

# Terminal 3 - ESCAPEARTIST (editor)
cd ESCAPEARTIST && npm install && npm run dev
# → http://localhost:5175
```

### Running Unit Tests

```bash
# From monorepo root using pnpm:
pnpm test                                    # All apps
pnpm test --filter=@escapesuite/plan         # ESCAPEPLAN (120 tests)
pnpm test --filter=@escapesuite/craft        # ESCAPECRAFT (165 tests)
pnpm test --filter=@escapesuite/artist       # ESCAPEARTIST (572 tests)
```

### Running E2E Tests

```bash
# Ensure all three dev servers are running first
cd ESCAPE-E2E && npm install
npx playwright install chromium

# Run all E2E tests
npm test

# Run with visible browser
npm run test:headed

# Run specific app tests
npm run test:escapeplan
npm run test:escapecraft
npm run test:escapeartist

# View test report
npm run report
```

**Note on CI vs Local Testing:**
- In CI (`process.env.CI=true`): Only smoke tests run (verify apps load)
- Locally: All tests run, including auth-dependent features
- Auth-required tests are skipped in CI using `test.skip(!!process.env.CI, ...)`

---

## CI/CD Pipelines

### Unit Test Workflows

Each app has a `.github/workflows/test.yml` that runs on push/PR to main:

1. Checkout code
2. Setup Node.js 20
3. Install dependencies (`npm ci`)
4. Run linter (`npm run lint`) - ESCAPEPLAN/ESCAPECRAFT only
5. Run tests (`npm run test:run`)
6. Upload coverage to Codecov

### E2E Test Workflow

`ESCAPE-E2E/.github/workflows/e2e.yml`:

1. Checkout all 4 repositories (requires `REPO_ACCESS_TOKEN` secret)
2. Install dependencies for all apps
3. Install Playwright Chromium
4. Run E2E tests (smoke tests only - auth tests auto-skip)
5. Upload Playwright report (30-day retention)
6. Upload test results on failure (7-day retention)

**CI Test Behavior:**
- 4 smoke tests run (verify apps start and `#root` renders)
- 28 auth-required tests are automatically skipped
- Full test suite runs locally with Supabase Auth authentication

### Deployment Workflow

`ESCAPEPLAN/.github/workflows/deploy.yml`:

1. Checkout ESCAPEPLAN, ESCAPECRAFT, ESCAPEARTIST
2. Build ESCAPEPLAN → `dist/`
3. Build ESCAPECRAFT → `dist/craft/`
4. Build ESCAPEARTIST → `dist/artist/`
5. Deploy combined `dist/` to GitHub Pages

**Required GitHub Secrets:**
- `GH_PAT` - Personal access token for cross-repo checkout
- `REPO_ACCESS_TOKEN` - For E2E workflow
- All `VITE_*` environment variables

---

## Site License Deployment (Air-Gapped)

ESCAPECRAFT and ESCAPEARTIST support offline builds that work without internet connectivity. This is the **Site License** offering — the hero product — for organizations with strict data sovereignty, air-gapped environments, or restricted network requirements.

### Site License Offering

The Site License is a per-org annual license (NOT per-seat) that runs fully offline / air-gapped.

| Band | Price | Approx. size |
|------|-------|--------------|
| Team | $2,400/year | up to ~25 |
| Organization | $9,600/year | up to ~250 |
| Enterprise / Site | Contact us | larger / custom |

For the Team and Organization bands, purchase via the Pricing page. For Enterprise / Site:

1. Visit [www.escapesuite.io](https://www.escapesuite.io) and use the "Contact us" flow
2. Reach out to sales@escapesuite.io with your organization details
3. Our team will provide a custom quote based on your requirements

### Site License Features

| Feature | Individual Pro (connected SaaS) | Site License (air-gapped) |
|---------|---------------------------------|---------------------------|
| Authentication | Supabase Auth (cloud) | License key |
| Subscription check | Supabase API | License validation |
| Analytics | Vercel Analytics | Disabled |
| Bundle size | Standard | Optimized (smaller) |
| Internet required | Yes | No |
| Deployment | Cloud (Vercel) | Self-hosted / Local |
| Support | Standard | Dedicated + Training |

### Building Standalone Versions

```bash
# ESCAPECRAFT standalone (from monorepo root)
cd apps/craft
VITE_BUILD_MODE=standalone VITE_LICENSE_KEY="<license>" pnpm build
# Output: dist/index.html (single file, ~2MB)

# ESCAPEARTIST standalone
cd apps/artist
VITE_BUILD_MODE=standalone VITE_LICENSE_KEY="<license>" pnpm build
# Output: dist/index.html (single file, ~3MB)
```

### License Key Format

Standalone builds require a license key embedded at build time:

```env
VITE_LICENSE_KEY=eyJpZCI6InVuaXF1ZS1pZCIsImN1c3RvbWVyIjoiQ3VzdG9tZXIgTmFtZSIsInByb2R1Y3QiOiJzdWl0ZSIsImlzc3VlZCI6IjIwMjUtMDEtMDVUMDA6MDA6MDBaIiwiZXhwaXJlcyI6IjIwMjYtMDEtMDVUMDA6MDA6MDBaIn0=.signature
```

License payload structure:
```json
{
  "id": "unique-license-id",
  "customer": "Customer Name",
  "product": "craft" | "artist" | "suite",
  "issued": "2025-01-05T00:00:00Z",
  "expires": "2026-01-05T00:00:00Z"
}
```

### Generating Licenses (Internal)

Use the license generation script:

```bash
cd apps/plan
node scripts/generate-license.js "Customer Name" suite "2027-01-01"
```

### Distributing Standalone Builds

The standalone build produces a single HTML file that:
- Contains all CSS, JS, and assets inlined
- Requires no external dependencies
- Can be opened directly from filesystem
- Can be hosted on any static server
- Works in air-gapped/restricted environments
- Includes embedded license for offline validation

---

## Possible Improvements

### ESCAPEPLAN

| Area | Improvement | Priority |
|------|-------------|----------|
| Testing | Add component tests for Dashboard, Home pages | Medium |
| Testing | Add Supabase Auth integration tests | Medium |
| Features | Implement usage analytics dashboard | Low |
| Features | Add project gallery/showcase | Low |
| Performance | Code-split auth bundle | Low |
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
| Features | Add audio waveform visualization | High |
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
| Coverage | Implement auth mocking for dashboard tests | High |
| Coverage | Add full CRAFT → ARTIST integration test | High |
| Coverage | Add export flow E2E tests | Medium |
| Fixtures | Add sample video files for import tests | Medium |
| Performance | Parallelize tests across apps | Low |

### Cross-Cutting

| Area | Improvement | Priority |
|------|-------------|----------|
| DevOps | Add staging environment | Medium |
| DevOps | Add automated dependency updates (Dependabot) | Medium |
| Security | Add license server for standalone validation | Medium |
| Docs | Add user documentation/help system | Medium |
| Docs | Add API documentation for integration | Low |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        ESCAPEPLAN                                │
│                    (Hub / Landing Page)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │  Supabase   │  │   Stripe    │  │  Supabase   │              │
│  │   (Auth)    │  │ (Payments)  │  │  (Backend)  │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└────────────────────────┬────────────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          │                             │
          ▼                             ▼
┌─────────────────────┐     ┌─────────────────────┐
│    ESCAPECRAFT      │     │    ESCAPEARTIST     │
│    (Recorder)       │────▶│     (Editor)        │
│                     │     │                     │
│ • Screen capture    │     │ • Multi-track       │
│ • Webcam/mic        │     │ • Keyframes         │
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

## Licensing

### Proprietary License

All ESCAPE Suite repositories are protected under a **Proprietary Software License**:

- All rights reserved by Bonham Technologies, LLC
- Source code is confidential and proprietary
- No redistribution, modification, or reverse engineering permitted
- Authorized use only under valid license agreement
- No warranty provided; liability limited

### License Tiers (Site License)

The air-gapped Site License is a per-org annual license (NOT per-seat):

| Band | Approx. size | Support | Price |
|------|--------------|---------|-------|
| **Team** | up to ~25 | Standard | $2,400/year |
| **Organization** | up to ~250 | Dedicated + training | $9,600/year |
| **Enterprise / Site** | larger / custom | Dedicated + training | Contact us |

Custom pricing is available for multi-site deployments and extended support. Contact sales@escapesuite.io for a quote.

### License Files

| File | Purpose |
|------|---------|
| `LICENSE` | Proprietary license terms (all repos) |

> Site License terms are folded into the `/terms` page (`Terms.tsx`); there is no separate
> EULA document or route.

### Individual Pro vs Site License

| Aspect | Individual Pro (connected SaaS) | Site License (air-gapped) |
|--------|---------------------------------|---------------------------|
| Target | Individuals | Organizations (per-org annual license) |
| Authentication | Supabase Auth (cloud) | License key validation |
| Subscription | Stripe billing ($9/mo or $89/yr) | Annual org license |
| Updates | Automatic | Manual delivery |
| Support | Standard (included) | Dedicated + training |
| Data | Client-side (private) | Client-side (private), offline |
| Internet | Required for auth | Not required (air-gapped) |

---

*Documentation updated: January 9, 2026*
