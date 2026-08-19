// ESCAPEPLAN Analytics
export { trackEvent } from '@escapesuite/shared/analytics'

import { trackEvent } from '@escapesuite/shared/analytics'

// ESCAPEPLAN Events
export const analytics = {
  toolLaunched: (tool: 'craft' | 'artist') => trackEvent('Tool Launched', { tool }),
}
