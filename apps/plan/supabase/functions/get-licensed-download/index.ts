import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { encode as base64Encode } from 'https://deno.land/std@0.168.0/encoding/base64.ts'
import { jsonResponse, handleOptions, corsHeaders } from '../_shared/cors.ts'
import { requireUser, serviceClient, AuthError } from '../_shared/auth.ts'

const PRIVATE_KEY_HEX = Deno.env.get('LICENSE_PRIVATE_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!

const LICENSE_PLACEHOLDER = '__ESCAPE_LICENSE_PLACEHOLDER__'

interface GetLicensedDownloadRequest {
  licenseId: string
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
      id: license.auth_user_id,
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

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') return handleOptions()

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const user = await requireUser(req)
    const supabase = serviceClient()

    const body: GetLicensedDownloadRequest = await req.json()
    const { licenseId, product } = body

    if (!licenseId || !product) {
      return jsonResponse(
        { error: 'Missing required fields: licenseId, product' },
        400
      )
    }

    if (product !== 'craft' && product !== 'artist') {
      return jsonResponse(
        { error: 'Invalid product. Must be "craft" or "artist"' },
        400
      )
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

    // Verify ownership (identity from the verified JWT, not the request body)
    if (license.auth_user_id !== user.id) {
      return jsonResponse(
        { error: 'Unauthorized - you do not own this license' },
        403
      )
    }

    // Check if revoked
    if (license.revoked_at) {
      return jsonResponse({ error: 'License has been revoked' }, 400)
    }

    // Verify the license covers the requested product
    if (license.product !== product && license.product !== 'suite') {
      return jsonResponse(
        { error: `License is for ${license.product}, not ${product}` },
        400
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
      return jsonResponse(
        { error: 'Failed to fetch download file. Please try again later.' },
        500
      )
    }

    let html = await htmlResponse.text()

    // Check if the placeholder exists
    if (!html.includes(LICENSE_PLACEHOLDER)) {
      console.error('License placeholder not found in HTML file')
      return jsonResponse(
        { error: 'Download file is not configured for license injection' },
        500
      )
    }

    // Replace the placeholder with the actual license key
    html = html.replace(LICENSE_PLACEHOLDER, licenseKey)

    // Log the download
    await supabase.from('license_downloads').insert({
      license_id: licenseId,
      user_id: user.id,
      downloaded_at: new Date().toISOString(),
      metadata: { product, type: 'pre-licensed' },
    })

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
    if (error instanceof AuthError) {
      return jsonResponse({ error: error.message }, error.status)
    }
    console.error('Error generating licensed download:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    return jsonResponse({ error: errorMessage }, 500)
  }
})
