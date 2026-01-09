import { useState, useEffect, type ReactNode } from 'react'
import { AuthContext, type AuthState } from './AuthContext'
import { ErrorScreen } from './ErrorScreen'
import { LoadingScreen } from './LoadingScreen'
import { LICENSE_KEY } from './config'
import { validateLicense, getLicenseInfo } from './license'
import { getSubscription, isTrialUser, isPaidUser } from './subscription'

interface AuthGateProps {
  children: ReactNode
}

// Initialize license state synchronously to avoid effect-based setState
function initializeLicenseState(): AuthState {
  const license = validateLicense(LICENSE_KEY)
  if (license) {
    console.log('License validated:', getLicenseInfo(license))
    return {
      isAuthorized: true,
      isTrial: false,
      isLoading: false,
      error: null,
      customerName: license.customer,
    }
  }
  return {
    isAuthorized: false,
    isTrial: false,
    isLoading: false,
    error: LICENSE_KEY
      ? 'Invalid or expired license key'
      : 'No license key found. This application requires a valid license.',
  }
}

// Standalone mode auth gate - license-based
export function StandaloneAuthGate({ children }: AuthGateProps) {
  const [authState] = useState<AuthState>(initializeLicenseState)

  if (authState.isLoading) {
    return <LoadingScreen />
  }

  if (!authState.isAuthorized) {
    return <ErrorScreen message={authState.error} />
  }

  return (
    <AuthContext.Provider value={authState}>
      {children}
    </AuthContext.Provider>
  )
}

interface SaaSAuthGateProps {
  children: ReactNode
  userId: string | undefined
  isLoaded: boolean
}

// SaaS mode auth gate - uses Clerk user ID to check subscription
export function SaaSAuthGate({ children, userId, isLoaded }: SaaSAuthGateProps) {
  const [subscriptionState, setSubscriptionState] = useState<{
    checked: boolean
    subscription: Awaited<ReturnType<typeof getSubscription>> | null
    error: string | null
  }>({
    checked: false,
    subscription: null,
    error: null,
  })

  useEffect(() => {
    if (!isLoaded || !userId) return

    let cancelled = false

    async function fetchSubscription() {
      try {
        const subscription = await getSubscription(userId!)
        if (!cancelled) {
          setSubscriptionState({
            checked: true,
            subscription,
            error: null,
          })
        }
      } catch (error) {
        console.error('Failed to check subscription:', error)
        if (!cancelled) {
          setSubscriptionState({
            checked: true,
            subscription: null,
            error: 'Failed to verify subscription. Please try again.',
          })
        }
      }
    }

    fetchSubscription()
    return () => { cancelled = true }
  }, [userId, isLoaded])

  // Derive auth state from props and subscription state
  const authState: AuthState = (() => {
    // Still loading Clerk
    if (!isLoaded) {
      return { isAuthorized: false, isTrial: false, isLoading: true, error: null }
    }

    // No user signed in
    if (!userId) {
      return {
        isAuthorized: false,
        isTrial: false,
        isLoading: false,
        error: 'Please sign in to use ESCAPEARTIST',
      }
    }

    // Subscription not yet checked
    if (!subscriptionState.checked) {
      return { isAuthorized: false, isTrial: false, isLoading: true, error: null }
    }

    // Error fetching subscription
    if (subscriptionState.error) {
      return {
        isAuthorized: false,
        isTrial: false,
        isLoading: false,
        error: subscriptionState.error,
      }
    }

    const subscription = subscriptionState.subscription
    if (!subscription) {
      return {
        isAuthorized: false,
        isTrial: false,
        isLoading: false,
        error: 'Failed to verify subscription.',
      }
    }

    // Check subscription status
    if (isPaidUser(subscription)) {
      return { isAuthorized: true, isTrial: false, isLoading: false, error: null }
    }

    if (isTrialUser(subscription)) {
      return { isAuthorized: true, isTrial: true, isLoading: false, error: null }
    }

    return {
      isAuthorized: false,
      isTrial: false,
      isLoading: false,
      error: subscription.status === 'expired'
        ? 'Your trial has expired. Please upgrade to continue.'
        : 'Subscription inactive. Please upgrade to continue.',
    }
  })()

  if (authState.isLoading) {
    return <LoadingScreen />
  }

  if (!authState.isAuthorized) {
    return <ErrorScreen message={authState.error} />
  }

  return (
    <AuthContext.Provider value={authState}>
      {children}
    </AuthContext.Provider>
  )
}
