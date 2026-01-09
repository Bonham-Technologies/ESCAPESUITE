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

  describe('analytics.pricingViewed', () => {
    it('tracks Pricing Viewed event', () => {
      analytics.pricingViewed()
      expect(track).toHaveBeenCalledWith('Pricing Viewed', undefined)
    })
  })

  describe('analytics.checkoutStarted', () => {
    it('tracks Checkout Started event with plan', () => {
      analytics.checkoutStarted('pro_monthly')
      expect(track).toHaveBeenCalledWith('Checkout Started', { plan: 'pro_monthly' })
    })
  })

  describe('analytics.signUpCompleted', () => {
    it('tracks Sign Up Completed event', () => {
      analytics.signUpCompleted()
      expect(track).toHaveBeenCalledWith('Sign Up Completed', undefined)
    })
  })

  describe('analytics.trialActivated', () => {
    it('tracks Trial Activated event', () => {
      analytics.trialActivated()
      expect(track).toHaveBeenCalledWith('Trial Activated', undefined)
    })
  })

  describe('analytics.subscriptionActivated', () => {
    it('tracks Subscription Activated event with plan', () => {
      analytics.subscriptionActivated('founding_member')
      expect(track).toHaveBeenCalledWith('Subscription Activated', { plan: 'founding_member' })
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
