import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Get clerkUserId from query params or body
    let clerkUserId: string | null = null

    if (req.method === 'GET') {
      const url = new URL(req.url)
      clerkUserId = url.searchParams.get('clerkUserId')
    } else {
      const body = await req.json()
      clerkUserId = body.clerkUserId
    }

    if (!clerkUserId) {
      return new Response(
        JSON.stringify({ error: 'Missing clerkUserId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get subscription from database
    const { data: subscription, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('clerk_user_id', clerkUserId)
      .single()

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows returned, which is expected for new users
      throw error
    }

    if (!subscription) {
      // No subscription found - user is on trial (create record)
      const trialEnd = new Date()
      trialEnd.setDate(trialEnd.getDate() + 14)

      const { data: newSub, error: insertError } = await supabase
        .from('subscriptions')
        .insert({
          clerk_user_id: clerkUserId,
          status: 'trialing',
          plan: 'trial',
          trial_start: new Date().toISOString(),
          trial_end: trialEnd.toISOString(),
        })
        .select()
        .single()

      if (insertError) {
        // Might have been created by another request, try to fetch again
        const { data: existingSub } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('clerk_user_id', clerkUserId)
          .single()

        if (existingSub) {
          return new Response(
            JSON.stringify(formatSubscription(existingSub)),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        throw insertError
      }

      return new Response(
        JSON.stringify(formatSubscription(newSub)),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if trial has expired
    if (subscription.status === 'trialing' && subscription.trial_end) {
      const trialEnd = new Date(subscription.trial_end)
      if (trialEnd < new Date()) {
        // Trial has expired
        await supabase
          .from('subscriptions')
          .update({ status: 'expired' })
          .eq('clerk_user_id', clerkUserId)

        subscription.status = 'expired'
      }
    }

    return new Response(
      JSON.stringify(formatSubscription(subscription)),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Get subscription error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function formatSubscription(sub: any) {
  const now = new Date()
  let trialDaysRemaining = 0

  if (sub.status === 'trialing' && sub.trial_end) {
    const trialEnd = new Date(sub.trial_end)
    const diffTime = trialEnd.getTime() - now.getTime()
    trialDaysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)))
  }

  return {
    status: sub.status,
    plan: sub.plan,
    trialEnd: sub.trial_end,
    trialDaysRemaining,
    periodEnd: sub.current_period_end,
    hasActiveSubscription: ['active', 'lifetime'].includes(sub.status),
    canAccessPro: ['active', 'lifetime', 'trialing'].includes(sub.status),
  }
}
