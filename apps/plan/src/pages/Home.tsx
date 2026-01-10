import { useState, useEffect, useRef, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { SignedIn, SignedOut, useUser } from '@clerk/clerk-react'
import { useSubscription } from '../hooks/useSubscription'
import { analytics } from '../lib/analytics'
import { functionsUrl, supabaseAnonKey } from '../lib/supabase'
import styles from './Home.module.css'

const PRICE_IDS = {
  monthly: import.meta.env.VITE_STRIPE_PRICE_PRO_MONTHLY,
  annual: import.meta.env.VITE_STRIPE_PRICE_PRO_ANNUAL,
  founding: import.meta.env.VITE_STRIPE_PRICE_FOUNDING,
}

interface EnterpriseFormData {
  name: string
  email: string
  company: string
  message: string
}

export default function Home() {
  const { isSignedIn } = useUser()
  const { subscription, checkout } = useSubscription()
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
  const [enterpriseForm, setEnterpriseForm] = useState<EnterpriseFormData>({
    name: '',
    email: '',
    company: '',
    message: '',
  })
  const [enterpriseSubmitting, setEnterpriseSubmitting] = useState(false)
  const [enterpriseSubmitted, setEnterpriseSubmitted] = useState(false)

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
  const enterpriseRef = useRef<HTMLElement>(null)

  const handleEnterpriseSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setEnterpriseSubmitting(true)

    try {
      // Track the inquiry
      analytics.enterpriseInquiry(enterpriseForm.company)

      // Submit to Edge Function
      const response = await fetch(`${functionsUrl}/enterprise-inquiry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({
          name: enterpriseForm.name,
          email: enterpriseForm.email,
          company: enterpriseForm.company,
          message: enterpriseForm.message,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit inquiry')
      }

      setEnterpriseSubmitted(true)
    } catch (error) {
      console.error('Enterprise form error:', error)
      alert('Failed to submit inquiry. Please try again or email enterprise@escapesuite.io directly.')
    } finally {
      setEnterpriseSubmitting(false)
    }
  }

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

      {/* Enterprise Standalone Section */}
      <section className={styles.enterprise} ref={enterpriseRef}>
        <div className={styles.enterpriseContent}>
          <div className={styles.enterpriseInfo}>
            <div className={styles.enterpriseBadge}>Enterprise</div>
            <h2>Standalone Deployment</h2>
            <p className={styles.enterpriseSubtitle}>
              Deploy ESCAPE Suite on your own infrastructure with no internet required.
              Perfect for air-gapped environments, restricted networks, and organizations
              with strict data sovereignty requirements.
            </p>
            <div className={styles.enterpriseFeatures}>
              <div className={styles.enterpriseFeature}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <div>
                  <h4>Air-Gapped Ready</h4>
                  <p>Single HTML file deployment with no external dependencies</p>
                </div>
              </div>
              <div className={styles.enterpriseFeature}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
                <div>
                  <h4>Unlimited Users</h4>
                  <p>One license covers your entire organization</p>
                </div>
              </div>
              <div className={styles.enterpriseFeature}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <div>
                  <h4>Dedicated Support</h4>
                  <p>Priority support with training and onboarding</p>
                </div>
              </div>
              <div className={styles.enterpriseFeature}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <div>
                  <h4>Complete Privacy</h4>
                  <p>No telemetry, no cloud, complete data control</p>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.enterpriseForm}>
            {enterpriseSubmitted ? (
              <div className={styles.enterpriseSuccess}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <h3>Thank You!</h3>
                <p>Your inquiry has been submitted. We'll be in touch within 1-2 business days.</p>
              </div>
            ) : (
              <>
                <h3>Request a Quote</h3>
                <form onSubmit={handleEnterpriseSubmit}>
                  <div className={styles.formRow}>
                    <input
                      type="text"
                      placeholder="Your Name"
                      value={enterpriseForm.name}
                      onChange={(e) => setEnterpriseForm({ ...enterpriseForm, name: e.target.value })}
                      required
                    />
                    <input
                      type="email"
                      placeholder="Work Email"
                      value={enterpriseForm.email}
                      onChange={(e) => setEnterpriseForm({ ...enterpriseForm, email: e.target.value })}
                      required
                    />
                  </div>
                  <input
                      type="text"
                      placeholder="Company Name"
                      value={enterpriseForm.company}
                      onChange={(e) => setEnterpriseForm({ ...enterpriseForm, company: e.target.value })}
                      required
                    />
                  <textarea
                    placeholder="Tell us about your use case and requirements..."
                    value={enterpriseForm.message}
                    onChange={(e) => setEnterpriseForm({ ...enterpriseForm, message: e.target.value })}
                    rows={4}
                  />
                  <button type="submit" className="primary" disabled={enterpriseSubmitting}>
                    {enterpriseSubmitting ? 'Sending...' : 'Get Custom Quote'}
                  </button>
                </form>
                <p className={styles.enterpriseNote}>
                  $4,999/year includes unlimited users within your organization.
                </p>
              </>
            )}
          </div>
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
