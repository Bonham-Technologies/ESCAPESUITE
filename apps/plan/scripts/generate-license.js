#!/usr/bin/env node
/**
 * License Generator for ESCAPE Suite
 *
 * Usage: node generate-license.js <customer> <product> [expires]
 *
 * Arguments:
 *   customer - Customer/company name
 *   product  - "craft", "artist", or "suite"
 *   expires  - Optional expiry date (ISO format, e.g., "2026-01-01")
 *
 * Examples:
 *   node generate-license.js "Acme Corp" suite
 *   node generate-license.js "Acme Corp" craft "2026-12-31"
 */

import crypto from 'crypto'

// Simple hash function matching the client-side validation
function simpleHash(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

function generateLicense(customer, product, expiresDate) {
  const validProducts = ['craft', 'artist', 'suite']
  if (!validProducts.includes(product)) {
    throw new Error(`Invalid product: ${product}. Must be one of: ${validProducts.join(', ')}`)
  }

  const license = {
    id: crypto.randomUUID(),
    customer,
    product,
    issued: new Date().toISOString(),
    expires: expiresDate || null,
  }

  // Create the payload
  const payload = Buffer.from(JSON.stringify(license)).toString('base64')

  // Generate signature matching client-side validation
  const hashPrefix = simpleHash(payload)

  // Add some additional entropy to make the signature look more substantial
  const extraEntropy = crypto.randomBytes(12).toString('hex')
  const signature = hashPrefix + extraEntropy

  return `${payload}.${signature}`
}

function main() {
  const args = process.argv.slice(2)

  if (args.length < 2) {
    console.log(`
ESCAPE Suite License Generator

Usage: node generate-license.js <customer> <product> [expires]

Arguments:
  customer - Customer/company name (use quotes for spaces)
  product  - "craft", "artist", or "suite"
  expires  - Optional expiry date (ISO format, e.g., "2026-01-01")

Examples:
  node generate-license.js "Acme Corp" suite
  node generate-license.js "Acme Corp" craft "2026-12-31"
  node generate-license.js "Test User" artist
`)
    process.exit(1)
  }

  const [customer, product, expires] = args

  try {
    const licenseKey = generateLicense(customer, product, expires)

    console.log('\n=== License Generated ===\n')
    console.log('Customer:', customer)
    console.log('Product:', product)
    console.log('Expires:', expires || 'Never (perpetual)')
    console.log('\nLicense Key:\n')
    console.log(licenseKey)
    console.log('\n=== Build Instructions ===\n')
    console.log('To build a standalone version with this license:')
    console.log('')
    if (product === 'craft' || product === 'suite') {
      console.log('For ESCAPECRAFT:')
      console.log(`  cd ESCAPECRAFT`)
      console.log(`  VITE_BUILD_MODE=standalone VITE_LICENSE_KEY="${licenseKey}" npm run build`)
    }
    if (product === 'artist' || product === 'suite') {
      console.log('For ESCAPEARTIST:')
      console.log(`  cd ESCAPEARTIST`)
      console.log(`  VITE_BUILD_MODE=standalone VITE_LICENSE_KEY="${licenseKey}" npm run build`)
    }
    console.log('')
  } catch (error) {
    console.error('Error:', error.message)
    process.exit(1)
  }
}

main()
