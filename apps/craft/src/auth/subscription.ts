// Subscription API client for SaaS mode
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config'

export interface Subscription {
  status: 'trialing' | 'active' | 'canceled' | 'expired' | 'lifetime' | 'past_due'
  plan: 'trial' | 'pro_monthly' | 'pro_annual' | 'founding_member'
  trialEnd: string | null
  trialDaysRemaining: number
  periodEnd: string | null
  hasActiveSubscription: boolean
  canAccessPro: boolean
}

const functionsUrl = `${SUPABASE_URL}/functions/v1`

export async function getSubscription(clerkUserId: string): Promise<Subscription> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase not configured')
  }

  const response = await fetch(
    `${functionsUrl}/get-subscription?clerkUserId=${encodeURIComponent(clerkUserId)}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
    }
  )

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to get subscription')
  }

  return response.json()
}

export function isPaidUser(subscription: Subscription | null): boolean {
  if (!subscription) return false
  return subscription.status === 'active' || subscription.status === 'lifetime'
}

export function isTrialUser(subscription: Subscription | null): boolean {
  if (!subscription) return false
  return subscription.status === 'trialing'
}
