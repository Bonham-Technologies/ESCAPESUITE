import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useUser } from '../../lib/auth'
import { useOrganization } from '../../hooks/useOrganization'
import {
  getAuditLogs,
  getActionDisplayName,
  getResourceTypeDisplayName,
  type AuditLog,
  type AuditLogFilters,
} from '../../lib/organization'

export default function AuditLogs() {
  const { slug } = useParams<{ slug: string }>()
  const { user } = useUser()
  const { organization, currentUserRole, loading: orgLoading, error: orgError } = useOrganization(slug)

  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [auditLoggingEnabled, setAuditLoggingEnabled] = useState(true)

  // Pagination
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  // Filters
  const [actionFilter, setActionFilter] = useState<string>('')
  const [resourceTypeFilter, setResourceTypeFilter] = useState<string>('')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [availableActions, setAvailableActions] = useState<string[]>([])
  const [availableResourceTypes, setAvailableResourceTypes] = useState<string[]>([])

  // Expanded log details
  const [expandedLog, setExpandedLog] = useState<string | null>(null)

  const fetchLogs = useCallback(async () => {
    if (!user?.id || !organization?.id) return

    setLoading(true)
    setError(null)

    try {
      const filters: AuditLogFilters = {
        page,
        limit: 25,
      }

      if (actionFilter) filters.action = actionFilter
      if (resourceTypeFilter) filters.resourceType = resourceTypeFilter
      if (startDate) filters.startDate = new Date(startDate).toISOString()
      if (endDate) filters.endDate = new Date(endDate + 'T23:59:59').toISOString()

      const response = await getAuditLogs({
        clerkUserId: user.id,
        organizationId: organization.id,
        filters,
      })

      setLogs(response.logs)
      setTotalPages(response.pagination.totalPages)
      setTotal(response.pagination.total)
      setAuditLoggingEnabled(response.auditLoggingEnabled)
      setAvailableActions(response.filters.availableActions)
      setAvailableResourceTypes(response.filters.availableResourceTypes)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit logs')
    } finally {
      setLoading(false)
    }
  }, [user?.id, organization?.id, page, actionFilter, resourceTypeFilter, startDate, endDate])

  useEffect(() => {
    if (organization?.id) {
      fetchLogs()
    }
  }, [organization?.id, fetchLogs])

  const handleClearFilters = () => {
    setActionFilter('')
    setResourceTypeFilter('')
    setStartDate('')
    setEndDate('')
    setPage(1)
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString()
  }

  const formatMetadata = (metadata: Record<string, unknown> | null) => {
    if (!metadata) return null
    return JSON.stringify(metadata, null, 2)
  }

  if (orgLoading) {
    return (
      <div className="audit-logs loading">
        <div className="spinner" />
        <p>Loading...</p>
      </div>
    )
  }

  if (orgError || !organization) {
    return (
      <div className="audit-logs error">
        <h2>Error</h2>
        <p>{orgError || 'Organization not found'}</p>
        <Link to="/dashboard">Back to Dashboard</Link>
      </div>
    )
  }

  // Check permissions
  if (currentUserRole !== 'owner' && currentUserRole !== 'admin') {
    return (
      <div className="audit-logs error">
        <h2>Access Denied</h2>
        <p>Only admins and owners can view audit logs.</p>
        <Link to={`/team/${slug}`}>Back to Team</Link>
      </div>
    )
  }

  return (
    <div className="audit-logs">
      <header className="page-header">
        <div className="breadcrumb">
          <Link to={`/team/${slug}`}>{organization.name}</Link>
          <span>/</span>
          <span>Audit Logs</span>
        </div>
        <h1>Audit Logs</h1>
        {organization.plan === 'enterprise' && (
          <span className="enterprise-badge">Enterprise</span>
        )}
      </header>

      {!auditLoggingEnabled ? (
        <div className="audit-disabled">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <h2>Audit Logging is Disabled</h2>
          <p>
            Audit logging is not enabled for this organization.
            {organization.plan !== 'enterprise' && (
              <> Upgrade to Enterprise to enable audit logging.</>
            )}
          </p>
          <Link to={`/team/${slug}/settings`}>
            <button className="btn btn-primary">Go to Settings</button>
          </Link>
        </div>
      ) : (
        <>
          {/* Filters */}
          <div className="filters-bar">
            <div className="filter-group">
              <label>Action</label>
              <select
                value={actionFilter}
                onChange={(e) => {
                  setActionFilter(e.target.value)
                  setPage(1)
                }}
              >
                <option value="">All Actions</option>
                {availableActions.map((action) => (
                  <option key={action} value={action}>
                    {getActionDisplayName(action)}
                  </option>
                ))}
              </select>
            </div>

            <div className="filter-group">
              <label>Resource Type</label>
              <select
                value={resourceTypeFilter}
                onChange={(e) => {
                  setResourceTypeFilter(e.target.value)
                  setPage(1)
                }}
              >
                <option value="">All Types</option>
                {availableResourceTypes.map((type) => (
                  <option key={type} value={type}>
                    {getResourceTypeDisplayName(type)}
                  </option>
                ))}
              </select>
            </div>

            <div className="filter-group">
              <label>Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value)
                  setPage(1)
                }}
              />
            </div>

            <div className="filter-group">
              <label>End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value)
                  setPage(1)
                }}
              />
            </div>

            {(actionFilter || resourceTypeFilter || startDate || endDate) && (
              <button className="btn btn-secondary clear-filters" onClick={handleClearFilters}>
                Clear Filters
              </button>
            )}
          </div>

          {/* Results info */}
          <div className="results-info">
            <p>
              {total} {total === 1 ? 'entry' : 'entries'} found
              {(actionFilter || resourceTypeFilter || startDate || endDate) && ' (filtered)'}
            </p>
          </div>

          {/* Logs Table */}
          {loading ? (
            <div className="loading-inline">
              <div className="spinner" />
              <span>Loading logs...</span>
            </div>
          ) : error ? (
            <div className="error-message">{error}</div>
          ) : logs.length === 0 ? (
            <div className="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              <p>No audit logs found</p>
              {(actionFilter || resourceTypeFilter || startDate || endDate) && (
                <button className="btn btn-secondary" onClick={handleClearFilters}>
                  Clear Filters
                </button>
              )}
            </div>
          ) : (
            <div className="logs-table">
              <table>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Action</th>
                    <th>User</th>
                    <th>Resource</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <>
                      <tr key={log.id} className={expandedLog === log.id ? 'expanded' : ''}>
                        <td className="timestamp-cell">
                          {formatDate(log.createdAt)}
                        </td>
                        <td>
                          <span className={`action-badge action-${log.action.split('.')[0]}`}>
                            {getActionDisplayName(log.action)}
                          </span>
                        </td>
                        <td className="user-cell">
                          {log.userEmail || log.userId || 'System'}
                        </td>
                        <td>
                          <span className="resource-type">
                            {getResourceTypeDisplayName(log.resourceType)}
                          </span>
                        </td>
                        <td>
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                          >
                            {expandedLog === log.id ? 'Hide' : 'View'}
                          </button>
                        </td>
                      </tr>
                      {expandedLog === log.id && (
                        <tr className="details-row">
                          <td colSpan={5}>
                            <div className="log-details">
                              <div className="detail-section">
                                <h4>Metadata</h4>
                                <pre>{formatMetadata(log.metadata) || 'No metadata'}</pre>
                              </div>
                              <div className="detail-grid">
                                <div className="detail-item">
                                  <span className="detail-label">IP Address</span>
                                  <span className="detail-value">{log.ipAddress || 'N/A'}</span>
                                </div>
                                <div className="detail-item">
                                  <span className="detail-label">Resource ID</span>
                                  <span className="detail-value">{log.resourceId || 'N/A'}</span>
                                </div>
                                <div className="detail-item">
                                  <span className="detail-label">User Agent</span>
                                  <span className="detail-value user-agent">
                                    {log.userAgent || 'N/A'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="btn btn-secondary"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <span className="page-info">
                Page {page} of {totalPages}
              </span>
              <button
                className="btn btn-secondary"
                disabled={page === totalPages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      <style>{`
        .audit-logs {
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem;
        }

        .audit-logs.loading,
        .audit-logs.error {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 50vh;
          text-align: center;
        }

        .page-header {
          margin-bottom: 2rem;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 1rem;
        }

        .page-header h1 {
          margin: 0;
          flex: 1;
        }

        .breadcrumb {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          color: var(--text-secondary);
        }

        .breadcrumb a {
          color: var(--accent);
          text-decoration: none;
        }

        .enterprise-badge {
          background: linear-gradient(135deg, var(--accent) 0%, #8b5cf6 100%);
          color: white;
          padding: 0.25rem 0.75rem;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .audit-disabled {
          text-align: center;
          padding: 4rem 2rem;
          background: var(--bg-secondary);
          border: 1px dashed var(--border);
          border-radius: 12px;
        }

        .audit-disabled svg {
          width: 64px;
          height: 64px;
          color: var(--text-secondary);
          margin-bottom: 1rem;
        }

        .audit-disabled h2 {
          margin: 0 0 0.5rem;
        }

        .audit-disabled p {
          color: var(--text-secondary);
          margin-bottom: 1.5rem;
        }

        .filters-bar {
          display: flex;
          flex-wrap: wrap;
          gap: 1rem;
          padding: 1.5rem;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 12px;
          margin-bottom: 1rem;
          align-items: flex-end;
        }

        .filter-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          min-width: 150px;
        }

        .filter-group label {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .filter-group select,
        .filter-group input {
          padding: 0.5rem 0.75rem;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--bg-tertiary);
          color: var(--text-primary);
          font-size: 0.875rem;
        }

        .clear-filters {
          margin-left: auto;
        }

        .results-info {
          margin-bottom: 1rem;
          color: var(--text-secondary);
          font-size: 0.875rem;
        }

        .loading-inline {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 2rem;
          justify-content: center;
          color: var(--text-secondary);
        }

        .error-message {
          background: rgba(239, 68, 68, 0.1);
          color: var(--error);
          padding: 1rem;
          border-radius: 8px;
          margin-bottom: 1rem;
        }

        .empty-state {
          text-align: center;
          padding: 4rem 2rem;
          color: var(--text-secondary);
        }

        .empty-state svg {
          width: 48px;
          height: 48px;
          margin-bottom: 1rem;
          opacity: 0.5;
        }

        .logs-table {
          overflow-x: auto;
        }

        .logs-table table {
          width: 100%;
          border-collapse: collapse;
          background: var(--bg-secondary);
          border-radius: 12px;
          overflow: hidden;
        }

        .logs-table th,
        .logs-table td {
          padding: 1rem;
          text-align: left;
          border-bottom: 1px solid var(--border);
        }

        .logs-table th {
          font-weight: 600;
          color: var(--text-secondary);
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          background: var(--bg-tertiary);
        }

        .logs-table tr:last-child td {
          border-bottom: none;
        }

        .logs-table tr.expanded td {
          background: var(--bg-tertiary);
        }

        .timestamp-cell {
          font-size: 0.875rem;
          white-space: nowrap;
          color: var(--text-secondary);
        }

        .action-badge {
          display: inline-block;
          padding: 0.25rem 0.75rem;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 500;
        }

        .action-member {
          background: rgba(99, 102, 241, 0.1);
          color: var(--accent);
        }

        .action-organization {
          background: rgba(34, 197, 94, 0.1);
          color: var(--success);
        }

        .action-subscription {
          background: rgba(245, 158, 11, 0.1);
          color: var(--warning);
        }

        .user-cell {
          font-size: 0.875rem;
        }

        .resource-type {
          font-size: 0.875rem;
          color: var(--text-secondary);
        }

        .details-row td {
          padding: 0 !important;
        }

        .log-details {
          padding: 1.5rem;
          background: var(--bg-primary);
          border-top: 1px solid var(--border);
        }

        .detail-section h4 {
          margin: 0 0 0.5rem;
          font-size: 0.75rem;
          text-transform: uppercase;
          color: var(--text-secondary);
          letter-spacing: 0.05em;
        }

        .log-details pre {
          background: var(--bg-tertiary);
          padding: 1rem;
          border-radius: 8px;
          overflow-x: auto;
          font-size: 0.75rem;
          margin: 0 0 1rem;
          color: var(--text-primary);
        }

        .detail-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1rem;
        }

        .detail-item {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .detail-label {
          font-size: 0.75rem;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .detail-value {
          font-size: 0.875rem;
          color: var(--text-primary);
        }

        .detail-value.user-agent {
          font-size: 0.75rem;
          word-break: break-all;
        }

        .pagination {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 1rem;
          margin-top: 2rem;
          padding-top: 1rem;
          border-top: 1px solid var(--border);
        }

        .page-info {
          color: var(--text-secondary);
          font-size: 0.875rem;
        }

        .btn {
          padding: 0.5rem 1rem;
          border-radius: 8px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          border: none;
        }

        .btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .btn-primary {
          background: var(--accent);
          color: white;
        }

        .btn-primary:hover:not(:disabled) {
          background: var(--accent-hover);
        }

        .btn-secondary {
          background: var(--bg-tertiary);
          color: var(--text-primary);
          border: 1px solid var(--border);
        }

        .btn-secondary:hover:not(:disabled) {
          border-color: var(--accent);
        }

        .btn-sm {
          padding: 0.375rem 0.75rem;
          font-size: 0.75rem;
        }

        .spinner {
          width: 24px;
          height: 24px;
          border: 2px solid var(--border);
          border-top-color: var(--accent);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        @media (max-width: 768px) {
          .audit-logs {
            padding: 1rem;
          }

          .filters-bar {
            flex-direction: column;
          }

          .filter-group {
            width: 100%;
          }

          .clear-filters {
            margin-left: 0;
            width: 100%;
          }

          .logs-table th:nth-child(4),
          .logs-table td:nth-child(4) {
            display: none;
          }
        }
      `}</style>
    </div>
  )
}
