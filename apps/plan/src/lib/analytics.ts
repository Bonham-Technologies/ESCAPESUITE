// ESCAPEPLAN Analytics
// Re-export shared trackEvent for backwards compatibility
export { trackEvent } from '@escapesuite/shared/analytics'

import { trackEvent } from '@escapesuite/shared/analytics'

// ESCAPEPLAN Events
export const analytics = {
  // Conversion events
  pricingViewed: () => trackEvent('Pricing Viewed'),
  checkoutStarted: (plan: string) => trackEvent('Checkout Started', { plan }),
  signUpCompleted: () => trackEvent('Sign Up Completed'),
  trialActivated: () => trackEvent('Trial Activated'),
  subscriptionActivated: (plan: string) => trackEvent('Subscription Activated', { plan }),

  // Enterprise events
  enterpriseInquiry: (company: string) =>
    trackEvent('Enterprise Inquiry', { company }),

  // Engagement events
  toolLaunched: (tool: 'craft' | 'artist') => trackEvent('Tool Launched', { tool }),
}
