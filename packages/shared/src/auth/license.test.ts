import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  validateLicense,
  getLicenseInfo,
  hasFeature,
  getLicenseStorageKey,
  saveLicense,
  loadLicense,
  clearLicense,
  type License,
} from './license'

// Helper to create a license key in the new ESCAPE- format
// Note: This creates an unsigned key for testing format parsing
// Signature verification is tested separately
function createTestLicenseKey(license: {
  id: string
  version: number
  customer: { id: string; email: string; name?: string }
  product: 'craft' | 'artist' | 'suite'
  tier: 'standard' | 'pro' | 'lifetime'
  seats: number
  issued: string
  expires?: string
  features?: string[]
}): string {
  const payload = {
    ...license,
    signature: 'test_signature_for_testing_only',
  }
  const json = JSON.stringify(payload)
  const encoded = btoa(json)
  return `ESCAPE-${encoded}`
}

// Mock import.meta.env for testing
vi.stubEnv('VITE_LICENSE_PUBLIC_KEY', '')

describe('validateLicense', () => {
  beforeEach(() => {
    // Clear the license cache before each test
    vi.resetModules()
  })

  const validCraftPayload = {
    id: 'lic_123',
    version: 1,
    customer: { id: 'cus_123', email: 'test@example.com', name: 'Test Customer' },
    product: 'craft' as const,
    tier: 'standard' as const,
    seats: 1,
    issued: '2024-01-01T00:00:00Z',
    features: ['recorder', 'screen_capture'],
  }

  const validArtistPayload = {
    id: 'lic_456',
    version: 1,
    customer: { id: 'cus_456', email: 'artist@example.com' },
    product: 'artist' as const,
    tier: 'pro' as const,
    seats: 1,
    issued: '2024-01-01T00:00:00Z',
    features: ['editor', 'export_4k'],
  }

  const validSuitePayload = {
    id: 'lic_789',
    version: 1,
    customer: { id: 'cus_789', email: 'suite@example.com', name: 'Suite User' },
    product: 'suite' as const,
    tier: 'lifetime' as const,
    seats: 5,
    issued: '2024-01-01T00:00:00Z',
    features: ['recorder', 'editor', 'export_4k', 'no_watermark'],
  }

  it('returns null for empty license key', () => {
    expect(validateLicense('', 'craft')).toBeNull()
  })

  it('returns null for invalid format (no ESCAPE- prefix)', () => {
    expect(validateLicense('invalidkey', 'craft')).toBeNull()
  })

  it('returns null for invalid base64 payload', () => {
    expect(validateLicense('ESCAPE-invalid!!!', 'craft')).toBeNull()
  })

  it('validates a valid craft license for craft product', () => {
    const key = createTestLicenseKey(validCraftPayload)
    const result = validateLicense(key, 'craft')
    expect(result).not.toBeNull()
    expect(result?.product).toBe('craft')
    expect(result?.customer).toBe('Test Customer')
    expect(result?.email).toBe('test@example.com')
  })

  it('validates a valid artist license for artist product', () => {
    const key = createTestLicenseKey(validArtistPayload)
    const result = validateLicense(key, 'artist')
    expect(result).not.toBeNull()
    expect(result?.product).toBe('artist')
    expect(result?.tier).toBe('pro')
  })

  it('validates a suite license for any product', () => {
    const key = createTestLicenseKey(validSuitePayload)

    const craftResult = validateLicense(key, 'craft')
    expect(craftResult).not.toBeNull()
    expect(craftResult?.product).toBe('suite')
    expect(craftResult?.seats).toBe(5)

    const artistResult = validateLicense(key, 'artist')
    expect(artistResult).not.toBeNull()
    expect(artistResult?.product).toBe('suite')
  })

  it('rejects craft license for artist product', () => {
    const key = createTestLicenseKey(validCraftPayload)
    expect(validateLicense(key, 'artist')).toBeNull()
  })

  it('rejects artist license for craft product', () => {
    const key = createTestLicenseKey(validArtistPayload)
    expect(validateLicense(key, 'craft')).toBeNull()
  })

  it('rejects expired license', () => {
    const expiredPayload = {
      ...validCraftPayload,
      expires: '2020-01-01T00:00:00Z',
    }
    const key = createTestLicenseKey(expiredPayload)
    expect(validateLicense(key, 'craft')).toBeNull()
  })

  it('accepts license with future expiry', () => {
    const futurePayload = {
      ...validCraftPayload,
      expires: '2099-12-31T00:00:00Z',
    }
    const key = createTestLicenseKey(futurePayload)
    const result = validateLicense(key, 'craft')
    expect(result).not.toBeNull()
    expect(result?.expires).toBe('2099-12-31T00:00:00Z')
  })

  it('accepts perpetual license (no expires)', () => {
    const key = createTestLicenseKey(validCraftPayload)
    const result = validateLicense(key, 'craft')
    expect(result).not.toBeNull()
    expect(result?.expires).toBeNull()
  })

  it('rejects license missing required fields', () => {
    const incompletePayload = {
      id: 'lic_123',
      version: 1,
      customer: { id: 'cus_123' }, // missing email
      product: 'craft' as const,
      tier: 'standard' as const,
      seats: 1,
      issued: '2024-01-01T00:00:00Z',
    }
    const json = JSON.stringify({ ...incompletePayload, signature: 'test' })
    const key = `ESCAPE-${btoa(json)}`
    expect(validateLicense(key, 'craft')).toBeNull()
  })

  it('preserves features from license', () => {
    const key = createTestLicenseKey(validCraftPayload)
    const result = validateLicense(key, 'craft')
    expect(result?.features).toContain('recorder')
    expect(result?.features).toContain('screen_capture')
  })

  it('uses email as customer name when name not provided', () => {
    const key = createTestLicenseKey(validArtistPayload)
    const result = validateLicense(key, 'artist')
    expect(result?.customer).toBe('artist@example.com')
  })
})

describe('getLicenseInfo', () => {
  it('returns "No license" for null', () => {
    expect(getLicenseInfo(null)).toBe('No license')
  })

  it('formats perpetual license info', () => {
    const license: License = {
      id: 'lic_123',
      customer: 'Acme Corp',
      email: 'acme@example.com',
      product: 'craft',
      tier: 'lifetime',
      seats: 1,
      issued: '2024-01-01',
      expires: null,
      features: [],
    }
    expect(getLicenseInfo(license)).toBe('Licensed to Acme Corp - Perpetual license')
  })

  it('formats license with expiry date', () => {
    const license: License = {
      id: 'lic_123',
      customer: 'Acme Corp',
      email: 'acme@example.com',
      product: 'craft',
      tier: 'standard',
      seats: 1,
      issued: '2024-01-01',
      expires: '2025-12-31',
      features: [],
    }
    const info = getLicenseInfo(license)
    expect(info).toContain('Licensed to Acme Corp')
    expect(info).toContain('Expires:')
  })
})

describe('hasFeature', () => {
  const license: License = {
    id: 'lic_123',
    customer: 'Test',
    email: 'test@example.com',
    product: 'suite',
    tier: 'pro',
    seats: 1,
    issued: '2024-01-01',
    expires: null,
    features: ['recorder', 'editor', 'export_4k', 'no_watermark'],
  }

  it('returns true for existing feature', () => {
    expect(hasFeature(license, 'recorder')).toBe(true)
    expect(hasFeature(license, 'no_watermark')).toBe(true)
  })

  it('returns false for missing feature', () => {
    expect(hasFeature(license, 'priority_support')).toBe(false)
  })

  it('returns false for null license', () => {
    expect(hasFeature(null, 'recorder')).toBe(false)
  })
})

describe('getLicenseStorageKey', () => {
  it('returns correct key for craft', () => {
    expect(getLicenseStorageKey('craft')).toBe('escape_craft_license')
  })

  it('returns correct key for artist', () => {
    expect(getLicenseStorageKey('artist')).toBe('escape_artist_license')
  })
})

describe('license storage functions', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('saves and loads license', () => {
    const key = 'ESCAPE-testkey123'
    saveLicense('craft', key)
    expect(loadLicense('craft')).toBe(key)
  })

  it('returns null for non-existent license', () => {
    expect(loadLicense('craft')).toBeNull()
  })

  it('clears license', () => {
    saveLicense('craft', 'ESCAPE-testkey')
    clearLicense('craft')
    expect(loadLicense('craft')).toBeNull()
  })

  it('stores licenses separately per product', () => {
    saveLicense('craft', 'ESCAPE-craftkey')
    saveLicense('artist', 'ESCAPE-artistkey')
    expect(loadLicense('craft')).toBe('ESCAPE-craftkey')
    expect(loadLicense('artist')).toBe('ESCAPE-artistkey')
  })
})

describe('validateLicenseAsync — fail-closed gate (audit H4)', () => {
  // Tests the no-public-key BEHAVIOR (fail closed in prod, open only in dev) — the
  // actual H4 change, and environment-independent. The real Ed25519 accept/reject
  // round-trip needs Web Crypto Ed25519 (browsers / Node 22+, NOT CI's jsdom+Node 20),
  // so it's covered by the standalone E2E (built with a test key, fed test-signed mock
  // licenses) plus the offline keypair proof — not this jsdom unit suite.

  // Structurally valid; only the no-key path (which returns before signature
  // verification) is exercised here, so a placeholder signature is fine.
  const structurallyValidKey = `ESCAPE-${btoa(
    JSON.stringify({
      id: 'lic_async',
      version: 1,
      customer: { id: 'cus_async', email: 'async@example.com', name: 'Async User' },
      product: 'craft',
      tier: 'pro',
      seats: 1,
      issued: '2026-01-01T00:00:00Z',
      features: ['recorder'],
      signature: 'placeholder',
    })
  )}`

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('fails CLOSED in a production build that has no public key', async () => {
    vi.stubEnv('VITE_LICENSE_PUBLIC_KEY', '')
    vi.stubEnv('DEV', false)
    vi.resetModules()
    const { validateLicenseAsync } = await import('./license')
    expect(await validateLicenseAsync(structurallyValidKey, 'craft')).toBeNull()
  })

  it('fails OPEN (dev convenience) only in a dev build with no public key', async () => {
    vi.stubEnv('VITE_LICENSE_PUBLIC_KEY', '')
    vi.stubEnv('DEV', true)
    vi.resetModules()
    const { validateLicenseAsync } = await import('./license')
    expect(await validateLicenseAsync(structurallyValidKey, 'craft')).not.toBeNull()
  })
})
