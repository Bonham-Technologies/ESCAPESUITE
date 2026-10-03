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
 * `app` is reserved for a future per-app condition (e.g. waiting on
 * ARTIST's `READY` postMessage for an embedded case) — today it drives no
 * branch, but a call site still reads as "this page is
 * ESCAPEPLAN/CRAFT/ARTIST" at a glance.
 *
 * No explicit `timeout`: a locator `waitFor` with one overrides
 * `use.actionTimeout`, and this config sets no `navigationTimeout`/
 * `actionTimeout` of its own, so a hard-coded number here would silently
 * stop tracking a future config change. Leaving it off lets the action
 * timeout (and, failing that, the test timeout) govern, the same as every
 * other `expect(locator)` call in this suite.
 */
export async function waitForAppReady(
  page: Page,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved, see the doc comment above
  app: 'plan' | 'craft' | 'artist'
): Promise<void> {
  await page.locator('main').first().waitFor({ state: 'attached' })
}
