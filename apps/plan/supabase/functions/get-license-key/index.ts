import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { encode as base64Encode } from 'https://deno.land/std@0.168.0/encoding/base64.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const PRIVATE_KEY_HEX = Deno.env.get('LICENSE_PRIVATE_KEY')!

interface GetLicenseKeyRequest {
  licenseId: string
  clerkUserId: string
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
async function signPayload(payload: Record<string, unknown>): Promise<string> {
  const privateKeyBytes = hexToBytes(PRIVATE_KEY_HEX)

  const privateKey = await crypto.subtle.importKey(
    'raw',
    privateKeyBytes,
    { name: 'Ed25519' },
    false,
    ['sign']
  )

  const message = JSON.stringify(payload)
  const messageBytes = new TextEncoder().encode(message)

  const signature = await crypto.subtle.sign(
    'Ed25519',
    privateKey,
    messageBytes
  )

  return base64Encode(new Uint8Array(signature))
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
    const body: GetLicenseKeyRequest = await req.json()
    const { licenseId, clerkUserId } = body

    if (!licenseId || !clerkUserId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Fetch the license from database
    const { data: license, error: licenseError } = await supabase
      .from('licenses')
      .select('*')
      .eq('id', licenseId)
      .single()

    if (licenseError || !license) {
      return new Response(
        JSON.stringify({ error: 'License not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Verify ownership
    if (license.customer_id !== clerkUserId) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Check if revoked
    if (license.revoked_at) {
      return new Response(
        JSON.stringify({ error: 'License has been revoked' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Build the license payload
    const payload = {
      id: license.id,
      version: 1,
      customer: {
        id: license.customer_id,
        email: license.customer_email,
        ...(license.customer_name && { name: license.customer_name }),
      },
      product: license.product,
      tier: license.tier,
      seats: license.seat_count,
      issued: license.issued_at,
      ...(license.expires_at && { expires: license.expires_at }),
      features: license.metadata?.features || [],
    }

    // Sign the payload
    const signature = await signPayload(payload)

    // Create the license key
    const licenseData = { ...payload, signature }
    const json = JSON.stringify(licenseData)
    const encoded = base64Encode(new TextEncoder().encode(json))
    const licenseKey = `ESCAPE-${encoded}`

    // Log the key retrieval
    if (license.organization_id) {
      const { data: org } = await supabase
        .from('organizations')
        .select('settings')
        .eq('id', license.organization_id)
        .single()

      if (org?.settings?.audit_logging) {
        await supabase.from('audit_logs').insert({
          organization_id: license.organization_id,
          user_id: clerkUserId,
          action: 'license.key_retrieved',
          resource_type: 'license',
          resource_id: licenseId,
          metadata: { product: license.product },
        })
      }
    }

    // Track license download
    await supabase.from('license_downloads').insert({
      license_id: licenseId,
      user_id: clerkUserId,
      downloaded_at: new Date().toISOString(),
    }).catch(() => {
      // Ignore if table doesn't exist yet
    })

    return new Response(
      JSON.stringify({
        licenseKey,
        product: license.product,
        tier: license.tier,
        expiresAt: license.expires_at,
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
    console.error('Error retrieving license key:', error)
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
