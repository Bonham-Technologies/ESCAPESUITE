import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useUser } from '../../lib/auth'
import { supabase } from '../../lib/supabase'

// Get Supabase URL from environment
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''

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

type DownloadingState = {
  licenseId: string
  product: 'craft' | 'artist'
} | null

interface DownloadInfo {
  product: 'craft' | 'artist'
  version: string
  platform: string
  fileName: string
  fileSize: string
  downloadUrl: string
}

interface VersionInfo {
  craft: { version: string; fileSize: string }
  artist: { version: string; fileSize: string }
}

// Build Supabase Storage public URL
function getStorageUrl(fileName: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/downloads/${fileName}`
}

export default function Downloads() {
  const { user, isLoaded } = useUser()
  const [licenses, setLicenses] = useState<LicenseRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<DownloadingState>(null)
  const [versionInfo, setVersionInfo] = useState<VersionInfo>({
    craft: { version: '1.1.1', fileSize: '~800 KB' },
    artist: { version: '1.1.1', fileSize: '~1.1 MB' },
  })

  // Fetch version info from storage (version.json)
  useEffect(() => {
    async function fetchVersionInfo() {
      try {
        const response = await fetch(getStorageUrl('version.json'))
        if (response.ok) {
          const data = await response.json()
          setVersionInfo(data)
        }
      } catch {
        // Use defaults if version.json isn't available
        console.debug('version.json not available, using defaults')
      }
    }
    fetchVersionInfo()
  }, [])

  // Build downloads list from version info
  const downloads: DownloadInfo[] = [
    {
      product: 'craft',
      version: versionInfo.craft.version,
      platform: 'All Platforms',
      fileName: 'ESCAPECRAFT-latest.html',
      fileSize: versionInfo.craft.fileSize,
      downloadUrl: getStorageUrl('ESCAPECRAFT-latest.html'),
    },
    {
      product: 'artist',
      version: versionInfo.artist.version,
      platform: 'All Platforms',
      fileName: 'ESCAPEARTIST-latest.html',
      fileSize: versionInfo.artist.fileSize,
      downloadUrl: getStorageUrl('ESCAPEARTIST-latest.html'),
    },
  ]

  useEffect(() => {
    if (!isLoaded || !user) return

    async function fetchLicenses() {
      if (!user) return

      setLoading(true)
      setError(null)

      try {
        // Direct query — RLS scopes licenses to the signed-in user.
        const { data, error } = await supabase
          .from('licenses')
          .select('id, product, tier, seat_count, issued_at, expires_at, metadata')
          .is('revoked_at', null)
          .order('issued_at', { ascending: false })

        if (error) throw error

        setLicenses((data ?? []) as LicenseRecord[])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load licenses')
      } finally {
        setLoading(false)
      }
    }

    fetchLicenses()
  }, [user, isLoaded])

  const copyLicenseKey = async (licenseId: string) => {
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

  const downloadPreLicensed = useCallback(async (licenseId: string, product: 'craft' | 'artist') => {
    if (!user) return

    setDownloading({ licenseId, product })
    setError(null)

    try {
      const response = await supabase.functions.invoke('get-licensed-download', {
        body: { licenseId, clerkUserId: user.id, product },
      })

      if (response.error) throw response.error

      // The response data is the HTML content
      // We need to trigger a download
      const blob = new Blob([response.data], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const productName = product === 'craft' ? 'ESCAPECRAFT' : 'ESCAPEARTIST'
      a.download = `${productName}-licensed.html`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download pre-licensed file')
    } finally {
      setDownloading(null)
    }
  }, [user])

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

  const getLicenseForProduct = (product: 'craft' | 'artist'): LicenseRecord | undefined => {
    // Prefer exact product match, then suite
    return licenses.find((l) => l.product === product) ||
           licenses.find((l) => l.product === 'suite')
  }

  const isDownloading = (product: 'craft' | 'artist') => {
    return downloading?.product === product
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
            const license = getLicenseForProduct(download.product)
            const currentlyDownloading = isDownloading(download.product)
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
                {hasLicense && license ? (
                  <div className="download-actions">
                    <button
                      className="btn btn-primary"
                      onClick={() => downloadPreLicensed(license.id, download.product)}
                      disabled={currentlyDownloading}
                    >
                      {currentlyDownloading ? 'Preparing...' : 'Download (Pre-Licensed)'}
                    </button>
                    <a
                      href={download.downloadUrl}
                      className="btn btn-secondary btn-small"
                      download={download.fileName}
                      title="Download generic version (requires license key entry)"
                    >
                      Generic
                    </a>
                  </div>
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
        <div className="help-options">
          <div className="help-option recommended">
            <h3>Option A: Pre-Licensed Download (Recommended)</h3>
            <div className="help-steps">
              <div className="step">
                <div className="step-number">1</div>
                <div className="step-content">
                  <h4>Download Pre-Licensed</h4>
                  <p>Click "Download (Pre-Licensed)" - your license is embedded automatically.</p>
                </div>
              </div>
              <div className="step">
                <div className="step-number">2</div>
                <div className="step-content">
                  <h4>Open & Use</h4>
                  <p>Open the HTML file and start using the app immediately.</p>
                </div>
              </div>
            </div>
          </div>
          <div className="help-option">
            <h3>Option B: Generic Download</h3>
            <div className="help-steps">
              <div className="step">
                <div className="step-number">1</div>
                <div className="step-content">
                  <h4>Download Generic</h4>
                  <p>Click "Generic" to download the unlicensed version.</p>
                </div>
              </div>
              <div className="step">
                <div className="step-number">2</div>
                <div className="step-content">
                  <h4>Copy License Key</h4>
                  <p>Click "Copy License Key" on your license card above.</p>
                </div>
              </div>
              <div className="step">
                <div className="step-number">3</div>
                <div className="step-content">
                  <h4>Activate</h4>
                  <p>Open the HTML file and paste your license key when prompted.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <style>{`
        .portal-downloads {
          max-width: 1000px;
          margin: 0 auto;
          padding: 2rem;
          color: var(--text-primary);
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

        .error-banner {
          background: var(--error-bg, #fef2f2);
          color: var(--error-text, #dc2626);
          padding: 1rem;
          border-radius: 8px;
          margin-bottom: 2rem;
        }

        .licenses-section,
        .downloads-section,
        .help-section {
          margin-bottom: 3rem;
        }

        .licenses-section h2,
        .downloads-section h2,
        .help-section h2 {
          color: var(--text-primary);
        }

        .section-description {
          color: var(--text-secondary);
          margin-bottom: 1.5rem;
        }

        .loading-placeholder,
        .empty-state {
          padding: 2rem;
          text-align: center;
          background: var(--bg-secondary);
          border-radius: 12px;
          color: var(--text-secondary);
        }

        .licenses-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 1.5rem;
        }

        .license-card {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
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
          color: var(--text-primary);
        }

        .tier-badge {
          padding: 0.25rem 0.75rem;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
        }

        .tier-lifetime {
          background: var(--badge-gold-bg, #fef3c7);
          color: var(--badge-gold-text, #92400e);
        }

        .tier-pro {
          background: var(--badge-blue-bg, #dbeafe);
          color: var(--badge-blue-text, #1e40af);
        }

        .tier-standard {
          background: var(--bg-tertiary);
          color: var(--text-secondary);
        }

        .license-details {
          margin-bottom: 1rem;
        }

        .detail-row {
          display: flex;
          justify-content: space-between;
          padding: 0.5rem 0;
          border-bottom: 1px solid var(--border-color);
        }

        .detail-row:last-child {
          border-bottom: none;
        }

        .label {
          color: var(--text-secondary);
        }

        .value {
          color: var(--text-primary);
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
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
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
          color: var(--text-primary);
        }

        .download-meta {
          font-size: 0.875rem;
          color: var(--text-secondary);
          margin: 0;
        }

        .download-actions {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .btn-small {
          padding: 0.375rem 0.75rem;
          font-size: 0.75rem;
        }

        .help-options {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 1.5rem;
        }

        .help-option {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          padding: 1.5rem;
        }

        .help-option.recommended {
          border-color: var(--color-primary, #6366f1);
          background: color-mix(in srgb, var(--color-primary, #6366f1) 5%, var(--bg-secondary));
        }

        .help-option h3 {
          margin: 0 0 1rem;
          font-size: 1rem;
          color: var(--text-primary);
        }

        .help-option .help-steps {
          flex-direction: column;
          gap: 1rem;
        }

        .help-option .step-content h4 {
          margin: 0 0 0.25rem;
          font-size: 0.875rem;
          color: var(--text-primary);
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
          color: var(--text-primary);
        }

        .step-content p {
          margin: 0;
          color: var(--text-secondary);
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
          background: var(--bg-tertiary);
          color: var(--text-primary);
          border: 1px solid var(--border-color);
        }

        .btn-secondary:hover {
          background: var(--bg-secondary);
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

        @media (max-width: 768px) {
          .help-steps {
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  )
}
