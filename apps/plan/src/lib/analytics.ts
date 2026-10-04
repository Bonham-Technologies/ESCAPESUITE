// ESCAPEPLAN Analytics
export { trackEvent } from '@escapesuite/shared/analytics'

import { trackEvent } from '@escapesuite/shared/analytics'

// ESCAPEPLAN Events
export const analytics = {
  toolLaunched: (tool: 'craft' | 'artist') => trackEvent('Tool Launched', { tool }),
  // `tool` is omitted (not sent as an empty/undefined prop) for the hero's
  // generic "all downloads" link, which names no single app (ESCSUITE-195).
  offlineBuildDownloaded: (tool?: 'craft' | 'artist') =>
    trackEvent('Offline Build Downloaded', tool ? { tool } : undefined),
}
