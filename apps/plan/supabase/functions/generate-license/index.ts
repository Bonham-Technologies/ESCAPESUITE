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

const baseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
}

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
  // Supabase auth.users UUID (null for guest purchases) + Stripe customer id.
  authUserId?: string | null
  stripeCustomerId?: string | null
  customerEmail: string
  customerName?: string
  product: 'craft' | 'artist' | 'suite'
  tier?: 'standard' | 'pro' | 'lifetime'
  seats?: number
  expiresAt?: string
  stripePaymentId?: string
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

  // Ed25519 PKCS8 prefix for 32-byte private key
  const pkcs8Prefix = new Uint8Array([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
    0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20
  ])

  // Combine prefix with private key bytes
  const pkcs8Key = new Uint8Array(pkcs8Prefix.length + privateKeyBytes.length)
  pkcs8Key.set(pkcs8Prefix)
  pkcs8Key.set(privateKeyBytes, pkcs8Prefix.length)

  // Import the private key in PKCS8 format
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8Key,
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
    return new Response(null, { headers: baseHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Internal-only: minting licenses requires the service-role key. This is
  // called server-to-server by the Stripe webhook, never by browsers.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token || token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const body: GenerateLicenseRequest = await req.json()

    const {
      authUserId,
      stripeCustomerId,
      customerEmail,
      customerName,
      product,
      tier = 'standard',
      seats = 1,
      expiresAt,
      stripePaymentId,
    } = body

    // Validate required fields
    if (!customerEmail || !product) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: customerEmail, product' }),
        { status: 400, headers: { ...baseHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate product
    if (!['craft', 'artist', 'suite'].includes(product)) {
      return new Response(
        JSON.stringify({ error: 'Invalid product. Must be: craft, artist, or suite' }),
        { status: 400, headers: { ...baseHeaders, 'Content-Type': 'application/json' } }
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

    // Stable identifier embedded in the signed (offline) license.
    const licenseCustomerId = authUserId || stripeCustomerId || customerEmail

    // Create license payload
    const payload: LicensePayload = {
      id: licenseId,
      version: 1,
      customer: {
        id: licenseCustomerId,
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
      auth_user_id: authUserId || null,
      stripe_customer_id: stripeCustomerId || null,
      customer_email: customerEmail,
      customer_name: customerName || null,
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
        { status: 500, headers: { ...baseHeaders, 'Content-Type': 'application/json' } }
      )
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
      { status: 200, headers: { ...baseHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error generating license:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...baseHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
