import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
  clerkUserId?: string
  email?: string
  product: 'craft' | 'artist' | 'suite'
  tier: 'standard' | 'pro' | 'lifetime'
  seats?: number
  returnUrl?: string
}

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

    const body: CheckoutRequest = await req.json()
    const {
      clerkUserId,
      email,
      product,
      tier,
      seats = 1,
      returnUrl,
    } = body

    // Validate required fields
    if (!product || !tier) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: product, tier' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate product and tier
    if (!['craft', 'artist', 'suite'].includes(product)) {
      return new Response(
        JSON.stringify({ error: 'Invalid product. Must be: craft, artist, or suite' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!['standard', 'pro', 'lifetime'].includes(tier)) {
      return new Response(
        JSON.stringify({ error: 'Invalid tier. Must be: standard, pro, or lifetime' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get the price ID for this product/tier combination
    const priceKey = `${product}_${tier}` as keyof typeof PRICE_IDS
    const priceId = PRICE_IDS[priceKey]

    if (!priceId) {
      return new Response(
        JSON.stringify({ error: `No price configured for ${product} ${tier}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Find or create Stripe customer
    let customerId: string | undefined

    if (clerkUserId) {
      // Check if user already has a Stripe customer ID
      const { data: existingSub } = await supabase
        .from('subscriptions')
        .select('stripe_customer_id')
        .eq('clerk_user_id', clerkUserId)
        .single()

      customerId = existingSub?.stripe_customer_id
    }

    // Create customer if doesn't exist
    if (!customerId) {
      const customerData: Stripe.CustomerCreateParams = {
        metadata: {
          ...(clerkUserId && { clerk_user_id: clerkUserId }),
          purchase_type: 'license',
        },
      }

      if (email) {
        customerData.email = email
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
      return_url: returnUrl || `${req.headers.get('origin')}/portal/downloads?session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        type: 'license',
        product,
        tier,
        seats: seats.toString(),
        ...(clerkUserId && { clerk_user_id: clerkUserId }),
      },
      // Collect email if not provided
      ...(!email && { customer_creation: 'always' }),
      // Allow promotion codes for discounts
      allow_promotion_codes: true,
    }

    // Collect customer email if they're not logged in
    if (!clerkUserId && !email) {
      sessionParams.customer_email = undefined // Let Stripe collect it
    }

    const session = await stripe.checkout.sessions.create(sessionParams)

    return new Response(
      JSON.stringify({
        clientSecret: session.client_secret,
        sessionId: session.id,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('License checkout error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
