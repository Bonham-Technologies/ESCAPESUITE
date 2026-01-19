import { test as base, Page } from '@playwright/test'
import { mockClerkAuth, mockClerkSignedOut, MockUser, MockSession } from '../utils/auth'
import {
  mockSubscription,
  SubscriptionState,
  injectAuthState,
} from '../utils/subscription-mocks'
import { mockStripeCheckout, mockStripePortal, mockAllStripeEndpoints } from '../utils/stripe-mocks'
import { injectLicense, mockLicenseValidation, ProductType, LicenseTier } from '../utils/license-mocks'

/**
 * User fixture with page and metadata.
 */
export interface UserFixture {
  page: Page
  user: MockUser
  subscriptionState: SubscriptionState
}

/**
 * Licensed user fixture with license info.
 */
export interface LicensedUserFixture extends UserFixture {
  licenseKey: string
  product: ProductType
  tier: LicenseTier
}

/**
 * Extended test fixtures for user journey testing.
 */
export const test = base.extend<{
  trialUser: UserFixture
  proUser: UserFixture
  foundingUser: UserFixture
  expiredUser: UserFixture
  canceledUser: UserFixture
  licensedUser: LicensedUserFixture
  signedOutUser: Page
}>({
  /**
   * Trial user with 14 days remaining.
   */
  trialUser: async ({ page }, use) => {
    const user: MockUser = {
      id: 'user_trial_123',
      email: 'trial@example.com',
      name: 'Trial User',
    }

    await mockClerkAuth(page, { user })
    await mockSubscription(page, 'trial')
    await mockAllStripeEndpoints(page)

    await use({
      page,
      user,
      subscriptionState: 'trial',
    })
  },

  /**
   * Pro Monthly subscriber with active subscription.
   */
  proUser: async ({ page }, use) => {
    const user: MockUser = {
      id: 'user_pro_123',
      email: 'pro@example.com',
      name: 'Pro User',
    }

    await mockClerkAuth(page, { user })
    await mockSubscription(page, 'pro_monthly')
    await mockAllStripeEndpoints(page)

    await use({
      page,
      user,
      subscriptionState: 'pro_monthly',
    })
  },

  /**
   * Founding Member with lifetime access.
   */
  foundingUser: async ({ page }, use) => {
    const user: MockUser = {
      id: 'user_founding_123',
      email: 'founding@example.com',
      name: 'Founding Member',
    }

    await mockClerkAuth(page, { user })
    await mockSubscription(page, 'founding_member')
    await mockAllStripeEndpoints(page)

    await use({
      page,
      user,
      subscriptionState: 'founding_member',
    })
  },

  /**
   * User with expired subscription (no access).
   */
  expiredUser: async ({ page }, use) => {
    const user: MockUser = {
      id: 'user_expired_123',
      email: 'expired@example.com',
      name: 'Expired User',
    }

    await mockClerkAuth(page, { user })
    await mockSubscription(page, 'expired')
    await mockAllStripeEndpoints(page)

    await use({
      page,
      user,
      subscriptionState: 'expired',
    })
  },

  /**
   * User who canceled but still has access until period end.
   */
  canceledUser: async ({ page }, use) => {
    const user: MockUser = {
      id: 'user_canceled_123',
      email: 'canceled@example.com',
      name: 'Canceled User',
    }

    await mockClerkAuth(page, { user })
    await mockSubscription(page, 'canceled')
    await mockAllStripeEndpoints(page)

    await use({
      page,
      user,
      subscriptionState: 'canceled',
    })
  },

  /**
   * User with valid standalone license.
   */
  licensedUser: async ({ page }, use) => {
    const user: MockUser = {
      id: 'user_licensed_123',
      email: 'licensed@example.com',
      name: 'Licensed User',
    }

    const product: ProductType = 'suite'
    const tier: LicenseTier = 'pro'

    await mockClerkAuth(page, { user })
    await mockLicenseValidation(page)
    const licenseKey = await injectLicense(page, product, {
      tier,
      email: user.email,
      customerName: user.name,
    })

    await use({
      page,
      user,
      subscriptionState: 'trial', // Standalone users might also be trial SaaS users
      licenseKey,
      product,
      tier,
    })
  },

  /**
   * Signed out visitor (no authentication).
   */
  signedOutUser: async ({ page }, use) => {
    await mockClerkSignedOut(page)
    await mockAllStripeEndpoints(page)

    await use(page)
  },
})

/**
 * Re-export expect from Playwright for convenience.
 */
export { expect } from '@playwright/test'

/**
 * Base URLs for each app.
 */
export const URLS = {
  plan: 'http://localhost:5173',
  craft: 'http://localhost:5174',
  artist: 'http://localhost:5175',
  craftStandalone: 'http://localhost:5184',
  artistStandalone: 'http://localhost:5185',
}

/**
 * Navigate to an app with the appropriate base URL.
 */
export async function navigateTo(
  page: Page,
  app: 'plan' | 'craft' | 'artist',
  path: string = ''
) {
  const baseUrl = URLS[app]
  await page.goto(`${baseUrl}${path}`)
  await page.waitForLoadState('networkidle')
}

/**
 * Navigate to standalone app.
 */
export async function navigateToStandalone(
  page: Page,
  app: 'craft' | 'artist',
  path: string = ''
) {
  const baseUrl = app === 'craft' ? URLS.craftStandalone : URLS.artistStandalone
  await page.goto(`${baseUrl}${path}`)
  await page.waitForLoadState('networkidle')
}
