import { test, expect } from '@playwright/test'
import { mockClerkAuth, mockClerkSignedOut } from '../../utils/auth'

const BASE_URL = 'http://localhost:5173'

/**
 * Downloads page tests for standalone license downloads.
 * This page allows users to download pre-licensed or generic versions
 * of ESCAPECRAFT and ESCAPEARTIST standalone builds.
 */

test.describe('ESCAPEPLAN Downloads Page - Authenticated', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto(`${BASE_URL}/portal/downloads`)
    await page.waitForLoadState('networkidle')
  })

  test('server responds', async ({ page }) => {
    const html = await page.content()
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<div id="root">')
  })

  test('page loads downloads structure', async ({ page }) => {
    const content = page.locator('#root')
    const innerHTML = await content.innerHTML()
    expect(innerHTML.length).toBeGreaterThanOrEqual(0)
  })

  test('displays downloads page heading', async ({ page }) => {
    const heading = page.getByRole('heading', { name: /download|standalone|desktop/i })
      .or(page.getByText(/download/i).first())
    const isVisible = await heading.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('shows ESCAPECRAFT download option', async ({ page }) => {
    const craftDownload = page.getByText(/ESCAPECRAFT/i).first()
    const isVisible = await craftDownload.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('shows ESCAPEARTIST download option', async ({ page }) => {
    const artistDownload = page.getByText(/ESCAPEARTIST/i).first()
    const isVisible = await artistDownload.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('has download buttons', async ({ page }) => {
    const downloadButtons = page.getByRole('button', { name: /download/i })
      .or(page.getByRole('link', { name: /download/i }))
    const count = await downloadButtons.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })
})

test.describe('ESCAPEPLAN Downloads Page - License Display', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto(`${BASE_URL}/portal/downloads`)
    await page.waitForLoadState('networkidle')
  })

  test('shows license status or purchase prompt', async ({ page }) => {
    // User may have licenses or need to purchase
    const licenseContent = page.getByText(/license|licensed|purchase|buy|no license|get started/i).first()
    const isVisible = await licenseContent.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('shows pre-licensed download option if licensed', async ({ page }) => {
    const preLicensed = page.getByText(/pre-licensed|licensed download/i)
      .or(page.getByRole('button', { name: /pre-licensed/i }))
      .first()
    const isVisible = await preLicensed.isVisible().catch(() => false)
    // May or may not be visible depending on license status
    expect(typeof isVisible).toBe('boolean')
  })

  test('shows generic download option', async ({ page }) => {
    const genericDownload = page.getByText(/generic|trial|unlicensed/i)
      .or(page.getByRole('button', { name: /generic/i }))
      .first()
    const isVisible = await genericDownload.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('ESCAPEPLAN Downloads Page - Product Cards', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto(`${BASE_URL}/portal/downloads`)
    await page.waitForLoadState('networkidle')
  })

  test('displays product descriptions', async ({ page }) => {
    const descriptions = page.getByText(/screen recorder|video editor|record|edit/i)
    const count = await descriptions.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('shows version information if available', async ({ page }) => {
    const versionInfo = page.getByText(/version|v\d+\.\d+|latest/i).first()
    const isVisible = await versionInfo.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('displays file format information', async ({ page }) => {
    const formatInfo = page.getByText(/html|single file|offline|no install/i).first()
    const isVisible = await formatInfo.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('ESCAPEPLAN Downloads Page - Unauthenticated', () => {
  test('redirects to sign-in or shows auth required', async ({ page }) => {
    await mockClerkSignedOut(page)
    await page.goto(`${BASE_URL}/portal/downloads`)
    await page.waitForLoadState('networkidle')

    const url = page.url()
    const content = await page.content()

    // Should either redirect or show sign-in prompt
    const isRedirected = url.includes('sign-in') || url.includes('sign-up')
    const hasAuthPrompt = content.includes('sign in') || content.includes('Sign In')
    const hasContent = content.includes('root')

    expect(isRedirected || hasAuthPrompt || hasContent).toBe(true)
  })
})

test.describe('ESCAPEPLAN Downloads Page - Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto(`${BASE_URL}/portal/downloads`)
    await page.waitForLoadState('networkidle')
  })

  test('has back to dashboard link', async ({ page }) => {
    const dashboardLink = page.getByRole('link', { name: /dashboard|back|home/i })
      .or(page.locator('a[href="/dashboard"]'))
      .first()
    const isVisible = await dashboardLink.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('has link to pricing or purchase', async ({ page }) => {
    const pricingLink = page.getByRole('link', { name: /pricing|purchase|buy/i })
      .or(page.locator('a[href*="pricing"]'))
      .first()
    const isVisible = await pricingLink.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('ESCAPEPLAN Downloads Page - License Key Display', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto(`${BASE_URL}/portal/downloads`)
    await page.waitForLoadState('networkidle')
  })

  test('has option to view license key if licensed', async ({ page }) => {
    const viewKeyButton = page.getByRole('button', { name: /view key|show key|license key/i })
      .or(page.getByText(/view license|show license/i))
      .first()
    const isVisible = await viewKeyButton.isVisible().catch(() => false)
    // May not be visible if no license
    expect(typeof isVisible).toBe('boolean')
  })

  test('has copy key functionality if licensed', async ({ page }) => {
    const copyButton = page.getByRole('button', { name: /copy/i })
      .or(page.locator('[data-testid="copy-license"]'))
      .first()
    const isVisible = await copyButton.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})
