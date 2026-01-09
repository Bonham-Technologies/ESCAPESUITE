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
