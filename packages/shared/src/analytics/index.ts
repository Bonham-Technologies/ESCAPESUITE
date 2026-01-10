// Vercel Analytics event tracking
// https://vercel.com/docs/analytics/custom-events

import { track } from '@vercel/analytics'

/**
 * Track a custom event in Vercel Analytics
 */
export function trackEvent(
  event: string,
  props?: Record<string, string | number | boolean>
): void {
  track(event, props)
}
