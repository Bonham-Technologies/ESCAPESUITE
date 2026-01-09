// Plausible Analytics event tracking
// https://plausible.io/docs/custom-event-goals

declare global {
  interface Window {
    plausible?: (
      event: string,
      options?: { props?: Record<string, string | number | boolean> }
    ) => void
  }
}

/**
 * Track a custom event in Plausible
 */
export function trackEvent(
  event: string,
  props?: Record<string, string | number | boolean>
): void {
  if (typeof window !== 'undefined' && window.plausible) {
    window.plausible(event, props ? { props } : undefined)
  }
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
