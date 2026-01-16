import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { AuthContext, type AuthState } from './context'
import { ErrorScreen } from './ErrorScreen'
import { LoadingScreen } from './LoadingScreen'
import { LicenseInputModal } from './LicenseInputModal'
import { ExpirationBanner } from './ExpirationBanner'
import { LICENSE_KEY } from './config'
import { validateLicense, getLicenseInfo, loadLicense, type License } from './license'
import { getSubscription, isTrialUser, isPaidUser } from './subscription'
import { getMachineHash } from './machineHash'

// Product types that can be validated (excludes 'suite' which is license-only)
type AppProduct = 'craft' | 'artist'

interface AuthGateProps {
  children: ReactNode
  appName: string
  logo: ReactNode
  product: AppProduct
}

// Initialize license state synchronously to avoid effect-based setState
// First checks localStorage, then falls back to embedded LICENSE_KEY
function initializeLicenseState(product: AppProduct): {
  authState: AuthState
  licenseKey: string | null
  license: License | null
} {
  // First, try to load license from localStorage
  const storedLicense = loadLicense(product)
  if (storedLicense) {
    const license = validateLicense(storedLicense, product)
    if (license) {
      console.log('License validated (stored):', getLicenseInfo(license))
      return {
        authState: {
          isAuthorized: true,
          isTrial: false,
          isLoading: false,
          error: null,
          customerName: license.customer,
        },
        licenseKey: storedLicense,
        license,
      }
    }
    // Stored license is invalid - continue to check embedded key
    console.warn('Stored license is invalid or expired')
  }

  // Fall back to embedded LICENSE_KEY
  if (LICENSE_KEY) {
    const license = validateLicense(LICENSE_KEY, product)
    if (license) {
      console.log('License validated (embedded):', getLicenseInfo(license))
      return {
        authState: {
          isAuthorized: true,
          isTrial: false,
          isLoading: false,
          error: null,
          customerName: license.customer,
        },
        licenseKey: LICENSE_KEY,
        license,
      }
    }
    // Embedded license is invalid
    return {
      authState: {
        isAuthorized: false,
        isTrial: false,
        isLoading: false,
        error: 'Invalid or expired license key',
      },
      licenseKey: null,
      license: null,
    }
  }

  // No license found - will show input modal
  return {
    authState: {
      isAuthorized: false,
      isTrial: false,
      isLoading: false,
      error: null, // No error - show license input modal
    },
    licenseKey: null,
    license: null,
  }
}

interface StandaloneAuthGateProps {
  children: ReactNode
  appName: string
  logo: ReactNode
  product: AppProduct
}

// Standalone mode auth gate - license-based with runtime license input
export function StandaloneAuthGate({ children, appName, logo, product }: StandaloneAuthGateProps) {
  const [{ authState, licenseKey, license }, setState] = useState(() => {
    const result = initializeLicenseState(product)
    return { authState: result.authState, licenseKey: result.licenseKey, license: result.license }
  })

  // Track activation in background (don't block UI)
  useEffect(() => {
    if (authState.isAuthorized && licenseKey) {
      // Fire and forget - activation tracking is best-effort
      trackActivation(licenseKey, product).catch((err) => {
        console.warn('Activation tracking failed:', err)
      })
    }
  }, [authState.isAuthorized, licenseKey, product])

  const handleLicenseSuccess = useCallback((newLicense: License) => {
    setState({
      authState: {
        isAuthorized: true,
        isTrial: false,
        isLoading: false,
        error: null,
        customerName: newLicense.customer,
      },
      licenseKey: loadLicense(product) || '',
      license: newLicense,
    })
  }, [product])

  if (authState.isLoading) {
    return <LoadingScreen appName={appName} logo={logo} />
  }

  // Show license input modal if no valid license and no error
  // (error means embedded license was invalid, which is a different case)
  if (!authState.isAuthorized && !authState.error) {
    return (
      <LicenseInputModal
        isOpen={true}
        onSuccess={handleLicenseSuccess}
        product={product}
        appName={appName}
      />
    )
  }

  if (!authState.isAuthorized) {
    return <ErrorScreen message={authState.error} />
  }

  return (
    <AuthContext.Provider value={authState}>
      <ExpirationBanner license={license} />
      {children}
    </AuthContext.Provider>
  )
}

// Track license activation for seat limiting (best-effort, non-blocking)
async function trackActivation(licenseKey: string, product: AppProduct): Promise<void> {
  try {
    const machineHash = await getMachineHash()
    const appVersion = import.meta.env.VITE_APP_VERSION || '1.0.0'

    // Get Supabase URL from environment
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    if (!supabaseUrl) {
      console.warn('SUPABASE_URL not configured - skipping activation tracking')
      return
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/validate-license`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        licenseKey,
        product,
        machineHash,
        appVersion,
      }),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      if (data.error === 'Maximum activations reached') {
        console.warn(`License seat limit reached: ${data.currentActivations}/${data.maxActivations}`)
        // Note: We don't block the user here - local validation passed
        // The server-side check is for tracking/analytics
      }
    }
  } catch (error) {
    // Network error - offline mode is fine
    console.debug('Activation tracking failed (offline?):', error)
  }
}

interface SaaSAuthGateProps {
  children: ReactNode
  userId: string | undefined
  isLoaded: boolean
  appName: string
  logo: ReactNode
}

// SaaS mode auth gate - uses Clerk user ID to check subscription
export function SaaSAuthGate({ children, userId, isLoaded, appName, logo }: SaaSAuthGateProps) {
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
        error: `Please sign in to use ${appName}`,
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
    return <LoadingScreen appName={appName} logo={logo} />
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

export type { AuthGateProps, StandaloneAuthGateProps, SaaSAuthGateProps }
