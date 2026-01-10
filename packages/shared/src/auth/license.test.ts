import { describe, it, expect } from 'vitest'
import { validateLicense, getLicenseInfo, type License } from './license'

// Helper to create a valid license key
function createLicenseKey(license: License): string {
  const payload = btoa(JSON.stringify(license))
  // Simple hash function matching the implementation
  let hash = 0
  for (let i = 0; i < payload.length; i++) {
    const char = payload.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  const signature = Math.abs(hash).toString(16).padStart(8, '0')
  return `${payload}.${signature}`
}

describe('validateLicense', () => {
  const validCraftLicense: License = {
    id: 'lic_123',
    customer: 'Test Customer',
    product: 'craft',
    issued: '2024-01-01',
    expires: null,
  }

  const validArtistLicense: License = {
    id: 'lic_456',
    customer: 'Test Customer',
    product: 'artist',
    issued: '2024-01-01',
    expires: null,
  }

  const validSuiteLicense: License = {
    id: 'lic_789',
    customer: 'Test Customer',
    product: 'suite',
    issued: '2024-01-01',
    expires: null,
  }

  it('returns null for empty license key', () => {
    expect(validateLicense('', 'craft')).toBeNull()
  })

  it('returns null for invalid format (no dot separator)', () => {
    expect(validateLicense('invalidkey', 'craft')).toBeNull()
  })

  it('returns null for invalid base64 payload', () => {
    expect(validateLicense('invalid.signature', 'craft')).toBeNull()
  })

  it('validates a valid craft license for craft product', () => {
    const key = createLicenseKey(validCraftLicense)
    const result = validateLicense(key, 'craft')
    expect(result).not.toBeNull()
    expect(result?.product).toBe('craft')
    expect(result?.customer).toBe('Test Customer')
  })

  it('validates a valid artist license for artist product', () => {
    const key = createLicenseKey(validArtistLicense)
    const result = validateLicense(key, 'artist')
    expect(result).not.toBeNull()
    expect(result?.product).toBe('artist')
  })

  it('validates a suite license for any product', () => {
    const key = createLicenseKey(validSuiteLicense)

    const craftResult = validateLicense(key, 'craft')
    expect(craftResult).not.toBeNull()
    expect(craftResult?.product).toBe('suite')

    const artistResult = validateLicense(key, 'artist')
    expect(artistResult).not.toBeNull()
    expect(artistResult?.product).toBe('suite')
  })

  it('rejects craft license for artist product', () => {
    const key = createLicenseKey(validCraftLicense)
    expect(validateLicense(key, 'artist')).toBeNull()
  })

  it('rejects artist license for craft product', () => {
    const key = createLicenseKey(validArtistLicense)
    expect(validateLicense(key, 'craft')).toBeNull()
  })

  it('rejects expired license', () => {
    const expiredLicense: License = {
      ...validCraftLicense,
      expires: '2020-01-01', // Past date
    }
    const key = createLicenseKey(expiredLicense)
    expect(validateLicense(key, 'craft')).toBeNull()
  })

  it('accepts license with future expiry', () => {
    const futureLicense: License = {
      ...validCraftLicense,
      expires: '2099-12-31',
    }
    const key = createLicenseKey(futureLicense)
    const result = validateLicense(key, 'craft')
    expect(result).not.toBeNull()
    expect(result?.expires).toBe('2099-12-31')
  })

  it('accepts perpetual license (null expires)', () => {
    const key = createLicenseKey(validCraftLicense)
    const result = validateLicense(key, 'craft')
    expect(result).not.toBeNull()
    expect(result?.expires).toBeNull()
  })

  it('rejects license with invalid signature', () => {
    const key = createLicenseKey(validCraftLicense)
    const [payload] = key.split('.')
    const tamperedKey = `${payload}.00000000`
    expect(validateLicense(tamperedKey, 'craft')).toBeNull()
  })

  it('rejects license missing required fields', () => {
    const incompleteLicense = {
      id: 'lic_123',
      customer: 'Test',
      // missing product and issued
    }
    const payload = btoa(JSON.stringify(incompleteLicense))
    let hash = 0
    for (let i = 0; i < payload.length; i++) {
      hash = ((hash << 5) - hash) + payload.charCodeAt(i)
      hash = hash & hash
    }
    const sig = Math.abs(hash).toString(16).padStart(8, '0')
    expect(validateLicense(`${payload}.${sig}`, 'craft')).toBeNull()
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
      product: 'craft',
      issued: '2024-01-01',
      expires: null,
    }
    expect(getLicenseInfo(license)).toBe('Licensed to Acme Corp - Perpetual license')
  })

  it('formats license with expiry date', () => {
    const license: License = {
      id: 'lic_123',
      customer: 'Acme Corp',
      product: 'craft',
      issued: '2024-01-01',
      expires: '2025-12-31',
    }
    const info = getLicenseInfo(license)
    expect(info).toContain('Licensed to Acme Corp')
    expect(info).toContain('Expires:')
  })
})
