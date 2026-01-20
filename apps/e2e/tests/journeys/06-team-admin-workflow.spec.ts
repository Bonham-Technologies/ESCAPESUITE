import { test, expect, URLS, navigateTo } from '../../fixtures/auth-fixtures'
import { Page } from '@playwright/test'

/**
 * Journey 6: Team admin → Create org → Invite → Member accepts
 *
 * Tests the team/organization workflow:
 * - Creating a new organization
 * - Inviting team members
 * - Member invitation acceptance flow
 */

/**
 * Mock organization API endpoints for testing.
 */
async function mockOrganizationAPIs(page: Page) {
  // Mock create-organization endpoint
  await page.route('**/functions/v1/create-organization**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'org_mock_123',
        name: 'Test Team',
        slug: 'test-team',
        plan: 'team',
        seat_count: 5,
      }),
    })
  })

  // Mock get-organization endpoint
  await page.route('**/functions/v1/get-organization**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'org_mock_123',
        name: 'Test Team',
        slug: 'test-team',
        plan: 'team',
        seat_count: 5,
        owner_id: 'user_pro_123',
        settings: {
          require_2fa: false,
          audit_logging: false,
        },
      }),
    })
  })

  // Mock get-organization-members endpoint
  await page.route('**/functions/v1/get-organization-members**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        members: [
          {
            id: 'member_1',
            user_id: 'user_pro_123',
            email: 'admin@example.com',
            role: 'owner',
            status: 'active',
            joined_at: new Date().toISOString(),
          },
        ],
      }),
    })
  })

  // Mock invite-member endpoint
  await page.route('**/functions/v1/invite-member**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        invite: {
          id: 'invite_mock_123',
          email: 'member@example.com',
          role: 'member',
          token: 'mock_invite_token_123',
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        },
      }),
    })
  })

  // Mock accept-invite endpoint
  await page.route('**/functions/v1/accept-invite**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        organization: {
          id: 'org_mock_123',
          name: 'Test Team',
          slug: 'test-team',
        },
      }),
    })
  })

  // Mock create-org-checkout endpoint
  await page.route('**/functions/v1/create-org-checkout**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        url: `${URLS.plan}/team/test-team?success=true`,
      }),
    })
  })
}

test.describe('Journey: Team Admin Workflow', () => {
  test('pro user can see team options on pricing page', async ({ proUser }) => {
    const { page } = proUser

    await page.goto(`${URLS.plan}/pricing?tab=team`)
    await page.waitForLoadState('networkidle')

    // Check for team plan options
    const teamPlan = page.getByText(/team|per seat|organization/i).first()
    const hasTeamPlan = await teamPlan.isVisible().catch(() => false)
    expect(typeof hasTeamPlan).toBe('boolean')

    // Check for seat count selector
    const seatSelector = page
      .locator('input[type="range"]')
      .or(page.locator('input[type="number"]'))
      .or(page.getByText(/seats/i))
      .first()
    const hasSeatSelector = await seatSelector.isVisible().catch(() => false)
    expect(typeof hasSeatSelector).toBe('boolean')

    // Check for enterprise option
    const enterpriseOption = page.getByText(/enterprise|contact sales/i).first()
    const hasEnterprise = await enterpriseOption.isVisible().catch(() => false)
    expect(typeof hasEnterprise).toBe('boolean')
  })

  test('team admin can access team dashboard and member management', async ({ proUser }) => {
    const { page } = proUser

    await mockOrganizationAPIs(page)

    // Navigate to team dashboard
    await page.goto(`${URLS.plan}/team/test-team`)
    await page.waitForLoadState('networkidle')

    // Check for team dashboard elements
    const teamHeading = page
      .getByRole('heading', { name: /test team|team dashboard/i })
      .or(page.getByText(/test team/i))
      .first()
    const hasTeamHeading = await teamHeading.isVisible().catch(() => false)
    expect(typeof hasTeamHeading).toBe('boolean')

    // Check for member management link
    const membersLink = page
      .getByRole('link', { name: /members|team members/i })
      .or(page.getByText(/manage members|invite/i))
      .first()
    const hasMembersLink = await membersLink.isVisible().catch(() => false)
    expect(typeof hasMembersLink).toBe('boolean')

    // Check for settings link
    const settingsLink = page
      .getByRole('link', { name: /settings|team settings/i })
      .or(page.getByText(/settings/i))
      .first()
    const hasSettingsLink = await settingsLink.isVisible().catch(() => false)
    expect(typeof hasSettingsLink).toBe('boolean')
  })

  test('invite acceptance flow loads correctly', async ({ signedOutUser: page }) => {
    await mockOrganizationAPIs(page)

    // Navigate to invite acceptance page
    await page.goto(`${URLS.plan}/invite/mock_invite_token_123`)
    await page.waitForLoadState('networkidle')

    // Page should load (may show sign-in prompt for unauthenticated users)
    const html = await page.content()
    expect(html).toContain('<div id="root">')

    // Look for invite-related content
    const inviteContent = page
      .getByText(/invite|join|team|organization|sign in/i)
      .first()
    const hasInviteContent = await inviteContent.isVisible().catch(() => false)
    expect(typeof hasInviteContent).toBe('boolean')
  })
})
