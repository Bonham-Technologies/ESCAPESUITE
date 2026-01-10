// ESCAPECRAFT Analytics
// Re-export shared trackEvent for backwards compatibility
export { trackEvent } from '@escapesuite/shared/analytics'

import { trackEvent } from '@escapesuite/shared/analytics'

// ESCAPECRAFT Events
export const analytics = {
  // Recording events
  recordingStarted: () => trackEvent('Recording Started'),
  recordingCompleted: (durationSeconds: number) =>
    trackEvent('Recording Completed', { duration: Math.round(durationSeconds) }),
  recordingSentToEditor: () => trackEvent('Recording Sent to Editor'),
  recordingDownloaded: () => trackEvent('Recording Downloaded'),
  recordingDeleted: () => trackEvent('Recording Deleted'),
}
