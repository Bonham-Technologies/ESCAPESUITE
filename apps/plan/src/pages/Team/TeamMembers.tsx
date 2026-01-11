import { useState, useEffect } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useOrganization } from '../../hooks/useOrganization'
import {
  getRoleDisplayName,
  canManageMembers,
  canChangeRole,
  canRemoveMember,
} from '../../lib/organization'
import { useUser } from '@clerk/clerk-react'

export default function TeamMembers() {
  const { slug } = useParams<{ slug: string }>()
  const [searchParams] = useSearchParams()
  const showInviteModal = searchParams.get('invite') === 'true'
  const { user } = useUser()

  const {
    organization,
    members,
    pendingInvites,
    seats,
    currentUserRole,
    loading,
    error,
    invite,
    updateRole,
    remove,
  } = useOrganization(slug)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member')
  const [inviteModalOpen, setInviteModalOpen] = useState(showInviteModal)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (showInviteModal) {
      setInviteModalOpen(true)
    }
  }, [showInviteModal])

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviteLoading(true)
    setInviteError(null)
    setInviteSuccess(null)

    try {
      const result = await invite(inviteEmail, inviteRole)
      setInviteSuccess(`Invitation sent to ${inviteEmail}`)
      setInviteEmail('')
      setInviteRole('member')
      // Copy invite URL to clipboard
      await navigator.clipboard.writeText(result.inviteUrl)
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to send invite')
    } finally {
      setInviteLoading(false)
    }
  }

  const handleRemove = async (memberId: string, email: string) => {
    if (!confirm(`Are you sure you want to remove ${email} from the team?`)) {
      return
    }

    try {
      await remove(memberId)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to remove member')
    }
  }

  const handleRoleChange = async (memberId: string, newRole: 'admin' | 'member') => {
    try {
      await updateRole(memberId, newRole)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update role')
    }
  }

  if (loading) {
    return (
      <div className="team-members loading">
        <div className="spinner" />
        <p>Loading members...</p>
      </div>
    )
  }

  if (error || !organization) {
    return (
      <div className="team-members error">
        <h2>Error</h2>
        <p>{error || 'Organization not found'}</p>
        <Link to="/dashboard">Back to Dashboard</Link>
      </div>
    )
  }

  const canManage = canManageMembers(currentUserRole || '')
  const activeMembers = members.filter((m) => m.status === 'active')

  return (
    <div className="team-members">
      <header className="page-header">
        <div className="breadcrumb">
          <Link to={`/team/${slug}`}>{organization.name}</Link>
          <span>/</span>
          <span>Members</span>
        </div>
        <h1>Team Members</h1>
      </header>

      <div className="seats-info">
        <div className="seats-bar">
          <div
            className="seats-used"
            style={{
              width: `${((seats?.used || 0) / (seats?.total || 1)) * 100}%`,
            }}
          />
        </div>
        <p>
          {seats?.used} of {seats?.total} seats used
          {seats?.available && seats.available > 0 && (
            <span className="seats-available">
              ({seats.available} available)
            </span>
          )}
        </p>
      </div>

      {canManage && (
        <div className="actions-bar">
          <button
            className="btn btn-primary"
            onClick={() => setInviteModalOpen(true)}
            disabled={seats?.available === 0}
          >
            {seats?.available === 0 ? 'No Seats Available' : 'Invite Member'}
          </button>
        </div>
      )}

      <section className="members-section">
        <h2>Active Members ({activeMembers.length})</h2>
        <div className="members-table">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Joined</th>
                {canManage && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {activeMembers.map((member) => {
                const isSelf = member.userId === user?.id
                const canChange = canChangeRole(currentUserRole || '', member.role)
                const canRemove = canRemoveMember(currentUserRole || '', member.role, isSelf)

                return (
                  <tr key={member.id}>
                    <td>
                      <div className="member-cell">
                        <div className="member-avatar">
                          {member.email.charAt(0).toUpperCase()}
                        </div>
                        <div className="member-info">
                          <span className="member-email">
                            {member.email}
                            {isSelf && <span className="you-badge">You</span>}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      {canChange ? (
                        <select
                          value={member.role}
                          onChange={(e) =>
                            handleRoleChange(member.id, e.target.value as 'admin' | 'member')
                          }
                          className="role-select"
                        >
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                        </select>
                      ) : (
                        <span className={`role-badge role-${member.role}`}>
                          {getRoleDisplayName(member.role)}
                        </span>
                      )}
                    </td>
                    <td>
                      {member.joinedAt
                        ? new Date(member.joinedAt).toLocaleDateString()
                        : '—'}
                    </td>
                    {canManage && (
                      <td>
                        {canRemove && (
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleRemove(member.id, member.email)}
                          >
                            {isSelf ? 'Leave' : 'Remove'}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {canManage && pendingInvites.length > 0 && (
        <section className="members-section">
          <h2>Pending Invites ({pendingInvites.length})</h2>
          <div className="invites-list">
            {pendingInvites.map((invite) => (
              <div key={invite.id} className="invite-item">
                <div className="invite-info">
                  <span className="invite-email">{invite.email}</span>
                  <span className="invite-role">{getRoleDisplayName(invite.role)}</span>
                </div>
                <div className="invite-meta">
                  <span>Expires {new Date(invite.expiresAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Invite Modal */}
      {inviteModalOpen && (
        <div className="modal-overlay" onClick={() => setInviteModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Invite Team Member</h2>
            <form onSubmit={handleInvite}>
              <div className="form-group">
                <label htmlFor="email">Email Address</label>
                <input
                  id="email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="role">Role</label>
                <select
                  id="role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
                >
                  <option value="member">Member - Standard access</option>
                  {currentUserRole === 'owner' && (
                    <option value="admin">Admin - Can manage members</option>
                  )}
                </select>
              </div>

              {inviteError && <div className="error-message">{inviteError}</div>}
              {inviteSuccess && (
                <div className="success-message">
                  {inviteSuccess}
                  <br />
                  <small>Invite link copied to clipboard!</small>
                </div>
              )}

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setInviteModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={inviteLoading}
                >
                  {inviteLoading ? 'Sending...' : 'Send Invite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        .team-members {
          max-width: 1000px;
          margin: 0 auto;
          padding: 2rem;
        }

        .team-members.loading,
        .team-members.error {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 50vh;
        }

        .page-header {
          margin-bottom: 2rem;
        }

        .breadcrumb {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          color: var(--color-text-secondary, #6b7280);
          margin-bottom: 0.5rem;
        }

        .breadcrumb a {
          color: var(--color-primary, #6366f1);
          text-decoration: none;
        }

        .page-header h1 {
          margin: 0;
        }

        .seats-info {
          margin-bottom: 1.5rem;
        }

        .seats-bar {
          height: 8px;
          background: var(--color-border, #e5e7eb);
          border-radius: 4px;
          overflow: hidden;
          margin-bottom: 0.5rem;
        }

        .seats-used {
          height: 100%;
          background: var(--color-primary, #6366f1);
          transition: width 0.3s;
        }

        .seats-available {
          color: var(--color-success, #10b981);
          margin-left: 0.5rem;
        }

        .actions-bar {
          margin-bottom: 2rem;
        }

        .members-section {
          margin-bottom: 2rem;
        }

        .members-section h2 {
          margin-bottom: 1rem;
        }

        .members-table table {
          width: 100%;
          border-collapse: collapse;
        }

        .members-table th,
        .members-table td {
          padding: 1rem;
          text-align: left;
          border-bottom: 1px solid var(--color-border, #e5e7eb);
        }

        .members-table th {
          font-weight: 600;
          color: var(--color-text-secondary, #6b7280);
          font-size: 0.875rem;
        }

        .member-cell {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .member-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: var(--color-primary, #6366f1);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          font-size: 0.875rem;
        }

        .you-badge {
          background: var(--color-surface, #f3f4f6);
          color: var(--color-text-secondary, #6b7280);
          padding: 0.125rem 0.5rem;
          border-radius: 4px;
          font-size: 0.75rem;
          margin-left: 0.5rem;
        }

        .role-select {
          padding: 0.375rem 0.75rem;
          border: 1px solid var(--color-border, #e5e7eb);
          border-radius: 6px;
          background: white;
          cursor: pointer;
        }

        .role-badge {
          padding: 0.25rem 0.75rem;
          border-radius: 999px;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .role-owner {
          background: #fef3c7;
          color: #92400e;
        }

        .role-admin {
          background: #dbeafe;
          color: #1e40af;
        }

        .role-member {
          background: #f3f4f6;
          color: #374151;
        }

        .invites-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .invite-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem;
          background: var(--color-surface, #f9fafb);
          border: 1px solid var(--color-border, #e5e7eb);
          border-radius: 8px;
        }

        .invite-info {
          display: flex;
          flex-direction: column;
        }

        .invite-email {
          font-weight: 500;
        }

        .invite-role {
          font-size: 0.875rem;
          color: var(--color-text-secondary, #6b7280);
        }

        .invite-meta {
          font-size: 0.875rem;
          color: var(--color-text-secondary, #6b7280);
        }

        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .modal {
          background: white;
          padding: 2rem;
          border-radius: 12px;
          width: 100%;
          max-width: 400px;
        }

        .modal h2 {
          margin: 0 0 1.5rem;
        }

        .form-group {
          margin-bottom: 1rem;
        }

        .form-group label {
          display: block;
          font-weight: 500;
          margin-bottom: 0.5rem;
        }

        .form-group input,
        .form-group select {
          width: 100%;
          padding: 0.75rem;
          border: 1px solid var(--color-border, #e5e7eb);
          border-radius: 8px;
          font-size: 1rem;
        }

        .error-message {
          background: #fef2f2;
          color: #dc2626;
          padding: 0.75rem;
          border-radius: 8px;
          margin-bottom: 1rem;
        }

        .success-message {
          background: #f0fdf4;
          color: #16a34a;
          padding: 0.75rem;
          border-radius: 8px;
          margin-bottom: 1rem;
        }

        .modal-actions {
          display: flex;
          gap: 0.75rem;
          justify-content: flex-end;
        }

        .btn {
          padding: 0.5rem 1rem;
          border-radius: 8px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-primary {
          background: var(--color-primary, #6366f1);
          color: white;
          border: none;
        }

        .btn-secondary {
          background: transparent;
          border: 1px solid var(--color-border, #e5e7eb);
        }

        .btn-danger {
          background: #fee2e2;
          color: #dc2626;
          border: none;
        }

        .btn-sm {
          padding: 0.375rem 0.75rem;
          font-size: 0.875rem;
        }

        .spinner {
          width: 40px;
          height: 40px;
          border: 3px solid var(--color-border, #e5e7eb);
          border-top-color: var(--color-primary, #6366f1);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
