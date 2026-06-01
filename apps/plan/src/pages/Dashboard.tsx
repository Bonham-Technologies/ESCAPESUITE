import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useUser } from '../lib/auth'
import { useSubscription } from '../hooks/useSubscription'
import { getPlanDisplayName } from '../lib/subscription'
import { analytics } from '../lib/analytics'
import { CheckoutModal } from '../components/Checkout'
import { supabase } from '../lib/supabase'
import styles from './Dashboard.module.css'

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

type DashboardTab = 'overview' | 'downloads'

export default function Dashboard() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, isLoaded } = useUser()
  const { subscription, isLoading, checkout, openPortal, refetch } = useSubscription()
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [checkoutClientSecret, setCheckoutClientSecret] = useState<string | null>(null)

  // Active tab is driven by ?tab= so links/redirects can deep-link.
  const activeTab: DashboardTab = searchParams.get('tab') === 'downloads' ? 'downloads' : 'overview'

  // --- Downloads / Licenses state (ported from the old Portal/Downloads page) ---
  const [licenses, setLicenses] = useState<LicenseRecord[]>([])
  const [licensesLoading, setLicensesLoading] = useState(true)
  const [licensesError, setLicensesError] = useState<string | null>(null)
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

      setLicensesLoading(true)
      setLicensesError(null)

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
        setLicensesError(err instanceof Error ? err.message : 'Failed to load licenses')
      } finally {
        setLicensesLoading(false)
      }
    }

    fetchLicenses()
  }, [user?.id, isLoaded])

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
    setLicensesError(null)

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
      setLicensesError(err instanceof Error ? err.message : 'Failed to download pre-licensed file')
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
        return styles.tierLifetime
      case 'pro':
        return styles.tierPro
      default:
        return styles.tierStandard
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

  // Handle checkout completion
  const handleCheckoutComplete = async () => {
    setCheckoutClientSecret(null)
    await refetch()
    navigate('/dashboard?success=true')
  }

  const handleUpgrade = async () => {
    // Wait for user to be fully loaded
    if (!isLoaded || !user?.id) {
      alert('Please wait for authentication to complete.')
      return
    }

    try {
      setActionLoading('upgrade')
      const clientSecret = await checkout('annual')
      setCheckoutClientSecret(clientSecret)
    } catch (error) {
      console.error('Upgrade error:', error)
      alert('Failed to start checkout. Please try again.')
    } finally {
      setActionLoading(null)
    }
  }

  const handleManageSubscription = async () => {
    try {
      setActionLoading('manage')
      await openPortal()
    } catch (error) {
      console.error('Portal error:', error)
      alert('Failed to open subscription management. Please try again.')
    } finally {
      setActionLoading(null)
    }
  }

  const tools = [
    {
      id: 'craft',
      name: 'ESCAPECRAFT',
      description: 'Record screen, webcam, and audio with ease',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="4" fill="currentColor" />
        </svg>
      ),
      url: '/craft/',
      color: '#ef4444',
    },
    {
      id: 'artist',
      name: 'ESCAPEARTIST',
      description: 'Edit videos with a professional timeline editor',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      ),
      url: '/artist/',
      color: '#6366f1',
    },
  ]

  const handleLaunchTool = (url: string, toolId: 'craft' | 'artist') => {
    analytics.toolLaunched(toolId)

    // In production, these will be on the same domain
    // For development, they're separate ports
    if (import.meta.env.DEV) {
      // Development URLs
      const devUrls: Record<string, string> = {
        '/craft/': 'http://localhost:5174',
        '/artist/': 'http://localhost:5175',
      }
      window.open(devUrls[url] || url, '_blank')
    } else {
      window.location.assign(url)
    }
  }

  return (
    <div className={styles.dashboard}>
      <div className={styles.container}>
        {/* Welcome Section */}
        <section className={styles.welcome}>
          <h1>Welcome back, {user?.firstName || 'Creator'}!</h1>
          <p>Select a tool to get started</p>
        </section>

        {/* Tab Switcher */}
        <div className={styles.tabs} role="tablist" aria-label="Dashboard sections">
          <Link
            to="/dashboard"
            role="tab"
            aria-selected={activeTab === 'overview'}
            className={`${styles.tab} ${activeTab === 'overview' ? styles.tabActive : ''}`}
          >
            Overview
          </Link>
          <Link
            to="/dashboard?tab=downloads"
            role="tab"
            aria-selected={activeTab === 'downloads'}
            className={`${styles.tab} ${activeTab === 'downloads' ? styles.tabActive : ''}`}
          >
            Downloads &amp; Licenses
          </Link>
        </div>

        {activeTab === 'overview' && (
          <>
            {/* Tools Grid */}
            <section className={styles.toolsSection}>
              <h2>Your Tools</h2>
              <div className={styles.toolsGrid}>
                {tools.map((tool) => (
                  <button
                    key={tool.id}
                    className={styles.toolCard}
                    onClick={() => handleLaunchTool(tool.url, tool.id as 'craft' | 'artist')}
                    style={{ '--tool-color': tool.color } as React.CSSProperties}
                    aria-label={`Launch ${tool.name} - ${tool.description}`}
                  >
                    <div className={styles.toolIcon} aria-hidden="true">{tool.icon}</div>
                    <div className={styles.toolInfo}>
                      <h3>{tool.name}</h3>
                      <p>{tool.description}</p>
                    </div>
                    <div className={styles.toolArrow} aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            {/* Subscription Status */}
            <section className={styles.subscriptionSection}>
              <h2>Subscription</h2>
              <div className={styles.subscriptionCard}>
                <div className={styles.subscriptionInfo}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0 }}>{isLoading ? 'Loading...' : getPlanDisplayName(subscription?.plan || 'trial')}</h3>
                    {subscription?.status === 'trialing' && !isLoading && (
                      <span
                        style={{
                          background: 'rgba(99,102,241,0.15)',
                          color: '#818cf8',
                          border: '1px solid rgba(99,102,241,0.35)',
                          borderRadius: '999px',
                          padding: '0.2rem 0.7rem',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                        }}
                      >
                        {subscription.trialDaysRemaining} {subscription.trialDaysRemaining === 1 ? 'day' : 'days'} left in trial
                      </span>
                    )}
                  </div>
                  {subscription?.status === 'trialing' && (
                    <p>You're on a free trial. Exports will have a watermark until you upgrade.</p>
                  )}
                  {subscription?.status === 'active' && (
                    <p>Your Pro subscription is active. Enjoy watermark-free exports!</p>
                  )}
                  {subscription?.status === 'expired' && (
                    <p>Your trial has expired. Upgrade to Pro to continue using all features without watermarks.</p>
                  )}
                  {subscription?.status === 'canceled' && (
                    <p>Your subscription has been canceled. You have access until the end of your billing period.</p>
                  )}
                </div>
                {(subscription?.status === 'trialing' || subscription?.status === 'expired') && (
                  <button
                    className="primary"
                    onClick={handleUpgrade}
                    disabled={actionLoading !== null}
                    aria-label={actionLoading === 'upgrade' ? 'Loading checkout...' : 'Upgrade to Pro subscription'}
                  >
                    {actionLoading === 'upgrade' ? 'Loading...' : 'Upgrade to Pro'}
                  </button>
                )}
                {(subscription?.status === 'active' || subscription?.status === 'canceled') && (
                  <button
                    onClick={handleManageSubscription}
                    disabled={actionLoading !== null}
                    aria-label={actionLoading === 'manage' ? 'Loading subscription portal...' : 'Manage your subscription'}
                  >
                    {actionLoading === 'manage' ? 'Loading...' : 'Manage Subscription'}
                  </button>
                )}
              </div>
            </section>

            {/* Quick Links */}
            <section className={styles.quickLinks}>
              <h2>Quick Links</h2>
              <div className={styles.linksGrid}>
                <Link to="/pricing" className={styles.linkCard} aria-label="View pricing plans">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <line x1="12" y1="1" x2="12" y2="23" />
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                  <span>View Pricing</span>
                </Link>
                <Link to="/dashboard?tab=downloads" className={styles.linkCard} aria-label="View downloads and licenses">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span>Downloads &amp; Licenses</span>
                </Link>
              </div>
            </section>
          </>
        )}

        {activeTab === 'downloads' && (
          <>
            {licensesError && (
              <div className={styles.errorBanner}>
                <p>{licensesError}</p>
              </div>
            )}

            <section className={styles.licensesSection}>
              <h2>Your Licenses</h2>
              {licensesLoading ? (
                <div className={styles.loadingPlaceholder}>
                  <div className={styles.spinner} />
                  <p>Loading licenses...</p>
                </div>
              ) : licenses.length === 0 ? (
                <div className={styles.emptyState}>
                  <p>You don't have any standalone licenses yet.</p>
                  <Link to="/pricing" className={`${styles.btn} ${styles.btnPrimary}`}>
                    Purchase a License
                  </Link>
                </div>
              ) : (
                <div className={styles.licensesGrid}>
                  {licenses.map((license) => (
                    <div key={license.id} className={styles.licenseCard}>
                      <div className={styles.licenseHeader}>
                        <h3>{getProductDisplayName(license.product)}</h3>
                        <span className={`${styles.tierBadge} ${getTierBadgeClass(license.tier)}`}>
                          {license.tier}
                        </span>
                      </div>
                      <div className={styles.licenseDetails}>
                        <div className={styles.detailRow}>
                          <span className={styles.label}>Seats:</span>
                          <span className={styles.value}>{license.seat_count}</span>
                        </div>
                        <div className={styles.detailRow}>
                          <span className={styles.label}>Issued:</span>
                          <span className={styles.value}>
                            {new Date(license.issued_at).toLocaleDateString()}
                          </span>
                        </div>
                        <div className={styles.detailRow}>
                          <span className={styles.label}>Expires:</span>
                          <span className={styles.value}>
                            {license.expires_at
                              ? new Date(license.expires_at).toLocaleDateString()
                              : 'Never'}
                          </span>
                        </div>
                      </div>
                      <button
                        className={`${styles.btn} ${styles.btnSecondary}`}
                        onClick={() => copyLicenseKey(license.id)}
                      >
                        {copiedId === license.id ? 'Copied!' : 'Copy License Key'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className={styles.downloadsSection}>
              <h2>Standalone Downloads</h2>
              <p className={styles.sectionDescription}>
                Download standalone versions that work offline without an internet connection.
              </p>
              <div className={styles.downloadsGrid}>
                {downloads.map((download) => {
                  const hasLicense = canDownload(download.product)
                  const license = getLicenseForProduct(download.product)
                  const currentlyDownloading = isDownloading(download.product)
                  return (
                    <div
                      key={`${download.product}-${download.platform}`}
                      className={`${styles.downloadCard} ${!hasLicense ? styles.locked : ''}`}
                    >
                      <div className={styles.downloadIcon}>
                        {download.product === 'craft' ? '🎥' : '🎬'}
                      </div>
                      <div className={styles.downloadInfo}>
                        <h3>
                          {download.product === 'craft' ? 'ESCAPECRAFT' : 'ESCAPEARTIST'}
                        </h3>
                        <p className={styles.downloadMeta}>
                          v{download.version} | {download.platform} | {download.fileSize}
                        </p>
                      </div>
                      {hasLicense && license ? (
                        <div className={styles.downloadActions}>
                          <button
                            className={`${styles.btn} ${styles.btnPrimary}`}
                            onClick={() => downloadPreLicensed(license.id, download.product)}
                            disabled={currentlyDownloading}
                          >
                            {currentlyDownloading ? 'Preparing...' : 'Download (Pre-Licensed)'}
                          </button>
                          <a
                            href={download.downloadUrl}
                            className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
                            download={download.fileName}
                            title="Download generic version (requires license key entry)"
                          >
                            Generic
                          </a>
                        </div>
                      ) : (
                        <Link to="/pricing" className={`${styles.btn} ${styles.btnSecondary}`}>
                          Purchase License
                        </Link>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>

            <section className={styles.helpSection}>
              <h2>Getting Started</h2>
              <div className={styles.helpOptions}>
                <div className={`${styles.helpOption} ${styles.recommended}`}>
                  <h3>Option A: Pre-Licensed Download (Recommended)</h3>
                  <div className={styles.helpSteps}>
                    <div className={styles.step}>
                      <div className={styles.stepNumber}>1</div>
                      <div className={styles.stepContent}>
                        <h4>Download Pre-Licensed</h4>
                        <p>Click "Download (Pre-Licensed)" - your license is embedded automatically.</p>
                      </div>
                    </div>
                    <div className={styles.step}>
                      <div className={styles.stepNumber}>2</div>
                      <div className={styles.stepContent}>
                        <h4>Open &amp; Use</h4>
                        <p>Open the HTML file and start using the app immediately.</p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className={styles.helpOption}>
                  <h3>Option B: Generic Download</h3>
                  <div className={styles.helpSteps}>
                    <div className={styles.step}>
                      <div className={styles.stepNumber}>1</div>
                      <div className={styles.stepContent}>
                        <h4>Download Generic</h4>
                        <p>Click "Generic" to download the unlicensed version.</p>
                      </div>
                    </div>
                    <div className={styles.step}>
                      <div className={styles.stepNumber}>2</div>
                      <div className={styles.stepContent}>
                        <h4>Copy License Key</h4>
                        <p>Click "Copy License Key" on your license card above.</p>
                      </div>
                    </div>
                    <div className={styles.step}>
                      <div className={styles.stepNumber}>3</div>
                      <div className={styles.stepContent}>
                        <h4>Activate</h4>
                        <p>Open the HTML file and paste your license key when prompted.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}
      </div>

      {/* Embedded Checkout Modal */}
      {checkoutClientSecret && (
        <CheckoutModal
          clientSecret={checkoutClientSecret}
          onClose={() => setCheckoutClientSecret(null)}
          onComplete={handleCheckoutComplete}
        />
      )}
    </div>
  )
}
