import { Page } from '@playwright/test'

/**
 * Utilities for mocking organization/team functionality in E2E tests.
 *
 * These utilities intercept organization-related Edge Functions and inject
 * organization state, allowing tests to simulate team workflows.
 */

export type OrgPlan = 'team' | 'enterprise'
export type MemberRole = 'owner' | 'admin' | 'member'
export type MemberStatus = 'active' | 'pending'

export interface OrganizationSettings {
  sso_enabled: boolean
  require_2fa: boolean
  audit_logging: boolean
  allowed_domains: string[]
}

export interface Organization {
  id: string
  name: string
  slug: string
  plan: OrgPlan
  seat_count: number
  owner_id: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  settings: OrganizationSettings
  created_at: string
  updated_at: string
}

export interface OrganizationMember {
  id: string
  organization_id: string
  user_id: string
  email: string
  role: MemberRole
  status: MemberStatus
  invited_by: string | null
  invited_at: string | null
  joined_at: string | null
}

export interface OrganizationInvite {
  id: string
  organization_id: string
  email: string
  role: MemberRole
  token: string
  expires_at: string
  invited_by: string
  created_at: string
  accepted_at: string | null
}

export interface AuditLogEntry {
  id: string
  organization_id: string
  user_id: string
  action: string
  resource_type: string
  resource_id: string | null
  metadata: Record<string, unknown>
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

export interface MockOrgOptions {
  plan?: OrgPlan
  seatCount?: number
  memberCount?: number
  settings?: Partial<OrganizationSettings>
}

/**
 * Generate a unique ID for mock entities.
 */
function generateId(prefix: string): string {
  return `${prefix}_mock_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Create a mock organization object.
 */
export function createMockOrganization(
  name: string,
  ownerId: string,
  options: MockOrgOptions = {}
): Organization {
  const {
    plan = 'team',
    seatCount = 5,
    settings = {},
  } = options

  const slug = name.toLowerCase().replace(/\s+/g, '-')

  return {
    id: generateId('org'),
    name,
    slug,
    plan,
    seat_count: seatCount,
    owner_id: ownerId,
    stripe_customer_id: `cus_mock_${Math.random().toString(36).substring(2, 9)}`,
    stripe_subscription_id: `sub_mock_${Math.random().toString(36).substring(2, 9)}`,
    settings: {
      sso_enabled: settings.sso_enabled ?? false,
      require_2fa: settings.require_2fa ?? false,
      audit_logging: settings.audit_logging ?? (plan === 'enterprise'),
      allowed_domains: settings.allowed_domains ?? [],
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

/**
 * Create a mock organization member.
 */
export function createMockMember(
  orgId: string,
  userId: string,
  email: string,
  role: MemberRole,
  invitedBy?: string
): OrganizationMember {
  return {
    id: generateId('member'),
    organization_id: orgId,
    user_id: userId,
    email,
    role,
    status: 'active',
    invited_by: invitedBy || null,
    invited_at: invitedBy ? new Date().toISOString() : null,
    joined_at: new Date().toISOString(),
  }
}

/**
 * Create a mock organization invite.
 */
export function createMockInvite(
  orgId: string,
  email: string,
  role: MemberRole,
  invitedBy: string,
  options: { expired?: boolean; accepted?: boolean } = {}
): OrganizationInvite {
  const { expired = false, accepted = false } = options
  const now = new Date()
  const expiresAt = expired
    ? new Date(now.getTime() - 24 * 60 * 60 * 1000) // Yesterday
    : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) // 7 days from now

  return {
    id: generateId('invite'),
    organization_id: orgId,
    email,
    role,
    token: `invite_token_${Math.random().toString(36).substring(2, 15)}`,
    expires_at: expiresAt.toISOString(),
    invited_by: invitedBy,
    created_at: now.toISOString(),
    accepted_at: accepted ? now.toISOString() : null,
  }
}

/**
 * Create a mock audit log entry.
 */
export function createMockAuditLog(
  orgId: string,
  userId: string,
  action: string,
  resourceType: string,
  metadata: Record<string, unknown> = {}
): AuditLogEntry {
  return {
    id: generateId('audit'),
    organization_id: orgId,
    user_id: userId,
    action,
    resource_type: resourceType,
    resource_id: metadata.resource_id as string || null,
    metadata,
    ip_address: '192.168.1.1',
    user_agent: 'Mozilla/5.0 (Playwright Test)',
    created_at: new Date().toISOString(),
  }
}

/**
 * State holder for organization mocks.
 */
interface OrgMockState {
  organization: Organization | null
  members: OrganizationMember[]
  invites: OrganizationInvite[]
  auditLogs: AuditLogEntry[]
  currentUserRole: MemberRole | null
}

let mockState: OrgMockState = {
  organization: null,
  members: [],
  invites: [],
  auditLogs: [],
  currentUserRole: null,
}

/**
 * Reset organization mock state.
 */
export function resetOrgMockState() {
  mockState = {
    organization: null,
    members: [],
    invites: [],
    auditLogs: [],
    currentUserRole: null,
  }
}

/**
 * Set up a mock organization with members.
 */
export function setupMockOrganization(
  org: Organization,
  members: OrganizationMember[],
  currentUserRole: MemberRole
) {
  mockState.organization = org
  mockState.members = members
  mockState.currentUserRole = currentUserRole
}

/**
 * Add a mock invite.
 */
export function addMockInvite(invite: OrganizationInvite) {
  mockState.invites.push(invite)
}

/**
 * Add a mock audit log entry.
 */
export function addMockAuditLog(log: AuditLogEntry) {
  mockState.auditLogs.push(log)
}

/**
 * Mock all organization-related API endpoints.
 */
export async function mockOrganizationAPIs(page: Page) {
  // Mock create-organization
  await page.route('**/functions/v1/create-organization**', async (route) => {
    const body = route.request().postDataJSON()
    const org = createMockOrganization(body.name, body.clerkUserId, {
      plan: body.plan || 'team',
      seatCount: body.seatCount || 5,
    })
    mockState.organization = org
    mockState.members = [createMockMember(org.id, body.clerkUserId, 'owner@example.com', 'owner')]
    mockState.currentUserRole = 'owner'

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(org),
    })
  })

  // Mock create-org-checkout
  await page.route('**/functions/v1/create-org-checkout**', async (route) => {
    const body = route.request().postDataJSON()
    const baseUrl = new URL(route.request().url()).origin

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        url: `${baseUrl}/team/${body.slug || 'test-team'}?success=true`,
        organization: {
          name: body.name,
          slug: body.slug || body.name.toLowerCase().replace(/\s+/g, '-'),
          plan: body.plan || 'team',
        },
      }),
    })
  })

  // Mock get-organization
  await page.route('**/functions/v1/get-organization**', async (route) => {
    if (!mockState.organization) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Organization not found' }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...mockState.organization,
        userRole: mockState.currentUserRole,
      }),
    })
  })

  // Mock get-organization-members
  await page.route('**/functions/v1/get-organization-members**', async (route) => {
    const activeMembers = mockState.members.filter(m => m.status === 'active')
    const pendingInvites = mockState.invites.filter(i => !i.accepted_at)

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        members: activeMembers,
        pendingInvites,
        seatCount: mockState.organization?.seat_count || 5,
        usedSeats: activeMembers.length,
        currentUserRole: mockState.currentUserRole,
      }),
    })
  })

  // Mock update-organization
  await page.route('**/functions/v1/update-organization**', async (route) => {
    const body = route.request().postDataJSON()

    if (mockState.organization) {
      mockState.organization = {
        ...mockState.organization,
        name: body.name || mockState.organization.name,
        settings: {
          ...mockState.organization.settings,
          ...body.settings,
        },
        updated_at: new Date().toISOString(),
      }
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockState.organization),
    })
  })

  // Mock invite-member
  await page.route('**/functions/v1/invite-member**', async (route) => {
    const body = route.request().postDataJSON()

    // Check seats
    const activeCount = mockState.members.filter(m => m.status === 'active').length
    if (activeCount >= (mockState.organization?.seat_count || 5)) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'No available seats' }),
      })
      return
    }

    // Check domain restrictions
    const allowedDomains = mockState.organization?.settings.allowed_domains || []
    if (allowedDomains.length > 0) {
      const emailDomain = body.email.split('@')[1]
      if (!allowedDomains.includes(emailDomain)) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error: `Email domain not allowed. Allowed domains: ${allowedDomains.join(', ')}`,
          }),
        })
        return
      }
    }

    const invite = createMockInvite(
      mockState.organization?.id || 'org_mock',
      body.email,
      body.role || 'member',
      body.clerkUserId
    )
    mockState.invites.push(invite)

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        invite: {
          ...invite,
          inviteUrl: `http://localhost:5173/invite/${invite.token}`,
        },
      }),
    })
  })

  // Mock accept-invite
  await page.route('**/functions/v1/accept-invite**', async (route) => {
    const body = route.request().postDataJSON()
    const invite = mockState.invites.find(i => i.token === body.token)

    if (!invite) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Invite not found' }),
      })
      return
    }

    if (new Date(invite.expires_at) < new Date()) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Invite has expired' }),
      })
      return
    }

    if (invite.accepted_at) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Invite already accepted' }),
      })
      return
    }

    // Mark invite as accepted
    invite.accepted_at = new Date().toISOString()

    // Add member
    const newMember = createMockMember(
      invite.organization_id,
      body.clerkUserId,
      invite.email,
      invite.role,
      invite.invited_by
    )
    mockState.members.push(newMember)

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        organization: mockState.organization,
        member: newMember,
      }),
    })
  })

  // Mock update-member-role
  await page.route('**/functions/v1/update-member-role**', async (route) => {
    const body = route.request().postDataJSON()
    const member = mockState.members.find(m => m.id === body.memberId)

    if (!member) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Member not found' }),
      })
      return
    }

    if (member.role === 'owner') {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Cannot change owner role' }),
      })
      return
    }

    member.role = body.newRole

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, member }),
    })
  })

  // Mock remove-member
  await page.route('**/functions/v1/remove-member**', async (route) => {
    const body = route.request().postDataJSON()
    const memberIndex = mockState.members.findIndex(m => m.id === body.memberId)

    if (memberIndex === -1) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Member not found' }),
      })
      return
    }

    const member = mockState.members[memberIndex]
    if (member.role === 'owner') {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Cannot remove organization owner' }),
      })
      return
    }

    mockState.members.splice(memberIndex, 1)

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: 'Member removed' }),
    })
  })

  // Mock get-audit-logs
  await page.route('**/functions/v1/get-audit-logs**', async (route) => {
    if (!mockState.organization?.settings.audit_logging) {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Audit logging is not enabled' }),
      })
      return
    }

    const url = new URL(route.request().url())
    const page_num = parseInt(url.searchParams.get('page') || '1')
    const limit = 25
    const offset = (page_num - 1) * limit

    const logs = mockState.auditLogs.slice(offset, offset + limit)

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        logs,
        total: mockState.auditLogs.length,
        page: page_num,
        totalPages: Math.ceil(mockState.auditLogs.length / limit),
      }),
    })
  })
}

/**
 * Helper to get current mock state (for assertions).
 */
export function getMockState(): OrgMockState {
  return { ...mockState }
}

/**
 * Check if user can manage members based on role.
 */
export function canManageMembers(role: MemberRole): boolean {
  return role === 'owner' || role === 'admin'
}

/**
 * Check if user can manage settings based on role.
 */
export function canManageSettings(role: MemberRole): boolean {
  return role === 'owner' || role === 'admin'
}

/**
 * Check if user can view audit logs.
 */
export function canViewAuditLogs(role: MemberRole, auditLoggingEnabled: boolean): boolean {
  return (role === 'owner' || role === 'admin') && auditLoggingEnabled
}
