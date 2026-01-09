import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { SignedIn, SignedOut, useUser } from '@clerk/clerk-react'
import { useSubscription } from '../hooks/useSubscription'
import { analytics } from '../lib/analytics'
import styles from './Home.module.css'

const PRICE_IDS = {
  monthly: import.meta.env.VITE_STRIPE_PRICE_PRO_MONTHLY,
  annual: import.meta.env.VITE_STRIPE_PRICE_PRO_ANNUAL,
  founding: import.meta.env.VITE_STRIPE_PRICE_FOUNDING,
}

export default function Home() {
  const { isSignedIn } = useUser()
  const { subscription, checkout } = useSubscription()
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)

  const handleCheckout = async (priceId: string, planName: string) => {
    if (!isSignedIn) {
      window.location.href = '/sign-up'
      return
    }

    try {
      setCheckoutLoading(planName)
      analytics.checkoutStarted(planName)
      await checkout(priceId)
    } catch (error) {
      console.error('Checkout error:', error)
      alert('Failed to start checkout. Please try again.')
    } finally {
      setCheckoutLoading(null)
    }
  }

  const hasActiveSubscription = subscription?.hasActiveSubscription || false

  // Track when pricing section comes into view
  const pricingRef = useRef<HTMLElement>(null)
  const pricingTracked = useRef(false)

  useEffect(() => {
    const pricingSection = pricingRef.current
    if (!pricingSection) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !pricingTracked.current) {
          pricingTracked.current = true
          analytics.pricingViewed()
        }
      },
      { threshold: 0.5 }
    )

    observer.observe(pricingSection)
    return () => observer.disconnect()
  }, [])

  return (
    <div className={styles.home}>
      {/* Hero Section */}
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <h1 className={styles.heroTitle}>
            Create stunning videos<br />
            <span className={styles.gradient}>entirely in your browser</span>
          </h1>
          <p className={styles.heroSubtitle}>
            Record, edit, and export professional videos with no uploads,
            no subscriptions to cloud services, and complete privacy.
            Everything runs locally on your device.
          </p>
          <div className={styles.heroCta}>
            <SignedOut>
              <Link to="/sign-up">
                <button className="primary">Start Free Trial</button>
              </Link>
              <Link to="/sign-in">
                <button>Sign In</button>
              </Link>
            </SignedOut>
            <SignedIn>
              <Link to="/dashboard">
                <button className="primary">Go to Dashboard</button>
              </Link>
            </SignedIn>
          </div>
        </div>
      </section>

      {/* Tools Section */}
      <section className={styles.tools}>
        <h2 className={styles.sectionTitle}>The Complete Video Creation Suite</h2>
        <div className={styles.toolsGrid}>
          <div className={styles.toolCard}>
            <div className={styles.toolIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="4" fill="currentColor" />
              </svg>
            </div>
            <h3>ESCAPECRAFT</h3>
            <p>
              Record your screen, webcam, and audio with picture-in-picture support.
              Perfect for tutorials, demos, and presentations.
            </p>
            <ul className={styles.featureList}>
              <li>Screen & webcam capture</li>
              <li>System & microphone audio</li>
              <li>Picture-in-Picture mode</li>
              <li>Instant local saving</li>
            </ul>
          </div>

          <div className={styles.toolCard}>
            <div className={styles.toolIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </div>
            <h3>ESCAPEARTIST</h3>
            <p>
              Edit videos with a professional timeline editor. Add overlays,
              animations, and export to multiple formats.
            </p>
            <ul className={styles.featureList}>
              <li>Multi-track timeline</li>
              <li>Keyframe animations</li>
              <li>Shape & blur overlays</li>
              <li>MP4 & WebM export</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className={styles.features}>
        <h2 className={styles.sectionTitle}>Why ESCAPE Suite?</h2>
        <div className={styles.featuresGrid}>
          <div className={styles.feature}>
            <div className={styles.featureIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <h3>100% Private</h3>
            <p>Your videos never leave your device. No cloud uploads, no data collection.</p>
          </div>

          <div className={styles.feature}>
            <div className={styles.featureIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <h3>Lightning Fast</h3>
            <p>No upload wait times. Edit and export at full speed using your local hardware.</p>
          </div>

          <div className={styles.feature}>
            <div className={styles.featureIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
            </div>
            <h3>Works Offline</h3>
            <p>Once loaded, works without internet. Perfect for travel or restricted networks.</p>
          </div>

          <div className={styles.feature}>
            <div className={styles.featureIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            </div>
            <h3>No Installation</h3>
            <p>Runs entirely in your browser. No downloads, no plugins, no hassle.</p>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className={styles.pricing} ref={pricingRef}>
        <h2 className={styles.sectionTitle}>Simple, Transparent Pricing</h2>
        <div className={styles.pricingGrid}>
          <div className={styles.pricingCard}>
            <h3>Free Trial</h3>
            <div className={styles.price}>
              <span className={styles.amount}>$0</span>
              <span className={styles.period}>14 days</span>
            </div>
            <ul className={styles.pricingFeatures}>
              <li>Full access to all tools</li>
              <li>Watermark on exports</li>
              <li>No credit card required</li>
            </ul>
            <SignedOut>
              <Link to="/sign-up">
                <button>Start Trial</button>
              </Link>
            </SignedOut>
            <SignedIn>
              <Link to="/dashboard">
                <button>Go to Dashboard</button>
              </Link>
            </SignedIn>
          </div>

          <div className={`${styles.pricingCard} ${styles.featured}`}>
            <div className={styles.badge}>Most Popular</div>
            <h3>Pro Annual</h3>
            <div className={styles.price}>
              <span className={styles.amount}>$79</span>
              <span className={styles.period}>per year</span>
            </div>
            <p className={styles.savings}>Save $29 vs monthly</p>
            <ul className={styles.pricingFeatures}>
              <li>Full access to all tools</li>
              <li>No watermark</li>
              <li>All future updates</li>
              <li>Priority support</li>
            </ul>
            <SignedOut>
              <Link to="/sign-up">
                <button className="primary">Get Started</button>
              </Link>
            </SignedOut>
            <SignedIn>
              {hasActiveSubscription ? (
                <Link to="/dashboard">
                  <button className="primary">Go to Dashboard</button>
                </Link>
              ) : (
                <button
                  className="primary"
                  onClick={() => handleCheckout(PRICE_IDS.annual, 'annual')}
                  disabled={checkoutLoading !== null}
                >
                  {checkoutLoading === 'annual' ? 'Loading...' : 'Upgrade Now'}
                </button>
              )}
            </SignedIn>
          </div>

          <div className={styles.pricingCard}>
            <h3>Pro Monthly</h3>
            <div className={styles.price}>
              <span className={styles.amount}>$9</span>
              <span className={styles.period}>per month</span>
            </div>
            <ul className={styles.pricingFeatures}>
              <li>Full access to all tools</li>
              <li>No watermark</li>
              <li>Cancel anytime</li>
            </ul>
            <SignedOut>
              <Link to="/sign-up">
                <button>Get Started</button>
              </Link>
            </SignedOut>
            <SignedIn>
              {hasActiveSubscription ? (
                <Link to="/dashboard">
                  <button>Go to Dashboard</button>
                </Link>
              ) : (
                <button
                  onClick={() => handleCheckout(PRICE_IDS.monthly, 'monthly')}
                  disabled={checkoutLoading !== null}
                >
                  {checkoutLoading === 'monthly' ? 'Loading...' : 'Upgrade Now'}
                </button>
              )}
            </SignedIn>
          </div>
        </div>

        {/* Founding Member Card */}
        <div className={styles.foundingMember}>
          <div className={styles.foundingContent}>
            <div className={styles.foundingBadge}>Limited Time</div>
            <h3>Founding Member</h3>
            <p>Get lifetime access for a one-time payment. Limited to the first 100 supporters.</p>
            <div className={styles.foundingPrice}>
              <span className={styles.amount}>$149</span>
              <span className={styles.period}>one-time</span>
            </div>
          </div>
          <SignedOut>
            <Link to="/sign-up">
              <button className="primary">Become a Founder</button>
            </Link>
          </SignedOut>
          <SignedIn>
            {hasActiveSubscription && subscription?.plan === 'founding_member' ? (
              <button disabled>You're a Founding Member!</button>
            ) : hasActiveSubscription ? (
              <Link to="/dashboard">
                <button>Go to Dashboard</button>
              </Link>
            ) : (
              <button
                className="primary"
                onClick={() => handleCheckout(PRICE_IDS.founding, 'founding')}
                disabled={checkoutLoading !== null}
              >
                {checkoutLoading === 'founding' ? 'Loading...' : 'Become a Founder'}
              </button>
            )}
          </SignedIn>
        </div>
      </section>

      {/* CTA Section */}
      <section className={styles.cta}>
        <h2>Ready to create amazing videos?</h2>
        <p>Start your free 14-day trial today. No credit card required.</p>
        <SignedOut>
          <Link to="/sign-up">
            <button className="primary">Start Free Trial</button>
          </Link>
        </SignedOut>
        <SignedIn>
          <Link to="/dashboard">
            <button className="primary">Go to Dashboard</button>
          </Link>
        </SignedIn>
      </section>
    </div>
  )
}
