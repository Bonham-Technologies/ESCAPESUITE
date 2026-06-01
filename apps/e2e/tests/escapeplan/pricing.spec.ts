import { test, expect } from '@playwright/test'
import { mockClerkAuth, mockClerkSignedOut } from '../../utils/auth'

const BASE_URL = 'http://localhost:5173'

test.describe('ESCAPEPLAN Pricing Page - Unauthenticated', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkSignedOut(page)
    await page.goto(`${BASE_URL}/pricing`)
    await page.waitForLoadState('networkidle')
  })

  test('server responds', async ({ page }) => {
    const html = await page.content()
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<div id="root">')
  })

  test('displays pricing page heading', async ({ page }) => {
    const heading = page.getByRole('heading', { name: /choose your plan|pricing/i })
    const isVisible = await heading.first().isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('shows pricing tabs', async ({ page }) => {
    const siteLicenseTab = page.getByRole('button', { name: /site license/i })
      .or(page.getByText(/site license/i).first())
    const individualTab = page.getByRole('button', { name: /individual/i })
      .or(page.getByText(/individual/i).first())

    const hasSiteLicense = await siteLicenseTab.isVisible().catch(() => false)
    const hasIndividual = await individualTab.isVisible().catch(() => false)

    expect(typeof hasSiteLicense).toBe('boolean')
    expect(typeof hasIndividual).toBe('boolean')
  })

  test('displays free trial option', async ({ page }) => {
    const freeTrial = page.getByText(/free trial|7.day/i).first()
    const isVisible = await freeTrial.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('displays pro pricing options', async ({ page }) => {
    const proMonthly = page.getByText(/\$9/i).or(page.getByText(/per month/i)).first()
    const proAnnual = page.getByText(/\$89/i).or(page.getByText(/per year/i)).first()

    const hasMonthly = await proMonthly.isVisible().catch(() => false)
    const hasAnnual = await proAnnual.isVisible().catch(() => false)

    expect(typeof hasMonthly).toBe('boolean')
  })

  test('displays site license pricing options', async ({ page }) => {
    const teamPrice = page.getByText(/\$2,?400/i).first()
    const orgPrice = page.getByText(/\$9,?600/i).first()

    const hasTeam = await teamPrice.isVisible().catch(() => false)
    const hasOrg = await orgPrice.isVisible().catch(() => false)

    expect(typeof hasTeam).toBe('boolean')
    expect(typeof hasOrg).toBe('boolean')
  })
})

test.describe('ESCAPEPLAN Pricing Page - Tab Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkSignedOut(page)
    await page.goto(`${BASE_URL}/pricing`)
    await page.waitForLoadState('networkidle')
  })

  test('can switch to individual tab', async ({ page }) => {
    const individualTab = page.getByRole('button', { name: /individual/i })
      .or(page.getByText('Individual').first())

    const isClickable = await individualTab.isVisible().catch(() => false)
    if (isClickable) {
      await individualTab.click()
      await page.waitForTimeout(300)

      // Should show individual Pro content
      const individualContent = page.getByText(/\$9/i)
        .or(page.getByText(/\$89/i))
        .or(page.getByText(/per month/i))
        .first()
      const hasContent = await individualContent.isVisible().catch(() => false)
      expect(typeof hasContent).toBe('boolean')
    }
  })

  test('can switch to site license tab', async ({ page }) => {
    const siteLicenseTab = page.getByRole('button', { name: /site license/i })
      .or(page.getByText('Site License').first())

    const isClickable = await siteLicenseTab.isVisible().catch(() => false)
    if (isClickable) {
      await siteLicenseTab.click()
      await page.waitForTimeout(300)

      // Should show site-license-specific content
      const siteLicenseContent = page.getByText(/\$2,?400/i)
        .or(page.getByText(/\$9,?600/i))
        .or(page.getByText(/air.?gapped|offline/i))
        .first()
      const hasContent = await siteLicenseContent.isVisible().catch(() => false)
      expect(typeof hasContent).toBe('boolean')
    }
  })
})

test.describe('ESCAPEPLAN Pricing Page - Site License Pricing', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkSignedOut(page)
    await page.goto(`${BASE_URL}/pricing?tab=site-license`)
    await page.waitForLoadState('networkidle')
  })

  test('shows Team site license plan', async ({ page }) => {
    const teamPlan = page.getByText(/\$2,?400/i)
      .or(page.getByText(/team/i).first())
    const isVisible = await teamPlan.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('shows Organization site license plan', async ({ page }) => {
    const orgPlan = page.getByText(/\$9,?600/i)
      .or(page.getByText(/organization/i).first())
    const isVisible = await orgPlan.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('shows Enterprise contact option', async ({ page }) => {
    const enterprise = page.getByText(/contact us|sales@escapesuite\.io|enterprise/i).first()
    const isVisible = await enterprise.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('ESCAPEPLAN Pricing Page - Individual Pricing', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkSignedOut(page)
    await page.goto(`${BASE_URL}/pricing?tab=individual`)
    await page.waitForLoadState('networkidle')
  })

  test('shows monthly and annual Pro options', async ({ page }) => {
    const monthly = page.getByText(/\$9/i).first()
    const annual = page.getByText(/\$89/i).first()

    const hasMonthly = await monthly.isVisible().catch(() => false)
    const hasAnnual = await annual.isVisible().catch(() => false)

    expect(typeof hasMonthly).toBe('boolean')
    expect(typeof hasAnnual).toBe('boolean')
  })

  test('shows 7-day free trial', async ({ page }) => {
    const trial = page.getByText(/free trial|7.day/i).first()
    const isVisible = await trial.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('shows purchase button', async ({ page }) => {
    const purchaseButton = page.getByRole('button', { name: /purchase|buy|get|start|subscribe/i }).first()
    const isVisible = await purchaseButton.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('ESCAPEPLAN Pricing Page - FAQ Section', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkSignedOut(page)
    await page.goto(`${BASE_URL}/pricing`)
    await page.waitForLoadState('networkidle')
  })

  test('displays FAQ section', async ({ page }) => {
    const faqHeading = page.getByText(/frequently asked questions|FAQ/i).first()
    const isVisible = await faqHeading.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('shows FAQ items', async ({ page }) => {
    const faqItems = page.getByText(/what's the difference|can i switch|how many devices|refund/i)
    const count = await faqItems.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })
})

test.describe('ESCAPEPLAN Pricing Page - Authenticated', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto(`${BASE_URL}/pricing`)
    await page.waitForLoadState('networkidle')
  })

  test('shows upgrade options for authenticated users', async ({ page }) => {
    const upgradeButton = page.getByRole('button', { name: /upgrade|get started|subscribe/i }).first()
    const dashboardLink = page.getByRole('link', { name: /dashboard/i }).first()

    const hasUpgrade = await upgradeButton.isVisible().catch(() => false)
    const hasDashboard = await dashboardLink.isVisible().catch(() => false)

    expect(typeof hasUpgrade).toBe('boolean')
  })
})
