import { Page } from '@playwright/test'

/**
 * Utilities for mocking subscription state in E2E tests.
 *
 * These utilities intercept the get-subscription Edge Function and inject
 * subscription state into the page, allowing tests to simulate different
 * user subscription scenarios.
 */

export type SubscriptionState =
  | 'trial'
  | 'pro_monthly'
  | 'pro_annual'
  | 'founding_member'
  | 'canceled'
  | 'expired'

export interface Subscription {
  status: 'trialing' | 'active' | 'canceled' | 'expired' | 'lifetime' | 'past_due'
  plan: 'trial' | 'pro_monthly' | 'pro_annual' | 'founding_member'
  trialEnd: string | null
  trialDaysRemaining: number
  periodEnd: string | null
  hasActiveSubscription: boolean
  canAccessPro: boolean
}

export interface AuthState {
  isAuthenticated: boolean
  isTrial: boolean
  isPro: boolean
  isFoundingMember: boolean
  subscription: Subscription | null
}

/**
 * Create a mock subscription object based on the desired state.
 */
export function createMockSubscription(state: SubscriptionState): Subscription {
  const now = new Date()
  const fourteenDaysFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  switch (state) {
    case 'trial':
      return {
        status: 'trialing',
        plan: 'trial',
        trialEnd: fourteenDaysFromNow.toISOString(),
        trialDaysRemaining: 14,
        periodEnd: null,
        hasActiveSubscription: false,
        canAccessPro: true,
      }

    case 'pro_monthly':
      return {
        status: 'active',
        plan: 'pro_monthly',
        trialEnd: null,
        trialDaysRemaining: 0,
        periodEnd: thirtyDaysFromNow.toISOString(),
        hasActiveSubscription: true,
        canAccessPro: true,
      }

    case 'pro_annual':
      return {
        status: 'active',
        plan: 'pro_annual',
        trialEnd: null,
        trialDaysRemaining: 0,
        periodEnd: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        hasActiveSubscription: true,
        canAccessPro: true,
      }

    case 'founding_member':
      return {
        status: 'lifetime',
        plan: 'founding_member',
        trialEnd: null,
        trialDaysRemaining: 0,
        periodEnd: null,
        hasActiveSubscription: true,
        canAccessPro: true,
      }

    case 'canceled':
      // Canceled but still has access until period end
      return {
        status: 'canceled',
        plan: 'pro_monthly',
        trialEnd: null,
        trialDaysRemaining: 0,
        periodEnd: thirtyDaysFromNow.toISOString(),
        hasActiveSubscription: true,
        canAccessPro: true,
      }

    case 'expired':
      return {
        status: 'expired',
        plan: 'trial',
        trialEnd: thirtyDaysAgo.toISOString(),
        trialDaysRemaining: 0,
        periodEnd: thirtyDaysAgo.toISOString(),
        hasActiveSubscription: false,
        canAccessPro: false,
      }

    default:
      return createMockSubscription('trial')
  }
}

/**
 * Mock the get-subscription Edge Function to return a specific subscription state.
 */
export async function mockSubscription(page: Page, state: SubscriptionState) {
  const subscription = createMockSubscription(state)

  await page.route('**/functions/v1/get-subscription**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(subscription),
    })
  })

  // Also inject auth state into the window
  await injectAuthState(page, state)
}

/**
 * Inject auth state into the window for components that check it.
 */
export async function injectAuthState(page: Page, state: SubscriptionState) {
  const subscription = createMockSubscription(state)

  const authState: AuthState = {
    isAuthenticated: true,
    isTrial: state === 'trial',
    isPro:
      state === 'pro_monthly' ||
      state === 'pro_annual' ||
      state === 'founding_member' ||
      state === 'canceled',
    isFoundingMember: state === 'founding_member',
    subscription,
  }

  await page.addInitScript(
    ({ authState }) => {
      ;(window as any).__ESCAPE_AUTH_STATE = authState
    },
    { authState }
  )
}

/**
 * Update subscription state mid-test (for upgrade/downgrade flows).
 * This updates the route handler to return a new subscription state.
 */
export async function updateSubscription(page: Page, newState: SubscriptionState) {
  const subscription = createMockSubscription(newState)

  // Unroute previous handler and add new one
  await page.unroute('**/functions/v1/get-subscription**')
  await page.route('**/functions/v1/get-subscription**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(subscription),
    })
  })

  // Update the injected auth state
  const authState: AuthState = {
    isAuthenticated: true,
    isTrial: newState === 'trial',
    isPro:
      newState === 'pro_monthly' ||
      newState === 'pro_annual' ||
      newState === 'founding_member' ||
      newState === 'canceled',
    isFoundingMember: newState === 'founding_member',
    subscription,
  }

  await page.evaluate(
    ({ authState }) => {
      ;(window as any).__ESCAPE_AUTH_STATE = authState
    },
    { authState }
  )
}

/**
 * Get the current auth state from the page.
 */
export async function getAuthState(page: Page): Promise<AuthState | null> {
  return page.evaluate(() => {
    return (window as any).__ESCAPE_AUTH_STATE || null
  })
}

/**
 * Check if the current user is in trial state based on the injected auth state.
 */
export async function isTrialUser(page: Page): Promise<boolean> {
  const authState = await getAuthState(page)
  return authState?.isTrial ?? false
}

/**
 * Check if the current user has Pro access based on the injected auth state.
 */
export async function hasProAccess(page: Page): Promise<boolean> {
  const authState = await getAuthState(page)
  return authState?.isPro ?? false
}
