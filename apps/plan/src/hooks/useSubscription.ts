import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@clerk/clerk-react'
import type { Subscription, CheckoutPlan } from '../lib/subscription'
import {
  getSubscription,
  createCheckoutSession,
  createPortalSession,
} from '../lib/subscription'

interface UseSubscriptionReturn {
  subscription: Subscription | null
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
  checkout: (plan: CheckoutPlan) => Promise<void>
  openPortal: () => Promise<void>
}

export function useSubscription(): UseSubscriptionReturn {
  const { user, isLoaded } = useUser()
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSubscription = useCallback(async () => {
    if (!user?.id) {
      setSubscription(null)
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      setError(null)
      const sub = await getSubscription(user.id)
      setSubscription(sub)
    } catch (err) {
      console.error('Failed to fetch subscription:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch subscription')
      // Set default trial subscription on error
      setSubscription({
        status: 'trialing',
        plan: 'trial',
        trialEnd: null,
        trialDaysRemaining: 14,
        periodEnd: null,
        hasActiveSubscription: false,
        canAccessPro: true,
      })
    } finally {
      setIsLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    if (isLoaded) {
      fetchSubscription()
    }
  }, [isLoaded, fetchSubscription])

  const checkout = useCallback(
    async (plan: CheckoutPlan) => {
      if (!user?.id) {
        throw new Error('User not authenticated')
      }

      try {
        const url = await createCheckoutSession(user.id, plan)
        window.location.href = url
      } catch (err) {
        console.error('Checkout error:', err)
        throw err
      }
    },
    [user?.id]
  )

  const openPortal = useCallback(async () => {
    if (!user?.id) {
      throw new Error('User not authenticated')
    }

    try {
      const url = await createPortalSession(user.id)
      window.location.href = url
    } catch (err) {
      console.error('Portal error:', err)
      throw err
    }
  }, [user?.id])

  return {
    subscription,
    isLoading,
    error,
    refetch: fetchSubscription,
    checkout,
    openPortal,
  }
}
