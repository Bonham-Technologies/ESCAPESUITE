import { Page } from '@playwright/test'

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

/**
 * Generate a mock license key in the ESCAPE- format.
 * Note: The signature is a placeholder since we skip verification in tests.
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

  const payload: LicensePayload = {
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
    signature: 'mock_signature_for_testing',
  }

  // Encode as base64
  const jsonString = JSON.stringify(payload)
  const base64 = btoa(jsonString)

  return `ESCAPE-${base64}`
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

  // Skip signature verification by injecting a mock verifier
  await page.addInitScript(() => {
    // Override the signature verification to always return true for mock licenses
    ;(window as any).__ESCAPE_SKIP_LICENSE_VERIFICATION = true
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
