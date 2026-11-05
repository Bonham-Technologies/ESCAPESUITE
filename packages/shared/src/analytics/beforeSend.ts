// What every Vercel Web Analytics record may say about the page it came from.

import type { BeforeSend } from '@vercel/analytics/react'

/**
 * `url` with its query string and fragment cut off: scheme, host and path only.
 *
 * Cut at the first `?` or `#` rather than parsed with `URL`, so it never throws
 * and leaves the path exactly as the browser wrote it.
 */
export function stripQueryAndFragment(url: string): string {
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}

/**
 * The `beforeSend` every `<Analytics />` mount passes (ESCSUITE-406).
 *
 * Vercel's insights script reports `location.href` with each page view and
 * each custom event, so without this an integration host's `?video=`,
 * `?title=`, `?project=` (a whole project), `?hostOrigin=` or `?tabKey=`, and
 * the CRAFT handoff's `?loadVideo=` id, would reach Vercel with every record.
 * The script runs every record through this one hook, custom events included,
 * so `trackEvent()` needs nothing of its own.
 *
 * The off-site referrer it may add is out of this hook's reach: the script
 * reads `document.referrer` itself and never passes it here. That value is the
 * *other* site's address, already cut to its origin by the browser's default
 * `strict-origin-when-cross-origin` policy unless that site chose otherwise.
 */
export const analyticsBeforeSend: BeforeSend = (event) => ({
  ...event,
  url: stripQueryAndFragment(event.url),
})
