// ESCAPEARTIST Analytics
// Re-export shared trackEvent for backwards compatibility
export { trackEvent } from '@escapesuite/shared/analytics'

import { trackEvent } from '@escapesuite/shared/analytics'

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
  exportFailed: (format: string, errorType: string, progress: number) =>
    trackEvent('Export Failed', { format, errorType, progress: Math.round(progress * 100) }),
}
