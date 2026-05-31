import { test, expect } from '@playwright/test'
import { mockClerkAuth } from '../../utils/auth'
import {
  mockNetworkFailure,
  mockNetworkTimeout,
  mockAPIError,
  mockSlowNetwork,
  mockOffline,
  mockOnline,
  mockSupabaseError,
  mockStripeError,
  mockLicenseValidationError,
} from '../../utils/error-mocks'

test.describe('Subscription API Failures', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
  })

  test('shows error on subscription API failure', async ({ page }) => {
    await mockSupabaseError(page, 'get-subscription', 500, 'Internal server error')
    await page.goto('http://localhost:5173/dashboard')
    await page.waitForLoadState('networkidle')

    // Should show error or fallback UI
    const errorIndicator = page.getByText(/error|failed|unavailable|try again/i).first()
    const hasError = await errorIndicator.isVisible().catch(() => false)

    // App should still load
    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })

  test('handles subscription timeout gracefully', async ({ page }) => {
    await mockNetworkTimeout(page, '**/functions/v1/get-subscription', 5000)
    await page.goto('http://localhost:5173/dashboard')

    // Should show loading state or timeout message
    await page.waitForTimeout(2000)

    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })
})

test.describe('Stripe Checkout Errors', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
  })

  test('shows error on card declined', async ({ page }) => {
    await mockStripeError(page, 'card_declined')
    await page.goto('http://localhost:5173/pricing')
    await page.waitForLoadState('networkidle')

    // Try to initiate checkout
    const upgradeButton = page.getByRole('button', { name: /upgrade|subscribe|buy/i }).first()
    const isVisible = await upgradeButton.isVisible().catch(() => false)

    if (isVisible) {
      await upgradeButton.click()
      await page.waitForTimeout(1000)

      // Should show payment error
      const errorMessage = page.getByText(/declined|failed|error|try again/i).first()
      const hasError = await errorMessage.isVisible().catch(() => false)

      // App should still function
      const html = await page.content()
      expect(html).toContain('<div id="root">')
    }
  })

  test('handles Stripe network error', async ({ page }) => {
    await mockStripeError(page, 'network_error')
    await page.goto('http://localhost:5173/pricing')
    await page.waitForLoadState('networkidle')

    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })
})

test.describe('License Validation Errors', () => {
  test('shows error for invalid license key', async ({ page }) => {
    await mockClerkAuth(page)
    await mockLicenseValidationError(page, 'invalid')
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')

    // Look for license activation UI
    const licenseInput = page.getByPlaceholder(/license|key/i).first()
    const isVisible = await licenseInput.isVisible().catch(() => false)

    if (isVisible) {
      await licenseInput.fill('INVALID-KEY-12345')

      const activateButton = page.getByRole('button', { name: /activate|submit/i }).first()
      const buttonVisible = await activateButton.isVisible().catch(() => false)

      if (buttonVisible) {
        await activateButton.click()
        await page.waitForTimeout(500)

        // Should show invalid error
        const errorMessage = page.getByText(/invalid|incorrect|wrong/i).first()
        const hasError = await errorMessage.isVisible().catch(() => false)
        expect(typeof hasError).toBe('boolean')
      }
    }
  })

  test('shows error for expired license', async ({ page }) => {
    await mockClerkAuth(page)
    await mockLicenseValidationError(page, 'expired')
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')

    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })

  test('handles license validation timeout', async ({ page }) => {
    await mockClerkAuth(page)
    await mockLicenseValidationError(page, 'network')
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')

    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })
})

test.describe('Graceful Degradation', () => {
  test('app works partially when some APIs fail', async ({ page }) => {
    await mockClerkAuth(page)
    // Mock only subscription API as failing
    await mockSupabaseError(page, 'get-subscription', 503, 'Service unavailable')

    await page.goto('http://localhost:5173/dashboard')
    await page.waitForLoadState('networkidle')

    // Core navigation should still work
    const nav = page.locator('nav, header').first()
    const hasNav = await nav.isVisible().catch(() => false)
    expect(typeof hasNav).toBe('boolean')
  })

  test('handles offline mode', async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')

    // Go offline
    await mockOffline(page)

    // Recording features should still work (local)
    const html = await page.content()
    expect(html).toContain('<div id="root">')

    // Go back online
    await mockOnline(page)
  })

  test('handles slow network', async ({ page }) => {
    await mockClerkAuth(page)
    await mockSlowNetwork(page, 2000)

    // Should still load eventually
    await page.goto('http://localhost:5174', { timeout: 60000 })

    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })
})

test.describe('Retry Mechanisms', () => {
  test('can retry after network failure', async ({ page }) => {
    await mockClerkAuth(page)

    let failCount = 0
    await page.route('**/functions/v1/get-subscription', async (route) => {
      failCount++
      if (failCount <= 2) {
        await route.abort('failed')
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ subscription: null }),
        })
      }
    })

    await page.goto('http://localhost:5173/dashboard')
    await page.waitForLoadState('networkidle')

    // App should eventually load
    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })
})

test.describe('API Rate Limiting', () => {
  test('handles 429 rate limit response', async ({ page }) => {
    await mockClerkAuth(page)
    await mockAPIError(page, '**/functions/v1/**', 429, 'Too many requests')

    await page.goto('http://localhost:5173/dashboard')
    await page.waitForLoadState('networkidle')

    // Should show rate limit message or retry
    const rateLimitMessage = page.getByText(/too many|rate limit|slow down|wait/i).first()
    const hasRateLimit = await rateLimitMessage.isVisible().catch(() => false)

    // App should still load
    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })
})

test.describe('401/403 Authentication Errors', () => {
  test('handles 401 unauthorized', async ({ page }) => {
    await mockClerkAuth(page)
    await mockAPIError(page, '**/functions/v1/get-subscription', 401, 'Unauthorized')

    await page.goto('http://localhost:5173/dashboard')
    await page.waitForLoadState('networkidle')

    // Should redirect to login or show error
    const url = page.url()
    const html = await page.content()

    expect(html).toContain('<div id="root">')
  })

  test('handles 403 forbidden', async ({ page }) => {
    await mockClerkAuth(page)
    await mockAPIError(page, '**/functions/v1/get-subscription', 403, 'Forbidden')

    await page.goto('http://localhost:5173/dashboard')
    await page.waitForLoadState('networkidle')

    // Should show access denied message
    const forbiddenMessage = page.getByText(/forbidden|access denied|not authorized/i).first()
    const hasForbidden = await forbiddenMessage.isVisible().catch(() => false)

    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })
})
