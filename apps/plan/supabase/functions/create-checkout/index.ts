import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Price ID mapping from environment variables
const PRICE_IDS = {
  monthly: () => Deno.env.get('STRIPE_PRICE_PRO_MONTHLY'),
  annual: () => Deno.env.get('STRIPE_PRICE_PRO_ANNUAL'),
  founding: () => Deno.env.get('STRIPE_PRICE_FOUNDING'),
}

type PlanType = 'monthly' | 'annual' | 'founding'

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2023-10-16',
    })

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { clerkUserId, plan, returnUrl } = await req.json()

    if (!clerkUserId || !plan) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: clerkUserId, plan' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate plan type
    if (!['monthly', 'annual', 'founding'].includes(plan)) {
      return new Response(
        JSON.stringify({ error: 'Invalid plan. Must be: monthly, annual, or founding' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get price ID from environment
    const priceId = PRICE_IDS[plan as PlanType]()
    if (!priceId) {
      console.error(`Missing Stripe price configuration: STRIPE_PRICE_${plan.toUpperCase()}`)
      return new Response(
        JSON.stringify({ error: `Stripe price not configured for ${plan}. Please contact support.` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if user already has a subscription record
    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('clerk_user_id', clerkUserId)
      .single()

    let customerId = existingSub?.stripe_customer_id

    // Create Stripe customer if doesn't exist
    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { clerk_user_id: clerkUserId },
      })
      customerId = customer.id

      // Create subscription record
      await supabase.from('subscriptions').upsert({
        clerk_user_id: clerkUserId,
        stripe_customer_id: customerId,
        status: 'trialing',
        plan: 'trial',
      })
    }

    // Determine if this is a one-time payment (Founding Member) or subscription
    const price = await stripe.prices.retrieve(priceId)
    const isOneTime = price.type === 'one_time'

    // Create checkout session with embedded mode
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: isOneTime ? 'payment' : 'subscription',
      ui_mode: 'embedded',
      redirect_on_completion: 'if_required',
      return_url: returnUrl || `${req.headers.get('origin')}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        clerk_user_id: clerkUserId,
        price_id: priceId,
      },
      // For subscriptions, allow promotion codes
      ...(isOneTime ? {} : { allow_promotion_codes: true }),
    })

    return new Response(
      JSON.stringify({ clientSecret: session.client_secret }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Checkout error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
