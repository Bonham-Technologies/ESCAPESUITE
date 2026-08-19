import { describe, it, expect, vi, beforeEach } from 'vitest'
import { trackEvent, analytics } from './analytics'

// Mock @vercel/analytics
vi.mock('@vercel/analytics', () => ({
  track: vi.fn(),
}))

import { track } from '@vercel/analytics'

describe('analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('trackEvent', () => {
    it('calls track with event name', () => {
      trackEvent('Test Event')
      expect(track).toHaveBeenCalledWith('Test Event', undefined)
    })

    it('calls track with event name and props', () => {
      trackEvent('Test Event', { foo: 'bar', count: 42 })
      expect(track).toHaveBeenCalledWith('Test Event', { foo: 'bar', count: 42 })
    })
  })

  describe('analytics.toolLaunched', () => {
    it('tracks Tool Launched event for craft', () => {
      analytics.toolLaunched('craft')
      expect(track).toHaveBeenCalledWith('Tool Launched', { tool: 'craft' })
    })

    it('tracks Tool Launched event for artist', () => {
      analytics.toolLaunched('artist')
      expect(track).toHaveBeenCalledWith('Tool Launched', { tool: 'artist' })
    })
  })
})
