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
