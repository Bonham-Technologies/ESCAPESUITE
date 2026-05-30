import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { encode as base64Encode } from 'https://deno.land/std@0.168.0/encoding/base64.ts'
import { jsonResponse, handleOptions } from '../_shared/cors.ts'
import { requireUser, serviceClient, AuthError } from '../_shared/auth.ts'

const PRIVATE_KEY_HEX = Deno.env.get('LICENSE_PRIVATE_KEY')!

interface GetLicenseKeyRequest {
  licenseId: string
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
  if (req.method === 'OPTIONS') return handleOptions()

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const user = await requireUser(req)
    const supabase = serviceClient()

    const body: GetLicenseKeyRequest = await req.json()
    const { licenseId } = body

    if (!licenseId) {
      return jsonResponse({ error: 'Missing required fields' }, 400)
    }

    // Fetch the license from database
    const { data: license, error: licenseError } = await supabase
      .from('licenses')
      .select('*')
      .eq('id', licenseId)
      .single()

    if (licenseError || !license) {
      return jsonResponse({ error: 'License not found' }, 404)
    }

    // Verify ownership: identity comes from the verified JWT, never the body
    if (license.auth_user_id !== user.id) {
      return jsonResponse({ error: 'Unauthorized' }, 403)
    }

    // Check if revoked
    if (license.revoked_at) {
      return jsonResponse({ error: 'License has been revoked' }, 400)
    }

    // Build the license payload
    const payload = {
      id: license.id,
      version: 1,
      customer: {
        id: license.auth_user_id,
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
          user_id: user.id,
          action: 'license.key_retrieved',
          resource_type: 'license',
          resource_id: licenseId,
          metadata: { product: license.product },
        })
      }
    }

    // Track license download (ignore errors if table doesn't exist)
    await supabase.from('license_downloads').insert({
      license_id: licenseId,
      user_id: user.id,
      downloaded_at: new Date().toISOString(),
    })

    return jsonResponse({
      licenseKey,
      product: license.product,
      tier: license.tier,
      expiresAt: license.expires_at,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonResponse({ error: error.message }, error.status)
    }
    console.error('Error retrieving license key:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    return jsonResponse({ error: errorMessage }, 500)
  }
})
