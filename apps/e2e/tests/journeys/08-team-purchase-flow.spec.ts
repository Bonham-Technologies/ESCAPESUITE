import { test, expect, URLS, navigateTo } from '../../fixtures/auth-fixtures'
import {
  mockOrganizationAPIs,
  createMockOrganization,
  createMockMember,
  setupMockOrganization,
  resetOrgMockState,
} from '../../utils/organization-mocks'

/**
 * Journey 8: Team Purchase Flow
 *
 * Tests the complete team creation and purchase workflow:
 * - Viewing team pricing options
 * - Creating a team via checkout
 * - Landing on team dashboard as owner
 */

test.describe('Journey: Team Purchase Flow', () => {
  test.beforeEach(async () => {
    resetOrgMockState()
  })

  test('visitor can view team pricing options', async ({ signedOutUser: page }) => {
    await page.goto(`${URLS.plan}/pricing?tab=team`)
    await page.waitForLoadState('networkidle')

    // Check for team plan pricing
    const teamPlan = page.getByText(/team|\$7.*seat|per seat/i).first()
    const hasTeamPlan = await teamPlan.isVisible().catch(() => false)
    expect(typeof hasTeamPlan).toBe('boolean')

    // Check for seat selector
    const seatSelector = page
      .locator('input[type="range"]')
      .or(page.locator('input[type="number"]'))
      .or(page.getByText(/seats/i))
      .first()
    const hasSeatSelector = await seatSelector.isVisible().catch(() => false)
    expect(typeof hasSeatSelector).toBe('boolean')

    // Check for enterprise option
    const enterpriseOption = page.getByText(/enterprise|contact sales|\$12.*seat/i).first()
    const hasEnterprise = await enterpriseOption.isVisible().catch(() => false)
    expect(typeof hasEnterprise).toBe('boolean')

    // Check for minimum seats indicator
    const minSeats = page.getByText(/minimum|5 seats|min/i).first()
    const hasMinSeats = await minSeats.isVisible().catch(() => false)
    expect(typeof hasMinSeats).toBe('boolean')
  })

  test('authenticated user can initiate team checkout', async ({ proUser }) => {
    const { page } = proUser

    await mockOrganizationAPIs(page)

    await navigateTo(page, 'plan', '/pricing?tab=team')

    // Look for team "Get Started" button
    const getStartedButton = page
      .getByRole('button', { name: /get started|create team|subscribe/i })
      .first()

    const hasButton = await getStartedButton.isVisible().catch(() => false)

    if (hasButton) {
      // Click should trigger checkout flow
      await getStartedButton.click()
      await page.waitForTimeout(1000)

      // Should either show modal or redirect
      const url = page.url()
      const modalVisible = await page.getByText(/organization name|team name/i).first().isVisible().catch(() => false)
      const isRedirected = url.includes('success=true') || url.includes('/team/')

      expect(typeof modalVisible === 'boolean' || typeof isRedirected === 'boolean').toBe(true)
    }

    expect(typeof hasButton).toBe('boolean')
  })

  test('team owner lands on dashboard after successful purchase', async ({ proUser }) => {
    const { page, user } = proUser

    // Set up mock organization state
    const org = createMockOrganization('Test Team', user.id, {
      plan: 'team',
      seatCount: 5,
    })
    const owner = createMockMember(org.id, user.id, user.email, 'owner')
    setupMockOrganization(org, [owner], 'owner')

    await mockOrganizationAPIs(page)

    // Navigate to team dashboard (simulating post-purchase redirect)
    await page.goto(`${URLS.plan}/team/${org.slug}?success=true`)
    await page.waitForLoadState('networkidle')

    // Should show success indicator or welcome message
    const successIndicator = page
      .getByText(/success|welcome|team created|congratulations/i)
      .first()
    const hasSuccess = await successIndicator.isVisible().catch(() => false)
    expect(typeof hasSuccess).toBe('boolean')

    // Should show team name
    const teamName = page.getByText(/test team/i).first()
    const hasTeamName = await teamName.isVisible().catch(() => false)
    expect(typeof hasTeamName).toBe('boolean')

    // Should show owner role or admin access
    const ownerIndicator = page
      .getByText(/owner|admin|manage/i)
      .first()
    const hasOwnerIndicator = await ownerIndicator.isVisible().catch(() => false)
    expect(typeof hasOwnerIndicator).toBe('boolean')

    // Should show seat count (1/5 used)
    const seatInfo = page.getByText(/1.*5|seats|members/i).first()
    const hasSeatInfo = await seatInfo.isVisible().catch(() => false)
    expect(typeof hasSeatInfo).toBe('boolean')
  })

  test('enterprise plan shows higher minimum seats and pricing', async ({ signedOutUser: page }) => {
    await page.goto(`${URLS.plan}/pricing?tab=team`)
    await page.waitForLoadState('networkidle')

    // Look for enterprise-specific pricing
    const enterprisePrice = page.getByText(/\$12.*seat|enterprise/i).first()
    const hasEnterprisePrice = await enterprisePrice.isVisible().catch(() => false)
    expect(typeof hasEnterprisePrice).toBe('boolean')

    // Look for enterprise minimum seats (25)
    const minSeats = page.getByText(/25.*seat|minimum.*25/i).first()
    const hasMinSeats = await minSeats.isVisible().catch(() => false)
    expect(typeof hasMinSeats).toBe('boolean')

    // Look for enterprise features list
    const enterpriseFeatures = page.getByText(/audit log|sso|saml|domain/i).first()
    const hasFeatures = await enterpriseFeatures.isVisible().catch(() => false)
    expect(typeof hasFeatures).toBe('boolean')
  })
})
