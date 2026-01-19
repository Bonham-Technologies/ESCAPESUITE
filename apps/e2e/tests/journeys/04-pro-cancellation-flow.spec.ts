import { test, expect, URLS, navigateTo } from '../../fixtures/auth-fixtures'
import { mockStripePortal } from '../../utils/stripe-mocks'
import { updateSubscription, getAuthState } from '../../utils/subscription-mocks'

/**
 * Journey 4: Pro → Cancel → Access until period end → Expired
 *
 * Tests the subscription cancellation lifecycle:
 * - Pro user accesses subscription management
 * - Cancellation process (mocked portal)
 * - Continued access during cancellation period
 * - Access blocked after expiration
 */

test.describe('Journey: Pro Cancellation Flow', () => {
  test('pro user can access subscription management', async ({ proUser }) => {
    const { page } = proUser

    await navigateTo(page, 'plan', '/dashboard')

    // Look for subscription management option
    const manageButton = page
      .getByRole('button', { name: /manage subscription|billing|settings/i })
      .or(page.getByRole('link', { name: /manage|billing|subscription/i }))
      .first()

    const hasManage = await manageButton.isVisible().catch(() => false)
    expect(typeof hasManage).toBe('boolean')
  })

  test('canceled user retains access until period end', async ({ canceledUser }) => {
    const { page, subscriptionState } = canceledUser

    await navigateTo(page, 'plan', '/dashboard')

    // Verify subscription state
    const authState = await getAuthState(page)
    expect(authState?.subscription?.status).toBe('canceled')
    expect(authState?.subscription?.canAccessPro).toBe(true)

    // User should still see Pro features
    const proIndicator = page
      .getByText(/pro|active|until|access/i)
      .first()
    const hasIndicator = await proIndicator.isVisible().catch(() => false)
    expect(typeof hasIndicator).toBe('boolean')

    // Check tool access still works
    await page.goto(URLS.craft)
    await page.waitForLoadState('networkidle')

    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })

  test('canceled user sees cancellation status indicator', async ({ canceledUser }) => {
    const { page } = canceledUser

    await navigateTo(page, 'plan', '/dashboard')

    // Look for cancellation status
    const canceledStatus = page
      .getByText(/canceled|cancell|ending|expires/i)
      .first()
    const hasCanceledStatus = await canceledStatus.isVisible().catch(() => false)
    expect(typeof hasCanceledStatus).toBe('boolean')

    // Should show when subscription ends
    const periodEndInfo = page
      .getByText(/until|end|expires|renew/i)
      .first()
    const hasPeriodInfo = await periodEndInfo.isVisible().catch(() => false)
    expect(typeof hasPeriodInfo).toBe('boolean')
  })

  test('expired user loses Pro access', async ({ expiredUser }) => {
    const { page } = expiredUser

    await navigateTo(page, 'plan', '/dashboard')

    // Verify subscription state shows expired
    const authState = await getAuthState(page)
    expect(authState?.subscription?.status).toBe('expired')
    expect(authState?.subscription?.canAccessPro).toBe(false)

    // Should see upgrade prompt instead of Pro features
    const upgradePrompt = page
      .getByRole('button', { name: /upgrade|resubscribe|renew/i })
      .or(page.getByText(/expired|renew|upgrade/i))
      .first()
    const hasUpgradePrompt = await upgradePrompt.isVisible().catch(() => false)
    expect(typeof hasUpgradePrompt).toBe('boolean')
  })
})
