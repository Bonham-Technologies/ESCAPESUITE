import { Page } from '@playwright/test'

/**
 * ESCSUITE-177: `page.waitForLoadState('networkidle')` never settles against
 * the Vite dev server in Firefox — the HMR websocket keeps the network "busy"
 * forever, so every `beforeEach` that waited on it timed out at 30s (24 of 28
 * Firefox failures in the cross-browser sweep that found this). Chromium
 * happens to tolerate it, which is why the suite looked fine there.
 *
 * All three apps render a `<main>` landmark unconditionally and synchronously
 * in their shell — `App.tsx` in CRAFT and ARTIST, `Layout.tsx` in PLAN — with
 * no async gate in front of it and no `display: none` at any breakpoint the
 * responsive suite drives. That makes it a deterministic, browser-agnostic
 * "the app has mounted" signal that costs nothing extra: no polling an
 * integration message, no depending on `isEmbedded()` or a PostMessage round
 * trip that a plain (non-iframed) page load never completes for in the same
 * way an embedded one does.
 *
 * `app` is taken rather than inferred from the URL so a call site reads as
 * "this page is ESCAPEPLAN/CRAFT/ARTIST" at a glance; today the three
 * branches do the same thing, and are kept separate so a future app-specific
 * readiness condition (e.g. waiting on ARTIST's `READY` postMessage for an
 * embedded case) has somewhere to go without changing every call site.
 */
export async function waitForAppReady(
  page: Page,
  app: 'plan' | 'craft' | 'artist'
): Promise<void> {
  switch (app) {
    case 'plan':
    case 'craft':
    case 'artist':
      await page.locator('main').first().waitFor({ state: 'visible', timeout: 30_000 })
      break
  }
}
