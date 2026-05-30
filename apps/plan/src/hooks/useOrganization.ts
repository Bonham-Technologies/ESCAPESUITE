import { useState, useEffect, useCallback } from 'react'
import { useUser } from '../lib/auth'
import type {
  Organization,
  OrganizationMember,
  OrganizationInvite,
  Seats,
  OrganizationSettings,
} from '../lib/organization'
import {
  getOrganization,
  getOrganizations,
  getOrganizationMembers,
  inviteMember,
  updateMemberRole,
  removeMember,
  updateOrganization,
  createOrgCheckout,
} from '../lib/organization'

interface UseOrganizationReturn {
  // State
  organization: Organization | null
  organizations: Organization[]
  members: OrganizationMember[]
  pendingInvites: OrganizationInvite[]
  seats: Seats | null
  currentUserRole: 'owner' | 'admin' | 'member' | null
  loading: boolean
  error: string | null

  // Actions
  fetchOrganization: (orgIdOrSlug: string) => Promise<void>
  fetchOrganizations: () => Promise<void>
  fetchMembers: () => Promise<void>
  invite: (email: string, role?: 'admin' | 'member') => Promise<{ inviteUrl: string }>
  updateRole: (memberId: string, newRole: 'admin' | 'member') => Promise<void>
  remove: (memberId: string) => Promise<void>
  leave: () => Promise<void>
  updateSettings: (settings: Partial<OrganizationSettings>) => Promise<void>
  updateName: (name: string) => Promise<void>
  createTeamCheckout: (params: {
    organizationName: string
    plan: 'team' | 'enterprise'
    seatCount: number
    billingPeriod: 'monthly' | 'annual'
  }) => Promise<void>
}

export function useOrganization(organizationId?: string): UseOrganizationReturn {
  const { user } = useUser()
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [members, setMembers] = useState<OrganizationMember[]>([])
  const [pendingInvites, setPendingInvites] = useState<OrganizationInvite[]>([])
  const [seats, setSeats] = useState<Seats | null>(null)
  const [currentUserRole, setCurrentUserRole] = useState<'owner' | 'admin' | 'member' | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clerkUserId = user?.id

  // Fetch a specific organization
  const fetchOrganization = useCallback(
    async (orgIdOrSlug: string) => {
      if (!clerkUserId) return

      setLoading(true)
      setError(null)

      try {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgIdOrSlug)
        const params = isUuid
          ? { clerkUserId, organizationId: orgIdOrSlug }
          : { clerkUserId, slug: orgIdOrSlug }

        const result = await getOrganization(params)
        setOrganization(result.organization)
        setCurrentUserRole(result.membership.role as 'owner' | 'admin' | 'member')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch organization')
      } finally {
        setLoading(false)
      }
    },
    [clerkUserId]
  )

  // Fetch all organizations the user is a member of
  const fetchOrganizations = useCallback(async () => {
    if (!clerkUserId) return

    setLoading(true)
    setError(null)

    try {
      const result = await getOrganizations(clerkUserId)
      setOrganizations(result.organizations)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch organizations')
    } finally {
      setLoading(false)
    }
  }, [clerkUserId])

  // Fetch members of the current organization
  const fetchMembers = useCallback(async () => {
    if (!clerkUserId || !organization?.id) return

    setLoading(true)
    setError(null)

    try {
      const result = await getOrganizationMembers({
        clerkUserId,
        organizationId: organization.id,
      })
      setMembers(result.members)
      setPendingInvites(result.pendingInvites)
      setSeats(result.seats)
      setCurrentUserRole(result.currentUserRole)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch members')
    } finally {
      setLoading(false)
    }
  }, [clerkUserId, organization?.id])

  // Invite a new member
  const invite = useCallback(
    async (email: string, role: 'admin' | 'member' = 'member') => {
      if (!clerkUserId || !organization?.id) {
        throw new Error('Not authenticated or no organization selected')
      }

      const result = await inviteMember({
        clerkUserId,
        organizationId: organization.id,
        email,
        role,
      })

      // Refresh members list
      await fetchMembers()

      return { inviteUrl: result.inviteUrl }
    },
    [clerkUserId, organization?.id, fetchMembers]
  )

  // Update a member's role
  const updateRole = useCallback(
    async (memberId: string, newRole: 'admin' | 'member') => {
      if (!clerkUserId || !organization?.id) {
        throw new Error('Not authenticated or no organization selected')
      }

      await updateMemberRole({
        clerkUserId,
        organizationId: organization.id,
        memberId,
        newRole,
      })

      // Refresh members list
      await fetchMembers()
    },
    [clerkUserId, organization?.id, fetchMembers]
  )

  // Remove a member
  const remove = useCallback(
    async (memberId: string) => {
      if (!clerkUserId || !organization?.id) {
        throw new Error('Not authenticated or no organization selected')
      }

      await removeMember({
        clerkUserId,
        organizationId: organization.id,
        memberId,
      })

      // Refresh members list
      await fetchMembers()
    },
    [clerkUserId, organization?.id, fetchMembers]
  )

  // Leave the organization (remove self)
  const leave = useCallback(async () => {
    if (!clerkUserId || !organization?.id) {
      throw new Error('Not authenticated or no organization selected')
    }

    // Find current user's member record
    const currentMember = members.find((m) => m.userId === clerkUserId)
    if (!currentMember) {
      throw new Error('Could not find your membership')
    }

    await removeMember({
      clerkUserId,
      organizationId: organization.id,
      memberId: currentMember.id,
    })

    // Clear organization state after leaving
    setOrganization(null)
    setMembers([])
    setPendingInvites([])
    setSeats(null)
    setCurrentUserRole(null)

    // Refresh organizations list
    await fetchOrganizations()
  }, [clerkUserId, organization?.id, members, fetchOrganizations])

  // Update organization settings
  const updateSettings = useCallback(
    async (settings: Partial<OrganizationSettings>) => {
      if (!clerkUserId || !organization?.id) {
        throw new Error('Not authenticated or no organization selected')
      }

      const result = await updateOrganization({
        clerkUserId,
        organizationId: organization.id,
        settings,
      })

      setOrganization(result.organization)
    },
    [clerkUserId, organization?.id]
  )

  // Update organization name
  const updateName = useCallback(
    async (name: string) => {
      if (!clerkUserId || !organization?.id) {
        throw new Error('Not authenticated or no organization selected')
      }

      const result = await updateOrganization({
        clerkUserId,
        organizationId: organization.id,
        name,
      })

      setOrganization(result.organization)
    },
    [clerkUserId, organization?.id]
  )

  // Create checkout for team/enterprise
  const createTeamCheckout = useCallback(
    async (params: {
      organizationName: string
      plan: 'team' | 'enterprise'
      seatCount: number
      billingPeriod: 'monthly' | 'annual'
    }) => {
      if (!clerkUserId || !user?.primaryEmailAddress?.emailAddress) {
        throw new Error('Not authenticated')
      }

      const result = await createOrgCheckout({
        clerkUserId,
        email: user.primaryEmailAddress.emailAddress,
        ...params,
      })

      // Redirect to Stripe checkout
      window.location.href = result.url
    },
    [clerkUserId, user?.primaryEmailAddress?.emailAddress]
  )

  // Auto-fetch organization if ID provided
  useEffect(() => {
    if (organizationId && clerkUserId) {
      fetchOrganization(organizationId)
    }
  }, [organizationId, clerkUserId, fetchOrganization])

  // Auto-fetch members when organization changes
  useEffect(() => {
    if (organization?.id) {
      fetchMembers()
    }
  }, [organization?.id, fetchMembers])

  return {
    organization,
    organizations,
    members,
    pendingInvites,
    seats,
    currentUserRole,
    loading,
    error,
    fetchOrganization,
    fetchOrganizations,
    fetchMembers,
    invite,
    updateRole,
    remove,
    leave,
    updateSettings,
    updateName,
    createTeamCheckout,
  }
}

// Hook for accepting invites
export function useAcceptInvite() {
  const { user } = useUser()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const acceptInvite = useCallback(
    async (token: string) => {
      if (!user?.id || !user?.primaryEmailAddress?.emailAddress) {
        throw new Error('Not authenticated')
      }

      setLoading(true)
      setError(null)

      try {
        const { acceptInvite: accept } = await import('../lib/organization')
        const result = await accept({
          clerkUserId: user.id,
          email: user.primaryEmailAddress.emailAddress,
          token,
        })
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to accept invite'
        setError(message)
        throw err
      } finally {
        setLoading(false)
      }
    },
    [user?.id, user?.primaryEmailAddress?.emailAddress]
  )

  return { acceptInvite, loading, error }
}
