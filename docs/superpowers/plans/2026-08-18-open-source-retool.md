# ESCAPE Suite Open-Source Retool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip all monetization/auth/licensing/watermark code from ESCAPE Suite, relicense as MIT, rework the landing page into a free "Use now" front door, move offline builds to GitHub Releases, and then sweep dependencies current.

**Architecture:** The paywall is a single all-or-nothing gate in `packages/shared/src/auth` (SaaS: Supabase subscription check; standalone: Ed25519 license key) wired around each app by `bootstrapApp`, plus one watermark branch in ARTIST's ExportDialog (CRAFT's watermark is dead code). Removal proceeds top-down — first unmount the gates (Task 1), then remove per-app consumption (Tasks 2–4), then strip the plan app and its Supabase backend (Tasks 5–7), then delete the now-orphaned shared modules (Task 8), then infra/tests/docs (Tasks 9–12), then verify + PR (Task 13). Each task leaves the monorepo lint/test/build green.

**Tech Stack:** Turborepo + pnpm 9 workspaces, React 19, Vite 8, Vitest 4, Playwright, GitHub Actions, Vercel static hosting.

**Spec:** `docs/superpowers/specs/2026-08-18-open-source-retool-design.md`

## Global Constraints

- License becomes **MIT**, copyright holder **Bonham Technologies, LLC**.
- `@supabase/supabase-js`, `@stripe/stripe-js`, `@stripe/react-stripe-js` must not remain in any `package.json`.
- `VITE_BUILD_MODE` (`saas` | `standalone`) **survives**: `standalone` now means *offline* (no analytics, no hub link), never *licensed*. `isSaaSMode()` / `isStandaloneMode()` move to `@escapesuite/shared/config`.
- `react-router-dom` must land at `^7.18.2` (security: 2 HIGH + 3 MODERATE advisories).
- After every `package.json` dependency change, run `pnpm install` so `pnpm-lock.yaml` stays in sync (CI uses `--frozen-lockfile`).
- Work happens on branch `feat/open-source-retool` (already created off `origin/main`).
- Every commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- GitHub repo: `Bonham-Technologies/ESCAPESUITE`. GitHub URL constant: `https://github.com/Bonham-Technologies/ESCAPESUITE`; releases: `https://github.com/Bonham-Technologies/ESCAPESUITE/releases/latest`.
- Never commit secrets. Never run destructive operations against live Supabase/Stripe — external teardown is the user's manual checklist.
- **Known follow-up:** open PR #250 (`feat/headless-artist-bundle`) passes `watermark` positionally to `exportToWebM`/`exportToMP4` in `src/headless/renderProject.ts`; after this PR merges, #250 needs a rebase dropping that argument. Note this in the PR description.

---

### Task 1: Shared config module + ungated bootstrap

**Files:**
- Create: `packages/shared/src/config/index.ts`
- Modify: `packages/shared/package.json` (exports map)
- Modify: `packages/shared/src/bootstrap/index.tsx` (full rewrite)
- Modify: `apps/craft/src/main.tsx`, `apps/artist/src/main.tsx`

**Interfaces:**
- Produces: `@escapesuite/shared/config` exporting `BUILD_MODE: string`, `isSaaSMode(): boolean`, `isStandaloneMode(): boolean`. Later tasks re-point all `isStandaloneMode` imports here.
- Produces: `bootstrapApp(config: { rootId?: string; App: ComponentType }): void` — no gates, no async.

- [ ] **Step 1: Create the config module**

`packages/shared/src/config/index.ts`:

```ts
// Build-time configuration.
// 'saas' (default) = hosted at escapesuite.io (Vercel Analytics enabled).
// 'standalone' = offline single-file build (no analytics, no network).
export const BUILD_MODE = import.meta.env.VITE_BUILD_MODE || 'saas'

export const isSaaSMode = (): boolean => BUILD_MODE === 'saas'
export const isStandaloneMode = (): boolean => BUILD_MODE === 'standalone'
```

- [ ] **Step 2: Add the export entry**

In `packages/shared/package.json`, add to `"exports"` (keep all existing entries for now — `./auth` and `./watermark` are still consumed until Task 8):

```json
    "./config": "./src/config/index.ts",
```

- [ ] **Step 3: Rewrite bootstrap**

Replace the entire contents of `packages/shared/src/bootstrap/index.tsx` with:

```tsx
// App bootstrap utilities for consistent initialization

import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import { isSaaSMode } from '../config'

export interface BootstrapConfig {
  /** The root element ID (default: 'root') */
  rootId?: string
  /** The main App component */
  App: ComponentType
}

/**
 * Bootstrap an ESCAPE Suite app.
 * Analytics are only mounted in hosted (saas) builds — standalone builds run
 * fully offline and must make no network requests.
 */
export function bootstrapApp(config: BootstrapConfig): void {
  const { rootId = 'root', App } = config

  const rootElement = document.getElementById(rootId)
  if (!rootElement) {
    throw new Error(`Root element #${rootId} not found`)
  }

  createRoot(rootElement).render(
    <StrictMode>
      <App />
      {isSaaSMode() && <Analytics />}
    </StrictMode>
  )
}

export type { BootstrapConfig as AppBootstrapConfig }
```

- [ ] **Step 4: Update both app entry points**

`apps/craft/src/main.tsx` (whole file):

```tsx
import './index.css'
import App from './App.tsx'
import { bootstrapApp } from '@escapesuite/shared/bootstrap'

bootstrapApp({ App })
```

`apps/artist/src/main.tsx` (whole file):

```tsx
import './styles/index.css'
import App from './App'
import { bootstrapApp } from '@escapesuite/shared/bootstrap'

bootstrapApp({ App })
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter=@escapesuite/shared --filter=@escapesuite/craft --filter=@escapesuite/artist test:run && pnpm --filter=@escapesuite/craft --filter=@escapesuite/artist build`
Expected: PASS / builds succeed. (The gate modules still exist; they're just unmounted.)

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(shared)!: ungate bootstrap — render App directly, add shared config module"
```

---

### Task 2: ARTIST — remove watermark + delete src/auth

**Files:**
- Modify: `apps/artist/src/components/Export/ExportDialog.tsx` (lines 6–7, 32, 110–117, and the `isTrial` entry in the `useCallback` deps ~line 175)
- Modify: `apps/artist/src/core/exportMP4.ts` (signature ~line 76, import ~line 17, draw block ~line 527)
- Modify: `apps/artist/src/core/exportWebM.ts` (signature ~line 44, import ~line 17, draw block ~line 434)
- Modify: `apps/artist/src/App.tsx:20`
- Delete: `apps/artist/src/utils/watermark.ts`, `apps/artist/src/auth/` (entire directory: AuthContext.ts, AuthGate.tsx, config.ts, index.ts, license.ts, subscription.ts)

**Interfaces:**
- Produces: `exportToMP4(clips, sourceVideos, options, onProgress, tracks?, signal?, projectResolution?)` and identically-shaped `exportToWebM` — the `watermark` positional parameter (previously 6th) is gone. PR #250 must adapt to this after merge.

- [ ] **Step 1: ExportDialog — drop the trial/watermark branch**

Remove these imports (lines 6–7):
```ts
import { useAuth } from '../../auth';
import { defaultWatermarkConfig } from '../../utils/watermark';
```
Remove line 32: `const { isTrial } = useAuth();`
Remove lines 109–110 (`// Add watermark for trial users` + `const watermark = isTrial ? defaultWatermarkConfig : null;`).
Change the two export calls (lines 113/116) from:
```ts
blob = await exportToMP4(clips, sourceVideos, exportOptions, onProgress, tracks, watermark, abortController.signal, projectResolution);
```
to:
```ts
blob = await exportToMP4(clips, sourceVideos, exportOptions, onProgress, tracks, abortController.signal, projectResolution);
```
(same for `exportToWebM`). Remove `isTrial` from the `handleExport` `useCallback` dependency array.

- [ ] **Step 2: Exporters — remove the parameter**

In both `exportMP4.ts` and `exportWebM.ts`:
- Remove `watermark?: WatermarkConfig | null,` from the signature (the param between `tracks?` and `signal?`).
- Remove the import `import { drawWatermark, type WatermarkConfig } from '../utils/watermark';`
- Remove the block:
```ts
      // Draw watermark if enabled (for trial users)
      if (watermark) {
        drawWatermark(ctx, width, height, watermark);
      }
```
- Run `grep -rn 'exportToMP4\|exportToWebM' apps/artist/src --include='*.ts*' | grep -v 'core/export'` — the only call sites are the two in ExportDialog (verified: `core/exporter.ts` only re-exports). If any test file passes a watermark argument, drop that argument.

- [ ] **Step 3: Delete auth shims, re-point App.tsx**

```bash
git rm -r apps/artist/src/auth apps/artist/src/utils/watermark.ts
```
In `apps/artist/src/App.tsx` line 20, change `import { isStandaloneMode } from './auth';` to `import { isStandaloneMode } from '@escapesuite/shared/config';`

- [ ] **Step 4: Verify**

Run: `pnpm --filter=@escapesuite/artist test:run && pnpm --filter=@escapesuite/artist build && grep -rn 'watermark\|useAuth\|isTrial' apps/artist/src --include='*.ts*' -i`
Expected: tests PASS, build OK, grep returns nothing.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(artist)!: remove trial watermark and auth shims — exports are unconditionally clean"
```

---

### Task 3: CRAFT — remove dead watermark + delete src/auth

**Files:**
- Modify: `apps/craft/src/core/compositor.ts` (lines 5, 12, 51, 186–190)
- Modify: `apps/craft/src/App.tsx` (line 19 import; delete stale comments on lines 389, 393, 403, 412, 461, 477)
- Delete: `apps/craft/src/core/watermark.ts`, `apps/craft/src/auth/` (entire directory)

**Interfaces:**
- Consumes: `@escapesuite/shared/config` from Task 1.
- Produces: `CompositorConfig` without the `watermark` field.

- [ ] **Step 1: Compositor cleanup**

In `apps/craft/src/core/compositor.ts` remove:
- line 5: `import { drawWatermark, type WatermarkConfig } from './watermark';`
- line 12: `watermark?: WatermarkConfig | null; // Optional watermark config`
- line 51: `watermark: config.watermark || null,`
- lines 186–190 (the `// Draw watermark if configured` block).
Check `grep -n -i watermark apps/craft/src/core/compositor.test.ts` (if the file exists) and remove any watermark-config test cases.

- [ ] **Step 2: App.tsx cleanup**

Change line 19 to `import { isStandaloneMode } from '@escapesuite/shared/config';` (keep the `!isStandaloneMode()` branch at line ~628 — it hides the hub link in offline builds).
Delete the six stale comment lines claiming watermarks are "applied at export" (lines 389, 393, 403, 412, 461, 477) — no code implements that; keep the surrounding code.

- [ ] **Step 3: Delete files**

```bash
git rm -r apps/craft/src/auth apps/craft/src/core/watermark.ts
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter=@escapesuite/craft test:run && pnpm --filter=@escapesuite/craft build && grep -rn -i 'watermark\|license\|useAuth' apps/craft/src --include='*.ts*'`
Expected: PASS, build OK, grep empty.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(craft)!: delete dead watermark plumbing and auth shims"
```

---

### Task 4: CRAFT + ARTIST build config / env cleanup

**Files:**
- Modify: `apps/craft/vite.config.ts`, `apps/artist/vite.config.ts`
- Rewrite: `apps/craft/.env.example`, `apps/artist/.env.example`

- [ ] **Step 1: Vite configs**

In both files remove:
- The whole warning block (`// Warn loudly when a standalone build...` through the closing `}` — craft lines ~7–15).
- The `VITE_LICENSE_KEY` define (the 4-line `JSON.stringify(...)` expression with `__ESCAPE_LICENSE_PLACEHOLDER__`) and its two comment lines.
Keep the `'import.meta.env.VITE_BUILD_MODE'` define exactly as is.

- [ ] **Step 2: Env examples**

Replace both `apps/craft/.env.example` and `apps/artist/.env.example` entirely with:

```
# Build Mode: 'saas' (default, hosted — enables Vercel Analytics) or
# 'standalone' (offline single-file build — no analytics, no network)
VITE_BUILD_MODE=saas
```

- [ ] **Step 3: Verify the offline build is ungated with zero env**

Run: `env -u VITE_LICENSE_PUBLIC_KEY -u VITE_LICENSE_KEY VITE_BUILD_MODE=standalone pnpm --filter=@escapesuite/craft build && VITE_BUILD_MODE=standalone pnpm --filter=@escapesuite/artist build && grep -c ESCAPE_LICENSE_PLACEHOLDER apps/craft/dist/index.html apps/artist/dist/index.html || true`
Expected: builds succeed; the grep finds **0** placeholder occurrences.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "build(craft,artist): drop license key injection from standalone builds"
```

---

### Task 5: PLAN — landing rework (Home, Header, launch helper, analytics)

**Files:**
- Create: `apps/plan/src/lib/launch.ts`
- Rewrite: `apps/plan/src/pages/Home.tsx`, `apps/plan/src/pages/Home.test.tsx`
- Modify: `apps/plan/src/components/Layout/Header.tsx` (remove AccountMenu + auth branches)
- Rewrite: `apps/plan/src/lib/analytics.ts`; modify `apps/plan/src/lib/analytics.test.ts`
- Modify: `apps/plan/src/pages/Home.module.css` (prune pricing styles; add `.ctaSecondary` if needed)

**Interfaces:**
- Produces: `launchTool(tool: 'craft' | 'artist'): void`, `toolUrl(tool): string`, `GITHUB_URL`, `RELEASES_URL` from `../lib/launch`.
- Produces: `analytics.toolLaunched(tool: 'craft' | 'artist')` — the only surviving custom event.

- [ ] **Step 1: Write failing Home tests**

Replace `apps/plan/src/pages/Home.test.tsx` with tests asserting the new landing (adapt render helper from the existing file — it wraps in `MemoryRouter`):

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Home from './Home'

function renderHome() {
  return render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>
  )
}

describe('Home (open-source landing)', () => {
  it('renders the hero with Use-now CTAs for both tools', () => {
    renderHome()
    expect(screen.getByRole('button', { name: /start recording/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open the editor/i })).toBeInTheDocument()
  })

  it('links to GitHub and the offline build download', () => {
    renderHome()
    const github = screen.getAllByRole('link', { name: /github/i })[0]
    expect(github).toHaveAttribute('href', 'https://github.com/Bonham-Technologies/ESCAPESUITE')
    const download = screen.getAllByRole('link', { name: /offline build/i })[0]
    expect(download).toHaveAttribute(
      'href',
      'https://github.com/Bonham-Technologies/ESCAPESUITE/releases/latest'
    )
  })

  it('has no pricing, sign-in, or trial content', () => {
    renderHome()
    expect(screen.queryByText(/pricing/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/free trial/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument()
  })

  it('describes the suite as free and open source', () => {
    renderHome()
    expect(screen.getAllByText(/open source/i).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter=@escapesuite/plan test:run -- Home`
Expected: FAIL (old Home has pricing/sign-up content).

- [ ] **Step 3: Create the launch helper**

`apps/plan/src/lib/launch.ts`:

```ts
import { analytics } from './analytics'

export type ToolId = 'craft' | 'artist'

export const GITHUB_URL = 'https://github.com/Bonham-Technologies/ESCAPESUITE'
export const RELEASES_URL = `${GITHUB_URL}/releases/latest`

const PROD_URLS: Record<ToolId, string> = { craft: '/craft/', artist: '/artist/' }
const DEV_URLS: Record<ToolId, string> = {
  craft: 'http://localhost:5174',
  artist: 'http://localhost:5175',
}

export function toolUrl(tool: ToolId): string {
  return import.meta.env.DEV ? DEV_URLS[tool] : PROD_URLS[tool]
}

export function launchTool(tool: ToolId): void {
  analytics.toolLaunched(tool)
  if (import.meta.env.DEV) {
    window.open(toolUrl(tool), '_blank')
  } else {
    window.location.assign(toolUrl(tool))
  }
}
```

- [ ] **Step 4: Rewrite Home.tsx**

Replace `apps/plan/src/pages/Home.tsx` entirely. Keep the existing hero/tools/features JSX structure and CSS-module classes; the SVG icons for the tool cards and features are unchanged from the current file. Content changes:

```tsx
import { launchTool, GITHUB_URL, RELEASES_URL } from '../lib/launch'
import styles from './Home.module.css'

export default function Home() {
  return (
    <div className={styles.home}>
      {/* Hero Section */}
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <h1 className={styles.heroTitle}>
            How-to videos for networks<br />
            <span className={styles.gradient}>the cloud can't reach.</span>
          </h1>
          <p className={styles.heroSubtitle}>
            ESCAPE Suite records and edits screencasts entirely in the browser — free and
            open source. Capture a walkthrough, trim the mistakes, blur anything sensitive,
            and share it with shift workers and remote sites — without a single byte
            leaving the building.
          </p>
          <div className={styles.heroCta}>
            <button className="primary" onClick={() => launchTool('craft')}>
              Start recording
            </button>
            <button onClick={() => launchTool('artist')}>Open the editor</button>
          </div>
          <p className={styles.heroLinks}>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">View on GitHub</a>
            {' · '}
            <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
              Download the offline build
            </a>
          </p>
        </div>
      </section>

      {/* Tools Section — keep the two existing tool cards verbatim (icons,
          headings, copy, feature lists), and add a Use-now button at the
          bottom of each card: */}
      {/*   <button className="primary" onClick={() => launchTool('craft')}>Use ESCAPECRAFT</button>   */}
      {/*   <button className="primary" onClick={() => launchTool('artist')}>Use ESCAPEARTIST</button> */}

      {/* Features Section — keep the four feature cards, with copy updated to
          drop license/account wording (exact copy below). */}

      {/* Open Source Section — replaces the old Pricing section */}
      <section className={styles.cta}>
        <h2>Free &amp; open source</h2>
        <p>
          ESCAPE Suite is MIT-licensed. Use the hosted apps right here, self-host the
          static build, or grab the offline single-file build for air-gapped networks.
        </p>
        <div className={styles.heroCta}>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            <button className="primary">View on GitHub</button>
          </a>
          <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
            <button>Download offline build</button>
          </a>
        </div>
      </section>
    </div>
  )
}
```

Feature-card copy updates (headings keep their icons):
- **Runs air-gapped** → "The offline build is 100% in-browser and fully offline. Drop the single HTML file onto your isolated network — no internet, ever."
- **One copy, whole org** → "Host a single file internally; everyone on your network just opens it and works."
- **Nothing leaves the building** → "No uploads, no accounts, no telemetry in the offline build — your footage stays on the device."
- **No installers** → unchanged.

Notes: no `useEffect`/`useRef`/`IntersectionObserver`/`analytics.pricingViewed` — delete all of it. No `react-router-dom` or `../lib/auth` imports. Add a `.heroLinks` class to `Home.module.css` (small, muted, margin-top) and delete the `.pricing*`/`.badge`/`.option*`/`.startingAt` style blocks.

- [ ] **Step 5: Rework Header**

In `apps/plan/src/components/Layout/Header.tsx`: delete the entire `AccountMenu` component and the `useState/useRef/useEffect/useNavigate/auth` imports. The header becomes:

```tsx
import { Link } from 'react-router-dom'
import { ThemeToggle } from '@escapesuite/shared/theme'
import { GITHUB_URL } from '../../lib/launch'
import styles from './Layout.module.css'

export default function Header() {
  return (
    <header className={styles.header}>
      <Link to="/" className={styles.logo} aria-label="ESCAPE Suite Home">
        {/* keep the existing logo SVG + spans verbatim */}
      </Link>

      <nav className={styles.nav} aria-label="Main navigation">
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
        <ThemeToggle />
      </nav>
    </header>
  )
}
```

Check `apps/plan/src/components/Layout/Layout.test.tsx` (or Header tests) and update any assertions about Pricing/Sign In/Dashboard links to the new nav (GitHub link + theme toggle).

- [ ] **Step 6: Prune analytics**

Replace `apps/plan/src/lib/analytics.ts` with:

```ts
// ESCAPEPLAN Analytics
export { trackEvent } from '@escapesuite/shared/analytics'

import { trackEvent } from '@escapesuite/shared/analytics'

// ESCAPEPLAN Events
export const analytics = {
  toolLaunched: (tool: 'craft' | 'artist') => trackEvent('Tool Launched', { tool }),
}
```

Update `apps/plan/src/lib/analytics.test.ts`: keep only the `toolLaunched` case; delete tests for pricingViewed/checkoutStarted/signUpCompleted/trialActivated/subscriptionActivated/enterpriseInquiry.

- [ ] **Step 7: Run the Home tests to verify they pass**

Run: `pnpm --filter=@escapesuite/plan test:run -- Home`
Expected: PASS. (The rest of plan's suite still passes because Dashboard/Pricing/auth files still exist until Task 6.)

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(plan): open-source landing — Use-now CTAs, GitHub/offline-build links, no pricing"
```

---

### Task 6: PLAN — delete auth/billing surface

**Files:**
- Delete: `apps/plan/src/pages/Pricing/` (whole dir), `Dashboard.tsx`, `Dashboard.module.css`, `Dashboard.test.tsx`, `SignIn.tsx`, `SignIn.test.tsx`, `SignUp.tsx`, `SignUp.test.tsx`, `Auth.module.css`, `apps/plan/src/components/Auth/` (whole dir), `apps/plan/src/components/Checkout/` (whole dir), `apps/plan/src/lib/auth.tsx`, `apps/plan/src/lib/subscription.ts`, `apps/plan/src/lib/subscription.test.ts`, `apps/plan/src/lib/supabase.ts`, `apps/plan/src/hooks/useSubscription.ts`, `apps/plan/src/hooks/useSubscription.test.ts`
- Rewrite: `apps/plan/src/App.tsx`
- Modify: `apps/plan/src/test/setup.ts`

**Interfaces:**
- Produces: routes `/`, `/privacy`, `/terms`, catch-all → `/`. Nothing else.

- [ ] **Step 1: Delete**

```bash
git rm -r apps/plan/src/pages/Pricing apps/plan/src/components/Auth apps/plan/src/components/Checkout
git rm apps/plan/src/pages/Dashboard.tsx apps/plan/src/pages/Dashboard.module.css apps/plan/src/pages/Dashboard.test.tsx \
  apps/plan/src/pages/SignIn.tsx apps/plan/src/pages/SignIn.test.tsx apps/plan/src/pages/SignUp.tsx \
  apps/plan/src/pages/SignUp.test.tsx apps/plan/src/pages/Auth.module.css \
  apps/plan/src/lib/auth.tsx apps/plan/src/lib/subscription.ts apps/plan/src/lib/subscription.test.ts \
  apps/plan/src/lib/supabase.ts apps/plan/src/hooks/useSubscription.ts apps/plan/src/hooks/useSubscription.test.ts
```

- [ ] **Step 2: Rewrite App.tsx**

```tsx
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout/Layout'
import Home from './pages/Home'
import { Privacy, Terms } from './pages/Legal'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="privacy" element={<Privacy />} />
        <Route path="terms" element={<Terms />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
```

- [ ] **Step 3: Clean the test setup**

In `apps/plan/src/test/setup.ts`: delete the `makeChain` helper, the `mockSupabase` object, the `vi.mock('@escapesuite/shared/auth', ...)` block, and the `export { mockSupabase }` line. Keep the shared setup import, `vi.restoreAllMocks`, the fetch stub, the `window.location` stub, and the `IntersectionObserver` stub (drop its "(used by analytics for pricing section)" comment). Then run `grep -rn mockSupabase apps/plan/src` and remove any remaining usages (they should all be in files already deleted).

- [ ] **Step 4: Verify**

Run: `pnpm --filter=@escapesuite/plan test:run && pnpm --filter=@escapesuite/plan build && grep -rn 'useUser\|SignedIn\|SignedOut\|useSubscription\|createCheckout\|stripe' apps/plan/src -i --include='*.ts*'`
Expected: PASS, build OK, grep empty (App.test.tsx, if present, may need route assertions updated).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(plan)!: remove auth, dashboard, pricing, and checkout surfaces"
```

---

### Task 7: PLAN — delete Supabase backend + dependency cleanup

**Files:**
- Delete: `apps/plan/supabase/` (entire tree — 11 Edge Functions, 16 migrations, config.toml, `_shared/`)
- Modify: `apps/plan/package.json`, `apps/plan/eslint.config.js` (remove `supabase/functions` ignore if present)
- Rewrite: `apps/plan/.env.example`

- [ ] **Step 1: Delete the backend**

```bash
git rm -r apps/plan/supabase
```
Check `grep -n supabase apps/plan/eslint.config.js apps/plan/tsconfig*.json` and remove any ignore/exclude entries referencing it.

- [ ] **Step 2: Dependencies**

In `apps/plan/package.json`:
- Remove `"@stripe/react-stripe-js"`, `"@stripe/stripe-js"`, `"@supabase/supabase-js"` from dependencies.
- Change `"react-router-dom"` to `"^7.18.2"`.
- Change `"description"` to `"ESCAPE Suite hub & landing page"`.
Run `pnpm install`.

- [ ] **Step 3: Env example**

Replace `apps/plan/.env.example` entirely with:

```
# ESCAPEPLAN has no required environment variables.
# Optional:
# VITE_BUILD_MODE=saas   # 'saas' (default, hosted) or 'standalone' (offline)
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter=@escapesuite/plan test:run && pnpm --filter=@escapesuite/plan build && pnpm --filter=@escapesuite/plan lint`
Expected: all green. Also `pnpm audit --prod 2>&1 | tail -5` — the react-router advisories should be gone.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(plan)!: delete Supabase backend (11 edge functions, 16 migrations); drop Stripe/Supabase deps; bump react-router-dom to 7.18.2 (security)"
```

---

### Task 8: Delete shared auth + watermark modules

**Files:**
- Delete: `packages/shared/src/auth/` (entire dir), `packages/shared/src/watermark/` (entire dir)
- Modify: `packages/shared/package.json` (exports map + deps)

- [ ] **Step 1: Confirm nothing imports them anymore**

Run: `grep -rn "shared/auth\|shared/watermark" apps packages --include='*.ts*' | grep -v node_modules`
Expected: empty. If anything remains, fix it first (it's a missed consumer from Tasks 2–7).

- [ ] **Step 2: Delete**

```bash
git rm -r packages/shared/src/auth packages/shared/src/watermark
```
In `packages/shared/package.json`: remove the `"./auth"` and `"./watermark"` exports entries; remove `"@supabase/supabase-js"` from dependencies. Run `pnpm install`.

- [ ] **Step 3: Full-workspace verify**

Run: `pnpm lint && pnpm test && pnpm build`
Expected: all green across all packages.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(shared)!: delete auth gates, license system, subscription client, and watermark module"
```

---

### Task 9: Legal pages trim

**Files:**
- Modify: `apps/plan/src/pages/Legal/Terms.tsx`, `apps/plan/src/pages/Legal/Privacy.tsx`

- [ ] **Step 1: Terms.tsx**

Delete sections **3. User Accounts**, **4. Subscriptions and Payments**, **5. Site License**, and **8. Organization Use**; renumber the survivors sequentially. Rewrite section **2. Description of Services** to describe: free, MIT-licensed, browser-based recording/editing tools, offered as a hosted site and as downloadable offline builds, with all processing local to the user's device. Add one sentence to the renumbered agreement section: "The ESCAPE Suite software is open source under the MIT License; these terms govern use of the hosted service at escapesuite.io."

- [ ] **Step 2: Privacy.tsx**

- Section **2. Information We Collect**: remove account/billing items; state that the apps require no account and process all media locally in the browser (IndexedDB); the hosted site collects only anonymous Vercel Analytics pageview/usage events.
- Section **3/4**: trim references to subscriptions/payments accordingly.
- Section **5. Third-Party Services**: reduce to Vercel (hosting + analytics); remove Stripe, Supabase, Resend.
- Replace sections **6. Air-Gapped Site License Bundle** and **7. Site License (Per-Organization)** with a single section titled **"Offline Build"**: the downloadable single-file build makes no network requests at all — no analytics, no uploads, no telemetry.
- Renumber the remaining sections.

- [ ] **Step 3: Verify**

Run: `pnpm --filter=@escapesuite/plan test:run && pnpm --filter=@escapesuite/plan build && grep -n -i 'stripe\|supabase\|subscription\|license fee\|billing' apps/plan/src/pages/Legal/*.tsx`
Expected: green; grep returns nothing (the word "License" may appear only for the MIT reference).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs(plan): trim Terms/Privacy to free hosted service + offline build"
```

---

### Task 10: E2E overhaul

**Files:**
- Delete: `apps/e2e/tests/journeys/01-visitor-to-trial.spec.ts`, `03-trial-to-pro-upgrade.spec.ts`, `04-pro-cancellation-flow.spec.ts`, `05-standalone-purchase-download.spec.ts`, `07-standalone-license-activation.spec.ts`; `apps/e2e/tests/escapeplan/pricing.spec.ts`, `dashboard.spec.ts`, `downloads.spec.ts`; `apps/e2e/utils/stripe-mocks.ts`, `subscription-mocks.ts`, `license-mocks.ts`, `watermark-verification.ts`, `auth.ts`; `apps/e2e/fixtures/auth-fixtures.ts`
- Rename+rewrite: `apps/e2e/tests/journeys/02-trial-record-edit-export.spec.ts` → `01-record-edit-export.spec.ts`
- Modify: `apps/e2e/utils/index.ts` (prune barrel), `apps/e2e/playwright.config.ts`, `apps/e2e/playwright.journeys.config.ts`, `apps/e2e/playwright.standalone.config.ts`, `apps/e2e/tests/escapeplan/landing.spec.ts`, `apps/e2e/tests/escapeplan/components.spec.ts`, `apps/e2e/tests/standalone/craft.spec.ts`, `apps/e2e/tests/standalone/artist.spec.ts`, and every surviving spec that imports auth mocks (~20 files, listed in Step 3)

- [ ] **Step 1: Delete dead suites and utils**

```bash
git rm apps/e2e/tests/journeys/01-visitor-to-trial.spec.ts \
  apps/e2e/tests/journeys/03-trial-to-pro-upgrade.spec.ts \
  apps/e2e/tests/journeys/04-pro-cancellation-flow.spec.ts \
  apps/e2e/tests/journeys/05-standalone-purchase-download.spec.ts \
  apps/e2e/tests/journeys/07-standalone-license-activation.spec.ts \
  apps/e2e/tests/escapeplan/pricing.spec.ts apps/e2e/tests/escapeplan/dashboard.spec.ts \
  apps/e2e/tests/escapeplan/downloads.spec.ts \
  apps/e2e/utils/stripe-mocks.ts apps/e2e/utils/subscription-mocks.ts \
  apps/e2e/utils/license-mocks.ts apps/e2e/utils/watermark-verification.ts \
  apps/e2e/utils/auth.ts apps/e2e/fixtures/auth-fixtures.ts
```
Prune `apps/e2e/utils/index.ts` to re-export only the surviving utils (accessibility, error-mocks, indexeddb, media-mocks, viewports).

- [ ] **Step 2: Playwright configs**

In `playwright.config.ts` and `playwright.journeys.config.ts`: remove the `import { MOCK_SUPABASE_URL, MOCK_SUPABASE_ANON_KEY } from './utils/auth'` line and the `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY` entries from the injected env. Check `playwright.standalone.config.ts` for license/`VITE_LICENSE` env and remove it.

- [ ] **Step 3: Strip auth mocks from surviving specs**

For each file: `tests/responsive/{plan,craft,artist}.spec.ts`, `tests/integration/{indexeddb-sharing,workflows,craft-to-artist}.spec.ts`, `tests/accessibility/{core,screen-reader,keyboard-navigation}.spec.ts`, `tests/errors/{permissions,export,network,validation}.spec.ts`, `tests/escapeartist/{components,video-import,timeline-editing}.spec.ts`, `tests/escapecraft/{recording-flow,components}.spec.ts`, `tests/escapeplan/{landing,components}.spec.ts`:
remove `mockSignedIn`/`mockSignedOut` imports and calls (and any `subscription-mocks`/`auth-fixtures` usage). The apps now load without any session, so the setup simply disappears. Where a test asserted gated behavior (redirect to sign-in, upgrade prompts, "Access Denied"), delete that test case.

- [ ] **Step 4: Update escapeplan specs for the new landing**

`landing.spec.ts`: assert the hero renders, the "Start recording" and "Open the editor" buttons exist, the GitHub link points at `https://github.com/Bonham-Technologies/ESCAPESUITE`, and no "Sign In"/"Pricing" text exists. `components.spec.ts`: update header expectations (GitHub link + theme toggle; no auth buttons).

- [ ] **Step 5: Rewrite the flagship journey**

`git mv apps/e2e/tests/journeys/02-trial-record-edit-export.spec.ts apps/e2e/tests/journeys/01-record-edit-export.spec.ts` and edit it: keep the record→edit→export flow (media mocks, IndexedDB helpers) but remove all sign-in/trial/subscription setup and every watermark assertion. The journey is now: open craft → record (mocked media) → send to editor → edit → export → assert a file downloads.

- [ ] **Step 6: Simplify standalone specs**

In `tests/standalone/craft.spec.ts` and `artist.spec.ts`: remove license-modal/license-key steps; assert the offline build loads directly to the app UI (no gate, no modal).

- [ ] **Step 7: Verify**

Run: `pnpm build && pnpm test:e2e` (fast suite; builds are needed for e2e). Then `pnpm --filter=@escapesuite/e2e run test:journeys` and `pnpm test:e2e:standalone`.
Expected: all green. `grep -rn -i 'license\|stripe\|subscription\|watermark\|signedin\|mocksign' apps/e2e --include='*.ts'` returns nothing.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "test(e2e): remove auth/billing/license suites; free record-edit-export journey"
```

---

### Task 11: CI, release workflows, Vercel CSP, dependabot

**Files:**
- Modify: `.github/workflows/ci.yml`, `.github/workflows/standalone-release.yml`, `.github/workflows/release.yml`, `.github/dependabot.yml`, `vercel.json`

- [ ] **Step 1: ci.yml**

- `build` job (~line 169): delete the `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` env lines (keep `VITE_BUILD_MODE: saas`).
- `build-standalone` job: delete the entire "verify LICENSE_PUBLIC_KEY" step (the `if [ -z "${{ secrets.LICENSE_PUBLIC_KEY }}" ]` block, ~lines 365–374) and the `VITE_LICENSE_PUBLIC_KEY: ${{ secrets.LICENSE_PUBLIC_KEY }}` env line (~380). Keep `VITE_BUILD_MODE: standalone`.
- `test-standalone` job: delete the `VITE_LICENSE_PUBLIC_KEY: 334ad5...` line (~453) and the 4-line comment above it about the disposable test key; update the job's header comment (~line 417) to "Standalone E2E tests — verify offline single-file builds work correctly". Keep `VITE_BUILD_MODE: standalone`.
- `deploy` job: delete the `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` env lines (~544–545).

- [ ] **Step 2: standalone-release.yml**

Keep the `name:`/`on:`/concurrency header and the `prepare` job, minus the "Generate version.json" step. Delete the `deploy-dev` ("Deploy to Dev Storage") and `deploy-prod` ("Deploy to Production Storage") jobs entirely (all Supabase curl uploads and `SUPABASE_*` env). Replace them with:

```yaml
  comment-pr:
    name: PR Build Comment
    needs: prepare
    if: github.event_name == 'pull_request' || (github.event_name == 'workflow_run' && github.event.workflow_run.event == 'pull_request')
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - name: Comment on PR
        uses: actions/github-script@v8
        with:
          script: |
            // Reuse the existing PR-number resolution from the old Comment on PR
            // step, but point at the workflow artifact instead of dev storage:
            const runUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;
            const body = [
              '### 📦 Standalone builds ready',
              '',
              `Offline single-file builds for this PR are attached as the`,
              `\`standalone-release\` artifact on [this workflow run](${runUrl}).`,
            ].join('\n');
            // ...create-or-update comment exactly as the old step did

  release:
    name: Create GitHub Release
    needs: prepare
    if: github.event_name != 'pull_request' && (github.event_name != 'workflow_run' || github.event.workflow_run.event != 'pull_request')
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Download artifacts
        uses: actions/download-artifact@v6
        with:
          name: standalone-release
          path: dist
      - name: Create release with attached builds
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          VERSION: ${{ needs.prepare.outputs.version }}
        run: |
          gh release create "v${VERSION}" \
            dist/ESCAPECRAFT-${VERSION}.html \
            dist/ESCAPEARTIST-${VERSION}.html \
            --repo "${{ github.repository }}" \
            --title "ESCAPE Suite v${VERSION}" \
            --notes "Offline single-file builds. Download, open in Chrome/Edge, done — no install, no account, no internet."
```

Adapt to the file's actual conditions/`needs.prepare.outputs` (the prepare job already computes `version` and names artifacts `ESCAPECRAFT-{version}.html` etc. — check the "prepare release artifacts" step at ~line 73 for the exact filenames and reuse them; if `version` is not currently a job output, add it to `prepare`'s `outputs:`). Keep the existing artifact download/versioning logic untouched. Also keep/adjust the `-latest.html` copies only if the prepare step produces them — the release should attach the versioned files.

- [ ] **Step 3: release.yml**

Delete the "Generate version manifest" (`uploads/version.json`) portion and the entire "Upload to Supabase Storage" step (~lines 168–200). Check nothing later in the job references `uploads/` or `SUPABASE_*` (`grep -n 'uploads/\|SUPABASE' .github/workflows/release.yml` → expect empty after the edit).

- [ ] **Step 4: dependabot.yml**

Remove the `stripe` and `supabase` dependency groups (their packages no longer exist in the repo).

- [ ] **Step 5: vercel.json**

Replace the CSP header value with:

```
default-src 'self'; script-src 'self' 'unsafe-inline' https://vercel.live; style-src 'self' 'unsafe-inline'; frame-src https://vercel.live; connect-src 'self' https://api.vercel.com https://vercel.live; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:;
```

(Removes all `stripe.com`, `supabase.co`, and `challenges.cloudflare.com` hosts; keeps `vercel.live` for preview toolbar.) Rewrites/buildCommand unchanged.

- [ ] **Step 6: Verify**

Run: `npx --yes @action-validator/cli .github/workflows/ci.yml 2>/dev/null || python3 -c "import yaml,glob; [yaml.safe_load(open(f)) for f in glob.glob('.github/workflows/*.yml')]; print('YAML OK')"` and `grep -rn -i 'supabase\|stripe\|LICENSE_PUBLIC' .github/ vercel.json`
Expected: YAML parses; grep returns nothing.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "ci: attach offline builds to GitHub Releases; drop Supabase storage uploads and license-key gates"
```

---

### Task 12: MIT license, metadata, README, docs

**Files:**
- Rewrite: `LICENSE`, `README.md`
- Create: `CONTRIBUTING.md`
- Delete: `apps/plan/LICENSE`, `apps/craft/LICENSE`, `apps/artist/LICENSE`, `apps/e2e/LICENSE`, `apps/craft/EULA-STANDALONE.md`, `apps/artist/EULA-STANDALONE.md`, `docs/CUSTOMER-LICENSING-PLAN.md`, `docs/STRIPE-CHECKOUT-TEST-CHECKLIST.md`
- Modify: `package.json` + `apps/{plan,craft,artist,e2e}/package.json` + `packages/shared/package.json` (license fields), `CLAUDE.md`, `apps/plan/CLAUDE.md`, `apps/craft/CLAUDE.md`, `apps/artist/CLAUDE.md`, `docs/ENVIRONMENT_SETUP.md`, `docs/STANDALONE-TEST-BATTERY.md`, `ESCAPE-SUITE-DOCUMENTATION.md`

- [ ] **Step 1: LICENSE**

Replace root `LICENSE` with the standard MIT text:

```
MIT License

Copyright (c) 2025-2026 Bonham Technologies, LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

```bash
git rm apps/plan/LICENSE apps/craft/LICENSE apps/artist/LICENSE apps/e2e/LICENSE \
  apps/craft/EULA-STANDALONE.md apps/artist/EULA-STANDALONE.md \
  docs/CUSTOMER-LICENSING-PLAN.md docs/STRIPE-CHECKOUT-TEST-CHECKLIST.md
```

Set `"license": "MIT"` in root `package.json` and in `apps/plan`, `apps/craft`, `apps/artist` package.json (replacing the `SEE LICENSE IN` values); add `"license": "MIT"` to `apps/e2e/package.json` and `packages/shared/package.json`.

- [ ] **Step 2: README.md rewrite**

Full rewrite with these sections (keep the CI badge line):
1. **Title + one-liner**: "Free, open-source (MIT), privacy-first media creation tools that run entirely in the browser. Nothing you record or edit ever leaves your machine."
2. **Use it now**: escapesuite.io (hosted, free, no account) — table of the three apps with links; note "or download the offline build from [Releases](https://github.com/Bonham-Technologies/ESCAPESUITE/releases/latest) — a single HTML file that runs air-gapped."
3. **Features**: keep the existing ESCAPECRAFT/ESCAPEARTIST feature lists; ESCAPEPLAN row becomes "Landing page & hub".
4. **Quick start (development)**: `pnpm install`, `pnpm dev`, dev ports table, `pnpm build`, `pnpm build:standalone`.
5. **Self-hosting**: `pnpm build:deploy` → static `dist/` deployable to any static host; the offline build needs no host at all.
6. **Browser support**: exports require WebCodecs (Chrome/Edge); recording works in all modern browsers.
7. **Testing**: `pnpm test`, `pnpm test:e2e`.
8. **Contributing**: link CONTRIBUTING.md.
9. **License**: MIT.
Remove: the "Copyright … All Rights Reserved" line, all pricing, Supabase/Stripe/Resend references, and env-var docs for deleted vars.

- [ ] **Step 3: CONTRIBUTING.md**

```markdown
# Contributing to ESCAPE Suite

Thanks for helping! ESCAPE Suite is an MIT-licensed Turborepo monorepo (pnpm).

## Setup

​```bash
pnpm install
pnpm dev        # all apps: plan :5173, craft :5174, artist :5175
​```

## Before you open a PR

​```bash
pnpm lint && pnpm test && pnpm build
pnpm test:e2e   # Playwright (Chromium); needs `pnpm build` first
​```

- Keep PRs focused; follow the existing code style (ESLint enforces most of it).
- Add or update tests for behavior changes.
- Conventional-commit style titles (`feat:`, `fix:`, `chore:`…) are appreciated.

## Notes

- Everything runs client-side — no backend, no accounts, no uploads.
- Video export uses WebCodecs (Chrome/Edge only); recording works in all
  modern browsers.
​```
```

(Write the fences as normal triple backticks in the actual file.)

- [ ] **Step 4: CLAUDE.md updates**

- Root `CLAUDE.md`: remove Supabase Auth bullet from Shared Infrastructure; ESCAPEPLAN row/desc → "Landing page & hub"; delete the Environment Variables section's Supabase/Stripe vars (state: no required env; `VITE_BUILD_MODE` optional); update Vercel table intro (still accurate); rewrite the Standalone Release paragraph (GitHub Releases, no license injection, no Supabase Storage); remove journey-test counts ("69") and stale test counts (state counts are approximate or drop them); remove "Supabase Auth" architecture lines and `get-licensed-download` references.
- `apps/plan/CLAUDE.md`: full rewrite as a landing-page app doc: overview (landing + legal pages), structure (Home, Legal, Layout, lib/launch, lib/analytics), routes table (`/`, `/privacy`, `/terms`), tool integration ports (keep), theme section (keep verbatim), no env vars. Delete all pricing/licensing/auth/edge-function content.
- `apps/craft/CLAUDE.md`: delete the `watermark.ts` core-module bullet and the whole "Trial User Watermarking" section; change "build:standalone creates an auth-free version" wording to "offline single-file build".
- `apps/artist/CLAUDE.md`: same standalone wording; no watermark section exists — verify with `grep -n -i 'watermark\|license\|auth' apps/artist/CLAUDE.md` and prune whatever it finds.

- [ ] **Step 5: Other docs**

- `docs/ENVIRONMENT_SETUP.md`: rewrite to state no environment variables are required; keep only generic local-dev setup (pnpm, node) and `VITE_BUILD_MODE`.
- `docs/STANDALONE-TEST-BATTERY.md`: delete license-activation/purchase checklists; keep the functional offline-build checklists (open file, record, edit, export).
- `ESCAPE-SUITE-DOCUMENTATION.md`: remove pricing/auth/licensing sections (`grep -n -i 'stripe\|license\|subscription\|supabase' ESCAPE-SUITE-DOCUMENTATION.md` to find them); keep architecture content.

- [ ] **Step 6: Verify + commit**

Run: `pnpm lint && git grep -il stripe -- ':!pnpm-lock.yaml' ':!docs/superpowers'` (expect empty) and `git grep -il 'supabase' -- ':!pnpm-lock.yaml' ':!docs/superpowers'` (expect empty).

```bash
git add -A && git commit -m "docs!: MIT license, open-source README/CONTRIBUTING, purge monetization docs"
```

---

### Task 13: Final verification, secret scan, PR

- [ ] **Step 1: Clean-slate verification**

```bash
pnpm install --frozen-lockfile
pnpm lint && pnpm test && pnpm build
env -i PATH="$PATH" HOME="$HOME" pnpm build:standalone   # zero env vars
pnpm test:e2e
pnpm test:e2e:standalone
```
Expected: everything green with no Supabase/Stripe/license env anywhere.

- [ ] **Step 2: Acceptance greps**

```bash
git grep -iln 'stripe' -- ':!pnpm-lock.yaml' ':!docs/superpowers'          # expect empty
git grep -iln 'supabase' -- ':!pnpm-lock.yaml' ':!docs/superpowers'        # expect empty
git grep -ln 'LICENSE_KEY\|LICENSE_PUBLIC\|ESCAPE_LICENSE_PLACEHOLDER' -- ':!docs/superpowers'  # expect empty
git grep -iln 'watermark' -- ':!pnpm-lock.yaml' ':!docs/superpowers'       # expect empty
git grep -iln 'subscription' -- ':!pnpm-lock.yaml' ':!docs/superpowers'    # expect empty
```

- [ ] **Step 3: Git-history secret scan (go-public gate)**

```bash
# Preferred: gitleaks (brew install gitleaks || docker)
gitleaks git . --no-banner 2>&1 | tail -20
# Fallback if gitleaks unavailable — scan every historical blob for key patterns:
git rev-list --all | head -1 >/dev/null && git grep -iE 'sk_live_[A-Za-z0-9]|whsec_[A-Za-z0-9]{20}|-----BEGIN (RSA |EC )?PRIVATE KEY' $(git rev-list --all) -- 2>/dev/null | head -20
```
Report findings to the user. Any hit = STOP and surface it before the repo goes public.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/open-source-retool
```
Open a PR to `main` titled `feat!: open-source retool — MIT license, no accounts, free everything`. Body must include: summary of removals, the acceptance-grep results, the **manual teardown checklist** (Supabase project/functions/tables/bucket/secrets; Stripe webhook + products; Vercel env vars `VITE_STRIPE_PUBLISHABLE_KEY`/`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`; GitHub secrets `LICENSE_PUBLIC_KEY`, `SUPABASE_URL[_DEV]`, `SUPABASE_SERVICE_ROLE_KEY[_DEV]`, `VITE_SUPABASE_*`; Resend key), the note that historical release download links will 404 after Supabase teardown, the PR #250 rebase note (drop the `watermark` positional arg in `headless/renderProject.ts`), the secret-scan result, and the footer `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

### Task 14: PR 2 — dependency sweep (ONLY after PR 1 merges to main)

- [ ] **Step 1:** Rebase/merge Dependabot PRs #270 (actions), #271 (linting), #272 (build-tools), #273 (testing) — comment `@dependabot rebase` if stale, merge after CI green.
- [ ] **Step 2:** Close #259 (stripe — packages no longer exist) and #263 (superseded) with a one-line comment.
- [ ] **Step 3:** New branch `chore/dep-sweep` off main: `pnpm update -r` (patch/minor); remove `@types/uuid` from `apps/craft/package.json` (deprecated — uuid v14 ships its own types); add `"engines": { "node": ">=20" }` to root `package.json`; in `.github/dependabot.yml` add a `runtime` group (react, react-dom, react-router-dom, zustand, uuid, mp4box, idb, mediabunny excluded) and raise `open-pull-requests-limit` to 8. **Exclude `mediabunny` from this pass** (`pnpm update -r '!mediabunny'` or pin it) — it gets its own PR.
- [ ] **Step 4:** Verify: `pnpm lint && pnpm test && pnpm build && pnpm test:e2e`. PR + merge.
- [ ] **Step 5 (separate PR):** `mediabunny` 1.34.x → 1.55.x: read its changelog for breaking changes to `Output`/`Mp4OutputFormat`/`BufferTarget`/`EncodedVideoPacketSource` APIs, bump in `apps/artist` + `apps/craft`, run both apps' unit tests plus `pnpm test:e2e` export specs, and manually export an MP4+WebM via `pnpm dev:artist` before merging.
- [ ] **Step 6 (separate PR, optional):** dev-tooling majors: `@testing-library/jest-dom` 7, `jsdom` 30, `@types/node` 26, `@changesets/cli` 3.

---

## Plan Self-Review (completed)

- **Spec coverage:** every spec section maps to a task — shared strip (1–4, 8), plan strip + landing (5–7), legal (9), tests (10), CI/release/CSP (11), license/docs (12), acceptance + teardown checklist + secret scan (13), PR 2 (14). The `get-version` drop is covered by Task 7 (function deleted) + Task 11 (version.json steps removed).
- **Types:** `bootstrapApp({App})` in Task 1 matches usage in Task 1's main.tsx edits; exporter signature in Task 2 Step 2 matches the call sites in Step 1; `launchTool`/`GITHUB_URL` produced in Task 5 Step 3 match consumers in Steps 4–5 and Task 10's landing assertions.
- **Known deviation from spec:** the spec's e2e util `utils/auth.ts` deletion also requires playwright config edits (they import `MOCK_SUPABASE_URL` from it) — handled in Task 10 Step 2.
