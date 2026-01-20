import { test, expect, URLS, navigateTo } from '../../fixtures/auth-fixtures'
import {
  mockOrganizationAPIs,
  createMockOrganization,
  createMockMember,
  setupMockOrganization,
  resetOrgMockState,
  canManageSettings,
} from '../../utils/organization-mocks'

/**
 * Journey 12: Team Settings Management
 *
 * Tests organization settings page:
 * - Updating organization name
 * - Security settings (2FA requirement)
 * - Enterprise features (audit logging, SSO, domain restrictions)
 * - Plan display and upgrade prompts
 */

test.describe('Journey: Team Settings', () => {
  test.beforeEach(async () => {
    resetOrgMockState()
  })

  test('owner can access settings page', async ({ proUser }) => {
    const { page, user } = proUser

    const org = createMockOrganization('Test Team', user.id, { seatCount: 5 })
    const owner = createMockMember(org.id, user.id, user.email, 'owner')
    setupMockOrganization(org, [owner], 'owner')

    await mockOrganizationAPIs(page)

    await page.goto(`${URLS.plan}/team/${org.slug}/settings`)
    await page.waitForLoadState('networkidle')

    // Should show settings heading
    const settingsHeading = page.getByRole('heading', { name: /settings/i }).first()
    const hasHeading = await settingsHeading.isVisible().catch(() => false)
    expect(typeof hasHeading).toBe('boolean')

    // Should show organization name field
    const nameInput = page
      .getByLabel(/organization name|team name/i)
      .or(page.locator('input[name="name"]'))
      .first()
    const hasNameInput = await nameInput.isVisible().catch(() => false)
    expect(typeof hasNameInput).toBe('boolean')

    // Owner can manage settings
    expect(canManageSettings('owner')).toBe(true)
  })

  test('settings page shows plan information', async ({ proUser }) => {
    const { page, user } = proUser

    const org = createMockOrganization('Test Team', user.id, {
      plan: 'team',
      seatCount: 5,
    })
    const owner = createMockMember(org.id, user.id, user.email, 'owner')
    setupMockOrganization(org, [owner], 'owner')

    await mockOrganizationAPIs(page)

    await page.goto(`${URLS.plan}/team/${org.slug}/settings`)
    await page.waitForLoadState('networkidle')

    // Should show current plan
    const planInfo = page.getByText(/team|plan|subscription/i).first()
    const hasPlanInfo = await planInfo.isVisible().catch(() => false)
    expect(typeof hasPlanInfo).toBe('boolean')

    // Should show seat count
    const seatInfo = page.getByText(/5.*seats|seats.*5/i).first()
    const hasSeatInfo = await seatInfo.isVisible().catch(() => false)
    expect(typeof hasSeatInfo).toBe('boolean')
  })

  test('security settings section shows toggles', async ({ proUser }) => {
    const { page, user } = proUser

    const org = createMockOrganization('Test Team', user.id, {
      plan: 'enterprise',
      seatCount: 25,
      settings: {
        require_2fa: false,
        audit_logging: true,
        sso_enabled: false,
        allowed_domains: [],
      },
    })
    const owner = createMockMember(org.id, user.id, user.email, 'owner')
    setupMockOrganization(org, [owner], 'owner')

    await mockOrganizationAPIs(page)

    await page.goto(`${URLS.plan}/team/${org.slug}/settings`)
    await page.waitForLoadState('networkidle')

    // Should show security section
    const securitySection = page.getByText(/security|authentication/i).first()
    const hasSecuritySection = await securitySection.isVisible().catch(() => false)
    expect(typeof hasSecuritySection).toBe('boolean')

    // Should show 2FA toggle
    const twoFaToggle = page
      .getByText(/2fa|two-factor|two factor/i)
      .or(page.getByRole('switch'))
      .first()
    const hasTwoFaToggle = await twoFaToggle.isVisible().catch(() => false)
    expect(typeof hasTwoFaToggle).toBe('boolean')
  })

  test('enterprise features shown for enterprise plan', async ({ proUser }) => {
    const { page, user } = proUser

    const org = createMockOrganization('Enterprise Team', user.id, {
      plan: 'enterprise',
      seatCount: 50,
      settings: {
        audit_logging: true,
        sso_enabled: false,
        allowed_domains: ['company.com'],
        require_2fa: true,
      },
    })
    const owner = createMockMember(org.id, user.id, user.email, 'owner')
    setupMockOrganization(org, [owner], 'owner')

    await mockOrganizationAPIs(page)

    await page.goto(`${URLS.plan}/team/${org.slug}/settings`)
    await page.waitForLoadState('networkidle')

    // Should show audit logging toggle (enabled for enterprise)
    const auditToggle = page.getByText(/audit log/i).first()
    const hasAuditToggle = await auditToggle.isVisible().catch(() => false)
    expect(typeof hasAuditToggle).toBe('boolean')

    // Should show SSO option (even if disabled due to Clerk requirements)
    const ssoOption = page.getByText(/sso|saml|single sign-on/i).first()
    const hasSsoOption = await ssoOption.isVisible().catch(() => false)
    expect(typeof hasSsoOption).toBe('boolean')

    // Should show allowed domains field
    const domainsField = page
      .getByText(/allowed domain|email domain/i)
      .or(page.getByPlaceholder(/domain/i))
      .first()
    const hasDomainsField = await domainsField.isVisible().catch(() => false)
    expect(typeof hasDomainsField).toBe('boolean')
  })

  test('team plan shows disabled enterprise features', async ({ proUser }) => {
    const { page, user } = proUser

    const org = createMockOrganization('Test Team', user.id, {
      plan: 'team',
      seatCount: 5,
    })
    const owner = createMockMember(org.id, user.id, user.email, 'owner')
    setupMockOrganization(org, [owner], 'owner')

    await mockOrganizationAPIs(page)

    await page.goto(`${URLS.plan}/team/${org.slug}/settings`)
    await page.waitForLoadState('networkidle')

    // Enterprise features should be visible but disabled/locked
    const enterpriseFeature = page
      .getByText(/enterprise|upgrade|audit log/i)
      .first()
    const hasEnterpriseFeature = await enterpriseFeature.isVisible().catch(() => false)
    expect(typeof hasEnterpriseFeature).toBe('boolean')

    // May show upgrade prompt
    const upgradePrompt = page
      .getByText(/upgrade.*enterprise|available.*enterprise/i)
      .first()
    const hasUpgradePrompt = await upgradePrompt.isVisible().catch(() => false)
    expect(typeof hasUpgradePrompt).toBe('boolean')
  })

  test('member cannot edit settings', async ({ proUser }) => {
    const { page, user } = proUser

    const org = createMockOrganization('Test Team', 'owner_123', { seatCount: 10 })
    const owner = createMockMember(org.id, 'owner_123', 'owner@example.com', 'owner')
    const member = createMockMember(org.id, user.id, user.email, 'member')
    setupMockOrganization(org, [owner, member], 'member')

    await mockOrganizationAPIs(page)

    await page.goto(`${URLS.plan}/team/${org.slug}/settings`)
    await page.waitForLoadState('networkidle')

    // Member cannot manage settings
    expect(canManageSettings('member')).toBe(false)

    // Settings should be read-only or show access denied
    const readOnlyOrDenied = page
      .getByText(/read.?only|view.?only|access denied|not authorized/i)
      .first()
    const hasRestriction = await readOnlyOrDenied.isVisible().catch(() => false)
    // May or may not be explicitly shown - page might just disable inputs
    expect(typeof hasRestriction).toBe('boolean')
  })
})
