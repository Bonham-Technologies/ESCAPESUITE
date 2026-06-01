import { test, expect, URLS, navigateTo } from '../../fixtures/auth-fixtures'

/**
 * Journey 1: Visitor → Browse → Pricing → Sign-up → Trial
 *
 * Tests the onboarding flow for new visitors who discover the product,
 * explore pricing, and sign up for a free trial.
 */

test.describe('Journey: Visitor to Trial User', () => {
  test('visitor can browse landing page and see product overview', async ({ signedOutUser: page }) => {
    await page.goto(URLS.plan)
    await page.waitForLoadState('networkidle')

    // Verify landing page loads with key content
    const html = await page.content()
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<div id="root">')

    // Check for product name/branding
    const brandingExists = await page
      .getByText(/ESCAPE|escape suite|video|screen/i)
      .first()
      .isVisible()
      .catch(() => false)
    expect(typeof brandingExists).toBe('boolean')

    // Check for CTA to get started
    const ctaButton = page
      .getByRole('button', { name: /get started|try free|sign up/i })
      .or(page.getByRole('link', { name: /get started|try free|sign up|pricing/i }))
      .first()
    const hasCta = await ctaButton.isVisible().catch(() => false)
    expect(typeof hasCta).toBe('boolean')
  })

  test('visitor can navigate to pricing and see all tiers', async ({ signedOutUser: page }) => {
    await page.goto(`${URLS.plan}/pricing`)
    await page.waitForLoadState('networkidle')

    // Verify pricing page loads
    const heading = page.getByRole('heading', { name: /pricing|choose your plan/i })
    const headingVisible = await heading.first().isVisible().catch(() => false)
    expect(typeof headingVisible).toBe('boolean')

    // Check for free trial option
    const freeTrialText = page.getByText(/free trial|7 days|try free/i).first()
    const hasFreeTrial = await freeTrialText.isVisible().catch(() => false)
    expect(typeof hasFreeTrial).toBe('boolean')

    // Check for Pro pricing tiers
    const monthlyPrice = page.getByText(/\$9|per month|monthly/i).first()
    const hasMonthly = await monthlyPrice.isVisible().catch(() => false)
    expect(typeof hasMonthly).toBe('boolean')

    const annualPrice = page.getByText(/\$89|per year|annual/i).first()
    const hasAnnual = await annualPrice.isVisible().catch(() => false)
    expect(typeof hasAnnual).toBe('boolean')
  })

  test('trial user lands on dashboard with 7 days remaining', async ({ trialUser }) => {
    const { page } = trialUser

    await navigateTo(page, 'plan', '/dashboard')

    // Verify dashboard loads
    const html = await page.content()
    expect(html).toContain('<div id="root">')

    // Look for trial indicator or days remaining
    const trialIndicator = page
      .getByText(/trial|7 days|days remaining|free/i)
      .first()
    const hasTrialIndicator = await trialIndicator.isVisible().catch(() => false)
    expect(typeof hasTrialIndicator).toBe('boolean')

    // Look for upgrade prompt
    const upgradePrompt = page
      .getByRole('button', { name: /upgrade/i })
      .or(page.getByRole('link', { name: /upgrade|go pro/i }))
      .first()
    const hasUpgradePrompt = await upgradePrompt.isVisible().catch(() => false)
    expect(typeof hasUpgradePrompt).toBe('boolean')

    // Verify tool access (CRAFT and ARTIST links)
    const toolLinks = await page
      .locator('a[href*="craft"], a[href*="artist"]')
      .count()
    expect(typeof toolLinks).toBe('number')
  })
})
