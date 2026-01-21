import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useSubscription } from './useSubscription'

// Mock Clerk
vi.mock('@clerk/clerk-react', () => ({
  useUser: vi.fn(() => ({
    user: { id: 'user_123', primaryEmailAddress: { emailAddress: 'test@example.com' } },
    isLoaded: true,
  })),
}))

// Mock subscription module
vi.mock('../lib/subscription', () => ({
  getSubscription: vi.fn(),
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
}))

import { getSubscription, createCheckoutSession, createPortalSession } from '../lib/subscription'

describe('useSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns initial loading state', () => {
    vi.mocked(getSubscription).mockImplementation(() => new Promise(() => {})) // Never resolves

    const { result } = renderHook(() => useSubscription())

    expect(result.current.isLoading).toBe(true)
    expect(typeof result.current.checkout).toBe('function')
    expect(typeof result.current.openPortal).toBe('function')
  })

  it('fetches subscription on mount', async () => {
    const mockSubscription = {
      status: 'active' as const,
      plan: 'pro_monthly' as const,
      trialEnd: null,
      trialDaysRemaining: 0,
      periodEnd: '2025-01-01',
      hasActiveSubscription: true,
      canAccessPro: true,
    }
    vi.mocked(getSubscription).mockResolvedValue(mockSubscription)

    const { result } = renderHook(() => useSubscription())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(getSubscription).toHaveBeenCalledWith('user_123')
    expect(result.current.subscription).toEqual(mockSubscription)
  })

  it('falls back to trial subscription on error', async () => {
    vi.mocked(getSubscription).mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useSubscription())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    // Hook sets default trial subscription on error
    expect(result.current.subscription).toEqual({
      status: 'trialing',
      plan: 'trial',
      trialEnd: null,
      trialDaysRemaining: 14,
      periodEnd: null,
      hasActiveSubscription: false,
      canAccessPro: true,
    })
    expect(result.current.error).toBe('Network error')
  })

  it('provides checkout function', async () => {
    vi.mocked(getSubscription).mockResolvedValue({
      status: 'trialing',
      plan: 'trial',
      trialEnd: null,
      trialDaysRemaining: 14,
      periodEnd: null,
      hasActiveSubscription: false,
      canAccessPro: true,
    })

    const { result } = renderHook(() => useSubscription())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(typeof result.current.checkout).toBe('function')
  })

  it('provides openPortal function', async () => {
    vi.mocked(getSubscription).mockResolvedValue({
      status: 'active',
      plan: 'pro_monthly',
      trialEnd: null,
      trialDaysRemaining: 0,
      periodEnd: '2025-01-01',
      hasActiveSubscription: true,
      canAccessPro: true,
    })

    const { result } = renderHook(() => useSubscription())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(typeof result.current.openPortal).toBe('function')
  })
})

describe('useSubscription - checkout flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls createCheckoutSession and returns clientSecret when checkout is invoked', async () => {
    vi.mocked(getSubscription).mockResolvedValue({
      status: 'trialing',
      plan: 'trial',
      trialEnd: null,
      trialDaysRemaining: 14,
      periodEnd: null,
      hasActiveSubscription: false,
      canAccessPro: true,
    })
    vi.mocked(createCheckoutSession).mockResolvedValue('cs_test_secret123')

    const { result } = renderHook(() => useSubscription())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    const clientSecret = await result.current.checkout('monthly')

    expect(createCheckoutSession).toHaveBeenCalledWith('user_123', 'monthly')
    expect(clientSecret).toBe('cs_test_secret123')
  })

  it('calls createPortalSession when openPortal is invoked', async () => {
    vi.mocked(getSubscription).mockResolvedValue({
      status: 'active',
      plan: 'pro_monthly',
      trialEnd: null,
      trialDaysRemaining: 0,
      periodEnd: '2025-01-01',
      hasActiveSubscription: true,
      canAccessPro: true,
    })
    vi.mocked(createPortalSession).mockResolvedValue('https://billing.stripe.com/portal123')

    // Mock window.location
    const originalLocation = window.location
    // @ts-expect-error - mocking location
    delete window.location
    window.location = { ...originalLocation, href: '' }

    const { result } = renderHook(() => useSubscription())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    await result.current.openPortal()

    expect(createPortalSession).toHaveBeenCalledWith('user_123')
    expect(window.location.href).toBe('https://billing.stripe.com/portal123')

    // Restore
    window.location = originalLocation
  })
})
