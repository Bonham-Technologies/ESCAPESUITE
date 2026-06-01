import { Page } from '@playwright/test'
import crypto from 'node:crypto'

/**
 * Utilities for mocking license validation in E2E tests.
 *
 * These utilities generate mock license keys and inject them into localStorage,
 * allowing tests to simulate licensed standalone app usage.
 */

export type ProductType = 'craft' | 'artist' | 'suite'
export type LicenseTier = 'standard' | 'pro' | 'lifetime'

export interface MockLicenseOptions {
  product: ProductType
  tier?: LicenseTier
  email?: string
  customerName?: string
  expiresInDays?: number | null
  features?: string[]
}

export interface LicensePayload {
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

/**
 * Generate a unique license ID.
 */
function generateLicenseId(): string {
  return `lic_mock_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

// Disposable Ed25519 test keypair. NOT a production key — it exists only to sign
// mock licenses for the standalone E2E, whose build bakes the matching PUBLIC key
// (ci.yml `test-standalone`). The fail-closed gate (audit H4) then verifies them.
//   public key: 334ad57afb4246efec5cea53dd64a0f25828cb3d32da5a38d9661e245436daee
const TEST_PRIVATE_KEY_HEX = '2db9865ba7d7590b8d2ae38be46bb1c6b0b01ea17ebde3b15adc27424c80e110'

// PKCS8 DER prefix for a raw 32-byte Ed25519 seed.
const PKCS8_ED25519_PREFIX = Buffer.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
])

/**
 * Sign a message with the disposable test Ed25519 key. Produces a real signature
 * that verifies against the test public key via Web Crypto — the same path
 * packages/shared/src/auth/license.ts uses. Returns base64.
 */
function signWithTestKey(message: string): string {
  const der = Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(TEST_PRIVATE_KEY_HEX, 'hex')])
  const key = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  return crypto.sign(null, Buffer.from(message, 'utf8'), key).toString('base64')
}

/**
 * Generate a mock license key in the ESCAPE- format, REALLY signed with the
 * disposable test key so it passes the fail-closed signature gate in a build that
 * bakes the matching test public key.
 */
export function generateMockLicenseKey(options: MockLicenseOptions): string {
  const {
    product,
    tier = 'standard',
    email = 'test@example.com',
    customerName = 'Test User',
    expiresInDays = 365,
    features = [],
  } = options

  const now = new Date()
  const issued = now.toISOString()

  let expires: string | undefined
  if (expiresInDays !== null) {
    const expiryDate = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000)
    expires = expiryDate.toISOString()
  }

  // Build the payload WITHOUT the signature and sign exactly that JSON, then
  // append the signature LAST — matching how license.ts reconstructs the signed
  // message ({ signature, ...rest } -> JSON.stringify(rest)).
  const payloadWithoutSig = {
    id: generateLicenseId(),
    version: 1,
    customer: {
      id: `cust_mock_${Math.random().toString(36).substring(2, 9)}`,
      email,
      name: customerName,
    },
    product,
    tier,
    seats: 1,
    issued,
    expires,
    features,
  }

  const signature = signWithTestKey(JSON.stringify(payloadWithoutSig))
  const payload: LicensePayload = { ...payloadWithoutSig, signature }

  return `ESCAPE-${btoa(JSON.stringify(payload))}`
}

/**
 * Mock the license validation endpoints to always return valid for mock licenses.
 */
export async function mockLicenseValidation(page: Page) {
  // Mock the validate-license Edge Function
  await page.route('**/functions/v1/validate-license**', async (route) => {
    const requestBody = route.request().postDataJSON()
    const licenseKey = requestBody?.licenseKey || ''

    if (licenseKey.startsWith('ESCAPE-')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          valid: true,
          message: 'License is valid',
        }),
      })
    } else {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          valid: false,
          error: 'Invalid license format',
        }),
      })
    }
  })

  // Mock get-license-key endpoint
  await page.route('**/functions/v1/get-license-key**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        licenses: [],
      }),
    })
  })

  // Mock get-user-licenses endpoint
  await page.route('**/functions/v1/get-user-licenses**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        licenses: [],
      }),
    })
  })

}

/**
 * Inject a license into localStorage for a specific product.
 */
export async function injectLicense(
  page: Page,
  product: ProductType,
  options?: Partial<MockLicenseOptions>
) {
  const licenseKey = generateMockLicenseKey({
    product,
    ...options,
  })

  const storageKey = `escape_${product === 'suite' ? 'craft' : product}_license`

  await page.addInitScript(
    ({ storageKey, licenseKey }) => {
      localStorage.setItem(storageKey, licenseKey)
    },
    { storageKey, licenseKey }
  )

  // If suite license, also inject for artist
  if (product === 'suite') {
    await page.addInitScript(
      ({ licenseKey }) => {
        localStorage.setItem('escape_artist_license', licenseKey)
      },
      { licenseKey }
    )
  }

  return licenseKey
}

/**
 * Clear all licenses from localStorage.
 */
export async function clearLicenses(page: Page) {
  await page.evaluate(() => {
    localStorage.removeItem('escape_craft_license')
    localStorage.removeItem('escape_artist_license')
  })
}

/**
 * Get the current license from localStorage.
 */
export async function getLicense(page: Page, product: 'craft' | 'artist'): Promise<string | null> {
  return page.evaluate(
    ({ product }) => {
      return localStorage.getItem(`escape_${product}_license`)
    },
    { product }
  )
}

/**
 * Check if a license is present for a product.
 */
export async function hasLicense(page: Page, product: 'craft' | 'artist'): Promise<boolean> {
  const license = await getLicense(page, product)
  return license !== null && license.startsWith('ESCAPE-')
}

/**
 * Mock the get-licensed-download endpoint to return a pre-licensed HTML file.
 */
export async function mockLicensedDownload(page: Page, options: MockLicenseOptions) {
  const licenseKey = generateMockLicenseKey(options)

  await page.route('**/functions/v1/get-licensed-download**', async (route) => {
    // Return mock HTML with embedded license
    const mockHtml = `<!DOCTYPE html>
<html>
<head><title>Mock ${options.product} Download</title></head>
<body>
<script>
  localStorage.setItem('escape_${options.product}_license', '${licenseKey}');
</script>
<div id="root">Mock standalone app content</div>
</body>
</html>`

    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: mockHtml,
    })
  })
}
