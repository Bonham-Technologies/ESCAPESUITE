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

// ESCAPEPLAN Events
export const analytics = {
  // Conversion events
  pricingViewed: () => trackEvent('Pricing Viewed'),
  checkoutStarted: (plan: string) => trackEvent('Checkout Started', { plan }),
  signUpCompleted: () => trackEvent('Sign Up Completed'),
  trialActivated: () => trackEvent('Trial Activated'),
  subscriptionActivated: (plan: string) => trackEvent('Subscription Activated', { plan }),

  // Engagement events
  toolLaunched: (tool: 'craft' | 'artist') => trackEvent('Tool Launched', { tool }),
}
