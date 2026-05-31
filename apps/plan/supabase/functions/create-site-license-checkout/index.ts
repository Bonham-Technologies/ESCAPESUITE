import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { jsonResponse, handleOptions } from '../_shared/cors.ts'
import { requireUser, serviceClient, AuthError } from '../_shared/auth.ts'

// Annual ESCAPE Suite site-license prices (LIVE). One license covers the whole
// org/network — host one bundle internally, everyone runs it locally. Price IDs
// are not secrets (they ride along in the browser checkout), so we keep them in
// code rather than edge-function secrets. `seats` is the contractual band cap
// (not technically enforced — an air-gapped box can't phone home).
const SITE_BANDS = {
  team: { priceId: 'price_1TcxM9Ig0cw1ev3SbkRC8uY6', seats: 25 },
  org: { priceId: 'price_1TcxMAIg0cw1ev3SXn6wK5Mv', seats: 250 },
} as const

type Band = keyof typeof SITE_BANDS

interface CheckoutRequest {
  band: Band
  returnUrl?: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions()

  try {
    const user = await requireUser(req)
    const supabase = serviceClient()
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2023-10-16',
    })

    const { band, returnUrl }: CheckoutRequest = await req.json()

    if (!band || !(band in SITE_BANDS)) {
      return jsonResponse({ error: 'Invalid band. Must be: team or org' }, 400)
    }
    const { priceId, seats } = SITE_BANDS[band]

    // Reuse the customer already on the authenticated user's subscription row.
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
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      ui_mode: 'embedded',
      redirect_on_completion: 'if_required',
      return_url:
        returnUrl ||
        `${req.headers.get('origin')}/portal/downloads?session_id={CHECKOUT_SESSION_ID}`,
      allow_promotion_codes: true,
      metadata: {
        type: 'site_license',
        band,
        seats: seats.toString(),
        supabase_user_id: user.id,
      },
    })

    return jsonResponse({ clientSecret: session.client_secret, sessionId: session.id })
  } catch (error) {
    if (error instanceof AuthError) return jsonResponse({ error: error.message }, error.status)
    console.error('Site license checkout error:', error)
    return jsonResponse({ error: error.message }, 500)
  }
})
