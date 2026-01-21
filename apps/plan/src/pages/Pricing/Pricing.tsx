import { useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { SignedIn, SignedOut, useUser } from '@clerk/clerk-react'
import { useSubscription } from '../../hooks/useSubscription'
import type { CheckoutPlan } from '../../lib/subscription'
import { analytics } from '../../lib/analytics'
import { functionsUrl, supabaseAnonKey } from '../../lib/supabase'
import { CheckoutModal } from '../../components/Checkout'
import styles from './Pricing.module.css'

type PricingTab = 'individual' | 'team' | 'standalone'
type StandaloneProduct = 'craft' | 'artist' | 'suite'
type StandaloneTier = 'standard' | 'pro' | 'lifetime'

// Standalone prices (configured in Stripe)
const STANDALONE_PRICES: Record<StandaloneProduct, Record<StandaloneTier, { amount: number; label: string }>> = {
  craft: {
    standard: { amount: 49, label: 'ESCAPECRAFT Standard' },
    pro: { amount: 99, label: 'ESCAPECRAFT Pro' },
    lifetime: { amount: 199, label: 'ESCAPECRAFT Lifetime' },
  },
  artist: {
    standard: { amount: 69, label: 'ESCAPEARTIST Standard' },
    pro: { amount: 129, label: 'ESCAPEARTIST Pro' },
    lifetime: { amount: 249, label: 'ESCAPEARTIST Lifetime' },
  },
  suite: {
    standard: { amount: 99, label: 'Suite Bundle Standard' },
    pro: { amount: 199, label: 'Suite Bundle Pro' },
    lifetime: { amount: 349, label: 'Suite Bundle Lifetime' },
  },
}

// Team pricing
const TEAM_PRICES = {
  team: { perSeat: 7, minSeats: 5, label: 'Team' },
  enterprise: { perSeat: 12, minSeats: 25, label: 'Enterprise' },
}

export default function Pricing() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const initialTab = (searchParams.get('tab') as PricingTab) || 'individual'

  const { isSignedIn, user } = useUser()
  const { subscription, checkout, refetch } = useSubscription()
  const [activeTab, setActiveTab] = useState<PricingTab>(initialTab)
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
  const [checkoutClientSecret, setCheckoutClientSecret] = useState<string | null>(null)

  // Team pricing state
  const [teamSeats, setTeamSeats] = useState(5)
  const [teamPlan, setTeamPlan] = useState<'team' | 'enterprise'>('team')
  const [teamBillingPeriod, setTeamBillingPeriod] = useState<'monthly' | 'annual'>('monthly')
  const [teamOrgSlug, setTeamOrgSlug] = useState<string | null>(null)

  // Standalone state
  const [standaloneProduct, setStandaloneProduct] = useState<StandaloneProduct>('suite')
  const [standaloneTier, setStandaloneTier] = useState<StandaloneTier>('pro')

  const hasActiveSubscription = subscription?.hasActiveSubscription || false

  // Handle checkout completion
  const handleCheckoutComplete = async () => {
    setCheckoutClientSecret(null)
    await refetch()
    // Navigate based on checkout type
    if (teamOrgSlug) {
      navigate(`/team/${teamOrgSlug}?success=true`)
      setTeamOrgSlug(null)
    } else {
      navigate('/dashboard?success=true')
    }
  }

  // Handle SaaS checkout
  const handleSaaSCheckout = async (plan: CheckoutPlan) => {
    if (!isSignedIn) {
      window.location.href = '/sign-up'
      return
    }

    try {
      setCheckoutLoading(plan)
      analytics.checkoutStarted(plan)
      const clientSecret = await checkout(plan)
      setCheckoutClientSecret(clientSecret)
    } catch (error) {
      console.error('Checkout error:', error)
      alert('Failed to start checkout. Please try again.')
    } finally {
      setCheckoutLoading(null)
    }
  }

  // Handle standalone license checkout
  const handleStandaloneCheckout = async () => {
    if (!isSignedIn) {
      window.location.href = '/sign-up?redirect=/pricing?tab=standalone'
      return
    }

    try {
      setCheckoutLoading('standalone')

      const response = await fetch(`${functionsUrl}/create-license-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({
          clerkUserId: user?.id,
          email: user?.primaryEmailAddress?.emailAddress,
          product: standaloneProduct,
          tier: standaloneTier,
          seats: 1,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Checkout failed')
      }

      // Open embedded checkout modal
      setCheckoutClientSecret(data.clientSecret)
    } catch (error) {
      console.error('Standalone checkout error:', error)
      alert('Failed to start checkout. Please try again.')
    } finally {
      setCheckoutLoading(null)
    }
  }

  // Handle team checkout
  const handleTeamCheckout = async () => {
    if (!isSignedIn) {
      window.location.href = '/sign-up'
      return
    }

    try {
      setCheckoutLoading('team')

      const response = await fetch(`${functionsUrl}/create-org-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({
          clerkUserId: user?.id,
          email: user?.primaryEmailAddress?.emailAddress,
          plan: teamPlan,
          seatCount: teamSeats,
          billingPeriod: teamBillingPeriod,
          organizationName: `${user?.firstName || 'User'}'s Team`,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Checkout failed')
      }

      // Store org slug for redirect after checkout
      setTeamOrgSlug(data.organizationSlug)
      // Open embedded checkout modal
      setCheckoutClientSecret(data.clientSecret)
    } catch (error) {
      console.error('Team checkout error:', error)
      alert('Failed to start checkout. Please try again.')
    } finally {
      setCheckoutLoading(null)
    }
  }

  const standalonePrice = STANDALONE_PRICES[standaloneProduct][standaloneTier]
  const teamPrice = TEAM_PRICES[teamPlan]
  const teamMonthlyTotal = teamPrice.perSeat * teamSeats
  const teamAnnualTotal = teamMonthlyTotal * 10 // 2 months free with annual

  return (
    <div className={styles.pricing}>
      <header className={styles.header}>
        <h1>Choose Your Plan</h1>
        <p>Select the option that best fits your needs</p>
      </header>

      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'individual' ? styles.active : ''}`}
          onClick={() => setActiveTab('individual')}
        >
          Individual
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'team' ? styles.active : ''}`}
          onClick={() => setActiveTab('team')}
        >
          Teams
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'standalone' ? styles.active : ''}`}
          onClick={() => setActiveTab('standalone')}
        >
          Standalone License
        </button>
      </div>

      {/* Individual SaaS Pricing */}
      {activeTab === 'individual' && (
        <div className={styles.individualPricing}>
          <div className={styles.pricingGrid}>
            <div className={styles.pricingCard}>
              <h3>Free Trial</h3>
              <div className={styles.price}>
                <span className={styles.amount}>$0</span>
                <span className={styles.period}>14 days</span>
              </div>
              <ul className={styles.features}>
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
              <ul className={styles.features}>
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
                    onClick={() => handleSaaSCheckout('annual')}
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
              <ul className={styles.features}>
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
                    onClick={() => handleSaaSCheckout('monthly')}
                    disabled={checkoutLoading !== null}
                  >
                    {checkoutLoading === 'monthly' ? 'Loading...' : 'Upgrade Now'}
                  </button>
                )}
              </SignedIn>
            </div>
          </div>

          <div className={styles.foundingMember}>
            <div className={styles.foundingBadge}>Limited Time</div>
            <h3>Founding Member - $149 one-time</h3>
            <p>Get lifetime access. Limited to first 100 supporters.</p>
            <SignedOut>
              <Link to="/sign-up">
                <button className="primary">Become a Founder</button>
              </Link>
            </SignedOut>
            <SignedIn>
              {hasActiveSubscription && subscription?.plan === 'founding_member' ? (
                <button disabled>You're a Founding Member!</button>
              ) : (
                <button
                  className="primary"
                  onClick={() => handleSaaSCheckout('founding')}
                  disabled={checkoutLoading !== null}
                >
                  {checkoutLoading === 'founding' ? 'Loading...' : 'Become a Founder'}
                </button>
              )}
            </SignedIn>
          </div>
        </div>
      )}

      {/* Team Pricing */}
      {activeTab === 'team' && (
        <div className={styles.teamPricing}>
          <div className={styles.teamCalculator}>
            <div className={styles.calculatorSection}>
              <h3>Choose Your Plan</h3>
              <div className={styles.planSelector}>
                <button
                  className={`${styles.planOption} ${teamPlan === 'team' ? styles.active : ''}`}
                  onClick={() => {
                    setTeamPlan('team')
                    if (teamSeats < 5) setTeamSeats(5)
                  }}
                >
                  <div className={styles.planName}>Team</div>
                  <div className={styles.planPrice}>${TEAM_PRICES.team.perSeat}/seat/mo</div>
                  <div className={styles.planMin}>Min 5 seats</div>
                </button>
                <button
                  className={`${styles.planOption} ${teamPlan === 'enterprise' ? styles.active : ''}`}
                  onClick={() => {
                    setTeamPlan('enterprise')
                    if (teamSeats < 25) setTeamSeats(25)
                  }}
                >
                  <div className={styles.planName}>Enterprise</div>
                  <div className={styles.planPrice}>${TEAM_PRICES.enterprise.perSeat}/seat/mo</div>
                  <div className={styles.planMin}>Min 25 seats</div>
                  <div className={styles.planBadge}>SSO + Audit</div>
                </button>
              </div>
            </div>

            <div className={styles.calculatorSection}>
              <h3>Number of Seats</h3>
              <div className={styles.seatSlider}>
                <input
                  type="range"
                  min={teamPrice.minSeats}
                  max={100}
                  value={teamSeats}
                  onChange={(e) => setTeamSeats(parseInt(e.target.value))}
                />
                <div className={styles.seatValue}>
                  <input
                    type="number"
                    min={teamPrice.minSeats}
                    max={500}
                    value={teamSeats}
                    onChange={(e) => setTeamSeats(Math.max(teamPrice.minSeats, parseInt(e.target.value) || teamPrice.minSeats))}
                  />
                  <span>seats</span>
                </div>
              </div>
            </div>

            <div className={styles.calculatorSection}>
              <h3>Billing Period</h3>
              <div className={styles.billingToggle}>
                <button
                  className={`${styles.billingOption} ${teamBillingPeriod === 'monthly' ? styles.active : ''}`}
                  onClick={() => setTeamBillingPeriod('monthly')}
                >
                  Monthly
                </button>
                <button
                  className={`${styles.billingOption} ${teamBillingPeriod === 'annual' ? styles.active : ''}`}
                  onClick={() => setTeamBillingPeriod('annual')}
                >
                  Annual
                  <span className={styles.savingsBadge}>Save 17%</span>
                </button>
              </div>
            </div>

            <div className={styles.calculatorTotal}>
              <div className={styles.totalBreakdown}>
                {teamBillingPeriod === 'monthly' ? (
                  <>
                    <span>{teamSeats} seats x ${teamPrice.perSeat}/mo</span>
                    <span className={styles.totalAmount}>${teamMonthlyTotal}/mo</span>
                  </>
                ) : (
                  <>
                    <span>{teamSeats} seats x ${teamPrice.perSeat * 10}/yr</span>
                    <span className={styles.totalAmount}>${teamAnnualTotal}/yr</span>
                  </>
                )}
              </div>
              {teamBillingPeriod === 'monthly' ? (
                <p className={styles.annualNote}>
                  Switch to annual billing and save ${teamMonthlyTotal * 2}/year
                </p>
              ) : (
                <p className={styles.annualNote}>
                  Equivalent to ${(teamAnnualTotal / 12).toFixed(0)}/mo (2 months free)
                </p>
              )}

              <SignedOut>
                <Link to="/sign-up">
                  <button className="primary">Sign Up to Continue</button>
                </Link>
              </SignedOut>
              <SignedIn>
                <button
                  className="primary"
                  onClick={handleTeamCheckout}
                  disabled={checkoutLoading !== null}
                >
                  {checkoutLoading === 'team' ? 'Loading...' : 'Start Team Plan'}
                </button>
              </SignedIn>
            </div>
          </div>

          <div className={styles.teamFeatures}>
            <h3>{teamPlan === 'team' ? 'Team' : 'Enterprise'} Features</h3>
            <div className={styles.featureGrid}>
              <div className={styles.featureItem}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>All Pro features</span>
              </div>
              <div className={styles.featureItem}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Team member management</span>
              </div>
              <div className={styles.featureItem}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Centralized billing</span>
              </div>
              <div className={styles.featureItem}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Priority support</span>
              </div>
              {teamPlan === 'enterprise' && (
                <>
                  <div className={styles.featureItem}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>SSO/SAML integration</span>
                  </div>
                  <div className={styles.featureItem}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>Audit logging</span>
                  </div>
                  <div className={styles.featureItem}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>Dedicated success manager</span>
                  </div>
                  <div className={styles.featureItem}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>99.9% SLA</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Standalone License Pricing */}
      {activeTab === 'standalone' && (
        <div className={styles.standalonePricing}>
          <div className={styles.standaloneInfo}>
            <h3>Standalone License</h3>
            <p>
              Purchase a one-time license for offline use. No subscription, no internet
              required after activation. Download and run entirely on your device.
            </p>
          </div>

          <div className={styles.standaloneCalculator}>
            <div className={styles.productSelector}>
              <h4>Select Product</h4>
              <div className={styles.productOptions}>
                <button
                  className={`${styles.productOption} ${standaloneProduct === 'craft' ? styles.active : ''}`}
                  onClick={() => setStandaloneProduct('craft')}
                >
                  <span className={styles.productIcon}>REC</span>
                  <span className={styles.productName}>ESCAPECRAFT</span>
                  <span className={styles.productDesc}>Screen Recorder</span>
                </button>
                <button
                  className={`${styles.productOption} ${standaloneProduct === 'artist' ? styles.active : ''}`}
                  onClick={() => setStandaloneProduct('artist')}
                >
                  <span className={styles.productIcon}>EDIT</span>
                  <span className={styles.productName}>ESCAPEARTIST</span>
                  <span className={styles.productDesc}>Video Editor</span>
                </button>
                <button
                  className={`${styles.productOption} ${standaloneProduct === 'suite' ? styles.active : ''}`}
                  onClick={() => setStandaloneProduct('suite')}
                >
                  <span className={styles.productIcon}>ALL</span>
                  <span className={styles.productName}>Suite Bundle</span>
                  <span className={styles.productDesc}>Both Apps - Save 20%</span>
                </button>
              </div>
            </div>

            <div className={styles.tierSelector}>
              <h4>Select Tier</h4>
              <div className={styles.tierOptions}>
                <button
                  className={`${styles.tierOption} ${standaloneTier === 'standard' ? styles.active : ''}`}
                  onClick={() => setStandaloneTier('standard')}
                >
                  <span className={styles.tierName}>Standard</span>
                  <span className={styles.tierPrice}>${STANDALONE_PRICES[standaloneProduct].standard.amount}</span>
                  <span className={styles.tierDesc}>1 year updates</span>
                </button>
                <button
                  className={`${styles.tierOption} ${standaloneTier === 'pro' ? styles.active : ''}`}
                  onClick={() => setStandaloneTier('pro')}
                >
                  <span className={styles.tierName}>Pro</span>
                  <span className={styles.tierPrice}>${STANDALONE_PRICES[standaloneProduct].pro.amount}</span>
                  <span className={styles.tierDesc}>2 years updates + priority support</span>
                </button>
                <button
                  className={`${styles.tierOption} ${standaloneTier === 'lifetime' ? styles.active : ''}`}
                  onClick={() => setStandaloneTier('lifetime')}
                >
                  <span className={styles.tierBadge}>Best Value</span>
                  <span className={styles.tierName}>Lifetime</span>
                  <span className={styles.tierPrice}>${STANDALONE_PRICES[standaloneProduct].lifetime.amount}</span>
                  <span className={styles.tierDesc}>Forever updates + priority support</span>
                </button>
              </div>
            </div>

            <div className={styles.standaloneTotal}>
              <div className={styles.totalInfo}>
                <span className={styles.selectedProduct}>{standalonePrice.label}</span>
                <span className={styles.selectedPrice}>${standalonePrice.amount}</span>
              </div>
              <p className={styles.oneTimeNote}>One-time payment - no subscription</p>

              <button
                className="primary"
                onClick={handleStandaloneCheckout}
                disabled={checkoutLoading !== null}
              >
                {checkoutLoading === 'standalone' ? 'Loading...' : 'Purchase License'}
              </button>

              <p className={styles.downloadNote}>
                After purchase, you'll receive a license key and download link via email.
              </p>
            </div>
          </div>

          <div className={styles.standaloneFeatures}>
            <h4>What's Included</h4>
            <div className={styles.featureGrid}>
              <div className={styles.featureItem}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Works completely offline</span>
              </div>
              <div className={styles.featureItem}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Single HTML file - no install</span>
              </div>
              <div className={styles.featureItem}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>No watermark</span>
              </div>
              <div className={styles.featureItem}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Use on multiple devices</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FAQ Section */}
      <section className={styles.faq}>
        <h2>Frequently Asked Questions</h2>
        <div className={styles.faqGrid}>
          <div className={styles.faqItem}>
            <h4>What's the difference between SaaS and Standalone?</h4>
            <p>
              SaaS is a subscription that requires an internet connection. Standalone is a
              one-time purchase that works completely offline after activation.
            </p>
          </div>
          <div className={styles.faqItem}>
            <h4>Can I switch from SaaS to Standalone later?</h4>
            <p>
              Yes! You can purchase a standalone license at any time. Your SaaS subscription
              is separate and can be cancelled if you prefer standalone.
            </p>
          </div>
          <div className={styles.faqItem}>
            <h4>How many devices can I use the standalone license on?</h4>
            <p>
              Individual licenses work on up to 3 personal devices. Team licenses provide
              one seat per user purchased.
            </p>
          </div>
          <div className={styles.faqItem}>
            <h4>Do you offer refunds?</h4>
            <p>
              Yes, we offer a 30-day money-back guarantee on all purchases if you're not
              satisfied.
            </p>
          </div>
        </div>
      </section>

      {/* Embedded Checkout Modal */}
      {checkoutClientSecret && (
        <CheckoutModal
          clientSecret={checkoutClientSecret}
          onClose={() => {
            setCheckoutClientSecret(null)
            setTeamOrgSlug(null)
          }}
          onComplete={handleCheckoutComplete}
        />
      )}
    </div>
  )
}
