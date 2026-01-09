import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getSubscription,
  createCheckoutSession,
  createPortalSession,
  getPlanDisplayName,
  getStatusDisplayName,
  type Subscription,
} from './subscription'

// Mock the supabase module
vi.mock('./supabase', () => ({
  functionsUrl: 'https://test.supabase.co/functions/v1',
  supabaseAnonKey: 'test-anon-key',
}))

describe('subscription', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset()
  })

  describe('getSubscription', () => {
    it('fetches subscription successfully', async () => {
      const mockSubscription: Subscription = {
        status: 'active',
        plan: 'pro_monthly',
        trialEnd: null,
        trialDaysRemaining: 0,
        periodEnd: '2026-02-01',
        hasActiveSubscription: true,
        canAccessPro: true,
      }

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSubscription),
      } as Response)

      const result = await getSubscription('user-123')

      expect(fetch).toHaveBeenCalledWith(
        'https://test.supabase.co/functions/v1/get-subscription?clerkUserId=user-123',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'apikey': 'test-anon-key',
          }),
        })
      )
      expect(result).toEqual(mockSubscription)
    })

    it('throws error on failed request', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'User not found' }),
      } as Response)

      await expect(getSubscription('user-123')).rejects.toThrow('User not found')
    })

    it('throws generic error when no error message', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({}),
      } as Response)

      await expect(getSubscription('user-123')).rejects.toThrow('Failed to get subscription')
    })
  })

  describe('createCheckoutSession', () => {
    it('creates checkout session and returns URL', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ url: 'https://checkout.stripe.com/session123' }),
      } as Response)

      const result = await createCheckoutSession('user-123', 'price_pro_monthly')

      expect(fetch).toHaveBeenCalledWith(
        'https://test.supabase.co/functions/v1/create-checkout',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            clerkUserId: 'user-123',
            priceId: 'price_pro_monthly',
            successUrl: 'http://localhost:5173/dashboard?success=true',
            cancelUrl: 'http://localhost:5173/?canceled=true',
          }),
        })
      )
      expect(result).toBe('https://checkout.stripe.com/session123')
    })

    it('throws error on failed request', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Invalid price ID' }),
      } as Response)

      await expect(createCheckoutSession('user-123', 'invalid')).rejects.toThrow('Invalid price ID')
    })
  })

  describe('createPortalSession', () => {
    it('creates portal session and returns URL', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ url: 'https://billing.stripe.com/portal123' }),
      } as Response)

      const result = await createPortalSession('user-123')

      expect(fetch).toHaveBeenCalledWith(
        'https://test.supabase.co/functions/v1/create-portal',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            clerkUserId: 'user-123',
            returnUrl: 'http://localhost:5173/dashboard',
          }),
        })
      )
      expect(result).toBe('https://billing.stripe.com/portal123')
    })

    it('throws error on failed request', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'No active subscription' }),
      } as Response)

      await expect(createPortalSession('user-123')).rejects.toThrow('No active subscription')
    })
  })

  describe('getPlanDisplayName', () => {
    it('returns correct display names', () => {
      expect(getPlanDisplayName('trial')).toBe('Free Trial')
      expect(getPlanDisplayName('pro_monthly')).toBe('Pro Monthly')
      expect(getPlanDisplayName('pro_annual')).toBe('Pro Annual')
      expect(getPlanDisplayName('founding_member')).toBe('Founding Member')
    })

    it('returns original value for unknown plans', () => {
      expect(getPlanDisplayName('unknown_plan')).toBe('unknown_plan')
    })
  })

  describe('getStatusDisplayName', () => {
    it('returns correct display names', () => {
      expect(getStatusDisplayName('trialing')).toBe('Trial')
      expect(getStatusDisplayName('active')).toBe('Active')
      expect(getStatusDisplayName('canceled')).toBe('Canceled')
      expect(getStatusDisplayName('expired')).toBe('Expired')
      expect(getStatusDisplayName('lifetime')).toBe('Lifetime')
      expect(getStatusDisplayName('past_due')).toBe('Past Due')
    })

    it('returns original value for unknown statuses', () => {
      expect(getStatusDisplayName('unknown_status')).toBe('unknown_status')
    })
  })
})
