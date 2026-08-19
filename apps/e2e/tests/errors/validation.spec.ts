import { test, expect } from '@playwright/test'

/**
 * ESCAPEARTIST accepts a handful of URL parameters from its integration API
 * (`?video=`, `?project=`, `?loadVideo=`). Bad input must never break the app.
 */

test.describe('URL Parameter Validation', () => {
  test('handles invalid video URL parameter', async ({ page }) => {
    await page.goto('http://localhost:5175?video=not-a-valid-url')
    await page.waitForLoadState('networkidle')

    // Should handle gracefully
    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })

  test('handles invalid project parameter', async ({ page }) => {
    await page.goto('http://localhost:5175?project=invalid-base64!!!')
    await page.waitForLoadState('networkidle')

    // Should handle gracefully
    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })

  test('handles missing loadVideo parameter', async ({ page }) => {
    await page.goto('http://localhost:5175?loadVideo=')
    await page.waitForLoadState('networkidle')

    // Should handle gracefully
    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })

  test('handles XSS attempt in URL parameters', async ({ page }) => {
    await page.goto('http://localhost:5175?video=<script>alert(1)</script>')
    await page.waitForLoadState('networkidle')

    // Should not execute script
    const html = await page.content()
    expect(html).toContain('<div id="root">')
    expect(html).not.toContain('<script>alert(1)</script>')
  })
})
