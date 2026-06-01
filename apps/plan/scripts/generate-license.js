#!/usr/bin/env node
/**
 * License Generator for ESCAPE Suite (Development/Testing)
 *
 * Usage: node generate-license.js <customer> <product> [expires] [email] [tier]
 *
 * Arguments:
 *   customer - Customer/company name
 *   product  - "craft", "artist", or "suite"
 *   expires  - Optional expiry date (ISO format, e.g., "2026-12-31")
 *   email    - Optional customer email (defaults to test@example.com)
 *   tier     - Optional tier: "standard", "pro", or "lifetime" (defaults to "pro")
 *
 * Examples:
 *   node generate-license.js "Acme Corp" suite
 *   node generate-license.js "Acme Corp" craft "2026-12-31"
 *   node generate-license.js "Test User" artist "" "user@example.com" "lifetime"
 *
 * NOTE: This generates licenses for DEVELOPMENT TESTING only.
 * Production licenses should be generated via the Supabase Edge Function
 * which uses proper Ed25519 cryptographic signatures.
 */

import crypto from 'crypto'

function generateLicense(customer, product, expiresDate, email, tier) {
  const validProducts = ['craft', 'artist', 'suite']
  if (!validProducts.includes(product)) {
    throw new Error(`Invalid product: ${product}. Must be one of: ${validProducts.join(', ')}`)
  }

  const validTiers = ['standard', 'pro', 'lifetime']
  if (tier && !validTiers.includes(tier)) {
    throw new Error(`Invalid tier: ${tier}. Must be one of: ${validTiers.join(', ')}`)
  }

  // Generate a unique license ID
  const licenseId = 'lic_' + crypto.randomBytes(16).toString('hex')

  // Determine features based on product and tier
  const features = []
  if (product === 'craft' || product === 'suite') {
    features.push('recorder', 'screen_capture', 'webcam', 'audio')
  }
  if (product === 'artist' || product === 'suite') {
    features.push('editor', 'export_4k', 'export_mp4', 'effects')
  }
  if (tier === 'pro' || tier === 'lifetime') {
    features.push('no_watermark', 'priority_support')
  }

  // Create license payload in the new ESCAPE- format
  // This matches the SignedLicensePayload interface in packages/shared/src/auth/license.ts
  const payload = {
    id: licenseId,
    version: 1,
    customer: {
      id: 'test_' + crypto.randomBytes(8).toString('hex'),
      email: email || 'test@example.com',
      name: customer,
    },
    product,
    tier: tier || 'pro',
    seats: 1,
    issued: new Date().toISOString(),
    features,
  }

  // Add expiration if specified
  if (expiresDate) {
    payload.expires = expiresDate
  }

  // Generate a placeholder (NOT a real Ed25519) signature.
  // NOTE: this only passes validation in a DEV build (import.meta.env.DEV) where
  // no public key is baked in. Production / shipped standalone builds bake
  // VITE_LICENSE_PUBLIC_KEY and fail closed (audit H4), so these dev licenses are
  // rejected there. For a real signed license use the server's generate-license
  // edge function (or the E2E test key in apps/e2e/utils/license-mocks.ts).
  const signatureData = JSON.stringify(payload)
  const hash = crypto.createHash('sha256').update(signatureData).digest('base64')
  payload.signature = hash

  // Encode as ESCAPE-<base64json>
  const jsonString = JSON.stringify(payload)
  const encoded = Buffer.from(jsonString).toString('base64')
  return `ESCAPE-${encoded}`
}

function main() {
  const args = process.argv.slice(2)

  if (args.length < 2) {
    console.log(`
ESCAPE Suite License Generator (Development/Testing)

Usage: node generate-license.js <customer> <product> [expires] [email] [tier]

Arguments:
  customer - Customer/company name (use quotes for spaces)
  product  - "craft", "artist", or "suite"
  expires  - Optional expiry date (ISO format, e.g., "2026-12-31") - use "" for perpetual
  email    - Optional customer email (defaults to test@example.com)
  tier     - Optional tier: "standard", "pro", or "lifetime" (defaults to "pro")

Examples:
  node generate-license.js "Acme Corp" suite
  node generate-license.js "Acme Corp" craft "2026-12-31"
  node generate-license.js "Test User" artist "" "user@example.com" "lifetime"

NOTE: This generates licenses for DEVELOPMENT TESTING only.
Production licenses use Ed25519 signatures from the Supabase Edge Function.
`)
    process.exit(1)
  }

  const [customer, product, expires, email, tier] = args

  try {
    const licenseKey = generateLicense(customer, product, expires || null, email, tier)

    console.log('\n=== License Generated (Development) ===\n')
    console.log('Customer:', customer)
    console.log('Email:', email || 'test@example.com')
    console.log('Product:', product)
    console.log('Tier:', tier || 'pro')
    console.log('Expires:', expires || 'Never (perpetual)')
    console.log('\nLicense Key:\n')
    console.log(licenseKey)
    console.log('\n=== Build Instructions ===\n')
    console.log('From the monorepo root, build standalone versions:')
    console.log('')

    // Windows-compatible instructions
    const isWindows = process.platform === 'win32'
    const setEnv = isWindows ? 'set' : 'export'
    const andOp = isWindows ? '&&' : '&&'

    if (isWindows) {
      console.log('Windows (PowerShell):')
      if (product === 'craft' || product === 'suite') {
        console.log(`  $env:VITE_BUILD_MODE="standalone"; $env:VITE_LICENSE_KEY="${licenseKey}"; pnpm build:craft`)
      }
      if (product === 'artist' || product === 'suite') {
        console.log(`  $env:VITE_BUILD_MODE="standalone"; $env:VITE_LICENSE_KEY="${licenseKey}"; pnpm build:artist`)
      }
      console.log('')
      console.log('Windows (cmd):')
      if (product === 'craft' || product === 'suite') {
        console.log(`  set VITE_BUILD_MODE=standalone && set VITE_LICENSE_KEY=${licenseKey} && pnpm build:craft`)
      }
      if (product === 'artist' || product === 'suite') {
        console.log(`  set VITE_BUILD_MODE=standalone && set VITE_LICENSE_KEY=${licenseKey} && pnpm build:artist`)
      }
    } else {
      if (product === 'craft' || product === 'suite') {
        console.log('For ESCAPECRAFT:')
        console.log(`  VITE_BUILD_MODE=standalone VITE_LICENSE_KEY="${licenseKey}" pnpm build:craft`)
      }
      if (product === 'artist' || product === 'suite') {
        console.log('For ESCAPEARTIST:')
        console.log(`  VITE_BUILD_MODE=standalone VITE_LICENSE_KEY="${licenseKey}" pnpm build:artist`)
      }
    }
    console.log('')
    console.log('=== Testing ===\n')
    console.log('After building, the standalone HTML files will be in:')
    console.log('  apps/craft/dist/index.html')
    console.log('  apps/artist/dist/index.html')
    console.log('')
    console.log('Open them directly in a browser (file://) or serve with:')
    console.log('  npx serve apps/craft/dist -l 5184')
    console.log('  npx serve apps/artist/dist -l 5185')
    console.log('')
  } catch (error) {
    console.error('Error:', error.message)
    process.exit(1)
  }
}

main()
