import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getSubscription,
  createCheckoutSession,
  createPortalSession,
  getPlanDisplayName,
  getStatusDisplayName,
  type Subscription,
} from './subscription'
import { mockSupabase } from '../test/setup'

// Helper: make supabase.from('subscriptions').select(...).eq(...).maybeSingle()
// resolve to the given result, and capture the calls for assertions.
function stubSubscriptionQuery(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result)
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  ;(mockSupabase as { from: unknown }).from = from
  return { from, select, eq, maybeSingle }
}

describe('subscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabase.functions.invoke.mockReset()
  })

  describe('getSubscription', () => {
    it('returns the formatted subscription from a row', async () => {
      const { from, select, eq } = stubSubscriptionQuery({
        data: {
          status: 'active',
          plan: 'pro_monthly',
          trial_end: null,
          current_period_end: '2026-02-01',
        },
        error: null,
      })

      const result = await getSubscription('auth-user-123')

      expect(from).toHaveBeenCalledWith('subscriptions')
      expect(select).toHaveBeenCalledWith('status, plan, trial_end, current_period_end')
      expect(eq).toHaveBeenCalledWith('auth_user_id', 'auth-user-123')
      expect(result).toEqual<Subscription>({
        status: 'active',
        plan: 'pro_monthly',
        trialEnd: null,
        trialDaysRemaining: 0,
        periodEnd: '2026-02-01',
        hasActiveSubscription: true,
        canAccessPro: true,
      })
    })

    it('computes remaining trial days for a trialing row', async () => {
      const trialEnd = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
      stubSubscriptionQuery({
        data: {
          status: 'trialing',
          plan: 'trial',
          trial_end: trialEnd,
          current_period_end: null,
        },
        error: null,
      })

      const result = await getSubscription('auth-user-123')

      expect(result.status).toBe('trialing')
      expect(result.trialEnd).toBe(trialEnd)
      expect(result.trialDaysRemaining).toBe(5)
      expect(result.hasActiveSubscription).toBe(false)
      expect(result.canAccessPro).toBe(true)
    })

    it('returns the trial fallback when no row exists', async () => {
      stubSubscriptionQuery({ data: null, error: null })

      const result = await getSubscription('auth-user-123')

      expect(result).toEqual<Subscription>({
        status: 'trialing',
        plan: 'trial',
        trialEnd: null,
        trialDaysRemaining: 7,
        periodEnd: null,
        hasActiveSubscription: false,
        canAccessPro: true,
      })
    })

    it('throws when the query returns an error', async () => {
      stubSubscriptionQuery({ data: null, error: { message: 'User not found' } })

      await expect(getSubscription('auth-user-123')).rejects.toThrow('User not found')
    })
  })

  describe('createCheckoutSession', () => {
    it('invokes create-checkout and returns the clientSecret', async () => {
      mockSupabase.functions.invoke.mockResolvedValueOnce({
        data: { clientSecret: 'cs_test_secret123' },
        error: null,
      })

      const result = await createCheckoutSession('auth-user-123', 'monthly')

      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith('create-checkout', {
        body: {
          plan: 'monthly',
          returnUrl: 'http://localhost:5173/dashboard?session_id={CHECKOUT_SESSION_ID}',
        },
      })
      expect(result).toBe('cs_test_secret123')
    })

    it('throws when invoke returns an error', async () => {
      mockSupabase.functions.invoke.mockResolvedValueOnce({
        data: null,
        error: { message: 'Invalid plan' },
      })

      await expect(createCheckoutSession('auth-user-123', 'monthly')).rejects.toThrow(
        'Invalid plan'
      )
    })
  })

  describe('createPortalSession', () => {
    it('invokes create-portal and returns the URL', async () => {
      mockSupabase.functions.invoke.mockResolvedValueOnce({
        data: { url: 'https://billing.stripe.com/portal123' },
        error: null,
      })

      const result = await createPortalSession('auth-user-123')

      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith('create-portal', {
        body: { returnUrl: 'http://localhost:5173/dashboard' },
      })
      expect(result).toBe('https://billing.stripe.com/portal123')
    })

    it('throws when invoke returns an error', async () => {
      mockSupabase.functions.invoke.mockResolvedValueOnce({
        data: null,
        error: { message: 'No active subscription' },
      })

      await expect(createPortalSession('auth-user-123')).rejects.toThrow(
        'No active subscription'
      )
    })
  })

  describe('getPlanDisplayName', () => {
    it('returns correct display names', () => {
      expect(getPlanDisplayName('trial')).toBe('Free Trial')
      expect(getPlanDisplayName('pro_monthly')).toBe('Pro Monthly')
      expect(getPlanDisplayName('pro_annual')).toBe('Pro Annual')
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
