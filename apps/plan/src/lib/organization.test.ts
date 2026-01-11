import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getRoleDisplayName,
  getPlanDisplayName,
  canManageMembers,
  canManageSettings,
  canChangeRole,
  canRemoveMember,
} from './organization'

// Mock the supabase module
vi.mock('./supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}))

describe('organization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getRoleDisplayName', () => {
    it('returns correct display names', () => {
      expect(getRoleDisplayName('owner')).toBe('Owner')
      expect(getRoleDisplayName('admin')).toBe('Admin')
      expect(getRoleDisplayName('member')).toBe('Member')
    })

    it('returns original value for unknown roles', () => {
      expect(getRoleDisplayName('unknown_role')).toBe('unknown_role')
    })
  })

  describe('getPlanDisplayName', () => {
    it('returns correct display names', () => {
      expect(getPlanDisplayName('team')).toBe('Team')
      expect(getPlanDisplayName('enterprise')).toBe('Enterprise')
    })

    it('returns original value for unknown plans', () => {
      expect(getPlanDisplayName('unknown_plan')).toBe('unknown_plan')
    })
  })

  describe('canManageMembers', () => {
    it('returns true for owner', () => {
      expect(canManageMembers('owner')).toBe(true)
    })

    it('returns true for admin', () => {
      expect(canManageMembers('admin')).toBe(true)
    })

    it('returns false for member', () => {
      expect(canManageMembers('member')).toBe(false)
    })

    it('returns false for empty role', () => {
      expect(canManageMembers('')).toBe(false)
    })
  })

  describe('canManageSettings', () => {
    it('returns true for owner', () => {
      expect(canManageSettings('owner')).toBe(true)
    })

    it('returns true for admin', () => {
      expect(canManageSettings('admin')).toBe(true)
    })

    it('returns false for member', () => {
      expect(canManageSettings('member')).toBe(false)
    })

    it('returns false for empty role', () => {
      expect(canManageSettings('')).toBe(false)
    })
  })

  describe('canChangeRole', () => {
    it('returns true when owner changes admin role', () => {
      expect(canChangeRole('owner', 'admin')).toBe(true)
    })

    it('returns true when owner changes member role', () => {
      expect(canChangeRole('owner', 'member')).toBe(true)
    })

    it('returns false when owner tries to change owner role', () => {
      expect(canChangeRole('owner', 'owner')).toBe(false)
    })

    it('returns false when admin tries to change any role', () => {
      expect(canChangeRole('admin', 'admin')).toBe(false)
      expect(canChangeRole('admin', 'member')).toBe(false)
      expect(canChangeRole('admin', 'owner')).toBe(false)
    })

    it('returns false when member tries to change any role', () => {
      expect(canChangeRole('member', 'admin')).toBe(false)
      expect(canChangeRole('member', 'member')).toBe(false)
      expect(canChangeRole('member', 'owner')).toBe(false)
    })
  })

  describe('canRemoveMember', () => {
    describe('self-removal (leaving)', () => {
      it('allows admin to leave', () => {
        expect(canRemoveMember('admin', 'admin', true)).toBe(true)
      })

      it('allows member to leave', () => {
        expect(canRemoveMember('member', 'member', true)).toBe(true)
      })

      it('prevents owner from leaving', () => {
        expect(canRemoveMember('owner', 'owner', true)).toBe(false)
      })
    })

    describe('owner removing others', () => {
      it('owner can remove admin', () => {
        expect(canRemoveMember('owner', 'admin', false)).toBe(true)
      })

      it('owner can remove member', () => {
        expect(canRemoveMember('owner', 'member', false)).toBe(true)
      })

      it('owner cannot remove another owner', () => {
        expect(canRemoveMember('owner', 'owner', false)).toBe(false)
      })
    })

    describe('admin removing others', () => {
      it('admin can remove member', () => {
        expect(canRemoveMember('admin', 'member', false)).toBe(true)
      })

      it('admin cannot remove another admin', () => {
        expect(canRemoveMember('admin', 'admin', false)).toBe(false)
      })

      it('admin cannot remove owner', () => {
        expect(canRemoveMember('admin', 'owner', false)).toBe(false)
      })
    })

    describe('member removing others', () => {
      it('member cannot remove anyone', () => {
        expect(canRemoveMember('member', 'member', false)).toBe(false)
        expect(canRemoveMember('member', 'admin', false)).toBe(false)
        expect(canRemoveMember('member', 'owner', false)).toBe(false)
      })
    })
  })
})
