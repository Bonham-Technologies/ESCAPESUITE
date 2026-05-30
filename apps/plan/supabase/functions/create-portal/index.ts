import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { jsonResponse, handleOptions } from '../_shared/cors.ts'
import { requireUser, serviceClient, AuthError } from '../_shared/auth.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions()

  try {
    // Identity comes from the verified JWT, never the request body.
    const user = await requireUser(req)

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2023-10-16',
    })
    const supabase = serviceClient()

    const { returnUrl } = await req.json()

    // Resolve this user's Stripe customer from their own subscription row.
    const { data: subscription, error } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    if (error || !subscription?.stripe_customer_id) {
      return jsonResponse({ error: 'No subscription found for this user' }, 404)
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: returnUrl || `${req.headers.get('origin')}/dashboard`,
    })

    return jsonResponse({ url: session.url })
  } catch (error) {
    if (error instanceof AuthError) return jsonResponse({ error: error.message }, error.status)
    console.error('Portal error:', error)
    return jsonResponse({ error: error.message }, 500)
  }
})
