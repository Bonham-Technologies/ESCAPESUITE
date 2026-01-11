import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { decode as base64Decode } from 'https://deno.land/std@0.168.0/encoding/base64.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// Public key for verifying signatures (safe to embed)
const PUBLIC_KEY_HEX = Deno.env.get('LICENSE_PUBLIC_KEY')!

interface LicensePayload {
  id: string
  version: number
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
  signature: string
}

interface ValidateLicenseRequest {
  licenseKey: string
  product?: 'craft' | 'artist'  // Which app is validating
  machineHash?: string          // For activation tracking
  appVersion?: string
}

// Convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
  }
  return bytes
}

// Parse and decode a license key
function parseLicenseKey(licenseKey: string): LicensePayload | null {
  try {
    // Remove prefix
    if (!licenseKey.startsWith('ESCAPE-')) {
      return null
    }

    const encoded = licenseKey.substring(7)
    const jsonBytes = base64Decode(encoded)
    const json = new TextDecoder().decode(jsonBytes)
    return JSON.parse(json)
  } catch {
    return null
  }
}

// Verify license signature
async function verifySignature(payload: LicensePayload): Promise<boolean> {
  try {
    const publicKeyBytes = hexToBytes(PUBLIC_KEY_HEX)

    // Import the public key
    const publicKey = await crypto.subtle.importKey(
      'raw',
      publicKeyBytes,
      {
        name: 'Ed25519',
      },
      false,
      ['verify']
    )

    // Reconstruct the payload without signature
    const { signature, ...payloadWithoutSig } = payload
    const message = JSON.stringify(payloadWithoutSig)
    const messageBytes = new TextEncoder().encode(message)

    // Decode signature from base64
    const signatureBytes = base64Decode(signature)

    // Verify
    return await crypto.subtle.verify(
      'Ed25519',
      publicKey,
      signatureBytes,
      messageBytes
    )
  } catch (error) {
    console.error('Signature verification error:', error)
    return false
  }
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
    const body: ValidateLicenseRequest = await req.json()
    const { licenseKey, product, machineHash, appVersion } = body

    if (!licenseKey) {
      return new Response(
        JSON.stringify({ valid: false, error: 'No license key provided' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Parse the license key
    const license = parseLicenseKey(licenseKey)
    if (!license) {
      return new Response(
        JSON.stringify({ valid: false, error: 'Invalid license key format' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Verify signature
    const signatureValid = await verifySignature(license)
    if (!signatureValid) {
      return new Response(
        JSON.stringify({ valid: false, error: 'Invalid license signature' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Check if product matches (if specified)
    if (product) {
      const licenseCoversProduct =
        license.product === 'suite' ||
        license.product === product
      if (!licenseCoversProduct) {
        return new Response(
          JSON.stringify({
            valid: false,
            error: `License is for ${license.product}, not ${product}`,
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }
    }

    // Check expiration
    if (license.expires) {
      const expiresAt = new Date(license.expires)
      if (expiresAt < new Date()) {
        return new Response(
          JSON.stringify({
            valid: false,
            error: 'License has expired',
            expiredAt: license.expires,
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }
    }

    // Check database for revocation
    const { data: dbLicense, error: dbError } = await supabase
      .from('licenses')
      .select('revoked_at, seat_count')
      .eq('id', license.id)
      .single()

    if (dbError && dbError.code !== 'PGRST116') {
      console.error('Database lookup error:', dbError)
      // Don't fail validation if DB is unreachable - allow offline use
    }

    if (dbLicense?.revoked_at) {
      return new Response(
        JSON.stringify({
          valid: false,
          error: 'License has been revoked',
          revokedAt: dbLicense.revoked_at,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Track activation if machine hash provided
    if (machineHash && dbLicense) {
      // Count existing activations
      const { count } = await supabase
        .from('license_activations')
        .select('*', { count: 'exact', head: true })
        .eq('license_id', license.id)

      const maxActivations = dbLicense.seat_count || license.seats || 1

      // Check if this machine is already activated
      const { data: existingActivation } = await supabase
        .from('license_activations')
        .select('id')
        .eq('license_id', license.id)
        .eq('machine_hash', machineHash)
        .single()

      if (!existingActivation) {
        // New activation - check seat limit
        if ((count || 0) >= maxActivations) {
          return new Response(
            JSON.stringify({
              valid: false,
              error: 'Maximum activations reached',
              maxActivations,
              currentActivations: count,
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          )
        }

        // Record new activation
        await supabase.from('license_activations').insert({
          license_id: license.id,
          machine_hash: machineHash,
          app_version: appVersion || null,
          last_seen_at: new Date().toISOString(),
        })
      } else {
        // Update last seen
        await supabase
          .from('license_activations')
          .update({
            last_seen_at: new Date().toISOString(),
            app_version: appVersion || null,
          })
          .eq('id', existingActivation.id)
      }
    }

    // License is valid
    return new Response(
      JSON.stringify({
        valid: true,
        license: {
          id: license.id,
          product: license.product,
          tier: license.tier,
          seats: license.seats,
          issuedAt: license.issued,
          expiresAt: license.expires || null,
          features: license.features || [],
          customer: {
            email: license.customer.email,
          },
        },
        message: 'License is valid',
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
    console.error('Error validating license:', error)
    return new Response(
      JSON.stringify({ valid: false, error: 'Validation error' }),
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
