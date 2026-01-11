import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { supabase } from '../../lib/supabase'

interface LicenseRecord {
  id: string
  product: 'craft' | 'artist' | 'suite'
  tier: 'standard' | 'pro' | 'lifetime'
  seat_count: number
  issued_at: string
  expires_at: string | null
  metadata: {
    features?: string[]
  }
}

interface DownloadInfo {
  product: 'craft' | 'artist'
  version: string
  platform: string
  fileName: string
  fileSize: string
  downloadUrl: string
}

export default function Downloads() {
  const { user, isLoaded } = useUser()
  const [licenses, setLicenses] = useState<LicenseRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Available downloads (this would come from a version API in production)
  const downloads: DownloadInfo[] = [
    {
      product: 'craft',
      version: '1.0.0',
      platform: 'Windows',
      fileName: 'ESCAPECRAFT-standalone.html',
      fileSize: '2.5 MB',
      downloadUrl: '/downloads/craft/ESCAPECRAFT-standalone.html',
    },
    {
      product: 'artist',
      version: '1.0.0',
      platform: 'Windows',
      fileName: 'ESCAPEARTIST-standalone.html',
      fileSize: '3.2 MB',
      downloadUrl: '/downloads/artist/ESCAPEARTIST-standalone.html',
    },
  ]

  useEffect(() => {
    if (!isLoaded || !user) return

    async function fetchLicenses() {
      if (!user) return

      setLoading(true)
      setError(null)

      try {
        const { data, error: fetchError } = await supabase
          .from('licenses')
          .select('id, product, tier, seat_count, issued_at, expires_at, metadata')
          .eq('customer_id', user.id)
          .is('revoked_at', null)
          .order('issued_at', { ascending: false })

        if (fetchError) throw fetchError

        setLicenses(data || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load licenses')
      } finally {
        setLoading(false)
      }
    }

    fetchLicenses()
  }, [user, isLoaded])

  const copyLicenseKey = async (licenseId: string) => {
    // In production, this would fetch the actual license key from a secure endpoint
    try {
      const response = await supabase.functions.invoke('get-license-key', {
        body: { licenseId, clerkUserId: user?.id },
      })

      if (response.error) throw response.error

      await navigator.clipboard.writeText(response.data.licenseKey)
      setCopiedId(licenseId)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to copy license key')
    }
  }

  const getProductDisplayName = (product: string) => {
    switch (product) {
      case 'craft':
        return 'ESCAPECRAFT'
      case 'artist':
        return 'ESCAPEARTIST'
      case 'suite':
        return 'Suite Bundle'
      default:
        return product
    }
  }

  const getTierBadgeClass = (tier: string) => {
    switch (tier) {
      case 'lifetime':
        return 'tier-lifetime'
      case 'pro':
        return 'tier-pro'
      default:
        return 'tier-standard'
    }
  }

  const canDownload = (product: 'craft' | 'artist') => {
    return licenses.some(
      (l) =>
        l.product === product ||
        l.product === 'suite'
    )
  }

  if (!isLoaded) {
    return (
      <div className="portal-downloads loading">
        <div className="spinner" />
        <p>Loading...</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="portal-downloads error">
        <h2>Sign In Required</h2>
        <p>Please sign in to access your downloads.</p>
        <Link to="/sign-in">Sign In</Link>
      </div>
    )
  }

  return (
    <div className="portal-downloads">
      <header className="page-header">
        <div className="breadcrumb">
          <Link to="/dashboard">Dashboard</Link>
          <span>/</span>
          <span>Downloads</span>
        </div>
        <h1>Downloads & Licenses</h1>
      </header>

      {error && (
        <div className="error-banner">
          <p>{error}</p>
        </div>
      )}

      <section className="licenses-section">
        <h2>Your Licenses</h2>
        {loading ? (
          <div className="loading-placeholder">
            <div className="spinner" />
            <p>Loading licenses...</p>
          </div>
        ) : licenses.length === 0 ? (
          <div className="empty-state">
            <p>You don't have any standalone licenses yet.</p>
            <Link to="/pricing" className="btn btn-primary">
              Purchase a License
            </Link>
          </div>
        ) : (
          <div className="licenses-grid">
            {licenses.map((license) => (
              <div key={license.id} className="license-card">
                <div className="license-header">
                  <h3>{getProductDisplayName(license.product)}</h3>
                  <span className={`tier-badge ${getTierBadgeClass(license.tier)}`}>
                    {license.tier}
                  </span>
                </div>
                <div className="license-details">
                  <div className="detail-row">
                    <span className="label">Seats:</span>
                    <span className="value">{license.seat_count}</span>
                  </div>
                  <div className="detail-row">
                    <span className="label">Issued:</span>
                    <span className="value">
                      {new Date(license.issued_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="detail-row">
                    <span className="label">Expires:</span>
                    <span className="value">
                      {license.expires_at
                        ? new Date(license.expires_at).toLocaleDateString()
                        : 'Never'}
                    </span>
                  </div>
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={() => copyLicenseKey(license.id)}
                >
                  {copiedId === license.id ? 'Copied!' : 'Copy License Key'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="downloads-section">
        <h2>Standalone Downloads</h2>
        <p className="section-description">
          Download standalone versions that work offline without an internet connection.
        </p>
        <div className="downloads-grid">
          {downloads.map((download) => {
            const hasLicense = canDownload(download.product)
            return (
              <div
                key={`${download.product}-${download.platform}`}
                className={`download-card ${!hasLicense ? 'locked' : ''}`}
              >
                <div className="download-icon">
                  {download.product === 'craft' ? '🎥' : '🎬'}
                </div>
                <div className="download-info">
                  <h3>
                    {download.product === 'craft' ? 'ESCAPECRAFT' : 'ESCAPEARTIST'}
                  </h3>
                  <p className="download-meta">
                    v{download.version} | {download.platform} | {download.fileSize}
                  </p>
                </div>
                {hasLicense ? (
                  <a
                    href={download.downloadUrl}
                    className="btn btn-primary"
                    download={download.fileName}
                  >
                    Download
                  </a>
                ) : (
                  <Link to="/pricing" className="btn btn-secondary">
                    Purchase License
                  </Link>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section className="help-section">
        <h2>Getting Started</h2>
        <div className="help-steps">
          <div className="step">
            <div className="step-number">1</div>
            <div className="step-content">
              <h3>Download</h3>
              <p>Download the standalone HTML file for your product.</p>
            </div>
          </div>
          <div className="step">
            <div className="step-number">2</div>
            <div className="step-content">
              <h3>Copy License Key</h3>
              <p>Click "Copy License Key" on your license card above.</p>
            </div>
          </div>
          <div className="step">
            <div className="step-number">3</div>
            <div className="step-content">
              <h3>Activate</h3>
              <p>Open the HTML file and paste your license key when prompted.</p>
            </div>
          </div>
        </div>
      </section>

      <style>{`
        .portal-downloads {
          max-width: 1000px;
          margin: 0 auto;
          padding: 2rem;
        }

        .portal-downloads.loading,
        .portal-downloads.error {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 50vh;
          text-align: center;
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

        .error-banner {
          background: #fef2f2;
          color: #dc2626;
          padding: 1rem;
          border-radius: 8px;
          margin-bottom: 2rem;
        }

        .licenses-section,
        .downloads-section,
        .help-section {
          margin-bottom: 3rem;
        }

        .section-description {
          color: var(--color-text-secondary, #6b7280);
          margin-bottom: 1.5rem;
        }

        .loading-placeholder,
        .empty-state {
          padding: 2rem;
          text-align: center;
          background: var(--color-surface, #f9fafb);
          border-radius: 12px;
        }

        .licenses-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 1.5rem;
        }

        .license-card {
          background: white;
          border: 1px solid var(--color-border, #e5e7eb);
          border-radius: 12px;
          padding: 1.5rem;
        }

        .license-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        }

        .license-header h3 {
          margin: 0;
          font-size: 1.125rem;
        }

        .tier-badge {
          padding: 0.25rem 0.75rem;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
        }

        .tier-lifetime {
          background: #fef3c7;
          color: #92400e;
        }

        .tier-pro {
          background: #dbeafe;
          color: #1e40af;
        }

        .tier-standard {
          background: #f3f4f6;
          color: #374151;
        }

        .license-details {
          margin-bottom: 1rem;
        }

        .detail-row {
          display: flex;
          justify-content: space-between;
          padding: 0.5rem 0;
          border-bottom: 1px solid var(--color-border, #e5e7eb);
        }

        .detail-row:last-child {
          border-bottom: none;
        }

        .label {
          color: var(--color-text-secondary, #6b7280);
        }

        .downloads-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 1.5rem;
        }

        .download-card {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1.5rem;
          background: white;
          border: 1px solid var(--color-border, #e5e7eb);
          border-radius: 12px;
        }

        .download-card.locked {
          opacity: 0.6;
        }

        .download-icon {
          font-size: 2.5rem;
        }

        .download-info {
          flex: 1;
        }

        .download-info h3 {
          margin: 0 0 0.25rem;
        }

        .download-meta {
          font-size: 0.875rem;
          color: var(--color-text-secondary, #6b7280);
          margin: 0;
        }

        .help-steps {
          display: flex;
          gap: 2rem;
        }

        .step {
          flex: 1;
          display: flex;
          gap: 1rem;
        }

        .step-number {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: var(--color-primary, #6366f1);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          flex-shrink: 0;
        }

        .step-content h3 {
          margin: 0 0 0.25rem;
          font-size: 1rem;
        }

        .step-content p {
          margin: 0;
          color: var(--color-text-secondary, #6b7280);
          font-size: 0.875rem;
        }

        .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0.5rem 1rem;
          border-radius: 8px;
          font-weight: 500;
          text-decoration: none;
          cursor: pointer;
          transition: all 0.2s;
          border: none;
        }

        .btn-primary {
          background: var(--color-primary, #6366f1);
          color: white;
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
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        @media (max-width: 768px) {
          .help-steps {
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  )
}
