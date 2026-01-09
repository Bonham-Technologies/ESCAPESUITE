import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { trackEvent, analytics } from './analytics'

describe('analytics', () => {
  let plausibleMock: Mock

  beforeEach(() => {
    plausibleMock = vi.fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window.plausible = plausibleMock as any
  })

  afterEach(() => {
    delete window.plausible
  })

  describe('trackEvent', () => {
    it('calls plausible with event name', () => {
      trackEvent('Test Event')
      expect(plausibleMock).toHaveBeenCalledWith('Test Event', undefined)
    })

    it('calls plausible with event name and props', () => {
      trackEvent('Test Event', { foo: 'bar', count: 42 })
      expect(plausibleMock).toHaveBeenCalledWith('Test Event', { props: { foo: 'bar', count: 42 } })
    })

    it('does nothing when plausible is not available', () => {
      delete window.plausible
      // Should not throw
      expect(() => trackEvent('Test Event')).not.toThrow()
    })
  })

  describe('analytics.pricingViewed', () => {
    it('tracks Pricing Viewed event', () => {
      analytics.pricingViewed()
      expect(plausibleMock).toHaveBeenCalledWith('Pricing Viewed', undefined)
    })
  })

  describe('analytics.checkoutStarted', () => {
    it('tracks Checkout Started event with plan', () => {
      analytics.checkoutStarted('pro_monthly')
      expect(plausibleMock).toHaveBeenCalledWith('Checkout Started', { props: { plan: 'pro_monthly' } })
    })
  })

  describe('analytics.signUpCompleted', () => {
    it('tracks Sign Up Completed event', () => {
      analytics.signUpCompleted()
      expect(plausibleMock).toHaveBeenCalledWith('Sign Up Completed', undefined)
    })
  })

  describe('analytics.trialActivated', () => {
    it('tracks Trial Activated event', () => {
      analytics.trialActivated()
      expect(plausibleMock).toHaveBeenCalledWith('Trial Activated', undefined)
    })
  })

  describe('analytics.subscriptionActivated', () => {
    it('tracks Subscription Activated event with plan', () => {
      analytics.subscriptionActivated('founding_member')
      expect(plausibleMock).toHaveBeenCalledWith('Subscription Activated', { props: { plan: 'founding_member' } })
    })
  })

  describe('analytics.toolLaunched', () => {
    it('tracks Tool Launched event for craft', () => {
      analytics.toolLaunched('craft')
      expect(plausibleMock).toHaveBeenCalledWith('Tool Launched', { props: { tool: 'craft' } })
    })

    it('tracks Tool Launched event for artist', () => {
      analytics.toolLaunched('artist')
      expect(plausibleMock).toHaveBeenCalledWith('Tool Launched', { props: { tool: 'artist' } })
    })
  })
})
