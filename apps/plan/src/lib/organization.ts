import { supabase } from './supabase'

// Types
export interface Organization {
  id: string
  name: string
  slug: string
  plan: 'team' | 'enterprise'
  seatCount: number
  settings: OrganizationSettings
  createdAt: string
  memberCount?: number
  pendingInvites?: number
  availableSeats?: number
}

export interface OrganizationSettings {
  sso_enabled: boolean
  require_2fa: boolean
  audit_logging: boolean
  allowed_domains: string[]
}

export interface OrganizationMembership {
  role: 'owner' | 'admin' | 'member'
  joinedAt: string
}

export interface OrganizationMember {
  id: string
  userId: string
  email: string
  role: 'owner' | 'admin' | 'member'
  invitedAt?: string
  joinedAt?: string
  status: 'active' | 'invited'
}

export interface OrganizationInvite {
  id: string
  email: string
  role: 'admin' | 'member'
  invitedBy: string
  expiresAt: string
  createdAt: string
}

export interface Seats {
  total: number
  used: number
  available: number
}

export interface AuditLog {
  id: string
  action: string
  userId: string | null
  userEmail: string | null
  resourceType: string | null
  resourceId: string | null
  metadata: Record<string, unknown> | null
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
}

export interface AuditLogFilters {
  action?: string
  userId?: string
  resourceType?: string
  startDate?: string
  endDate?: string
  page?: number
  limit?: number
}

export interface AuditLogResponse {
  logs: AuditLog[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  filters: {
    availableActions: string[]
    availableResourceTypes: string[]
  }
  auditLoggingEnabled: boolean
}

// API Functions

export async function createOrganization(params: {
  clerkUserId: string
  email: string
  name: string
  slug?: string
  plan?: 'team' | 'enterprise'
  seatCount?: number
}): Promise<{ organization: Organization }> {
  const response = await supabase.functions.invoke('create-organization', {
    body: params,
  })

  if (response.error) {
    throw new Error(response.error.message)
  }

  return response.data
}

export async function getOrganization(params: {
  clerkUserId: string
  organizationId?: string
  slug?: string
}): Promise<{ organization: Organization; membership: OrganizationMembership }> {
  const response = await supabase.functions.invoke('get-organization', {
    body: params,
  })

  if (response.error) {
    throw new Error(response.error.message)
  }

  return response.data
}

export async function getOrganizations(clerkUserId: string): Promise<{
  organizations: (Organization & { role: string; joinedAt: string })[]
}> {
  const response = await supabase.functions.invoke('get-organization', {
    body: { clerkUserId },
  })

  if (response.error) {
    throw new Error(response.error.message)
  }

  return response.data
}

export async function updateOrganization(params: {
  clerkUserId: string
  organizationId: string
  name?: string
  settings?: Partial<OrganizationSettings>
}): Promise<{ organization: Organization }> {
  const response = await supabase.functions.invoke('update-organization', {
    body: params,
  })

  if (response.error) {
    throw new Error(response.error.message)
  }

  return response.data
}

export async function getOrganizationMembers(params: {
  clerkUserId: string
  organizationId: string
}): Promise<{
  members: OrganizationMember[]
  pendingInvites: OrganizationInvite[]
  seats: Seats
  currentUserRole: 'owner' | 'admin' | 'member'
}> {
  const response = await supabase.functions.invoke('get-organization-members', {
    body: params,
  })

  if (response.error) {
    throw new Error(response.error.message)
  }

  return response.data
}

export async function inviteMember(params: {
  clerkUserId: string
  organizationId: string
  email: string
  role?: 'admin' | 'member'
}): Promise<{ invite: OrganizationInvite; inviteUrl: string; message: string }> {
  const response = await supabase.functions.invoke('invite-member', {
    body: params,
  })

  if (response.error) {
    throw new Error(response.error.message)
  }

  return response.data
}

export async function acceptInvite(params: {
  clerkUserId: string
  email: string
  token: string
}): Promise<{
  organization: Pick<Organization, 'id' | 'name' | 'slug' | 'plan'>
  membership: { id: string; role: string; joinedAt: string }
  message: string
}> {
  const response = await supabase.functions.invoke('accept-invite', {
    body: params,
  })

  if (response.error) {
    throw new Error(response.error.message)
  }

  return response.data
}

export async function updateMemberRole(params: {
  clerkUserId: string
  organizationId: string
  memberId: string
  newRole: 'admin' | 'member'
}): Promise<{ member: { id: string; role: string; email: string }; message: string }> {
  const response = await supabase.functions.invoke('update-member-role', {
    body: params,
  })

  if (response.error) {
    throw new Error(response.error.message)
  }

  return response.data
}

export async function removeMember(params: {
  clerkUserId: string
  organizationId: string
  memberId: string
}): Promise<{ message: string; removedMember: { id: string; email: string } }> {
  const response = await supabase.functions.invoke('remove-member', {
    body: params,
  })

  if (response.error) {
    throw new Error(response.error.message)
  }

  return response.data
}

export async function createOrgCheckout(params: {
  clerkUserId: string
  email: string
  organizationName: string
  organizationSlug?: string
  plan: 'team' | 'enterprise'
  seatCount: number
  billingPeriod: 'monthly' | 'annual'
  successUrl?: string
  cancelUrl?: string
}): Promise<{ url: string; organizationId: string; organizationSlug: string }> {
  const response = await supabase.functions.invoke('create-org-checkout', {
    body: params,
  })

  if (response.error) {
    throw new Error(response.error.message)
  }

  return response.data
}

export async function getAuditLogs(params: {
  clerkUserId: string
  organizationId: string
  filters?: AuditLogFilters
}): Promise<AuditLogResponse> {
  const response = await supabase.functions.invoke('get-audit-logs', {
    body: {
      clerkUserId: params.clerkUserId,
      organizationId: params.organizationId,
      ...params.filters,
    },
  })

  if (response.error) {
    throw new Error(response.error.message)
  }

  // Handle the case where audit logging is not enabled
  if (response.data.error && response.data.auditLoggingEnabled === false) {
    return {
      logs: [],
      pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
      filters: { availableActions: [], availableResourceTypes: [] },
      auditLoggingEnabled: false,
    }
  }

  if (response.data.error) {
    throw new Error(response.data.error)
  }

  return response.data
}

// Helper functions

export function getRoleDisplayName(role: string): string {
  switch (role) {
    case 'owner':
      return 'Owner'
    case 'admin':
      return 'Admin'
    case 'member':
      return 'Member'
    default:
      return role
  }
}

export function getPlanDisplayName(plan: string): string {
  switch (plan) {
    case 'team':
      return 'Team'
    case 'enterprise':
      return 'Enterprise'
    default:
      return plan
  }
}

export function canManageMembers(role: string): boolean {
  return role === 'owner' || role === 'admin'
}

export function canManageSettings(role: string): boolean {
  return role === 'owner' || role === 'admin'
}

export function canChangeRole(
  currentUserRole: string,
  targetRole: string
): boolean {
  // Only owners can change roles
  if (currentUserRole !== 'owner') return false
  // Cannot change owner role
  if (targetRole === 'owner') return false
  return true
}

export function canRemoveMember(
  currentUserRole: string,
  targetRole: string,
  isSelf: boolean
): boolean {
  // Users can always remove themselves (leave)
  if (isSelf && targetRole !== 'owner') return true
  // Cannot remove owner
  if (targetRole === 'owner') return false
  // Owners can remove anyone
  if (currentUserRole === 'owner') return true
  // Admins can only remove members
  if (currentUserRole === 'admin' && targetRole === 'member') return true
  return false
}

export function getActionDisplayName(action: string): string {
  const actionMap: Record<string, string> = {
    'member.invited': 'Member Invited',
    'member.joined': 'Member Joined',
    'member.removed': 'Member Removed',
    'member.left': 'Member Left',
    'member.role_changed': 'Role Changed',
    'organization.created': 'Organization Created',
    'organization.updated': 'Settings Updated',
    'subscription.created': 'Subscription Created',
    'subscription.updated': 'Subscription Updated',
    'subscription.cancelled': 'Subscription Cancelled',
  }
  return actionMap[action] || action.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function getResourceTypeDisplayName(resourceType: string | null): string {
  if (!resourceType) return 'N/A'
  const typeMap: Record<string, string> = {
    'member': 'Member',
    'settings': 'Settings',
    'subscription': 'Subscription',
    'organization': 'Organization',
    'invite': 'Invite',
  }
  return typeMap[resourceType] || resourceType.charAt(0).toUpperCase() + resourceType.slice(1)
}
