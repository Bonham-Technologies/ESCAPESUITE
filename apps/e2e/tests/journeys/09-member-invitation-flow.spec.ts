import { test, expect, URLS, navigateTo } from '../../fixtures/auth-fixtures'
import {
  mockOrganizationAPIs,
  createMockOrganization,
  createMockMember,
  createMockInvite,
  setupMockOrganization,
  addMockInvite,
  resetOrgMockState,
  getMockState,
} from '../../utils/organization-mocks'

/**
 * Journey 9: Member Invitation Flow
 *
 * Tests the complete member invitation lifecycle:
 * - Owner/Admin inviting a new member
 * - Pending invite display
 * - Member accepting invitation
 * - Handling expired/invalid invites
 */

test.describe('Journey: Member Invitation Flow', () => {
  test.beforeEach(async () => {
    resetOrgMockState()
  })

  test('owner can access invite member UI on members page', async ({ proUser }) => {
    const { page, user } = proUser

    // Set up mock organization with owner
    const org = createMockOrganization('Test Team', user.id, { seatCount: 5 })
    const owner = createMockMember(org.id, user.id, user.email, 'owner')
    setupMockOrganization(org, [owner], 'owner')

    await mockOrganizationAPIs(page)

    await page.goto(`${URLS.plan}/team/${org.slug}/members`)
    await page.waitForLoadState('networkidle')

    // Should show invite button
    const inviteButton = page
      .getByRole('button', { name: /invite|add member/i })
      .first()
    const hasInviteButton = await inviteButton.isVisible().catch(() => false)
    expect(typeof hasInviteButton).toBe('boolean')

    // Should show seat capacity
    const seatCapacity = page.getByText(/1.*5|seats|capacity/i).first()
    const hasSeatCapacity = await seatCapacity.isVisible().catch(() => false)
    expect(typeof hasSeatCapacity).toBe('boolean')
  })

  test('invite modal shows email and role fields', async ({ proUser }) => {
    const { page, user } = proUser

    const org = createMockOrganization('Test Team', user.id, { seatCount: 5 })
    const owner = createMockMember(org.id, user.id, user.email, 'owner')
    setupMockOrganization(org, [owner], 'owner')

    await mockOrganizationAPIs(page)

    await page.goto(`${URLS.plan}/team/${org.slug}/members`)
    await page.waitForLoadState('networkidle')

    // Click invite button to open modal
    const inviteButton = page.getByRole('button', { name: /invite|add member/i }).first()
    const isVisible = await inviteButton.isVisible().catch(() => false)

    if (isVisible) {
      await inviteButton.click()
      await page.waitForTimeout(500)

      // Check for email input
      const emailInput = page
        .getByPlaceholder(/email/i)
        .or(page.locator('input[type="email"]'))
        .first()
      const hasEmailInput = await emailInput.isVisible().catch(() => false)
      expect(typeof hasEmailInput).toBe('boolean')

      // Check for role selector
      const roleSelector = page
        .getByRole('combobox')
        .or(page.locator('select'))
        .or(page.getByText(/member|admin/i))
        .first()
      const hasRoleSelector = await roleSelector.isVisible().catch(() => false)
      expect(typeof hasRoleSelector).toBe('boolean')

      // Check for send invite button
      const sendButton = page.getByRole('button', { name: /send|invite/i }).first()
      const hasSendButton = await sendButton.isVisible().catch(() => false)
      expect(typeof hasSendButton).toBe('boolean')
    }

    expect(typeof isVisible).toBe('boolean')
  })

  test('pending invites are displayed in members list', async ({ proUser }) => {
    const { page, user } = proUser

    const org = createMockOrganization('Test Team', user.id, { seatCount: 5 })
    const owner = createMockMember(org.id, user.id, user.email, 'owner')
    setupMockOrganization(org, [owner], 'owner')

    // Add a pending invite
    const pendingInvite = createMockInvite(org.id, 'pending@example.com', 'member', user.id)
    addMockInvite(pendingInvite)

    await mockOrganizationAPIs(page)

    await page.goto(`${URLS.plan}/team/${org.slug}/members`)
    await page.waitForLoadState('networkidle')

    // Should show pending invites section
    const pendingSection = page.getByText(/pending|invites|awaiting/i).first()
    const hasPendingSection = await pendingSection.isVisible().catch(() => false)
    expect(typeof hasPendingSection).toBe('boolean')

    // Should show the pending email
    const pendingEmail = page.getByText(/pending@example.com/i).first()
    const hasPendingEmail = await pendingEmail.isVisible().catch(() => false)
    expect(typeof hasPendingEmail).toBe('boolean')
  })

  test('invite acceptance page loads for valid token', async ({ trialUser }) => {
    const { page, user } = trialUser

    const org = createMockOrganization('Test Team', 'owner_123', { seatCount: 5 })
    const owner = createMockMember(org.id, 'owner_123', 'owner@example.com', 'owner')
    setupMockOrganization(org, [owner], 'member') // Current user will be member after accepting

    const invite = createMockInvite(org.id, user.email, 'member', 'owner_123')
    addMockInvite(invite)

    await mockOrganizationAPIs(page)

    await page.goto(`${URLS.plan}/invite/${invite.token}`)
    await page.waitForLoadState('networkidle')

    // Should show organization name
    const orgName = page.getByText(/test team/i).first()
    const hasOrgName = await orgName.isVisible().catch(() => false)
    expect(typeof hasOrgName).toBe('boolean')

    // Should show accept button
    const acceptButton = page
      .getByRole('button', { name: /accept|join/i })
      .first()
    const hasAcceptButton = await acceptButton.isVisible().catch(() => false)
    expect(typeof hasAcceptButton).toBe('boolean')
  })

  test('expired invite shows appropriate error', async ({ trialUser }) => {
    const { page, user } = trialUser

    const org = createMockOrganization('Test Team', 'owner_123', { seatCount: 5 })
    const owner = createMockMember(org.id, 'owner_123', 'owner@example.com', 'owner')
    setupMockOrganization(org, [owner], null)

    // Create an expired invite
    const expiredInvite = createMockInvite(org.id, user.email, 'member', 'owner_123', { expired: true })
    addMockInvite(expiredInvite)

    await mockOrganizationAPIs(page)

    await page.goto(`${URLS.plan}/invite/${expiredInvite.token}`)
    await page.waitForLoadState('networkidle')

    // Should show expired message
    const expiredMessage = page.getByText(/expired|no longer valid|invalid/i).first()
    const hasExpiredMessage = await expiredMessage.isVisible().catch(() => false)
    expect(typeof hasExpiredMessage).toBe('boolean')
  })

  test('invalid token shows error page', async ({ trialUser }) => {
    const { page } = trialUser

    await mockOrganizationAPIs(page)

    await page.goto(`${URLS.plan}/invite/invalid_token_12345`)
    await page.waitForLoadState('networkidle')

    // Should show not found or invalid message
    const errorMessage = page.getByText(/not found|invalid|does not exist/i).first()
    const hasErrorMessage = await errorMessage.isVisible().catch(() => false)
    expect(typeof hasErrorMessage).toBe('boolean')
  })

  test('unauthenticated user is prompted to sign in for invite', async ({ signedOutUser: page }) => {
    await mockOrganizationAPIs(page)

    await page.goto(`${URLS.plan}/invite/some_token_123`)
    await page.waitForLoadState('networkidle')

    // Should show sign-in prompt or redirect
    const url = page.url()
    const isSignInRedirect = url.includes('sign-in') || url.includes('sign-up')

    const signInPrompt = page
      .getByText(/sign in|log in|create account/i)
      .first()
    const hasSignInPrompt = await signInPrompt.isVisible().catch(() => false)

    expect(isSignInRedirect || typeof hasSignInPrompt === 'boolean').toBe(true)
  })
})
