# ESCAPE Suite Open-Source Retool — Design Spec

**Date:** 2026-08-18
**Status:** Approved by Matt (design review in session); implementation pending
**Branch:** `feat/open-source-retool` (off `main`)

## Goal

Retool ESCAPE Suite from a proprietary, subscription/license-gated product into an
MIT-licensed open-source project, while keeping the hosted deployment at
escapesuite.io as a free, no-account static site. Then bring dependencies current.

## Decisions (made with Matt, 2026-08-18)

| Decision | Choice |
|---|---|
| License | MIT (copyright holder: Bonham Technologies, LLC) |
| Accounts/auth | Removed entirely — no Supabase Auth, no sign-in anywhere |
| Standalone offline builds | Kept, ungated; distributed via GitHub Releases, linked from landing page |
| Existing customers | None — Stripe/Supabase billing backend deleted outright, no wind-down |
| Sequencing | Strip first (PR 1), dependency sweep second (PR 2), mediabunny + majors separately |

## End state

- Fully static monorepo: three Vite apps + shared package, no backend of any kind.
- Hosted site: landing page → "Use now" → `/craft/` and `/artist/`. No gates, no
  watermarks, no telemetry beyond Vercel Analytics pageviews/tool-launch events.
- Offline single-file HTML builds ("standalone" = offline, not licensed) attached
  directly to GitHub Releases by CI.
- `@supabase/supabase-js`, `@stripe/stripe-js`, `@stripe/react-stripe-js` removed
  from all package.json files.

## Background facts that shape the design

(From the codebase mapping pass, 2026-08-18.)

1. **No per-feature gating exists.** Payment gates *access* via a full-app wall in
   `packages/shared/src/auth` (SaaS: Supabase session + `subscriptions` table row;
   standalone: Ed25519-signed `ESCAPE-` license key), plus a trial watermark on
   ARTIST exports. CRAFT's watermark is dead code (commented, never applied).
2. **Standalone builds fail closed.** A build without `VITE_LICENSE_PUBLIC_KEY`
   rejects all licenses. The gate must be deleted from code; leaving it
   unconfigured produces a bricked build. CI also hard-fails on a missing
   `LICENSE_PUBLIC_KEY` secret (audit H4 guard) — that guard must go in the same PR.
3. **SaaS gating does not go through Edge Functions.** Clients read the
   `subscriptions` table directly under RLS; a signup trigger seeds trials.
   Deleting Edge Functions alone would leave gating intact.
4. **Existing GitHub Releases link to Supabase Storage URLs.** Historical release
   links will break when Supabase is torn down; future releases must attach files
   directly to the release.
5. **The artist exporters take `watermark` as a positional argument** with 4 call
   sites (ExportDialog ×2, headless/renderProject ×2) — removal must be atomic.
6. **`isStandaloneMode()` is dual-purpose**: it gates the license wall AND drives
   legitimate offline UX (analytics off, hub link hidden, no Supabase imports).
   The build-mode concept survives; only the licensing half is amputated.

## PR 1 — Open-source retool

### packages/shared

- Delete `src/auth/` (AuthGate, license, subscription, machineHash,
  LicenseInputModal, ExpirationBanner, ErrorScreen, context, barrel) and
  `src/watermark/`, with all their tests.
- Preserve `BUILD_MODE` / `isSaaSMode()` / `isStandaloneMode()` in a new small
  `src/config/` module (exported as `@escapesuite/shared/config`); delete the
  `LICENSE_KEY` and Supabase URL/key exports.
- `src/bootstrap/index.tsx`: render `<App/>` directly in both modes; keep
  `<Analytics/>` only in hosted (SaaS) mode. Update `BootstrapConfig` so craft and
  artist `main.tsx` compile in lockstep.
- `package.json`: remove `./auth` and `./watermark` exports entries, add
  `./config`; drop `@supabase/supabase-js`.

### apps/craft

- Delete `src/auth/` (all re-export shims) and `src/core/watermark.ts`.
- `src/core/compositor.ts`: remove the never-populated `watermark` config field,
  import, and draw call. Prune any compositor test references.
- `src/App.tsx`: delete the stale "watermark applied at export" comments; keep the
  `isStandaloneMode()` hub-link branch, re-pointed at `@escapesuite/shared/config`.
- `vite.config.ts`: remove `VITE_LICENSE_KEY` define (placeholder injection) and
  the missing-public-key warning; keep `VITE_BUILD_MODE`.
- `.env.example`: remove license vars and Supabase vars.
- Delete `EULA-STANDALONE.md`, per-app `LICENSE`; `package.json` license → MIT.

### apps/artist

- Delete `src/auth/` and `src/utils/watermark.ts`.
- Remove the `watermark` positional parameter end-to-end:
  `core/exportMP4.ts`, `core/exportWebM.ts`, `headless/types.ts`
  (`RenderInput.watermark`), and all 4 call sites atomically.
- `components/Export/ExportDialog.tsx`: drop `useAuth()`/`isTrial`/
  `defaultWatermarkConfig`; exports are unconditionally clean.
- `src/App.tsx`: re-point `isStandaloneMode` import to shared config.
- `vite.config.ts`, `.env.example`, `EULA-STANDALONE.md`, `LICENSE`,
  `package.json` license: same treatment as craft.

### apps/plan

- Delete: `pages/Pricing/`, `pages/Dashboard.*`, `pages/SignIn*`, `pages/SignUp*`,
  `pages/Auth.module.css`, `components/Auth/`, `components/Checkout/`,
  `lib/auth.tsx`, `lib/subscription.ts`, `lib/supabase.ts`,
  `hooks/useSubscription.ts` — each with its tests/styles.
- Delete the entire `supabase/` tree (11 Edge Functions, 16 migrations,
  config.toml, `_shared/`).
- `App.tsx`: routes shrink to `/`, `/privacy`, `/terms` + catch-all; delete
  `ProtectedRoute`.
- `Home.tsx`: keep hero, tools, features sections. Replace the pricing section and
  every trial/upgrade/sign-up CTA cluster with: **"Use now"** buttons for CRAFT and
  ARTIST (dev: `localhost:5174`/`5175`; prod: `/craft/`, `/artist/` — reuse
  Dashboard's `handleLaunchTool` logic), **"View on GitHub"**, and **"Download
  offline build"** (link to the repo's latest GitHub Release). Prune matching
  styles and rewrite `Home.test.tsx`.
- `Header.tsx`: logo, tool links, GitHub link, ThemeToggle; no auth branches, no
  Pricing link. Footer stays (Privacy/Terms).
- Legal pages: Terms loses Subscriptions and Site-License sections; Privacy
  simplified around "everything stays in your browser".
- `lib/analytics.ts`: keep pageviews + tool-launch events; delete conversion
  events (pricingViewed, checkout, trial, etc.).
- `package.json`: drop both Stripe packages and `@supabase/supabase-js`; bump
  `react-router-dom` to `^7.18.2` (security: 2 HIGH + 3 MODERATE advisories fixed
  there — Dependabot's PR slots are saturated so it lands here). License → MIT.

### CI / release / hosting

- `.github/workflows/ci.yml`: remove the `LICENSE_PUBLIC_KEY` fail-closed guard
  and env injection from `build-standalone`; remove the disposable test-key baking
  from `test-standalone`; remove Supabase/Stripe env from build and deploy jobs.
  `build-standalone` survives as a plain offline single-file build artifact job.
- `.github/workflows/standalone-release.yml`: delete both Supabase Storage upload
  steps and their secrets; attach `ESCAPECRAFT-{version}.html` /
  `ESCAPEARTIST-{version}.html` directly to the GitHub Release. PR preview comment
  points at the workflow artifact. Drop `version.json` upload; the `get-version`
  update-check feature is removed (Edge Function is deleted; no replacement).
- `.github/workflows/release.yml`: remove the Supabase service-key usage
  (lines ~187–196).
- `vercel.json`: trim Stripe and Supabase hosts from the CSP. Rewrites and
  `scripts/build-all.mjs` unchanged.

### Tests (unit + e2e)

- Unit tests for deleted modules go with their modules (license, watermark,
  machineHash, LicenseInputModal, subscription, useSubscription, Dashboard,
  Pricing, SignIn/SignUp, auth adapter, Layout/Home assertions on auth/pricing).
- e2e: delete journeys 01, 03, 04, 05, 07; delete `escapeplan/pricing.spec.ts`,
  `dashboard.spec.ts`, `downloads.spec.ts`; delete `utils/stripe-mocks.ts`,
  `subscription-mocks.ts`, `license-mocks.ts`, `watermark-verification.ts`,
  `utils/auth.ts`, `fixtures/auth-fixtures.ts`.
- Journey 02 is rewritten as the flagship free record→edit→export flow (no
  watermark assertions, no sign-in mocks). `landing.spec.ts` updated for the new
  Home. `standalone/*.spec.ts` simplified to "offline build mounts and works"
  (no license modal). `escapeartist`/`escapecraft` specs lose `mockSignedIn`.
- `playwright.journeys.config.ts` / `playwright.standalone.config.ts`: remove mock
  Supabase/Stripe env; fold or simplify as the surviving suites allow.

### Licensing & docs

- Root `LICENSE` → MIT. Delete `apps/{plan,craft,artist,e2e}/LICENSE` and both
  EULAs. All `package.json` `license` fields → `"MIT"`.
- `README.md`: full rewrite — what it is, use-it-now link, screenshots/feature
  list, self-hosting and local build instructions, browser-support constraints
  (WebCodecs = Chrome/Edge for ARTIST export), contributing pointer, MIT notice.
- Add a brief `CONTRIBUTING.md` (setup, test commands, PR expectations).
- Update root + per-app `CLAUDE.md` (remove auth/subscription/licensing
  architecture, stale Edge Function lists, stale test counts).
- Delete `docs/CUSTOMER-LICENSING-PLAN.md`, `docs/STRIPE-CHECKOUT-TEST-CHECKLIST.md`.
  Trim monetization content from `docs/ENVIRONMENT_SETUP.md` and
  `docs/STANDALONE-TEST-BATTERY.md`, and from `ESCAPE-SUITE-DOCUMENTATION.md`.
- `.env.example` files: only genuinely needed vars remain (essentially just
  `VITE_BUILD_MODE`, optional).

### Acceptance criteria for PR 1

- `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm build:standalone`, and the fast
  e2e suite all green with **no** Supabase/Stripe/license env vars set anywhere.
- Both apps load and export media in hosted and standalone builds with no gate,
  modal, or watermark.
- `git grep -iE 'stripe|license[_-]?key|subscription|watermark|supabase'` returns
  only intentional survivors (docs history, this spec, MIT license text, etc.).
- Landing page renders with Use-now/GitHub/Download links and no auth UI.

## PR 2 — Dependency sweep (after PR 1 merges)

1. Merge Dependabot #270 (actions), #271 (linting), #272 (build-tools); rebase as
   needed. Merge or fold #273 (testing).
2. Close stale #259 (stripe — moot after PR 1) and #263 (superseded).
3. One `pnpm update -r` pass for remaining patch/minors (react, zustand, uuid,
   vite, turbo, eslint, typescript-eslint, playwright, mp4box, globals, …).
4. Remove deprecated `@types/uuid` from `apps/craft`.
5. Add `"engines": { "node": ">=20" }` to root `package.json` (match CI).
6. `dependabot.yml`: add a runtime-deps group and/or raise
   `open-pull-requests-limit` so security-relevant runtime bumps aren't crowded out.

## Follow-up PRs (separate, verified individually)

- `mediabunny` 1.34.3 → 1.55.x (21 minors; core export path — changelog review +
  export e2e verification).
- Dev-tooling majors: `@testing-library/jest-dom` 7, `jsdom` 30, `@types/node` 26,
  `@changesets/cli` 3. Possibly a deliberate pnpm 10 migration.

## Manual teardown (Matt, outside the repo — checklist goes in PR 1 description)

- **Supabase**: undeploy the 11 Edge Functions; drop tables
  (`subscriptions`, `licenses`, `license_activations`, `license_downloads`,
  `processed_stripe_events`, `enterprise_inquiries`), the `auth.users` trial
  trigger, and the `downloads` Storage bucket — or delete the project outright.
  Delete server-side secrets (STRIPE_*, LICENSE_PRIVATE_KEY/PUBLIC_KEY,
  RESEND_API_KEY).
- **Stripe**: delete webhook endpoint, products/prices; close account when ready.
- **Vercel**: remove `VITE_STRIPE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY` from the dashboard env.
- **GitHub**: remove secrets `LICENSE_PUBLIC_KEY`, `SUPABASE_URL[_DEV]`,
  `SUPABASE_SERVICE_ROLE_KEY[_DEV]`, `VITE_SUPABASE_*`.
- **Resend**: revoke the API key.
- Note: historical GitHub Release download links (Supabase URLs) will 404 after
  teardown; optionally edit old releases or let them lapse.

## Go-public gate

Before flipping the repo to public: run a full git-history secret scan (only
`.env.example` files were ever committed per the initial scan, but verify with a
history-wide scan and GitHub secret scanning) and confirm the MIT license and
README are on `main`.
