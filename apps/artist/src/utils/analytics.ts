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

// ESCAPEARTIST Events
export const analytics = {
  // Project events
  videoImported: (type: 'video' | 'image' | 'audio') =>
    trackEvent('Video Imported', { type }),
  projectCreated: () => trackEvent('Project Created'),
  projectSaved: () => trackEvent('Project Saved'),

  // Editing events
  overlayAdded: (type: 'text' | 'shape' | 'blur') =>
    trackEvent('Overlay Added', { type }),

  // Export events
  exportStarted: (format: 'webm' | 'mp4') =>
    trackEvent('Export Started', { format }),
  exportCompleted: (format: 'webm' | 'mp4', durationSeconds: number) =>
    trackEvent('Export Completed', { format, duration: Math.round(durationSeconds) }),
}
