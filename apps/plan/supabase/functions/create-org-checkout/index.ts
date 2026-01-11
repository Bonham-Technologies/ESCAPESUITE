import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CreateOrgCheckoutRequest {
  clerkUserId: string
  email: string
  organizationName: string
  organizationSlug?: string
  plan: 'team' | 'enterprise'
  seatCount: number
  billingPeriod: 'monthly' | 'annual'
  successUrl?: string
  cancelUrl?: string
}

serve(async (req) => {
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

    const body: CreateOrgCheckoutRequest = await req.json()
    const {
      clerkUserId,
      email,
      organizationName,
      plan,
      seatCount,
      billingPeriod,
      successUrl,
      cancelUrl,
    } = body

    if (!clerkUserId || !email || !organizationName || !plan || !seatCount || !billingPeriod) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate seat count
    const minSeats = plan === 'team' ? 2 : 5
    if (seatCount < minSeats) {
      return new Response(
        JSON.stringify({ error: `Minimum ${minSeats} seats required for ${plan} plan` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Generate slug from name if not provided
    const slug = body.organizationSlug || organizationName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50)

    // Check if slug is already taken
    const { data: existingOrg } = await supabase
      .from('organizations')
      .select('id')
      .eq('slug', slug)
      .single()

    if (existingOrg) {
      return new Response(
        JSON.stringify({ error: 'Organization slug already taken' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if user already owns an organization
    const { data: existingMembership } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', clerkUserId)
      .eq('role', 'owner')
      .single()

    if (existingMembership) {
      return new Response(
        JSON.stringify({ error: 'User already owns an organization' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get or create Stripe price for the plan
    // In production, these would be pre-configured price IDs
    // For now, we'll use per-seat pricing with quantity
    const pricePerSeat = plan === 'team'
      ? (billingPeriod === 'monthly' ? 700 : 7000) // $7/month or $70/year per seat
      : (billingPeriod === 'monthly' ? 500 : 5000) // $5/month or $50/year per seat (enterprise)

    // Create or retrieve Stripe customer
    let customerId: string

    // Check if user has an existing customer ID
    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('clerk_user_id', clerkUserId)
      .single()

    if (existingSub?.stripe_customer_id) {
      customerId = existingSub.stripe_customer_id
    } else {
      const customer = await stripe.customers.create({
        email,
        metadata: {
          clerk_user_id: clerkUserId,
          organization_name: organizationName,
        },
      })
      customerId = customer.id
    }

    // Create the organization (will be activated after payment)
    const { data: organization, error: orgError } = await supabase
      .from('organizations')
      .insert({
        name: organizationName,
        slug,
        plan,
        seat_count: seatCount,
        stripe_customer_id: customerId,
        settings: {
          sso_enabled: false,
          require_2fa: false,
          audit_logging: plan === 'enterprise',
          allowed_domains: [],
        },
      })
      .select()
      .single()

    if (orgError) {
      console.error('Create organization error:', orgError)
      throw orgError
    }

    // Add the creator as owner (but not joined yet - will join after payment)
    const { error: memberError } = await supabase
      .from('organization_members')
      .insert({
        organization_id: organization.id,
        user_id: clerkUserId,
        email,
        role: 'owner',
        invited_at: new Date().toISOString(),
        // joined_at will be set after successful payment
      })

    if (memberError) {
      // Rollback organization creation
      await supabase.from('organizations').delete().eq('id', organization.id)
      console.error('Add owner error:', memberError)
      throw memberError
    }

    // Get or create the price
    // In production, use environment variables for price IDs
    const teamMonthlyPriceId = Deno.env.get('STRIPE_PRICE_TEAM_MONTHLY')
    const teamAnnualPriceId = Deno.env.get('STRIPE_PRICE_TEAM_ANNUAL')
    const enterpriseMonthlyPriceId = Deno.env.get('STRIPE_PRICE_ENTERPRISE_MONTHLY')
    const enterpriseAnnualPriceId = Deno.env.get('STRIPE_PRICE_ENTERPRISE_ANNUAL')

    let priceId: string

    if (plan === 'team') {
      priceId = billingPeriod === 'monthly' ? teamMonthlyPriceId! : teamAnnualPriceId!
    } else {
      priceId = billingPeriod === 'monthly' ? enterpriseMonthlyPriceId! : enterpriseAnnualPriceId!
    }

    // If no price ID configured, create dynamic price
    if (!priceId) {
      const price = await stripe.prices.create({
        unit_amount: pricePerSeat,
        currency: 'usd',
        recurring: {
          interval: billingPeriod === 'monthly' ? 'month' : 'year',
        },
        product_data: {
          name: `ESCAPESUITE ${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan`,
        },
      })
      priceId = price.id
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{
        price: priceId,
        quantity: seatCount,
      }],
      mode: 'subscription',
      success_url: successUrl || `${req.headers.get('origin')}/team/${slug}?success=true`,
      cancel_url: cancelUrl || `${req.headers.get('origin')}/pricing?canceled=true`,
      metadata: {
        clerk_user_id: clerkUserId,
        organization_id: organization.id,
        plan,
        seat_count: seatCount.toString(),
        type: 'organization',
      },
      subscription_data: {
        metadata: {
          clerk_user_id: clerkUserId,
          organization_id: organization.id,
          plan,
          seat_count: seatCount.toString(),
        },
      },
      allow_promotion_codes: true,
    })

    return new Response(
      JSON.stringify({
        url: session.url,
        organizationId: organization.id,
        organizationSlug: organization.slug,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Org checkout error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
