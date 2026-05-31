import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { jsonResponse, handleOptions } from '../_shared/cors.ts'
import { requireUser, serviceClient, AuthError } from '../_shared/auth.ts'

// Price ID mapping from environment variables
const PRICE_IDS = {
  monthly: () => Deno.env.get('STRIPE_PRICE_PRO_MONTHLY'),
  annual: () => Deno.env.get('STRIPE_PRICE_PRO_ANNUAL'),
}

type PlanType = 'monthly' | 'annual'

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions()

  try {
    // Identity comes from the verified JWT, never the request body.
    const user = await requireUser(req)

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2023-10-16',
    })
    const supabase = serviceClient()

    const { plan, returnUrl } = await req.json()

    if (!plan) {
      return jsonResponse({ error: 'Missing required field: plan' }, 400)
    }
    if (!['monthly', 'annual'].includes(plan)) {
      return jsonResponse({ error: 'Invalid plan. Must be: monthly or annual' }, 400)
    }

    const priceId = PRICE_IDS[plan as PlanType]()
    if (!priceId) {
      console.error(`Missing Stripe price configuration: STRIPE_PRICE_${plan.toUpperCase()}`)
      return jsonResponse({ error: `Stripe price not configured for ${plan}. Please contact support.` }, 500)
    }

    // Reuse an existing Stripe customer for this user if we have one.
    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    let customerId = existingSub?.stripe_customer_id

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      })
      customerId = customer.id

      await supabase.from('subscriptions').upsert(
        {
          auth_user_id: user.id,
          stripe_customer_id: customerId,
          status: 'trialing',
          plan: 'trial',
        },
        { onConflict: 'auth_user_id' }
      )
    }

    const price = await stripe.prices.retrieve(priceId)
    const isOneTime = price.type === 'one_time'

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: isOneTime ? 'payment' : 'subscription',
      ui_mode: 'embedded',
      redirect_on_completion: 'if_required',
      return_url:
        returnUrl || `${req.headers.get('origin')}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        supabase_user_id: user.id,
        price_id: priceId,
      },
      ...(isOneTime ? {} : { allow_promotion_codes: true }),
    })

    return jsonResponse({ clientSecret: session.client_secret })
  } catch (error) {
    if (error instanceof AuthError) return jsonResponse({ error: error.message }, error.status)
    console.error('Checkout error:', error)
    return jsonResponse({ error: error.message }, 500)
  }
})
