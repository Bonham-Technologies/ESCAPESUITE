// License validation for standalone mode

export type ProductType = 'craft' | 'artist' | 'suite'
export type LicenseTier = 'standard' | 'pro' | 'lifetime'

export interface License {
  id: string
  customer: string
  email?: string
  product: ProductType
  tier: LicenseTier
  seats: number
  issued: string
  expires: string | null
  features: string[]
}

// New signed license format
interface SignedLicensePayload {
  id: string
  version: number
  customer: {
    id: string
    email: string
    name?: string
  }
  product: ProductType
  tier: LicenseTier
  seats: number
  issued: string
  expires?: string
  features?: string[]
  signature: string
}

// Public key for verifying licenses (embedded at build time)
// This should match LICENSE_PUBLIC_KEY from the server
const PUBLIC_KEY_HEX = import.meta.env.VITE_LICENSE_PUBLIC_KEY || ''

// Convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
  }
  return bytes
}

// Decode base64 to Uint8Array
function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

// Parse the new ESCAPE- license format
function parseNewFormat(licenseKey: string): SignedLicensePayload | null {
  try {
    if (!licenseKey.startsWith('ESCAPE-')) {
      return null
    }

    const encoded = licenseKey.substring(7)
    const jsonBytes = base64ToBytes(encoded)
    const json = new TextDecoder().decode(jsonBytes)
    return JSON.parse(json)
  } catch {
    return null
  }
}

// Helper to ensure we have a proper ArrayBuffer (not SharedArrayBuffer)
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.length)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

// Verify Ed25519 signature using Web Crypto API
async function verifySignatureAsync(payload: SignedLicensePayload): Promise<boolean> {
  if (!PUBLIC_KEY_HEX) {
    // No public key was baked into this build, so the signature CANNOT be
    // verified. Fail OPEN only in a local dev build (import.meta.env.DEV); fail
    // CLOSED in any production build (audit H4). CI's build-standalone now injects
    // VITE_LICENSE_PUBLIC_KEY, and the standalone E2E build bakes a disposable test
    // key — so a keyless build only ever happens in local dev.
    if (import.meta.env.DEV) {
      console.warn('[license] No public key configured — signature verification SKIPPED (dev only).')
      return true
    }
    console.error('[license] No license public key baked into this build — rejecting license (fail closed).')
    return false
  }

  try {
    const publicKeyBytes = hexToBytes(PUBLIC_KEY_HEX)

    // Import the public key
    const publicKey = await crypto.subtle.importKey(
      'raw',
      toArrayBuffer(publicKeyBytes),
      { name: 'Ed25519' },
      false,
      ['verify']
    )

    // Reconstruct the payload without signature
    const { signature, ...payloadWithoutSig } = payload
    const message = JSON.stringify(payloadWithoutSig)
    const messageBytes = new TextEncoder().encode(message)

    // Decode signature from base64
    const signatureBytes = base64ToBytes(signature)

    // Verify
    return await crypto.subtle.verify(
      'Ed25519',
      publicKey,
      toArrayBuffer(signatureBytes),
      messageBytes
    )
  } catch (error) {
    console.error('Signature verification error:', error)
    return false
  }
}

// Cache for validated licenses (avoid re-verifying)
const validatedLicenses = new Map<string, License | null>()

/**
 * Validate a license key for a specific product (synchronous, uses cache).
 *
 * WARNING: this does NOT verify the Ed25519 signature — it only checks the
 * structure, product, and expiry. It must NOT be used for access decisions.
 * Use {@link validateLicenseAsync}, which awaits signature verification and
 * fails closed. Retained for back-compat / displaying license info.
 *
 * @param licenseKey The license key to validate
 * @param product The product to validate against ('craft' or 'artist')
 */
export function validateLicense(licenseKey: string, product: 'craft' | 'artist'): License | null {
  if (!licenseKey) return null

  // Check cache first
  const cacheKey = `${licenseKey}:${product}`
  if (validatedLicenses.has(cacheKey)) {
    return validatedLicenses.get(cacheKey) || null
  }

  // Try new format
  const signedPayload = parseNewFormat(licenseKey)
  if (signedPayload) {
    // Verify basic structure
    if (
      !signedPayload.id ||
      !signedPayload.customer ||
      !signedPayload.customer.email ||
      !signedPayload.product ||
      !signedPayload.issued
    ) {
      validatedLicenses.set(cacheKey, null)
      return null
    }

    // Verify product matches
    if (signedPayload.product !== product && signedPayload.product !== 'suite') {
      validatedLicenses.set(cacheKey, null)
      return null
    }

    // Check expiration
    if (signedPayload.expires) {
      const expiryDate = new Date(signedPayload.expires)
      if (expiryDate < new Date()) {
        validatedLicenses.set(cacheKey, null)
        return null
      }
    }

    // Convert to License format (signature verification is async, done separately)
    const license: License = {
      id: signedPayload.id,
      customer: signedPayload.customer.name || signedPayload.customer.email,
      email: signedPayload.customer.email,
      product: signedPayload.product,
      tier: signedPayload.tier || 'standard',
      seats: signedPayload.seats || 1,
      issued: signedPayload.issued,
      expires: signedPayload.expires || null,
      features: signedPayload.features || [],
    }

    // Structural check only — NO signature verification here. Previously this
    // fired verifySignatureAsync as a background promise and invalidated the
    // cache "later", but callers never re-read the result, so a forged license
    // stayed authorized (audit H3/H5). Access decisions must go through
    // validateLicenseAsync(), which awaits verification and fails closed.
    validatedLicenses.set(cacheKey, license)
    return license
  }

  // Legacy format not supported in new system
  validatedLicenses.set(cacheKey, null)
  return null
}

/**
 * Validate a license key asynchronously with full signature verification
 * @param licenseKey The license key to validate
 * @param product The product to validate against ('craft' or 'artist')
 */
export async function validateLicenseAsync(licenseKey: string, product: 'craft' | 'artist'): Promise<License | null> {
  if (!licenseKey) return null

  const signedPayload = parseNewFormat(licenseKey)
  if (!signedPayload) return null

  // Verify basic structure
  if (
    !signedPayload.id ||
    !signedPayload.customer ||
    !signedPayload.customer.email ||
    !signedPayload.product ||
    !signedPayload.issued
  ) {
    return null
  }

  // Verify product matches
  if (signedPayload.product !== product && signedPayload.product !== 'suite') {
    return null
  }

  // Check expiration
  if (signedPayload.expires) {
    const expiryDate = new Date(signedPayload.expires)
    if (expiryDate < new Date()) {
      return null
    }
  }

  // Verify signature
  const signatureValid = await verifySignatureAsync(signedPayload)
  if (!signatureValid) {
    return null
  }

  return {
    id: signedPayload.id,
    customer: signedPayload.customer.name || signedPayload.customer.email,
    email: signedPayload.customer.email,
    product: signedPayload.product,
    tier: signedPayload.tier || 'standard',
    seats: signedPayload.seats || 1,
    issued: signedPayload.issued,
    expires: signedPayload.expires || null,
    features: signedPayload.features || [],
  }
}

export function getLicenseInfo(license: License | null): string {
  if (!license) return 'No license'

  const expiryInfo = license.expires
    ? `Expires: ${new Date(license.expires).toLocaleDateString()}`
    : 'Perpetual license'

  return `Licensed to ${license.customer} - ${expiryInfo}`
}

/**
 * Check if a license has a specific feature
 */
export function hasFeature(license: License | null, feature: string): boolean {
  if (!license) return false
  return license.features.includes(feature)
}

/**
 * Get the storage key for the license
 */
export function getLicenseStorageKey(product: 'craft' | 'artist'): string {
  return `escape_${product}_license`
}

/**
 * Save license to localStorage
 */
export function saveLicense(product: 'craft' | 'artist', licenseKey: string): void {
  localStorage.setItem(getLicenseStorageKey(product), licenseKey)
}

/**
 * Load license from localStorage
 */
export function loadLicense(product: 'craft' | 'artist'): string | null {
  return localStorage.getItem(getLicenseStorageKey(product))
}

/**
 * Clear license from localStorage
 */
export function clearLicense(product: 'craft' | 'artist'): void {
  localStorage.removeItem(getLicenseStorageKey(product))
  // Clear cache
  for (const key of validatedLicenses.keys()) {
    if (key.endsWith(`:${product}`)) {
      validatedLicenses.delete(key)
    }
  }
}
