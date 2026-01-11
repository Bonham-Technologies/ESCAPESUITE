import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
})

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const endpointSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

serve(async (req) => {
  const signature = req.headers.get('stripe-signature')
  const body = await req.text()

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature!, endpointSecret)
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message)
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  console.log('Received event:', event.type)

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const clerkUserId = session.metadata?.clerk_user_id
        const priceId = session.metadata?.price_id
        const checkoutType = session.metadata?.type // 'organization' or undefined (individual)
        const organizationId = session.metadata?.organization_id

        if (!clerkUserId) {
          console.error('No clerk_user_id in session metadata')
          break
        }

        // Handle organization checkout
        if (checkoutType === 'organization' && organizationId) {
          const orgPlan = session.metadata?.plan || 'team'
          const seatCount = parseInt(session.metadata?.seat_count || '5', 10)

          // Activate the organization owner's membership
          await supabase
            .from('organization_members')
            .update({ joined_at: new Date().toISOString() })
            .eq('organization_id', organizationId)
            .eq('user_id', clerkUserId)
            .eq('role', 'owner')

          // Create subscription record linked to organization
          await supabase.from('subscriptions').upsert({
            clerk_user_id: clerkUserId,
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: session.subscription as string || null,
            status: 'active',
            plan: orgPlan,
            organization_id: organizationId,
            seat_count: seatCount,
            current_period_start: new Date().toISOString(),
            current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          }, {
            onConflict: 'clerk_user_id',
          })

          // Log the action (if audit logging enabled)
          const { data: org } = await supabase
            .from('organizations')
            .select('settings')
            .eq('id', organizationId)
            .single()

          if (org?.settings?.audit_logging) {
            await supabase.from('audit_logs').insert({
              organization_id: organizationId,
              user_id: clerkUserId,
              action: 'subscription.created',
              resource_type: 'subscription',
              resource_id: session.subscription as string,
              metadata: { plan: orgPlan, seatCount },
            })
          }

          console.log(`Organization subscription created for ${organizationId}: ${orgPlan} with ${seatCount} seats`)
          break
        }

        // Handle individual checkout (existing logic)
        let plan = 'pro_monthly'
        let status = 'active'

        if (priceId?.includes('annual') || session.mode === 'subscription') {
          // Check if it's annual by the amount or metadata
          const amount = session.amount_total || 0
          plan = amount > 5000 ? 'pro_annual' : 'pro_monthly' // $50+ is annual
        }

        // Check if this is a one-time payment (Founding Member)
        if (session.mode === 'payment') {
          plan = 'founding_member'
          status = 'lifetime'
        }

        // Update subscription record
        await supabase.from('subscriptions').upsert({
          clerk_user_id: clerkUserId,
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: session.subscription as string || null,
          status,
          plan,
          current_period_start: new Date().toISOString(),
          current_period_end: status === 'lifetime'
            ? null
            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
        }, {
          onConflict: 'clerk_user_id',
        })

        console.log(`Subscription created/updated for ${clerkUserId}: ${plan}`)
        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string

        // Get clerk_user_id from our database
        const { data: subRecord } = await supabase
          .from('subscriptions')
          .select('clerk_user_id')
          .eq('stripe_customer_id', customerId)
          .single()

        if (!subRecord) {
          console.error('No subscription record found for customer:', customerId)
          break
        }

        const status = subscription.status === 'active' ? 'active' :
                       subscription.status === 'canceled' ? 'canceled' :
                       subscription.status === 'trialing' ? 'trialing' : 'expired'

        await supabase.from('subscriptions').update({
          status,
          current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        }).eq('clerk_user_id', subRecord.clerk_user_id)

        console.log(`Subscription updated for ${subRecord.clerk_user_id}: ${status}`)
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string

        await supabase.from('subscriptions').update({
          status: 'expired',
          stripe_subscription_id: null,
        }).eq('stripe_customer_id', customerId)

        console.log(`Subscription deleted for customer: ${customerId}`)
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = invoice.customer as string

        await supabase.from('subscriptions').update({
          status: 'past_due',
        }).eq('stripe_customer_id', customerId)

        console.log(`Payment failed for customer: ${customerId}`)
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }
  } catch (error) {
    console.error('Error processing webhook:', error)
    return new Response(`Webhook handler error: ${error.message}`, { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
