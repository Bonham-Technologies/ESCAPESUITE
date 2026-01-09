import { useState } from 'react'
import { useUser } from '@clerk/clerk-react'
import { useSubscription } from '../hooks/useSubscription'
import { getPlanDisplayName } from '../lib/subscription'
import { analytics } from '../lib/analytics'
import styles from './Dashboard.module.css'

const PRICE_IDS = {
  monthly: import.meta.env.VITE_STRIPE_PRICE_PRO_MONTHLY,
  annual: import.meta.env.VITE_STRIPE_PRICE_PRO_ANNUAL,
}

export default function Dashboard() {
  const { user } = useUser()
  const { subscription, isLoading, checkout, openPortal } = useSubscription()
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const handleUpgrade = async () => {
    try {
      setActionLoading('upgrade')
      await checkout(PRICE_IDS.annual)
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
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
              >
                <div className={styles.toolIcon}>{tool.icon}</div>
                <div className={styles.toolInfo}>
                  <h3>{tool.name}</h3>
                  <p>{tool.description}</p>
                </div>
                <div className={styles.toolArrow}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Quick Stats */}
        <section className={styles.statsSection}>
          <h2>Quick Stats</h2>
          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <div className={styles.statValue}>--</div>
              <div className={styles.statLabel}>Recordings</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statValue}>--</div>
              <div className={styles.statLabel}>Projects</div>
            </div>
            {subscription?.status === 'trialing' && (
              <div className={styles.statCard}>
                <div className={styles.statValue}>
                  {isLoading ? '--' : subscription.trialDaysRemaining}
                </div>
                <div className={styles.statLabel}>Days Left in Trial</div>
              </div>
            )}
          </div>
          <p className={styles.statsNote}>
            Project stats will be available once you start creating!
          </p>
        </section>

        {/* Subscription Status */}
        <section className={styles.subscriptionSection}>
          <div className={styles.subscriptionCard}>
            <div className={styles.subscriptionInfo}>
              <h3>{isLoading ? 'Loading...' : getPlanDisplayName(subscription?.plan || 'trial')}</h3>
              {subscription?.status === 'trialing' && (
                <p>You're on a free trial with {subscription.trialDaysRemaining} days remaining. Exports will have a watermark.</p>
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
              >
                {actionLoading === 'upgrade' ? 'Loading...' : 'Upgrade to Pro'}
              </button>
            )}
            {(subscription?.status === 'active' || subscription?.status === 'canceled') && (
              <button
                onClick={handleManageSubscription}
                disabled={actionLoading !== null}
              >
                {actionLoading === 'manage' ? 'Loading...' : 'Manage Subscription'}
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
