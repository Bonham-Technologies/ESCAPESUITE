import { useState, useRef } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { SignedIn, SignedOut, useUser } from '../../lib/auth'
import { useSubscription } from '../../hooks/useSubscription'
import type { CheckoutPlan } from '../../lib/subscription'
import { analytics } from '../../lib/analytics'
import { supabase } from '../../lib/supabase'
import { CheckoutModal } from '../../components/Checkout'
import styles from './Pricing.module.css'

type PricingTab = 'site' | 'individual'
type Band = 'team' | 'org'

// Whole-network sales contact (founder can repoint this alias).
const CONTACT_EMAIL = 'sales@escapesuite.io'

export default function Pricing() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const initialTab: PricingTab = searchParams.get('tab') === 'individual' ? 'individual' : 'site'

  const { isSignedIn, isLoaded, user } = useUser()
  const { subscription, checkout, refetch } = useSubscription()
  const [activeTab, setActiveTab] = useState<PricingTab>(initialTab)
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
  const [checkoutClientSecret, setCheckoutClientSecret] = useState<string | null>(null)
  // Where to land after the embedded checkout completes.
  const postCheckoutRef = useRef<'downloads' | 'dashboard'>('dashboard')

  const hasActiveSubscription = subscription?.hasActiveSubscription || false

  const handleCheckoutComplete = async () => {
    setCheckoutClientSecret(null)
    await refetch()
    const dest = postCheckoutRef.current
    navigate(dest === 'downloads' ? '/dashboard?tab=downloads&success=true' : '/dashboard?success=true')
  }

  // Site license (annual subscription -> downloadable Suite bundle)
  const handleSiteLicenseCheckout = async (band: Band) => {
    if (!isSignedIn) {
      window.location.href = '/sign-up?redirect=/pricing?tab=site'
      return
    }
    if (!isLoaded || !user?.id) {
      alert('Please wait for authentication to complete.')
      return
    }
    try {
      setCheckoutLoading(band)
      const { data, error } = await supabase.functions.invoke('create-site-license-checkout', {
        body: { band },
      })
      if (error) throw new Error(error.message || 'Checkout failed')
      postCheckoutRef.current = 'downloads'
      setCheckoutClientSecret(data.clientSecret)
    } catch (error) {
      console.error('Site license checkout error:', error)
      alert('Failed to start checkout. Please try again.')
    } finally {
      setCheckoutLoading(null)
    }
  }

  // Individual SaaS (hosted convenience for connected users)
  const handleSaaSCheckout = async (plan: CheckoutPlan) => {
    if (!isSignedIn) {
      window.location.href = '/sign-up'
      return
    }
    if (!isLoaded || !user?.id) {
      alert('Please wait for authentication to complete.')
      return
    }
    try {
      setCheckoutLoading(plan)
      analytics.checkoutStarted(plan)
      const clientSecret = await checkout(plan)
      postCheckoutRef.current = 'dashboard'
      setCheckoutClientSecret(clientSecret)
    } catch (error) {
      console.error('Checkout error:', error)
      alert('Failed to start checkout. Please try again.')
    } finally {
      setCheckoutLoading(null)
    }
  }

  const siteFeatures = [
    'Both apps — record (CRAFT) + edit (ARTIST)',
    'One hosted copy serves your whole network',
    'Runs 100% in-browser, fully offline — air-gap friendly',
    'Signed bundle with your license embedded',
    'No watermark, no telemetry, no cloud dependency',
    'A year of updates + support; renews annually',
  ]

  return (
    <div className={styles.pricing}>
      <header className={styles.header}>
        <h1>Pricing</h1>
        <p>Run it on your network, or let us host it. One license covers your whole organization.</p>
      </header>

      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'site' ? styles.active : ''}`}
          onClick={() => setActiveTab('site')}
        >
          Site License
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'individual' ? styles.active : ''}`}
          onClick={() => setActiveTab('individual')}
        >
          Individual
        </button>
      </div>

      {/* Site License — the hero. One license = the whole org/network. */}
      {activeTab === 'site' && (
        <div className={styles.individualPricing}>
          <div className={styles.standaloneInfo}>
            <h3>ESCAPE Suite — Site License</h3>
            <p>
              Built for air-gapped and regulated networks. Host one copy internally; everyone on
              your network records and edits in their browser — nothing ever leaves the building.
              One annual license covers the whole organization.
            </p>
          </div>

          <div className={styles.pricingGrid}>
            <div className={styles.pricingCard}>
              <h3>Team</h3>
              <div className={styles.price}>
                <span className={styles.amount}>$2,400</span>
                <span className={styles.period}>per year</span>
              </div>
              <p className={styles.savings}>A single team or unit · up to ~25 people</p>
              <ul className={styles.features}>
                {siteFeatures.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <button
                onClick={() => handleSiteLicenseCheckout('team')}
                disabled={checkoutLoading !== null}
              >
                {checkoutLoading === 'team' ? 'Loading…' : 'Get Team License'}
              </button>
            </div>

            <div className={`${styles.pricingCard} ${styles.featured}`}>
              <div className={styles.badge}>Most Popular</div>
              <h3>Organization</h3>
              <div className={styles.price}>
                <span className={styles.amount}>$9,600</span>
                <span className={styles.period}>per year</span>
              </div>
              <p className={styles.savings}>A department or agency · up to ~250 people</p>
              <ul className={styles.features}>
                {siteFeatures.map((f) => (
                  <li key={f}>{f}</li>
                ))}
                <li>Priority support</li>
              </ul>
              <button
                className="primary"
                onClick={() => handleSiteLicenseCheckout('org')}
                disabled={checkoutLoading !== null}
              >
                {checkoutLoading === 'org' ? 'Loading…' : 'Get Org License'}
              </button>
            </div>

            <div className={styles.pricingCard}>
              <h3>Enterprise / Site</h3>
              <div className={styles.price}>
                <span className={styles.amount}>Let's talk</span>
              </div>
              <p className={styles.savings}>Whole-network deployment · unlimited users</p>
              <ul className={styles.features}>
                <li>Everything in Organization</li>
                <li>Unlimited users across your network</li>
                <li>Procurement, PO & security review</li>
                <li>Custom terms + onboarding</li>
              </ul>
              <a href={`mailto:${CONTACT_EMAIL}?subject=ESCAPE%20Suite%20Enterprise%2FSite%20License`}>
                <button>Contact Us</button>
              </a>
            </div>
          </div>

          <p className={styles.downloadNote}>
            After purchase you'll download a single, signed HTML bundle with your license embedded —
            host it on your network and you're done. No installers, no accounts for your users, no
            internet required.
          </p>
          <p className={styles.downloadNote}>
            Annual term, renews automatically — cancel anytime. By purchasing you agree to the{' '}
            <Link to="/terms">Site License Agreement</Link> and certify your organization is within
            the selected band.
          </p>
        </div>
      )}

      {/* Individual SaaS — hosted convenience for connected users */}
      {activeTab === 'individual' && (
        <div className={styles.individualPricing}>
          <div className={styles.standaloneInfo}>
            <h3>Individual</h3>
            <p>
              For solo creators who just want the hosted apps — sign in at escapesuite.io and start
              recording. No air-gap needed.
            </p>
          </div>

          <div className={styles.pricingGrid}>
            <div className={styles.pricingCard}>
              <h3>Free Trial</h3>
              <div className={styles.price}>
                <span className={styles.amount}>$0</span>
                <span className={styles.period}>7 days</span>
              </div>
              <ul className={styles.features}>
                <li>Full access to both apps</li>
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
                <span className={styles.amount}>$89</span>
                <span className={styles.period}>per year</span>
              </div>
              <p className={styles.savings}>Save $19 vs monthly</p>
              <ul className={styles.features}>
                <li>Full access to both apps</li>
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
                    onClick={() => handleSaaSCheckout('annual')}
                    disabled={checkoutLoading !== null}
                  >
                    {checkoutLoading === 'annual' ? 'Loading…' : 'Upgrade Now'}
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
              <ul className={styles.features}>
                <li>Full access to both apps</li>
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
                    onClick={() => handleSaaSCheckout('monthly')}
                    disabled={checkoutLoading !== null}
                  >
                    {checkoutLoading === 'monthly' ? 'Loading…' : 'Upgrade Now'}
                  </button>
                )}
              </SignedIn>
            </div>
          </div>

        </div>
      )}

      {/* Common questions */}
      <section className={styles.faq}>
        <h2>Common questions</h2>
        <div className={styles.faqGrid}>
          <div className={styles.faqItem}>
            <h4>How does it run with no internet?</h4>
            <p>
              You buy here and download one signed HTML file with your license baked in. Host it on
              an internal server; anyone on the network opens it in a browser and records and edits
              locally. Once you've carried the file in, it never touches the internet again.
            </p>
          </div>
          <div className={styles.faqItem}>
            <h4>One license for our whole team?</h4>
            <p>
              Yes — a Site License is per organization, not per seat. Host one copy and everyone uses
              it. The Team and Organization bands just track roughly how many of you there are.
            </p>
          </div>
          <div className={styles.faqItem}>
            <h4>What happens when the year is up?</h4>
            <p>
              Each license carries an end date. When the term lapses, the apps stop working until you
              renew and drop in the refreshed bundle — which is also how you pick up the latest fixes
              and features. Stay current, stay running.
            </p>
          </div>
        </div>
      </section>

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
