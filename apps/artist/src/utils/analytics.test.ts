import { describe, it, expect, vi, beforeEach } from 'vitest'
import { analytics, trackEvent } from './analytics'

// Mock the shared analytics module
vi.mock('@escapesuite/shared/analytics', () => ({
  trackEvent: vi.fn(),
}))

describe('analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('trackEvent', () => {
    it('is exported from shared module', () => {
      expect(typeof trackEvent).toBe('function')
    })
  })

  describe('analytics.videoImported', () => {
    it('tracks video import with type', () => {
      analytics.videoImported('video')
      expect(trackEvent).toHaveBeenCalledWith('Video Imported', { type: 'video' })
    })

    it('tracks image import', () => {
      analytics.videoImported('image')
      expect(trackEvent).toHaveBeenCalledWith('Video Imported', { type: 'image' })
    })

    it('tracks audio import', () => {
      analytics.videoImported('audio')
      expect(trackEvent).toHaveBeenCalledWith('Video Imported', { type: 'audio' })
    })
  })

  describe('analytics.projectCreated', () => {
    it('tracks project creation', () => {
      analytics.projectCreated()
      expect(trackEvent).toHaveBeenCalledWith('Project Created')
    })
  })

  describe('analytics.projectSaved', () => {
    it('tracks project save', () => {
      analytics.projectSaved()
      expect(trackEvent).toHaveBeenCalledWith('Project Saved')
    })
  })

  describe('analytics.overlayAdded', () => {
    it('tracks text overlay', () => {
      analytics.overlayAdded('text')
      expect(trackEvent).toHaveBeenCalledWith('Overlay Added', { type: 'text' })
    })

    it('tracks shape overlay', () => {
      analytics.overlayAdded('shape')
      expect(trackEvent).toHaveBeenCalledWith('Overlay Added', { type: 'shape' })
    })

    it('tracks blur overlay', () => {
      analytics.overlayAdded('blur')
      expect(trackEvent).toHaveBeenCalledWith('Overlay Added', { type: 'blur' })
    })
  })

  describe('analytics.exportStarted', () => {
    it('tracks WebM export start', () => {
      analytics.exportStarted('webm')
      expect(trackEvent).toHaveBeenCalledWith('Export Started', { format: 'webm' })
    })

    it('tracks MP4 export start', () => {
      analytics.exportStarted('mp4')
      expect(trackEvent).toHaveBeenCalledWith('Export Started', { format: 'mp4' })
    })
  })

  describe('analytics.exportCompleted', () => {
    it('tracks WebM export completion with duration', () => {
      analytics.exportCompleted('webm', 120.5)
      expect(trackEvent).toHaveBeenCalledWith('Export Completed', { format: 'webm', duration: 121 })
    })

    it('tracks MP4 export completion', () => {
      analytics.exportCompleted('mp4', 60)
      expect(trackEvent).toHaveBeenCalledWith('Export Completed', { format: 'mp4', duration: 60 })
    })

    it('rounds duration to nearest second', () => {
      analytics.exportCompleted('webm', 90.4)
      expect(trackEvent).toHaveBeenCalledWith('Export Completed', { format: 'webm', duration: 90 })
    })
  })
})
