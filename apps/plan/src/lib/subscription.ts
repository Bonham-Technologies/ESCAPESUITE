import { supabase } from './supabase'

export interface Subscription {
  status: 'trialing' | 'active' | 'canceled' | 'expired' | 'lifetime' | 'past_due'
  plan: 'trial' | 'pro_monthly' | 'pro_annual'
  trialEnd: string | null
  trialDaysRemaining: number
  periodEnd: string | null
  hasActiveSubscription: boolean
  canAccessPro: boolean
}

interface SubscriptionRow {
  status: string
  plan: string
  trial_end: string | null
  current_period_end: string | null
}

function formatSubscription(row: SubscriptionRow): Subscription {
  let status = row.status
  let trialDaysRemaining = 0

  if (status === 'trialing' && row.trial_end) {
    const diff = new Date(row.trial_end).getTime() - Date.now()
    trialDaysRemaining = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
    if (diff < 0) status = 'expired'
  }

  return {
    status: status as Subscription['status'],
    plan: row.plan as Subscription['plan'],
    trialEnd: row.trial_end,
    trialDaysRemaining,
    periodEnd: row.current_period_end,
    hasActiveSubscription: ['active', 'lifetime'].includes(status),
    canAccessPro: ['active', 'lifetime', 'trialing'].includes(status),
  }
}

// Reads the caller's own subscription. RLS (auth.uid() = auth_user_id) scopes it.
// The `authUserId` argument is the Supabase auth.users UUID.
export async function getSubscription(authUserId: string): Promise<Subscription> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('status, plan, trial_end, current_period_end')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (error) throw new Error(error.message)

  if (!data) {
    // Trigger seeds a trial on signup; defensive fallback.
    return {
      status: 'trialing',
      plan: 'trial',
      trialEnd: null,
      trialDaysRemaining: 7,
      periodEnd: null,
      hasActiveSubscription: false,
      canAccessPro: true,
    }
  }

  return formatSubscription(data as SubscriptionRow)
}

export type CheckoutPlan = 'monthly' | 'annual'

export async function createCheckoutSession(
  _authUserId: string,
  plan: CheckoutPlan
): Promise<string> {
  const { data, error } = await supabase.functions.invoke('create-checkout', {
    body: {
      plan,
      returnUrl: `${window.location.origin}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
    },
  })

  if (error) throw new Error(error.message || 'Failed to create checkout session')
  return data.clientSecret
}

export async function createPortalSession(_authUserId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('create-portal', {
    body: { returnUrl: `${window.location.origin}/dashboard` },
  })

  if (error) throw new Error(error.message || 'Failed to create portal session')
  return data.url
}

export function getPlanDisplayName(plan: string): string {
  switch (plan) {
    case 'trial':
      return 'Free Trial'
    case 'pro_monthly':
      return 'Pro Monthly'
    case 'pro_annual':
      return 'Pro Annual'
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
