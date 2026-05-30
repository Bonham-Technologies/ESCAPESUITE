import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { SignedIn, SignedOut } from '../lib/auth'
import { analytics } from '../lib/analytics'
import styles from './Home.module.css'

export default function Home() {
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
        <p className={styles.pricingSubtitle}>
          Choose how you want to use ESCAPE Suite
        </p>

        <div className={styles.pricingOptions}>
          <div className={styles.pricingOption}>
            <div className={styles.optionIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <h3>Individual</h3>
            <p>For solo creators and professionals</p>
            <div className={styles.optionPricing}>
              <span className={styles.startingAt}>Starting at</span>
              <span className={styles.optionPrice}>$9<span>/mo</span></span>
            </div>
            <ul className={styles.optionFeatures}>
              <li>14-day free trial</li>
              <li>No watermark on Pro</li>
              <li>Priority support</li>
            </ul>
          </div>

          <div className={`${styles.pricingOption} ${styles.featured}`}>
            <div className={styles.badge}>Most Flexible</div>
            <div className={styles.optionIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <h3>Teams</h3>
            <p>For teams and organizations</p>
            <div className={styles.optionPricing}>
              <span className={styles.startingAt}>Starting at</span>
              <span className={styles.optionPrice}>$7<span>/seat/mo</span></span>
            </div>
            <ul className={styles.optionFeatures}>
              <li>Centralized billing</li>
              <li>Member management</li>
              <li>SSO/SAML (Enterprise)</li>
            </ul>
          </div>

          <div className={styles.pricingOption}>
            <div className={styles.optionIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <h3>Standalone</h3>
            <p>One-time purchase, works offline</p>
            <div className={styles.optionPricing}>
              <span className={styles.startingAt}>Starting at</span>
              <span className={styles.optionPrice}>$49<span> once</span></span>
            </div>
            <ul className={styles.optionFeatures}>
              <li>No subscription required</li>
              <li>Works completely offline</li>
              <li>Single HTML file</li>
            </ul>
          </div>
        </div>

        <div className={styles.pricingCta}>
          <Link to="/pricing">
            <button className="primary">View All Pricing Options</button>
          </Link>
          <SignedOut>
            <Link to="/sign-up">
              <button>Start Free Trial</button>
            </Link>
          </SignedOut>
          <SignedIn>
            <Link to="/dashboard">
              <button>Go to Dashboard</button>
            </Link>
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
