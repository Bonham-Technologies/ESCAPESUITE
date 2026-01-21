import { functionsUrl, supabaseAnonKey } from './supabase'

export interface Subscription {
  status: 'trialing' | 'active' | 'canceled' | 'expired' | 'lifetime' | 'past_due'
  plan: 'trial' | 'pro_monthly' | 'pro_annual' | 'founding_member'
  trialEnd: string | null
  trialDaysRemaining: number
  periodEnd: string | null
  hasActiveSubscription: boolean
  canAccessPro: boolean
}

export async function getSubscription(clerkUserId: string): Promise<Subscription> {
  const response = await fetch(
    `${functionsUrl}/get-subscription?clerkUserId=${encodeURIComponent(clerkUserId)}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
      },
    }
  )

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to get subscription')
  }

  return response.json()
}

export type CheckoutPlan = 'monthly' | 'annual' | 'founding'

export async function createCheckoutSession(
  clerkUserId: string,
  plan: CheckoutPlan
): Promise<string> {
  const response = await fetch(`${functionsUrl}/create-checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseAnonKey,
      'Authorization': `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify({
      clerkUserId,
      plan,
      returnUrl: `${window.location.origin}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to create checkout session')
  }

  const { clientSecret } = await response.json()
  return clientSecret
}

export async function createPortalSession(clerkUserId: string): Promise<string> {
  const response = await fetch(`${functionsUrl}/create-portal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseAnonKey,
      'Authorization': `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify({
      clerkUserId,
      returnUrl: `${window.location.origin}/dashboard`,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to create portal session')
  }

  const { url } = await response.json()
  return url
}

export function getPlanDisplayName(plan: string): string {
  switch (plan) {
    case 'trial':
      return 'Free Trial'
    case 'pro_monthly':
      return 'Pro Monthly'
    case 'pro_annual':
      return 'Pro Annual'
    case 'founding_member':
      return 'Founding Member'
    default:
      return plan
  }
}

export function getStatusDisplayName(status: string): string {
  switch (status) {
    case 'trialing':
      return 'Trial'
    case 'active':
      return 'Active'
    case 'canceled':
      return 'Canceled'
    case 'expired':
      return 'Expired'
    case 'lifetime':
      return 'Lifetime'
    case 'past_due':
      return 'Past Due'
    default:
      return status
  }
}
