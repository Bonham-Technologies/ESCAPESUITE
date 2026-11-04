<!-- Moved verbatim from CLAUDE.md on 2026-10-19. Edit here; CLAUDE.md only indexes this file. -->
# Vercel Analytics

**Hosted (`saas`) builds only.** All three apps use `@vercel/analytics` for pageview and
custom event tracking:
- `<Analytics />` is mounted by `bootstrapApp()` (`packages/shared/src/bootstrap`) for
  ESCAPECRAFT and ESCAPEARTIST; ESCAPEPLAN still mounts it directly in its own `main.tsx`
- Custom events via `trackEvent()` in `*/analytics.ts` files, which re-export the shared
  `packages/shared/src/analytics` wrapper
- **A standalone build ships no analytics runtime at all.** `BUILD_MODE === 'saas'` gates
  both `trackEvent()` and the `<Analytics />` mount, and because `BUILD_MODE` folds to a
  literal at build time the bundler drops `@vercel/analytics` from the offline bundle
  rather than shipping it inert — `va.vercel-scripts.com` appears 0 times in the
  ESCAPECRAFT and ESCAPEARTIST standalone builds and once in the hosted one. Held at
  runtime by `apps/e2e/tests/standalone/craft.spec.ts` ("makes no requests off the local
  origin"), which records a real take and then asserts there is no `window.va`, no queue
  and no injected script
- **What each record carries: the page's path, never its query or fragment.** Vercel's
  `/_vercel/insights/script.js` posts every page view *and* every custom event with the page
  address. Both mounts (`bootstrapApp()` and ESCAPEPLAN's `GatedAnalytics`) pass the shared
  `analyticsBeforeSend` (`packages/shared/src/analytics/beforeSend.ts`), which cuts that address
  at the first `?` or `#`; the script runs custom events through the same hook, so `trackEvent()`
  needs nothing of its own. An integration host's `?hostOrigin=` / `?tabKey=` / `?video=` /
  `?title=` / `?project=` and the CRAFT handoff's `?loadVideo=` id therefore never reach Vercel
  (ESCSUITE-406). Held by the `beforeSend` and mount unit tests and, end to end through Vercel's
  real script, by `apps/e2e/tests/production/analytics-strip-query.spec.ts`.
- **The referrer is out of `beforeSend`'s reach.** The script reads `document.referrer` itself,
  sends it only when it is off-site, and never passes it to the hook (`@vercel/analytics`
  2.0.1's `BeforeSendEvent` is `{ type, url }`). For a framed editor that value is the host
  page's address, which the browser cuts to its origin under the default
  `strict-origin-when-cross-origin` policy unless the host sets a looser one. Vercel also derives
  browser, OS, device type and city-level location from the request. The hub's `/limitations`
  page (ESCSUITE-402) states what is sent; change it with any change here.
