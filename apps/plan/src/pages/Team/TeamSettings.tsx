import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useOrganization } from '../../hooks/useOrganization'
import { canManageSettings } from '../../lib/organization'

export default function TeamSettings() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()

  const {
    organization,
    currentUserRole,
    loading,
    error,
    updateSettings,
    updateName,
    leave,
  } = useOrganization(slug)

  const [name, setName] = useState('')
  const [ssoEnabled, setSsoEnabled] = useState(false)
  const [require2fa, setRequire2fa] = useState(false)
  const [auditLogging, setAuditLogging] = useState(false)
  const [allowedDomains, setAllowedDomains] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [initialized, setInitialized] = useState(false)

  // Initialize form when organization loads
  if (organization && !initialized) {
    setName(organization.name)
    setSsoEnabled(organization.settings.sso_enabled)
    setRequire2fa(organization.settings.require_2fa)
    setAuditLogging(organization.settings.audit_logging)
    setAllowedDomains(organization.settings.allowed_domains.join(', '))
    setInitialized(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    try {
      // Update name if changed
      if (name !== organization?.name) {
        await updateName(name)
      }

      // Update settings
      await updateSettings({
        sso_enabled: ssoEnabled,
        require_2fa: require2fa,
        audit_logging: auditLogging,
        allowed_domains: allowedDomains
          .split(',')
          .map((d) => d.trim())
          .filter(Boolean),
      })

      setSaveSuccess(true)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleLeave = async () => {
    if (currentUserRole === 'owner') {
      alert('Owners cannot leave the organization. Transfer ownership first.')
      return
    }

    if (!confirm('Are you sure you want to leave this organization?')) {
      return
    }

    try {
      await leave()
      navigate('/dashboard')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to leave organization')
    }
  }

  if (loading) {
    return (
      <div className="team-settings loading">
        <div className="spinner" />
        <p>Loading settings...</p>
      </div>
    )
  }

  if (error || !organization) {
    return (
      <div className="team-settings error">
        <h2>Error</h2>
        <p>{error || 'Organization not found'}</p>
        <Link to="/dashboard">Back to Dashboard</Link>
      </div>
    )
  }

  const canManage = canManageSettings(currentUserRole || '')
  const isEnterprise = organization.plan === 'enterprise'

  return (
    <div className="team-settings">
      <header className="page-header">
        <div className="breadcrumb">
          <Link to={`/team/${slug}`}>{organization.name}</Link>
          <span>/</span>
          <span>Settings</span>
        </div>
        <h1>Organization Settings</h1>
      </header>

      <form onSubmit={handleSave}>
        <section className="settings-section">
          <h2>General</h2>
          <div className="form-group">
            <label htmlFor="name">Organization Name</label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canManage}
              required
            />
          </div>

          <div className="form-group">
            <label>Organization Slug</label>
            <input type="text" value={organization.slug} disabled />
            <p className="form-help">
              Used in URLs: /team/{organization.slug}
            </p>
          </div>

          <div className="form-group">
            <label>Plan</label>
            <div className="plan-display">
              <span className="plan-badge">{organization.plan}</span>
              <span className="seat-count">{organization.seatCount} seats</span>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2>Security</h2>

          <div className="form-group toggle-group">
            <div className="toggle-info">
              <label htmlFor="require2fa">Require Two-Factor Authentication</label>
              <p className="form-help">
                Require all team members to enable 2FA on their accounts.
              </p>
            </div>
            <input
              id="require2fa"
              type="checkbox"
              checked={require2fa}
              onChange={(e) => setRequire2fa(e.target.checked)}
              disabled={!canManage}
              className="toggle"
            />
          </div>

          <div className="form-group toggle-group">
            <div className="toggle-info">
              <label htmlFor="sso">
                Single Sign-On (SSO)
                {!isEnterprise && <span className="badge">Enterprise</span>}
              </label>
              <p className="form-help">
                Enable SAML SSO for your organization.
              </p>
            </div>
            <input
              id="sso"
              type="checkbox"
              checked={ssoEnabled}
              onChange={(e) => setSsoEnabled(e.target.checked)}
              disabled={!canManage || !isEnterprise}
              className="toggle"
            />
          </div>

          <div className="form-group toggle-group">
            <div className="toggle-info">
              <label htmlFor="audit">
                Audit Logging
                {!isEnterprise && <span className="badge">Enterprise</span>}
              </label>
              <p className="form-help">
                Track all member actions and security events.
                {auditLogging && (
                  <> <Link to={`/team/${slug}/audit-logs`} className="view-logs-link">View Logs →</Link></>
                )}
              </p>
            </div>
            <input
              id="audit"
              type="checkbox"
              checked={auditLogging}
              onChange={(e) => setAuditLogging(e.target.checked)}
              disabled={!canManage || !isEnterprise}
              className="toggle"
            />
          </div>
        </section>

        <section className="settings-section">
          <h2>Access Control</h2>
          <div className="form-group">
            <label htmlFor="domains">
              Allowed Email Domains
              {!isEnterprise && <span className="badge">Enterprise</span>}
            </label>
            <input
              id="domains"
              type="text"
              value={allowedDomains}
              onChange={(e) => setAllowedDomains(e.target.value)}
              placeholder="company.com, subsidiary.com"
              disabled={!canManage || !isEnterprise}
            />
            <p className="form-help">
              Only allow users with these email domains to join. Comma-separated.
            </p>
          </div>
        </section>

        {canManage && (
          <div className="form-actions">
            {saveError && <div className="error-message">{saveError}</div>}
            {saveSuccess && (
              <div className="success-message">Settings saved successfully!</div>
            )}
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
      </form>

      <section className="settings-section danger-zone">
        <h2>Danger Zone</h2>
        {currentUserRole !== 'owner' && (
          <div className="danger-action">
            <div className="danger-info">
              <h3>Leave Organization</h3>
              <p>Remove yourself from this organization.</p>
            </div>
            <button
              type="button"
              className="btn btn-danger"
              onClick={handleLeave}
            >
              Leave Organization
            </button>
          </div>
        )}
        {currentUserRole === 'owner' && (
          <div className="danger-action">
            <div className="danger-info">
              <h3>Transfer Ownership</h3>
              <p>Transfer this organization to another admin.</p>
            </div>
            <button type="button" className="btn btn-danger" disabled>
              Transfer Ownership
            </button>
          </div>
        )}
      </section>

      <style>{`
        .team-settings {
          max-width: 800px;
          margin: 0 auto;
          padding: 2rem;
          color: var(--text-primary);
        }

        .team-settings.loading,
        .team-settings.error {
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
          color: var(--text-secondary);
          margin-bottom: 0.5rem;
        }

        .breadcrumb a {
          color: var(--color-primary, #6366f1);
          text-decoration: none;
        }

        .page-header h1 {
          margin: 0;
          color: var(--text-primary);
        }

        .settings-section {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          padding: 1.5rem;
          margin-bottom: 1.5rem;
        }

        .settings-section h2 {
          margin: 0 0 1.5rem;
          font-size: 1.125rem;
          color: var(--text-primary);
        }

        .form-group {
          margin-bottom: 1.25rem;
        }

        .form-group:last-child {
          margin-bottom: 0;
        }

        .form-group label {
          display: block;
          font-weight: 500;
          margin-bottom: 0.5rem;
          color: var(--text-primary);
        }

        .form-group input[type="text"] {
          width: 100%;
          padding: 0.75rem;
          border: 1px solid var(--border-color);
          border-radius: 8px;
          font-size: 1rem;
          background: var(--bg-tertiary);
          color: var(--text-primary);
        }

        .form-group input:disabled {
          background: var(--bg-tertiary);
          color: var(--text-secondary);
          cursor: not-allowed;
        }

        .form-help {
          font-size: 0.875rem;
          color: var(--text-secondary);
          margin: 0.5rem 0 0;
        }

        .view-logs-link {
          color: var(--color-primary, #6366f1);
          text-decoration: none;
        }

        .view-logs-link:hover {
          text-decoration: underline;
        }

        .toggle-group {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: 1rem;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          border-radius: 8px;
        }

        .toggle-info {
          flex: 1;
        }

        .toggle-info label {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: var(--text-primary);
        }

        .toggle {
          width: 48px;
          height: 24px;
          appearance: none;
          background: var(--border-color);
          border-radius: 12px;
          position: relative;
          cursor: pointer;
          transition: background 0.2s;
        }

        .toggle:checked {
          background: var(--color-primary, #6366f1);
        }

        .toggle::after {
          content: '';
          position: absolute;
          top: 2px;
          left: 2px;
          width: 20px;
          height: 20px;
          background: white;
          border-radius: 50%;
          transition: transform 0.2s;
        }

        .toggle:checked::after {
          transform: translateX(24px);
        }

        .toggle:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .badge {
          background: var(--color-primary, #6366f1);
          color: white;
          padding: 0.125rem 0.5rem;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 500;
        }

        .plan-display {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .plan-badge {
          background: var(--color-primary, #6366f1);
          color: white;
          padding: 0.25rem 0.75rem;
          border-radius: 6px;
          font-weight: 500;
          text-transform: capitalize;
        }

        .seat-count {
          color: var(--text-secondary);
        }

        .form-actions {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          margin-bottom: 2rem;
        }

        .error-message {
          background: var(--error-bg);
          color: var(--error-text);
          padding: 0.75rem;
          border-radius: 8px;
        }

        .success-message {
          background: var(--success-bg);
          color: var(--success-text);
          padding: 0.75rem;
          border-radius: 8px;
        }

        .danger-zone {
          border-color: var(--error);
        }

        .danger-zone h2 {
          color: var(--error);
        }

        .danger-action {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          border-radius: 8px;
        }

        .danger-info h3 {
          margin: 0 0 0.25rem;
          font-size: 1rem;
          color: var(--text-primary);
        }

        .danger-info p {
          margin: 0;
          font-size: 0.875rem;
          color: var(--text-secondary);
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

        .btn-primary:hover:not(:disabled) {
          background: var(--color-primary-dark, #4f46e5);
        }

        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .btn-danger {
          background: var(--error-bg);
          color: var(--error-text);
          border: none;
        }

        .btn-danger:hover:not(:disabled) {
          opacity: 0.9;
        }

        .btn-danger:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .spinner {
          width: 40px;
          height: 40px;
          border: 3px solid var(--border-color);
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
