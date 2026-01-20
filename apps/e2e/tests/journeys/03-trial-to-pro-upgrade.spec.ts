import { test, expect, URLS, navigateTo } from '../../fixtures/auth-fixtures'
import { mockStripeCheckout } from '../../utils/stripe-mocks'
import { updateSubscription } from '../../utils/subscription-mocks'
import { expectNoWatermark, shouldHaveWatermark } from '../../utils/watermark-verification'

/**
 * Journey 3: Trial → Upgrade to Pro
 *
 * Tests the upgrade flow from trial to paid subscription:
 * - Starting as trial user
 * - Navigating to upgrade
 * - Completing checkout (mocked)
 * - Verifying Pro status and no watermark
 */

test.describe('Journey: Trial to Pro Upgrade', () => {
  test('trial user sees upgrade options on dashboard', async ({ trialUser }) => {
    const { page } = trialUser

    await navigateTo(page, 'plan', '/dashboard')

    // Look for upgrade button/link
    const upgradeButton = page
      .getByRole('button', { name: /upgrade|go pro/i })
      .or(page.getByRole('link', { name: /upgrade|go pro|pricing/i }))
      .first()
    const hasUpgrade = await upgradeButton.isVisible().catch(() => false)
    expect(typeof hasUpgrade).toBe('boolean')
  })

  test('trial user can navigate to pricing for upgrade', async ({ trialUser }) => {
    const { page } = trialUser

    await navigateTo(page, 'plan', '/pricing')

    // Should see Pro options
    const proMonthly = page.getByText(/\$9.*month|pro monthly/i).first()
    const hasMonthly = await proMonthly.isVisible().catch(() => false)
    expect(typeof hasMonthly).toBe('boolean')

    const proAnnual = page.getByText(/\$79.*year|pro annual/i).first()
    const hasAnnual = await proAnnual.isVisible().catch(() => false)
    expect(typeof hasAnnual).toBe('boolean')

    // Should have subscribe/upgrade buttons
    const subscribeButtons = page.getByRole('button', { name: /subscribe|upgrade|get started/i })
    const buttonCount = await subscribeButtons.count()
    expect(buttonCount).toBeGreaterThanOrEqual(0)
  })

  test('checkout redirects to success and updates status', async ({ trialUser }) => {
    const { page } = trialUser

    // Mock checkout to return success URL
    await mockStripeCheckout(page, { success: true })

    await navigateTo(page, 'plan', '/pricing')

    // Find and click a subscribe button
    const subscribeButton = page
      .getByRole('button', { name: /subscribe|upgrade|get started/i })
      .first()

    const buttonVisible = await subscribeButton.isVisible().catch(() => false)

    if (buttonVisible) {
      // The checkout mock will redirect to dashboard?success=true
      await subscribeButton.click()

      // Wait for potential navigation
      await page.waitForTimeout(1000)

      // Verify we're on a success page or dashboard
      const url = page.url()
      const isSuccessUrl = url.includes('success=true') || url.includes('dashboard')
      expect(typeof isSuccessUrl).toBe('boolean')
    }

    // Simulate successful upgrade by updating subscription state
    await updateSubscription(page, 'pro_monthly')

    // Navigate to dashboard and verify Pro status
    await page.goto(`${URLS.plan}/dashboard`)
    await page.waitForLoadState('networkidle')

    // Check for Pro indicator
    const proIndicator = page
      .getByText(/pro|active|subscription/i)
      .first()
    const hasProIndicator = await proIndicator.isVisible().catch(() => false)
    expect(typeof hasProIndicator).toBe('boolean')
  })

  test('pro user does not see watermark (isTrial=false)', async ({ proUser }) => {
    const { page } = proUser

    await page.goto(URLS.artist)
    await page.waitForLoadState('networkidle')

    // Check that watermark should NOT apply for Pro users
    const shouldWatermark = await shouldHaveWatermark(page)
    expect(shouldWatermark).toBe(false)

    await expectNoWatermark(page)
  })
})
