import { Page } from '@playwright/test'

/**
 * Utilities for mocking Stripe payment flows in E2E tests.
 *
 * These utilities intercept Stripe-related API calls and return mock responses,
 * allowing tests to simulate payment flows without real Stripe interactions.
 */

export interface CheckoutOptions {
  success?: boolean
  priceId?: string
  customerId?: string
  subscriptionId?: string
}

export interface LicenseCheckoutOptions {
  product: 'craft' | 'artist' | 'suite'
  tier: 'standard' | 'pro' | 'lifetime'
  success?: boolean
}

/**
 * Mock Stripe checkout session creation.
 * Intercepts the create-checkout Edge Function and returns a mock redirect URL.
 */
export async function mockStripeCheckout(page: Page, options: CheckoutOptions = {}) {
  const { success = true, customerId = 'cus_mock_123', subscriptionId = 'sub_mock_123' } = options

  await page.route('**/functions/v1/create-checkout**', async (route) => {
    if (success) {
      // Return mock checkout URL that redirects to success
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: `${page.url().split('/').slice(0, 3).join('/')}/dashboard?success=true&customer=${customerId}&subscription=${subscriptionId}`,
        }),
      })
    } else {
      // Return cancel URL
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: `${page.url().split('/').slice(0, 3).join('/')}/?canceled=true`,
        }),
      })
    }
  })
}

/**
 * Mock Stripe customer portal session.
 * Intercepts the create-portal Edge Function and returns a mock portal URL.
 */
export async function mockStripePortal(page: Page) {
  await page.route('**/functions/v1/create-portal**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        url: `${page.url().split('/').slice(0, 3).join('/')}/dashboard?portal=true`,
      }),
    })
  })
}

/**
 * Mock Stripe checkout for standalone license purchases.
 * Intercepts the create-license-checkout Edge Function.
 */
export async function mockLicenseCheckout(page: Page, options: LicenseCheckoutOptions) {
  const { product, tier, success = true } = options

  await page.route('**/functions/v1/create-license-checkout**', async (route) => {
    if (success) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: `${page.url().split('/').slice(0, 3).join('/')}/dashboard?tab=downloads&success=true&product=${product}&tier=${tier}`,
        }),
      })
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: `${page.url().split('/').slice(0, 3).join('/')}/?canceled=true`,
        }),
      })
    }
  })
}

/**
 * Mock all Stripe-related endpoints to prevent actual API calls.
 */
export async function mockAllStripeEndpoints(page: Page) {
  // Block actual Stripe.js from loading
  await page.route('**/*.stripe.com/**', async (route) => {
    await route.abort()
  })

  // Mock checkout
  await mockStripeCheckout(page)

  // Mock portal
  await mockStripePortal(page)
}
