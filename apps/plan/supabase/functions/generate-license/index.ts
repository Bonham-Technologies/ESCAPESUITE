import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { encode as base64Encode } from 'https://deno.land/std@0.168.0/encoding/base64.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// Ed25519 key pair for signing licenses
// In production, store these securely in environment variables
const PRIVATE_KEY_HEX = Deno.env.get('LICENSE_PRIVATE_KEY')!
const PUBLIC_KEY_HEX = Deno.env.get('LICENSE_PUBLIC_KEY')!

interface LicensePayload {
  id: string
  version: 1
  customer: {
    id: string
    email: string
    name?: string
  }
  product: 'craft' | 'artist' | 'suite'
  tier: 'standard' | 'pro' | 'lifetime'
  seats: number
  issued: string
  expires?: string
  features?: string[]
}

interface GenerateLicenseRequest {
  customerId: string
  customerEmail: string
  customerName?: string
  product: 'craft' | 'artist' | 'suite'
  tier?: 'standard' | 'pro' | 'lifetime'
  seats?: number
  expiresAt?: string
  stripePaymentId?: string
  organizationId?: string
}

// Generate a random license ID
function generateLicenseId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return 'lic_' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
  }
  return bytes
}

// Sign license payload using Ed25519
async function signLicense(payload: LicensePayload): Promise<string> {
  const privateKeyBytes = hexToBytes(PRIVATE_KEY_HEX)

  // Import the private key
  const privateKey = await crypto.subtle.importKey(
    'raw',
    privateKeyBytes,
    {
      name: 'Ed25519',
    },
    false,
    ['sign']
  )

  // Create the message to sign (canonical JSON)
  const message = JSON.stringify(payload)
  const messageBytes = new TextEncoder().encode(message)

  // Sign the message
  const signature = await crypto.subtle.sign(
    'Ed25519',
    privateKey,
    messageBytes
  )

  return base64Encode(new Uint8Array(signature))
}

// Create the full license key string
function createLicenseKey(payload: LicensePayload, signature: string): string {
  const licenseData = {
    ...payload,
    signature,
  }
  const json = JSON.stringify(licenseData)
  const encoded = base64Encode(new TextEncoder().encode(json))
  return `ESCAPE-${encoded}`
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
      },
    })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const body: GenerateLicenseRequest = await req.json()

    const {
      customerId,
      customerEmail,
      customerName,
      product,
      tier = 'standard',
      seats = 1,
      expiresAt,
      stripePaymentId,
      organizationId,
    } = body

    // Validate required fields
    if (!customerId || !customerEmail || !product) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: customerId, customerEmail, product' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Validate product
    if (!['craft', 'artist', 'suite'].includes(product)) {
      return new Response(
        JSON.stringify({ error: 'Invalid product. Must be: craft, artist, or suite' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Generate license ID
    const licenseId = generateLicenseId()

    // Determine features based on product and tier
    const features: string[] = []
    if (product === 'craft' || product === 'suite') {
      features.push('recorder', 'screen_capture', 'webcam', 'audio')
    }
    if (product === 'artist' || product === 'suite') {
      features.push('editor', 'export_4k', 'export_mp4', 'effects')
    }
    if (tier === 'pro' || tier === 'lifetime') {
      features.push('no_watermark', 'priority_support')
    }

    // Create license payload
    const payload: LicensePayload = {
      id: licenseId,
      version: 1,
      customer: {
        id: customerId,
        email: customerEmail,
        ...(customerName && { name: customerName }),
      },
      product,
      tier,
      seats,
      issued: new Date().toISOString(),
      ...(expiresAt && { expires: expiresAt }),
      features,
    }

    // Sign the license
    const signature = await signLicense(payload)

    // Create the encoded license key
    const licenseKey = createLicenseKey(payload, signature)

    // Store in database
    const { error: dbError } = await supabase.from('licenses').insert({
      id: licenseId,
      customer_id: customerId,
      customer_email: customerEmail,
      customer_name: customerName || null,
      organization_id: organizationId || null,
      product,
      tier,
      seat_count: seats,
      issued_at: payload.issued,
      expires_at: expiresAt || null,
      stripe_payment_id: stripePaymentId || null,
      metadata: { features },
    })

    if (dbError) {
      console.error('Database error:', dbError)
      return new Response(
        JSON.stringify({ error: 'Failed to store license' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Log the license creation
    if (organizationId) {
      await supabase.from('audit_logs').insert({
        organization_id: organizationId,
        user_id: customerId,
        action: 'license.created',
        resource_type: 'license',
        resource_id: licenseId,
        metadata: { product, tier, seats },
      })
    }

    return new Response(
      JSON.stringify({
        licenseId,
        licenseKey,
        product,
        tier,
        seats,
        issuedAt: payload.issued,
        expiresAt: payload.expires || null,
        features,
        message: 'License generated successfully',
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    )
  } catch (error) {
    console.error('Error generating license:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    )
  }
})
