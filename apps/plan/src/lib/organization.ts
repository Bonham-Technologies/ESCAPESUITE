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

// Row mappers (snake_case DB rows -> camelCase API types)

interface OrgRow {
  id: string
  name: string
  slug: string
  plan: 'team' | 'enterprise'
  seat_count: number
  settings: OrganizationSettings
  created_at: string
}
interface MemberRow {
  id: string
  user_id: string
  email: string
  role: 'owner' | 'admin' | 'member'
  invited_at: string | null
  joined_at: string | null
}
interface InviteRow {
  id: string
  email: string
  role: 'admin' | 'member'
  invited_by: string
  expires_at: string
  created_at: string
}

function mapOrganization(row: OrgRow): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    plan: row.plan,
    seatCount: row.seat_count,
    settings: row.settings,
    createdAt: row.created_at,
  }
}
function mapMember(m: MemberRow): OrganizationMember {
  return {
    id: m.id,
    userId: m.user_id,
    email: m.email,
    role: m.role,
    invitedAt: m.invited_at ?? undefined,
    joinedAt: m.joined_at ?? undefined,
    status: m.joined_at ? 'active' : 'invited',
  }
}
function mapInvite(i: InviteRow): OrganizationInvite {
  return {
    id: i.id,
    email: i.email,
    role: i.role,
    invitedBy: i.invited_by,
    expiresAt: i.expires_at,
    createdAt: i.created_at,
  }
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
  const { organizationId, slug } = params
  const base = supabase.from('organizations').select('*')
  const { data: org, error } = await (organizationId
    ? base.eq('id', organizationId)
    : base.eq('slug', slug ?? '')
  ).single()
  if (error || !org) throw new Error(error?.message || 'Organization not found')

  const { data: auth } = await supabase.auth.getUser()
  const { data: member, error: memErr } = await supabase
    .from('organization_members')
    .select('role, joined_at')
    .eq('organization_id', (org as OrgRow).id)
    .eq('user_id', auth.user?.id ?? '')
    .single()
  if (memErr || !member) throw new Error('You are not a member of this organization')

  return {
    organization: mapOrganization(org as OrgRow),
    membership: { role: member.role, joinedAt: member.joined_at },
  }
}

export async function getOrganizations(_clerkUserId: string): Promise<{
  organizations: (Organization & { role: string; joinedAt: string })[]
}> {
  const { data: auth } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('organization_members')
    .select('role, joined_at, organizations(*)')
    .eq('user_id', auth.user?.id ?? '')
    .not('joined_at', 'is', null)
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as unknown as Array<{
    role: string
    joined_at: string
    organizations: OrgRow | null
  }>
  return {
    organizations: rows
      .filter((r) => r.organizations)
      .map((r) => ({
        ...mapOrganization(r.organizations as OrgRow),
        role: r.role,
        joinedAt: r.joined_at,
      })),
  }
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
  const { organizationId } = params
  const { data: auth } = await supabase.auth.getUser()

  const [membersRes, invitesRes, orgRes] = await Promise.all([
    supabase.from('organization_members').select('*').eq('organization_id', organizationId),
    supabase
      .from('organization_invites')
      .select('*')
      .eq('organization_id', organizationId)
      .is('accepted_at', null),
    supabase.from('organizations').select('seat_count').eq('id', organizationId).single(),
  ])

  if (membersRes.error) throw new Error(membersRes.error.message)

  const memberRows = (membersRes.data ?? []) as MemberRow[]
  const inviteRows = (invitesRes.data ?? []) as InviteRow[]
  const total = (orgRes.data?.seat_count as number) ?? 0
  const used = memberRows.filter((m) => m.joined_at).length
  const currentUserRole = (memberRows.find((m) => m.user_id === auth.user?.id)?.role ??
    'member') as 'owner' | 'admin' | 'member'

  return {
    members: memberRows.map(mapMember),
    pendingInvites: inviteRows.map(mapInvite),
    seats: { total, used, available: Math.max(0, total - used) },
    currentUserRole,
  }
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

interface AuditLogRow {
  id: string
  action: string
  user_id: string | null
  resource_type: string | null
  resource_id: string | null
  metadata: Record<string, unknown> | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

export async function getAuditLogs(params: {
  clerkUserId: string
  organizationId: string
  filters?: AuditLogFilters
}): Promise<AuditLogResponse> {
  const { organizationId, filters = {} } = params
  const page = filters.page ?? 1
  const limit = filters.limit ?? 50

  // Audit logging is an Enterprise opt-in.
  const { data: org } = await supabase
    .from('organizations')
    .select('settings')
    .eq('id', organizationId)
    .single()

  if (!org?.settings?.audit_logging) {
    return {
      logs: [],
      pagination: { page: 1, limit, total: 0, totalPages: 0 },
      filters: { availableActions: [], availableResourceTypes: [] },
      auditLoggingEnabled: false,
    }
  }

  let query = supabase
    .from('audit_logs')
    .select('*', { count: 'exact' })
    .eq('organization_id', organizationId)
  if (filters.action) query = query.eq('action', filters.action)
  if (filters.userId) query = query.eq('user_id', filters.userId)
  if (filters.resourceType) query = query.eq('resource_type', filters.resourceType)
  if (filters.startDate) query = query.gte('created_at', filters.startDate)
  if (filters.endDate) query = query.lte('created_at', filters.endDate)

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as AuditLogRow[]
  return {
    logs: rows.map((l) => ({
      id: l.id,
      action: l.action,
      userId: l.user_id,
      userEmail: null,
      resourceType: l.resource_type,
      resourceId: l.resource_id,
      metadata: l.metadata,
      ipAddress: l.ip_address,
      userAgent: l.user_agent,
      createdAt: l.created_at,
    })),
    pagination: {
      page,
      limit,
      total: count ?? 0,
      totalPages: Math.ceil((count ?? 0) / limit),
    },
    filters: {
      availableActions: Array.from(new Set(rows.map((l) => l.action))),
      availableResourceTypes: Array.from(
        new Set(rows.map((l) => l.resource_type).filter((t): t is string => !!t))
      ),
    },
    auditLoggingEnabled: true,
  }
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
