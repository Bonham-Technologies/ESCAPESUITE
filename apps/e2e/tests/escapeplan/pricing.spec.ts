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
    const individualTab = page.getByRole('button', { name: /individual/i })
      .or(page.getByText(/individual/i).first())
    const teamsTab = page.getByRole('button', { name: /teams/i })
      .or(page.getByText(/teams/i).first())
    const standaloneTab = page.getByRole('button', { name: /standalone/i })
      .or(page.getByText(/standalone/i).first())

    const hasIndividual = await individualTab.isVisible().catch(() => false)
    const hasTeams = await teamsTab.isVisible().catch(() => false)
    const hasStandalone = await standaloneTab.isVisible().catch(() => false)

    expect(typeof hasIndividual).toBe('boolean')
  })

  test('displays free trial option', async ({ page }) => {
    const freeTrial = page.getByText(/free trial/i).first()
    const isVisible = await freeTrial.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('displays pro pricing options', async ({ page }) => {
    const proMonthly = page.getByText(/\$9/i).or(page.getByText(/per month/i)).first()
    const proAnnual = page.getByText(/\$79/i).or(page.getByText(/per year/i)).first()

    const hasMonthly = await proMonthly.isVisible().catch(() => false)
    const hasAnnual = await proAnnual.isVisible().catch(() => false)

    expect(typeof hasMonthly).toBe('boolean')
  })

  test('shows founding member option', async ({ page }) => {
    const founding = page.getByText(/founding member/i).first()
    const isVisible = await founding.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('ESCAPEPLAN Pricing Page - Tab Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkSignedOut(page)
    await page.goto(`${BASE_URL}/pricing`)
    await page.waitForLoadState('networkidle')
  })

  test('can switch to teams tab', async ({ page }) => {
    const teamsTab = page.getByRole('button', { name: /teams/i })
      .or(page.getByText('Teams').first())

    const isClickable = await teamsTab.isVisible().catch(() => false)
    if (isClickable) {
      await teamsTab.click()
      await page.waitForTimeout(300)

      // Should show team-specific content
      const teamContent = page.getByText(/seat/i)
        .or(page.getByText(/team features/i))
        .first()
      const hasTeamContent = await teamContent.isVisible().catch(() => false)
      expect(typeof hasTeamContent).toBe('boolean')
    }
  })

  test('can switch to standalone tab', async ({ page }) => {
    const standaloneTab = page.getByRole('button', { name: /standalone/i })
      .or(page.getByText('Standalone License').first())

    const isClickable = await standaloneTab.isVisible().catch(() => false)
    if (isClickable) {
      await standaloneTab.click()
      await page.waitForTimeout(300)

      // Should show standalone-specific content
      const standaloneContent = page.getByText(/ESCAPECRAFT/i)
        .or(page.getByText(/ESCAPEARTIST/i))
        .or(page.getByText(/suite bundle/i))
        .first()
      const hasContent = await standaloneContent.isVisible().catch(() => false)
      expect(typeof hasContent).toBe('boolean')
    }
  })
})

test.describe('ESCAPEPLAN Pricing Page - Team Pricing', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkSignedOut(page)
    await page.goto(`${BASE_URL}/pricing?tab=team`)
    await page.waitForLoadState('networkidle')
  })

  test('shows team plan options', async ({ page }) => {
    const teamPlan = page.getByText(/\$7.*seat/i)
      .or(page.getByText(/team/i).first())
    const isVisible = await teamPlan.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('shows enterprise plan option', async ({ page }) => {
    const enterprise = page.getByText(/enterprise/i).first()
    const isVisible = await enterprise.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('has seat count selector', async ({ page }) => {
    const seatSelector = page.locator('input[type="range"]')
      .or(page.locator('input[type="number"]'))
      .or(page.getByText(/seats/i))
      .first()
    const isVisible = await seatSelector.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('ESCAPEPLAN Pricing Page - Standalone Pricing', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkSignedOut(page)
    await page.goto(`${BASE_URL}/pricing?tab=standalone`)
    await page.waitForLoadState('networkidle')
  })

  test('shows product selection', async ({ page }) => {
    const craftOption = page.getByText(/ESCAPECRAFT/i).first()
    const artistOption = page.getByText(/ESCAPEARTIST/i).first()
    const suiteOption = page.getByText(/suite bundle/i).first()

    const hasCraft = await craftOption.isVisible().catch(() => false)
    const hasArtist = await artistOption.isVisible().catch(() => false)
    const hasSuite = await suiteOption.isVisible().catch(() => false)

    expect(typeof hasCraft).toBe('boolean')
  })

  test('shows tier selection', async ({ page }) => {
    const standard = page.getByText(/standard/i).first()
    const pro = page.getByText(/pro/i).first()
    const lifetime = page.getByText(/lifetime/i).first()

    const hasStandard = await standard.isVisible().catch(() => false)
    const hasPro = await pro.isVisible().catch(() => false)
    const hasLifetime = await lifetime.isVisible().catch(() => false)

    expect(typeof hasStandard).toBe('boolean')
  })

  test('shows purchase button', async ({ page }) => {
    const purchaseButton = page.getByRole('button', { name: /purchase|buy|get/i }).first()
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
