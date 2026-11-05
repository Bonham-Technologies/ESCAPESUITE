// Vercel Analytics event tracking
// https://vercel.com/docs/analytics/custom-events

import { track } from '@vercel/analytics'
import { BUILD_MODE } from '../config'

export { analyticsBeforeSend, stripQueryAndFragment } from './beforeSend'

/**
 * Track a custom event in Vercel Analytics.
 *
 * **Hosted (saas) builds only.** The offline single-file build runs air-gapped
 * and must make no network request at all, so `trackEvent` returns before it
 * reaches `track`.
 *
 * The guard compares `BUILD_MODE` rather than calling `isSaaSMode()` on
 * purpose. `BUILD_MODE` folds to a string literal at build time (Vite inlines
 * `import.meta.env.VITE_BUILD_MODE`), so the bundler can evaluate this
 * comparison, drop the dead call, and with it drop `@vercel/analytics` from
 * the standalone bundle entirely — the runtime that would make the request is
 * *absent*, not merely unused. A function call is opaque to that analysis and
 * would leave the library in the file. `apps/e2e/tests/standalone/craft.spec.ts`
 * holds the other end of the invariant at runtime.
 *
 * The page address an event carries is cut to its path by the
 * `analyticsBeforeSend` hook every `<Analytics />` mount passes (ESCSUITE-406):
 * the insights script runs custom events through that same hook.
 */
export function trackEvent(
  event: string,
  props?: Record<string, string | number | boolean>
): void {
  if (BUILD_MODE !== 'saas') return
  track(event, props)
}
