import { test, expect } from '@playwright/test'
import {
  mockNetworkFailure,
  mockSlowNetwork,
  mockOffline,
  mockOnline,
} from '../../utils/error-mocks'

/**
 * The suite ships no backend: every app is static and does all of its work in
 * the browser. These tests cover what that promises — the tools keep working
 * when the network degrades or disappears entirely.
 */

test.describe('Graceful Degradation', () => {
  test('ESCAPECRAFT keeps running after the network drops', async ({ page }) => {
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')

    await mockOffline(page)

    // Recording is entirely local — the UI must survive going offline
    const html = await page.content()
    expect(html).toContain('<div id="root">')

    await mockOnline(page)
  })

  test('ESCAPEARTIST keeps running after the network drops', async ({ page }) => {
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    await mockOffline(page)

    const html = await page.content()
    expect(html).toContain('<div id="root">')

    await mockOnline(page)
  })

  test('handles slow network', async ({ page }) => {
    await mockSlowNetwork(page, 2000)

    // Should still load eventually
    await page.goto('http://localhost:5174', { timeout: 60000 })

    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })
})

test.describe('External Request Failures', () => {
  test('landing page renders when outbound requests fail', async ({ page }) => {
    // Nothing on the landing page depends on a remote service; blocking every
    // cross-origin request must not stop it from rendering.
    await mockNetworkFailure(page, /^https?:\/\/(?!localhost)/)

    await page.goto('http://localhost:5173')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})
