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
