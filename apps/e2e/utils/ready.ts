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
 * no async gate in front of it. That makes it a deterministic, browser-agnostic
 * "the app has mounted" signal that costs nothing extra: no polling an
 * integration message, no depending on `isEmbedded()` or a PostMessage round
 * trip that a plain (non-iframed) page load never completes for in the same
 * way an embedded one does.
 *
 * Waits for `state: 'attached'`, not `'visible'`: the landmark is rendered
 * synchronously (attachment is the "the app has mounted" fact this helper
 * exists to signal), but whether it is *visible* depends on layout — at a
 * narrow responsive viewport (812x375, landscape) ARTIST's `<main>` can be
 * attached with zero rendered height before the rest of the chrome settles,
 * which made `tests/responsive/artist.spec.ts`'s "editor/preview visible in
 * landscape" cases time out waiting on 'visible' (ESCSUITE-177 fix round).
 * Attachment is also strictly earlier than visibility, so this is a weaker
 * (not a different) condition — every caller that goes on to assert its own
 * visible element (a button, a heading) is unaffected.
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
      await page.locator('main').first().waitFor({ state: 'attached', timeout: 30_000 })
      break
  }
}
