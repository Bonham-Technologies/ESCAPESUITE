// Subscription read for SaaS mode (craft/artist gate).
// Reads the caller's own subscription row directly; Postgres RLS
// (auth.uid() = auth_user_id) scopes it — no edge function, no IDOR surface.
import { getSupabase } from './supabaseClient'

export interface Subscription {
  status: 'trialing' | 'active' | 'canceled' | 'expired' | 'lifetime' | 'past_due'
  plan: 'trial' | 'pro_monthly' | 'pro_annual' | 'founding_member'
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
    // Effective expiry: a trial past its end is treated as expired for gating,
    // even if a background job hasn't flipped the row yet.
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

export async function getSubscription(authUserId: string): Promise<Subscription> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('subscriptions')
    .select('status, plan, trial_end, current_period_end')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (error) throw new Error(error.message)

  if (!data) {
    // Trigger seeds a trial on signup; this is a defensive fallback only.
    return {
      status: 'trialing',
      plan: 'trial',
      trialEnd: null,
      trialDaysRemaining: 14,
      periodEnd: null,
      hasActiveSubscription: false,
      canAccessPro: true,
    }
  }

  return formatSubscription(data as SubscriptionRow)
}

export function isPaidUser(subscription: Subscription | null): boolean {
  if (!subscription) return false
  return subscription.status === 'active' || subscription.status === 'lifetime'
}

export function isTrialUser(subscription: Subscription | null): boolean {
  if (!subscription) return false
  return subscription.status === 'trialing'
}
