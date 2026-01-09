// License validation for standalone mode

export interface License {
  id: string
  customer: string
  product: 'craft' | 'artist' | 'suite'
  issued: string
  expires: string | null
}

// Simple hash function for client-side signature verification
// Note: This is not cryptographically secure, but provides basic protection
function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

export function validateLicense(licenseKey: string): License | null {
  if (!licenseKey) return null

  try {
    const [payload, signature] = licenseKey.split('.')
    if (!payload || !signature) return null

    // Decode the license payload
    const decoded = atob(payload)
    const license: License = JSON.parse(decoded)

    // Verify basic structure
    if (!license.id || !license.customer || !license.product || !license.issued) {
      return null
    }

    // Verify product matches this app
    if (license.product !== 'craft' && license.product !== 'suite') {
      return null
    }

    // Check expiration
    if (license.expires) {
      const expiryDate = new Date(license.expires)
      if (expiryDate < new Date()) {
        return null
      }
    }

    // Basic signature check (payload hash should match)
    // In production, use HMAC with a shared secret embedded at build time
    const expectedSig = simpleHash(payload)
    if (!signature.startsWith(expectedSig.slice(0, 8))) {
      return null
    }

    return license
  } catch {
    return null
  }
}

export function getLicenseInfo(license: License | null): string {
  if (!license) return 'No license'

  const expiryInfo = license.expires
    ? `Expires: ${new Date(license.expires).toLocaleDateString()}`
    : 'Perpetual license'

  return `Licensed to ${license.customer} - ${expiryInfo}`
}
