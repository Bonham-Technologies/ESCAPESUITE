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
    // Use async version for Deno compatibility with SubtleCrypto
    event = await stripe.webhooks.constructEventAsync(body, signature!, endpointSecret)
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message)
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  console.log('Received event:', event.type)

  // Idempotency: claim this event.id before processing. Stripe delivers
  // at-least-once and retries on non-2xx, so without this a retried
  // checkout.session.completed mints a duplicate (un-revocable) license per
  // payment. The unique PK makes the claim atomic; if the claim already exists
  // the event was processed (or is in-flight), so we ack and skip. On a
  // processing error below we roll the claim back so Stripe's retry reprocesses.
  const { error: claimError } = await supabase
    .from('processed_stripe_events')
    .insert({ event_id: event.id, event_type: event.type })
  if (claimError) {
    if (claimError.code === '23505') {
      console.log(`Duplicate event ${event.id} (${event.type}); skipping`)
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
    // Non-conflict error (e.g. table not yet migrated): log and continue so the
    // webhook keeps working, just without idempotency until the migration lands.
    console.error('Idempotency claim failed (continuing without it):', claimError.message)
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        // Identity is carried in Stripe metadata as the Supabase auth.users UUID.
        const supabaseUserId = session.metadata?.supabase_user_id
        const priceId = session.metadata?.price_id
        const checkoutType = session.metadata?.type // 'organization', 'license', or undefined (individual)
        const organizationId = session.metadata?.organization_id

        // Handle license purchase (standalone)
        if (checkoutType === 'license') {
          const product = session.metadata?.product as 'craft' | 'artist' | 'suite'
          const tier = session.metadata?.tier as 'standard' | 'pro' | 'lifetime'
          const seats = parseInt(session.metadata?.seats || '1', 10)
          const customerEmail = session.customer_details?.email || ''
          const customerName = session.customer_details?.name || undefined
          const stripeCustomerId = session.customer as string

          console.log(`License purchase: ${product} ${tier} x${seats} for ${customerEmail}`)

          // Generate license via the generate-license function (service-role auth)
          const licenseResponse = await fetch(
            `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-license`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              },
              body: JSON.stringify({
                authUserId: supabaseUserId || null,
                stripeCustomerId,
                customerEmail,
                customerName,
                product,
                tier,
                seats,
                stripePaymentId: session.payment_intent as string,
              }),
            }
          )

          if (!licenseResponse.ok) {
            const errorText = await licenseResponse.text()
            console.error('Failed to generate license:', errorText)
            throw new Error(`Failed to generate license: ${errorText}`)
          }

          const licenseData = await licenseResponse.json()
          console.log(`License generated: ${licenseData.licenseId}`)

          // Track the license for analytics
          await supabase.from('license_downloads').insert({
            license_id: licenseData.licenseId,
            user_id: supabaseUserId || null,
            downloaded_at: new Date().toISOString(),
            metadata: { source: 'purchase', product, tier },
          })

          // Send license key via email
          try {
            const emailResponse = await fetch(
              `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-license-email`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                },
                body: JSON.stringify({
                  licenseKey: licenseData.licenseKey,
                  customerEmail,
                  customerName,
                  product,
                  tier,
                }),
              }
            )

            if (!emailResponse.ok) {
              const errorText = await emailResponse.text()
              console.error('Failed to send license email:', errorText)
              // Don't throw - license was generated successfully, email is best-effort
            } else {
              console.log(`License email sent to ${customerEmail}`)
            }
          } catch (emailError) {
            console.error('Error sending license email:', emailError)
            // Don't throw - license was generated successfully
          }

          break
        }

        // Handle site-license purchase (annual subscription -> downloadable Suite license)
        if (checkoutType === 'site_license') {
          if (!supabaseUserId) {
            console.error('No supabase_user_id in session metadata for site_license checkout')
            break
          }
          const band = session.metadata?.band || 'team'
          const seats = parseInt(session.metadata?.seats || '25', 10)
          const customerEmail = session.customer_details?.email || ''
          const customerName = session.customer_details?.name || undefined
          const stripeCustomerId = session.customer as string

          // Annual term from the Stripe subscription -> the license expiry.
          let periodStart = new Date().toISOString()
          let periodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
          if (session.subscription) {
            try {
              const sub = await stripe.subscriptions.retrieve(session.subscription as string)
              periodStart = new Date(sub.current_period_start * 1000).toISOString()
              periodEnd = new Date(sub.current_period_end * 1000).toISOString()
            } catch (e) {
              console.error('Failed to retrieve subscription for site license:', e)
            }
          }

          // Mint the Suite license (full features; expires at term end -> renewal re-issues).
          const licenseResponse = await fetch(
            `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-license`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              },
              body: JSON.stringify({
                authUserId: supabaseUserId,
                stripeCustomerId,
                customerEmail,
                customerName,
                product: 'suite',
                tier: 'pro',
                seats,
                expiresAt: periodEnd,
                stripePaymentId: session.subscription as string,
              }),
            }
          )
          if (!licenseResponse.ok) {
            const errorText = await licenseResponse.text()
            console.error('Failed to generate site license:', errorText)
            throw new Error(`Failed to generate site license: ${errorText}`)
          }
          const licenseData = await licenseResponse.json()
          console.log(`Site license generated (${band}): ${licenseData.licenseId}`)

          // Record the subscription (drives status + renewal handling below).
          await supabase.from('subscriptions').upsert({
            auth_user_id: supabaseUserId,
            stripe_customer_id: stripeCustomerId,
            stripe_subscription_id: session.subscription as string || null,
            status: 'active',
            plan: `site_${band}`,
            seat_count: seats,
            current_period_start: periodStart,
            current_period_end: periodEnd,
          }, { onConflict: 'auth_user_id' })

          // Email the license key (best-effort).
          try {
            await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-license-email`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              },
              body: JSON.stringify({
                licenseKey: licenseData.licenseKey,
                customerEmail,
                customerName,
                product: 'suite',
                tier: 'pro',
              }),
            })
          } catch (e) {
            console.error('Site license email failed (non-fatal):', e)
          }
          break
        }

        // Handle organization checkout
        if (checkoutType === 'organization' && organizationId) {
          if (!supabaseUserId) {
            console.error('No supabase_user_id in session metadata for organization checkout')
            break
          }
          const orgPlan = session.metadata?.plan || 'team'
          const seatCount = parseInt(session.metadata?.seat_count || '5', 10)

          // Activate the organization owner's membership
          await supabase
            .from('organization_members')
            .update({ joined_at: new Date().toISOString() })
            .eq('organization_id', organizationId)
            .eq('user_id', supabaseUserId)
            .eq('role', 'owner')

          // Get actual period dates from Stripe subscription
          let periodStart = new Date().toISOString()
          let periodEnd: string | null = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

          if (session.subscription) {
            try {
              const stripeSubscription = await stripe.subscriptions.retrieve(session.subscription as string)
              periodStart = new Date(stripeSubscription.current_period_start * 1000).toISOString()
              periodEnd = new Date(stripeSubscription.current_period_end * 1000).toISOString()
            } catch (subError) {
              console.error('Failed to retrieve subscription details:', subError)
              // Fall back to defaults
            }
          }

          // Create subscription record linked to organization
          await supabase.from('subscriptions').upsert({
            auth_user_id: supabaseUserId,
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: session.subscription as string || null,
            status: 'active',
            plan: orgPlan,
            organization_id: organizationId,
            seat_count: seatCount,
            current_period_start: periodStart,
            current_period_end: periodEnd,
          }, {
            onConflict: 'auth_user_id',
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
              user_id: supabaseUserId,
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
        if (!supabaseUserId) {
          console.error('No supabase_user_id in session metadata for individual checkout')
          break
        }

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

        // Get actual period dates from Stripe subscription (for subscriptions only)
        let periodStart = new Date().toISOString()
        let periodEnd: string | null = null

        if (status !== 'lifetime' && session.subscription) {
          try {
            const stripeSubscription = await stripe.subscriptions.retrieve(session.subscription as string)
            periodStart = new Date(stripeSubscription.current_period_start * 1000).toISOString()
            periodEnd = new Date(stripeSubscription.current_period_end * 1000).toISOString()
          } catch (subError) {
            console.error('Failed to retrieve subscription details:', subError)
            // Fall back to 30-day default
            periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          }
        }

        // Update subscription record
        await supabase.from('subscriptions').upsert({
          auth_user_id: supabaseUserId,
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: session.subscription as string || null,
          status,
          plan,
          current_period_start: periodStart,
          current_period_end: periodEnd,
        }, {
          onConflict: 'auth_user_id',
        })

        console.log(`Subscription created/updated for ${supabaseUserId}: ${plan}`)
        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string

        // Resolve the local user via the Stripe customer id (reverse lookup).
        const { data: subRecord } = await supabase
          .from('subscriptions')
          .select('auth_user_id, plan')
          .eq('stripe_customer_id', customerId)
          .single()

        if (!subRecord) {
          console.error('No subscription record found for customer:', customerId)
          break
        }

        const status = subscription.status === 'active' ? 'active' :
                       subscription.status === 'canceled' ? 'canceled' :
                       subscription.status === 'trialing' ? 'trialing' : 'expired'

        const newPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString()

        await supabase.from('subscriptions').update({
          status,
          current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          current_period_end: newPeriodEnd,
        }).eq('auth_user_id', subRecord.auth_user_id)

        // Site licenses: on renewal, extend the downloadable Suite license's
        // expiry to the new term end (the org re-downloads a fresh bundle).
        if (subRecord.plan?.startsWith('site_') && status === 'active') {
          await supabase.from('licenses')
            .update({ expires_at: newPeriodEnd })
            .eq('auth_user_id', subRecord.auth_user_id)
            .eq('product', 'suite')
            .is('revoked_at', null)
        }

        console.log(`Subscription updated for ${subRecord.auth_user_id}: ${status}`)
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
    // Roll back the idempotency claim so Stripe's retry of this *failed* event
    // is reprocessed rather than skipped as a duplicate.
    await supabase.from('processed_stripe_events').delete().eq('event_id', event.id)
    return new Response(`Webhook handler error: ${error.message}`, { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
