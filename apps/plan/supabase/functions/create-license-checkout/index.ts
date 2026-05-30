import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { jsonResponse, handleOptions } from '../_shared/cors.ts'
import { requireUser, serviceClient, AuthError } from '../_shared/auth.ts'

// Product price IDs from environment
const PRICE_IDS = {
  craft_standard: Deno.env.get('STRIPE_PRICE_CRAFT_STANDARD'),
  craft_pro: Deno.env.get('STRIPE_PRICE_CRAFT_PRO'),
  craft_lifetime: Deno.env.get('STRIPE_PRICE_CRAFT_LIFETIME'),
  artist_standard: Deno.env.get('STRIPE_PRICE_ARTIST_STANDARD'),
  artist_pro: Deno.env.get('STRIPE_PRICE_ARTIST_PRO'),
  artist_lifetime: Deno.env.get('STRIPE_PRICE_ARTIST_LIFETIME'),
  suite_standard: Deno.env.get('STRIPE_PRICE_SUITE_STANDARD'),
  suite_pro: Deno.env.get('STRIPE_PRICE_SUITE_PRO'),
  suite_lifetime: Deno.env.get('STRIPE_PRICE_SUITE_LIFETIME'),
}

interface CheckoutRequest {
  product: 'craft' | 'artist' | 'suite'
  tier: 'standard' | 'pro' | 'lifetime'
  seats?: number
  returnUrl?: string
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') return handleOptions()

  try {
    const user = await requireUser(req)
    const supabase = serviceClient()

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2023-10-16',
    })

    const body: CheckoutRequest = await req.json()
    const {
      product,
      tier,
      seats = 1,
      returnUrl,
    } = body

    // Validate required fields
    if (!product || !tier) {
      return jsonResponse({ error: 'Missing required fields: product, tier' }, 400)
    }

    // Validate product and tier
    if (!['craft', 'artist', 'suite'].includes(product)) {
      return jsonResponse({ error: 'Invalid product. Must be: craft, artist, or suite' }, 400)
    }

    if (!['standard', 'pro', 'lifetime'].includes(tier)) {
      return jsonResponse({ error: 'Invalid tier. Must be: standard, pro, or lifetime' }, 400)
    }

    // Get the price ID for this product/tier combination
    const priceKey = `${product}_${tier}` as keyof typeof PRICE_IDS
    const priceId = PRICE_IDS[priceKey]

    if (!priceId) {
      return jsonResponse({ error: `No price configured for ${product} ${tier}` }, 400)
    }

    // Find or create Stripe customer.
    // Reuse the customer already on the authenticated user's subscription.
    let customerId: string | undefined

    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('auth_user_id', user.id)
      .single()

    customerId = existingSub?.stripe_customer_id

    // Create customer if doesn't exist
    if (!customerId) {
      const customerData: Stripe.CustomerCreateParams = {
        metadata: {
          supabase_user_id: user.id,
          purchase_type: 'license',
        },
      }

      if (user.email) {
        customerData.email = user.email
      }

      const customer = await stripe.customers.create(customerData)
      customerId = customer.id
    }

    // Create checkout session for one-time license purchase with embedded mode
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      line_items: [
        {
          price: priceId,
          quantity: seats,
        },
      ],
      mode: 'payment', // Always one-time for licenses
      ui_mode: 'embedded',
      redirect_on_completion: 'if_required',
      return_url: returnUrl || `${req.headers.get('origin')}/portal/downloads?session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        type: 'license',
        product,
        tier,
        seats: seats.toString(),
        supabase_user_id: user.id,
      },
      // Allow promotion codes for discounts
      allow_promotion_codes: true,
    }

    const session = await stripe.checkout.sessions.create(sessionParams)

    return jsonResponse({
      clientSecret: session.client_secret,
      sessionId: session.id,
    })
  } catch (error) {
    if (error instanceof AuthError) return jsonResponse({ error: error.message }, error.status)
    console.error('License checkout error:', error)
    return jsonResponse({ error: error.message }, 500)
  }
})
