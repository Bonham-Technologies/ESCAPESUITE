import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { encode as base64Encode } from 'https://deno.land/std@0.168.0/encoding/base64.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const PRIVATE_KEY_HEX = Deno.env.get('LICENSE_PRIVATE_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!

const LICENSE_PLACEHOLDER = '__ESCAPE_LICENSE_PLACEHOLDER__'

interface GetLicensedDownloadRequest {
  licenseId: string
  clerkUserId: string
  product: 'craft' | 'artist'
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

// Generate license key from license record
async function generateLicenseKey(license: Record<string, unknown>): Promise<string> {
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
    features: (license.metadata as Record<string, unknown>)?.features || [],
  }

  const signature = await signPayload(payload)
  const licenseData = { ...payload, signature }
  const json = JSON.stringify(licenseData)
  const encoded = base64Encode(new TextEncoder().encode(json))
  return `ESCAPE-${encoded}`
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const body: GetLicensedDownloadRequest = await req.json()
    const { licenseId, clerkUserId, product } = body

    if (!licenseId || !clerkUserId || !product) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: licenseId, clerkUserId, product' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (product !== 'craft' && product !== 'artist') {
      return new Response(
        JSON.stringify({ error: 'Invalid product. Must be "craft" or "artist"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify ownership
    if (license.customer_id !== clerkUserId) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized - you do not own this license' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if revoked
    if (license.revoked_at) {
      return new Response(
        JSON.stringify({ error: 'License has been revoked' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify the license covers the requested product
    if (license.product !== product && license.product !== 'suite') {
      return new Response(
        JSON.stringify({ error: `License is for ${license.product}, not ${product}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Generate the license key
    const licenseKey = await generateLicenseKey(license)

    // Fetch the base HTML file from storage
    const fileName = product === 'craft' ? 'ESCAPECRAFT-latest.html' : 'ESCAPEARTIST-latest.html'
    const storageUrl = `${SUPABASE_URL}/storage/v1/object/public/downloads/${fileName}`

    const htmlResponse = await fetch(storageUrl)
    if (!htmlResponse.ok) {
      console.error(`Failed to fetch base HTML: ${htmlResponse.status} ${htmlResponse.statusText}`)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch download file. Please try again later.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let html = await htmlResponse.text()

    // Check if the placeholder exists
    if (!html.includes(LICENSE_PLACEHOLDER)) {
      console.error('License placeholder not found in HTML file')
      return new Response(
        JSON.stringify({ error: 'Download file is not configured for license injection' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Replace the placeholder with the actual license key
    html = html.replace(LICENSE_PLACEHOLDER, licenseKey)

    // Log the download
    await supabase.from('license_downloads').insert({
      license_id: licenseId,
      user_id: clerkUserId,
      downloaded_at: new Date().toISOString(),
      metadata: { product, type: 'pre-licensed' },
    })

    // Log to audit if org has it enabled
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
          action: 'license.pre_licensed_download',
          resource_type: 'license',
          resource_id: licenseId,
          metadata: { product },
        })
      }
    }

    // Return the personalized HTML file
    const productName = product === 'craft' ? 'ESCAPECRAFT' : 'ESCAPEARTIST'
    const downloadFileName = `${productName}-licensed.html`

    return new Response(html, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${downloadFileName}"`,
      },
    })
  } catch (error) {
    console.error('Error generating licensed download:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
