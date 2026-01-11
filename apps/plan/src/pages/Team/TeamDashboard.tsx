import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useOrganization } from '../../hooks/useOrganization'
import {
  getRoleDisplayName,
  getPlanDisplayName,
  canManageMembers,
  canManageSettings,
} from '../../lib/organization'

export default function TeamDashboard() {
  const { slug } = useParams<{ slug: string }>()
  const [searchParams] = useSearchParams()
  const success = searchParams.get('success')

  const {
    organization,
    members,
    seats,
    currentUserRole,
    loading,
    error,
  } = useOrganization(slug)

  if (loading) {
    return (
      <div className="team-dashboard loading">
        <div className="spinner" />
        <p>Loading organization...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="team-dashboard error">
        <h2>Error</h2>
        <p>{error}</p>
        <Link to="/dashboard">Back to Dashboard</Link>
      </div>
    )
  }

  if (!organization) {
    return (
      <div className="team-dashboard not-found">
        <h2>Organization Not Found</h2>
        <p>The organization you're looking for doesn't exist or you don't have access.</p>
        <Link to="/dashboard">Back to Dashboard</Link>
      </div>
    )
  }

  const activeMembers = members.filter((m) => m.status === 'active')

  return (
    <div className="team-dashboard">
      {success && (
        <div className="success-banner">
          <span>Welcome to {organization.name}! Your team subscription is now active.</span>
        </div>
      )}

      <header className="team-header">
        <div className="team-info">
          <h1>{organization.name}</h1>
          <span className="plan-badge">{getPlanDisplayName(organization.plan)}</span>
        </div>
        <div className="team-actions">
          {canManageSettings(currentUserRole || '') && (
            <Link to={`/team/${slug}/settings`} className="btn btn-secondary">
              Settings
            </Link>
          )}
        </div>
      </header>

      <div className="team-stats">
        <div className="stat-card">
          <h3>Members</h3>
          <div className="stat-value">
            {activeMembers.length} / {seats?.total || organization.seatCount}
          </div>
          <p className="stat-label">
            {seats?.available || 0} seats available
          </p>
        </div>

        <div className="stat-card">
          <h3>Your Role</h3>
          <div className="stat-value">{getRoleDisplayName(currentUserRole || '')}</div>
          <p className="stat-label">
            {currentUserRole === 'owner' && 'Full control'}
            {currentUserRole === 'admin' && 'Can manage members'}
            {currentUserRole === 'member' && 'Standard access'}
          </p>
        </div>

        <div className="stat-card">
          <h3>Plan</h3>
          <div className="stat-value">{getPlanDisplayName(organization.plan)}</div>
          <p className="stat-label">
            {organization.plan === 'enterprise' ? 'All features included' : 'Core features'}
          </p>
        </div>
      </div>

      <section className="team-section">
        <div className="section-header">
          <h2>Team Members</h2>
          {canManageMembers(currentUserRole || '') && (
            <Link to={`/team/${slug}/members`} className="btn btn-primary">
              Manage Members
            </Link>
          )}
        </div>

        <div className="member-list">
          {activeMembers.slice(0, 5).map((member) => (
            <div key={member.id} className="member-item">
              <div className="member-avatar">
                {member.email.charAt(0).toUpperCase()}
              </div>
              <div className="member-info">
                <span className="member-email">{member.email}</span>
                <span className="member-role">{getRoleDisplayName(member.role)}</span>
              </div>
            </div>
          ))}
          {activeMembers.length > 5 && (
            <Link to={`/team/${slug}/members`} className="view-all">
              View all {activeMembers.length} members
            </Link>
          )}
        </div>
      </section>

      <section className="team-section">
        <h2>Quick Actions</h2>
        <div className="quick-actions">
          <Link to="/craft" className="action-card">
            <span className="action-icon">🎥</span>
            <span className="action-title">ESCAPECRAFT</span>
            <span className="action-desc">Record screen & webcam</span>
          </Link>
          <Link to="/artist" className="action-card">
            <span className="action-icon">🎬</span>
            <span className="action-title">ESCAPEARTIST</span>
            <span className="action-desc">Edit videos</span>
          </Link>
          {canManageMembers(currentUserRole || '') && (
            <Link to={`/team/${slug}/members?invite=true`} className="action-card">
              <span className="action-icon">👥</span>
              <span className="action-title">Invite Member</span>
              <span className="action-desc">Add team members</span>
            </Link>
          )}
        </div>
      </section>

      <style>{`
        .team-dashboard {
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem;
        }

        .team-dashboard.loading,
        .team-dashboard.error,
        .team-dashboard.not-found {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 50vh;
          text-align: center;
        }

        .success-banner {
          background: var(--color-success, #10b981);
          color: white;
          padding: 1rem;
          border-radius: 8px;
          margin-bottom: 2rem;
          text-align: center;
        }

        .team-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2rem;
        }

        .team-info {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .team-info h1 {
          margin: 0;
        }

        .plan-badge {
          background: var(--color-primary, #6366f1);
          color: white;
          padding: 0.25rem 0.75rem;
          border-radius: 999px;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .team-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1.5rem;
          margin-bottom: 2rem;
        }

        .stat-card {
          background: var(--color-surface, #f9fafb);
          padding: 1.5rem;
          border-radius: 12px;
          border: 1px solid var(--color-border, #e5e7eb);
        }

        .stat-card h3 {
          margin: 0 0 0.5rem;
          font-size: 0.875rem;
          color: var(--color-text-secondary, #6b7280);
          font-weight: 500;
        }

        .stat-value {
          font-size: 2rem;
          font-weight: 700;
          margin-bottom: 0.25rem;
        }

        .stat-label {
          font-size: 0.875rem;
          color: var(--color-text-secondary, #6b7280);
          margin: 0;
        }

        .team-section {
          margin-bottom: 2rem;
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        }

        .section-header h2 {
          margin: 0;
        }

        .member-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .member-item {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem;
          background: var(--color-surface, #f9fafb);
          border-radius: 8px;
          border: 1px solid var(--color-border, #e5e7eb);
        }

        .member-avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: var(--color-primary, #6366f1);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
        }

        .member-info {
          display: flex;
          flex-direction: column;
        }

        .member-email {
          font-weight: 500;
        }

        .member-role {
          font-size: 0.875rem;
          color: var(--color-text-secondary, #6b7280);
        }

        .view-all {
          text-align: center;
          padding: 0.75rem;
          color: var(--color-primary, #6366f1);
          text-decoration: none;
        }

        .quick-actions {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1rem;
        }

        .action-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 1.5rem;
          background: var(--color-surface, #f9fafb);
          border: 1px solid var(--color-border, #e5e7eb);
          border-radius: 12px;
          text-decoration: none;
          color: inherit;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .action-card:hover {
          border-color: var(--color-primary, #6366f1);
          box-shadow: 0 4px 12px rgba(99, 102, 241, 0.15);
        }

        .action-icon {
          font-size: 2rem;
          margin-bottom: 0.5rem;
        }

        .action-title {
          font-weight: 600;
          margin-bottom: 0.25rem;
        }

        .action-desc {
          font-size: 0.875rem;
          color: var(--color-text-secondary, #6b7280);
        }

        .btn {
          display: inline-flex;
          align-items: center;
          padding: 0.5rem 1rem;
          border-radius: 8px;
          font-weight: 500;
          text-decoration: none;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-primary {
          background: var(--color-primary, #6366f1);
          color: white;
          border: none;
        }

        .btn-primary:hover {
          background: var(--color-primary-dark, #4f46e5);
        }

        .btn-secondary {
          background: transparent;
          color: var(--color-text, #1f2937);
          border: 1px solid var(--color-border, #e5e7eb);
        }

        .btn-secondary:hover {
          background: var(--color-surface, #f9fafb);
        }

        .spinner {
          width: 40px;
          height: 40px;
          border: 3px solid var(--color-border, #e5e7eb);
          border-top-color: var(--color-primary, #6366f1);
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-bottom: 1rem;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  )
}
