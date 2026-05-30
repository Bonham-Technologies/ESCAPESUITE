import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useOrganization, useAcceptInvite } from './useOrganization'

// Mock organization lib so we can control return values and assert calls.
vi.mock('../lib/organization', () => ({
  getOrganization: vi.fn(),
  getOrganizations: vi.fn(),
  getOrganizationMembers: vi.fn(),
  inviteMember: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
  updateOrganization: vi.fn(),
  createOrgCheckout: vi.fn(),
  acceptInvite: vi.fn(),
}))

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

describe('useOrganization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns initial state', () => {
    const { result } = renderHook(() => useOrganization())

    expect(result.current.organization).toBeNull()
    expect(result.current.organizations).toEqual([])
    expect(result.current.members).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('provides action functions', () => {
    const { result } = renderHook(() => useOrganization())

    expect(typeof result.current.fetchOrganization).toBe('function')
    expect(typeof result.current.fetchOrganizations).toBe('function')
    expect(typeof result.current.fetchMembers).toBe('function')
    expect(typeof result.current.invite).toBe('function')
    expect(typeof result.current.updateRole).toBe('function')
    expect(typeof result.current.remove).toBe('function')
    expect(typeof result.current.leave).toBe('function')
    expect(typeof result.current.updateSettings).toBe('function')
    expect(typeof result.current.updateName).toBe('function')
    expect(typeof result.current.createTeamCheckout).toBe('function')
  })
})

describe('useOrganization - fetching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches organizations list', async () => {
    const mockOrganizations = [
      { id: 'org_1', name: 'Test Org', slug: 'test-org' },
    ]
    vi.mocked(getOrganizations).mockResolvedValue({ organizations: mockOrganizations })

    const { result } = renderHook(() => useOrganization())

    await result.current.fetchOrganizations()

    await waitFor(() => {
      expect(result.current.organizations).toEqual(mockOrganizations)
    })

    expect(getOrganizations).toHaveBeenCalledWith('test-user-id')
  })

  it('fetches specific organization by slug', async () => {
    const mockOrg = { id: 'org_1', name: 'Test Org', slug: 'test-org' }
    vi.mocked(getOrganization).mockResolvedValue({
      organization: mockOrg,
      membership: { role: 'owner' },
    })
    vi.mocked(getOrganizationMembers).mockResolvedValue({
      members: [],
      pendingInvites: [],
      seats: { used: 1, total: 5, available: 4 },
      currentUserRole: 'owner',
    })

    const { result } = renderHook(() => useOrganization())

    await result.current.fetchOrganization('test-org')

    await waitFor(() => {
      expect(result.current.organization).toEqual(mockOrg)
    })

    expect(getOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'test-org' })
    )
  })

  it('fetches specific organization by UUID', async () => {
    const mockOrg = { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Test Org' }
    vi.mocked(getOrganization).mockResolvedValue({
      organization: mockOrg,
      membership: { role: 'admin' },
    })
    vi.mocked(getOrganizationMembers).mockResolvedValue({
      members: [],
      pendingInvites: [],
      seats: { used: 1, total: 5, available: 4 },
      currentUserRole: 'admin',
    })

    const { result } = renderHook(() => useOrganization())

    await result.current.fetchOrganization('550e8400-e29b-41d4-a716-446655440000')

    await waitFor(() => {
      expect(result.current.organization).toEqual(mockOrg)
    })

    expect(getOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: '550e8400-e29b-41d4-a716-446655440000',
      })
    )
  })

  it('handles fetch error', async () => {
    vi.mocked(getOrganizations).mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useOrganization())

    await result.current.fetchOrganizations()

    await waitFor(() => {
      expect(result.current.error).toBe('Network error')
    })
  })
})

describe('useOrganization - member actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invites a member', async () => {
    const mockOrg = { id: 'org_1', name: 'Test Org' }
    vi.mocked(getOrganization).mockResolvedValue({
      organization: mockOrg,
      membership: { role: 'owner' },
    })
    vi.mocked(getOrganizationMembers).mockResolvedValue({
      members: [],
      pendingInvites: [],
      seats: { used: 1, total: 5, available: 4 },
      currentUserRole: 'owner',
    })
    vi.mocked(inviteMember).mockResolvedValue({
      inviteUrl: 'https://example.com/invite/token123',
    })

    const { result } = renderHook(() => useOrganization())

    // First fetch the organization
    await result.current.fetchOrganization('org_1')

    await waitFor(() => {
      expect(result.current.organization).toEqual(mockOrg)
    })

    // Then invite a member
    const inviteResult = await result.current.invite('newuser@example.com', 'member')

    expect(inviteMember).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_1',
        email: 'newuser@example.com',
        role: 'member',
      })
    )
    expect(inviteResult.inviteUrl).toBe('https://example.com/invite/token123')
  })

  it('updates member role', async () => {
    const mockOrg = { id: 'org_1', name: 'Test Org' }
    vi.mocked(getOrganization).mockResolvedValue({
      organization: mockOrg,
      membership: { role: 'owner' },
    })
    vi.mocked(getOrganizationMembers).mockResolvedValue({
      members: [{ id: 'member_1', userId: 'user_456', role: 'member' }],
      pendingInvites: [],
      seats: { used: 2, total: 5, available: 3 },
      currentUserRole: 'owner',
    })
    vi.mocked(updateMemberRole).mockResolvedValue(undefined)

    const { result } = renderHook(() => useOrganization())

    await result.current.fetchOrganization('org_1')

    await waitFor(() => {
      expect(result.current.organization).toEqual(mockOrg)
    })

    await result.current.updateRole('member_1', 'admin')

    expect(updateMemberRole).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_1',
        memberId: 'member_1',
        newRole: 'admin',
      })
    )
  })

  it('removes a member', async () => {
    const mockOrg = { id: 'org_1', name: 'Test Org' }
    vi.mocked(getOrganization).mockResolvedValue({
      organization: mockOrg,
      membership: { role: 'owner' },
    })
    vi.mocked(getOrganizationMembers).mockResolvedValue({
      members: [{ id: 'member_1', userId: 'user_456', role: 'member' }],
      pendingInvites: [],
      seats: { used: 2, total: 5, available: 3 },
      currentUserRole: 'owner',
    })
    vi.mocked(removeMember).mockResolvedValue(undefined)

    const { result } = renderHook(() => useOrganization())

    await result.current.fetchOrganization('org_1')

    await waitFor(() => {
      expect(result.current.organization).toEqual(mockOrg)
    })

    await result.current.remove('member_1')

    expect(removeMember).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_1',
        memberId: 'member_1',
      })
    )
  })
})

describe('useOrganization - settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates organization name', async () => {
    const mockOrg = { id: 'org_1', name: 'Test Org' }
    const updatedOrg = { id: 'org_1', name: 'New Name' }

    vi.mocked(getOrganization).mockResolvedValue({
      organization: mockOrg,
      membership: { role: 'owner' },
    })
    vi.mocked(getOrganizationMembers).mockResolvedValue({
      members: [],
      pendingInvites: [],
      seats: { used: 1, total: 5, available: 4 },
      currentUserRole: 'owner',
    })
    vi.mocked(updateOrganization).mockResolvedValue({ organization: updatedOrg })

    const { result } = renderHook(() => useOrganization())

    await result.current.fetchOrganization('org_1')

    await waitFor(() => {
      expect(result.current.organization).toEqual(mockOrg)
    })

    await result.current.updateName('New Name')

    expect(updateOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_1',
        name: 'New Name',
      })
    )

    await waitFor(() => {
      expect(result.current.organization).toEqual(updatedOrg)
    })
  })

  it('updates organization settings', async () => {
    const mockOrg = { id: 'org_1', name: 'Test Org', settings: {} }
    const updatedOrg = { id: 'org_1', name: 'Test Org', settings: { require_2fa: true } }

    vi.mocked(getOrganization).mockResolvedValue({
      organization: mockOrg,
      membership: { role: 'owner' },
    })
    vi.mocked(getOrganizationMembers).mockResolvedValue({
      members: [],
      pendingInvites: [],
      seats: { used: 1, total: 5, available: 4 },
      currentUserRole: 'owner',
    })
    vi.mocked(updateOrganization).mockResolvedValue({ organization: updatedOrg })

    const { result } = renderHook(() => useOrganization())

    await result.current.fetchOrganization('org_1')

    await waitFor(() => {
      expect(result.current.organization).toEqual(mockOrg)
    })

    await result.current.updateSettings({ require_2fa: true })

    expect(updateOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_1',
        settings: { require_2fa: true },
      })
    )

    await waitFor(() => {
      expect(result.current.organization).toEqual(updatedOrg)
    })
  })
})

describe('useOrganization - checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates team checkout', async () => {
    vi.mocked(createOrgCheckout).mockResolvedValue({
      url: 'https://checkout.stripe.com/session123',
    })

    // Mock window.location
    const originalLocation = window.location
    // @ts-expect-error - mocking location
    delete window.location
    window.location = { ...originalLocation, href: '' }

    const { result } = renderHook(() => useOrganization())

    await result.current.createTeamCheckout({
      organizationName: 'New Team',
      plan: 'team',
      seatCount: 5,
      billingPeriod: 'monthly',
    })

    expect(createOrgCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'test@example.com',
        organizationName: 'New Team',
        plan: 'team',
        seatCount: 5,
        billingPeriod: 'monthly',
      })
    )
    expect(window.location.href).toBe('https://checkout.stripe.com/session123')

    // Restore
    window.location = originalLocation
  })
})

describe('useAcceptInvite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns initial state', () => {
    const { result } = renderHook(() => useAcceptInvite())

    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(typeof result.current.acceptInvite).toBe('function')
  })
})
