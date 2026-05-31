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
            How-to videos for networks<br />
            <span className={styles.gradient}>the cloud can't reach.</span>
          </h1>
          <p className={styles.heroSubtitle}>
            ESCAPE Suite records and edits screencasts entirely in the browser. Host one copy on your
            air-gapped or regulated network and your whole team can capture a walkthrough, trim the
            mistakes, blur anything sensitive, and share it with shift workers and remote sites —
            without a single byte leaving the building.
          </p>
          <div className={styles.heroCta}>
            <Link to="/pricing?tab=site">
              <button className="primary">See Site Licensing</button>
            </Link>
            <SignedOut>
              <Link to="/sign-up">
                <button>Try the hosted apps free</button>
              </Link>
            </SignedOut>
            <SignedIn>
              <Link to="/dashboard">
                <button>Go to Dashboard</button>
              </Link>
            </SignedIn>
          </div>
        </div>
      </section>

      {/* Tools Section */}
      <section className={styles.tools}>
        <h2 className={styles.sectionTitle}>Capture it, clean it up, send it out</h2>
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
              One-shot a how-to: record your screen, webcam, and audio — picture-in-picture included.
              Built for tutorials, SOPs, and handoffs between shifts.
            </p>
            <ul className={styles.featureList}>
              <li>Screen &amp; webcam capture</li>
              <li>System &amp; microphone audio</li>
              <li>Picture-in-Picture mode</li>
              <li>Saves locally, instantly</li>
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
              Cut the fumbles, blur a password or PII, add a caption — then export. A real timeline
              editor, no cloud render farm required.
            </p>
            <ul className={styles.featureList}>
              <li>Multi-track timeline</li>
              <li>Blur &amp; redaction overlays</li>
              <li>Keyframe animations</li>
              <li>MP4 &amp; WebM export</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className={styles.features}>
        <h2 className={styles.sectionTitle}>Why teams behind a firewall choose ESCAPE</h2>
        <div className={styles.featuresGrid}>
          <div className={styles.feature}>
            <div className={styles.featureIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <h3>Runs air-gapped</h3>
            <p>100% in-browser, fully offline. Drop the bundle onto your isolated network — no internet, ever.</p>
          </div>

          <div className={styles.feature}>
            <div className={styles.featureIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <h3>One copy, whole org</h3>
            <p>Host a single signed file internally; everyone on your network just opens it and works.</p>
          </div>

          <div className={styles.feature}>
            <div className={styles.featureIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 12l2 2 4-4" />
                <path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c1.66 0 3.21.45 4.54 1.23" />
              </svg>
            </div>
            <h3>Nothing leaves the building</h3>
            <p>No uploads, no accounts for your users, no telemetry. Your footage stays on the device.</p>
          </div>

          <div className={styles.feature}>
            <div className={styles.featureIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            </div>
            <h3>No installers</h3>
            <p>A single HTML file — no plugins, no admin rights, no deployment headaches.</p>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className={styles.pricing} ref={pricingRef}>
        <h2 className={styles.sectionTitle}>One license covers your whole network</h2>
        <p className={styles.pricingSubtitle}>
          Buy a Site License for your organization — or grab the hosted apps if you're flying solo.
        </p>

        <div className={styles.pricingOptions}>
          <div className={`${styles.pricingOption} ${styles.featured}`}>
            <div className={styles.badge}>For organizations</div>
            <div className={styles.optionIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <path d="M9 9h6v6H9z" />
              </svg>
            </div>
            <h3>Site License</h3>
            <p>Host once, license your whole air-gapped network</p>
            <div className={styles.optionPricing}>
              <span className={styles.startingAt}>Starting at</span>
              <span className={styles.optionPrice}>$2,400<span>/yr</span></span>
            </div>
            <ul className={styles.optionFeatures}>
              <li>Both apps, full features, no watermark</li>
              <li>Signed offline bundle, license embedded</li>
              <li>One copy serves everyone</li>
            </ul>
          </div>

          <div className={styles.pricingOption}>
            <div className={styles.optionIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <h3>Individual</h3>
            <p>Hosted apps for solo creators</p>
            <div className={styles.optionPricing}>
              <span className={styles.startingAt}>Starting at</span>
              <span className={styles.optionPrice}>$9<span>/mo</span></span>
            </div>
            <ul className={styles.optionFeatures}>
              <li>7-day free trial</li>
              <li>No watermark on Pro</li>
              <li>Use it at escapesuite.io</li>
            </ul>
          </div>
        </div>

        <div className={styles.pricingCta}>
          <Link to="/pricing?tab=site">
            <button className="primary">View Site Licensing</button>
          </Link>
          <SignedOut>
            <Link to="/sign-up">
              <button>Try the hosted apps free</button>
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
        <h2>Run it on your network</h2>
        <p>License ESCAPE Suite for your network, or try the hosted apps free for 7 days.</p>
        <div className={styles.heroCta}>
          <Link to="/pricing?tab=site">
            <button className="primary">See Site Licensing</button>
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
    </div>
  )
}
