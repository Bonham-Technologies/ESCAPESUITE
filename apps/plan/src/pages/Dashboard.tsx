import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useUser } from '../lib/auth'
import { useSubscription } from '../hooks/useSubscription'
import { useOrganization } from '../hooks/useOrganization'
import { getPlanDisplayName } from '../lib/subscription'
import { analytics } from '../lib/analytics'
import { CheckoutModal } from '../components/Checkout'
import styles from './Dashboard.module.css'

export default function Dashboard() {
  const navigate = useNavigate()
  const { user, isLoaded } = useUser()
  const { subscription, isLoading, checkout, openPortal, refetch } = useSubscription()
  const { organizations, fetchOrganizations, loading: orgsLoading } = useOrganization()
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [checkoutClientSecret, setCheckoutClientSecret] = useState<string | null>(null)

  // Fetch user's organizations on mount
  useEffect(() => {
    if (user?.id) {
      fetchOrganizations()
    }
  }, [user?.id, fetchOrganizations])

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
              {subscription?.status === 'lifetime' && (
                <p>You're a Founding Member with lifetime access. Thank you for your support!</p>
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

        {/* Teams Section */}
        <section className={styles.teamsSection}>
          <div className={styles.teamsSectionHeader}>
            <h2>Your Teams</h2>
            <Link to="/pricing?tab=team">
              <button aria-label="Create a new team">Create Team</button>
            </Link>
          </div>
          {orgsLoading ? (
            <p className={styles.teamsLoading}>Loading teams...</p>
          ) : organizations.length > 0 ? (
            <div className={styles.teamsGrid}>
              {organizations.map((org) => (
                <Link key={org.id} to={`/team/${org.slug}`} className={styles.teamCard} aria-label={`View ${org.name} team dashboard`}>
                  <div className={styles.teamInfo}>
                    <h3>{org.name}</h3>
                    <span className={styles.teamPlan}>
                      {org.plan === 'enterprise' ? 'Enterprise' : 'Team'} Plan
                    </span>
                  </div>
                  <div className={styles.teamArrow} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className={styles.teamsEmpty}>
              <p>You're not part of any teams yet.</p>
              <p className={styles.teamsEmptyHint}>
                Create a team for centralized billing and member management, or wait for an invite.
              </p>
            </div>
          )}
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
            <Link to="/portal/downloads" className={styles.linkCard} aria-label="View downloads and licenses">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Downloads & Licenses</span>
            </Link>
          </div>
        </section>
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
