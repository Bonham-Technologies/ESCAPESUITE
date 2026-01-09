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
