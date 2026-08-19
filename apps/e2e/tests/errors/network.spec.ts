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

    // Capability detection settles before we cut the connection
    const record = page.getByRole('button', { name: 'Start recording' })
    await expect(record).toBeEnabled()

    await mockOffline(page)

    // Recording is entirely local — the recorder must stay usable offline
    await expect(record).toBeVisible()
    await expect(record).toBeEnabled()
    await expect(
      page.locator('[class*="sourceToggle"]').filter({ hasText: 'Screen' }).last().getByRole('button')
    ).toBeEnabled()

    // …and it still reacts to input rather than sitting frozen
    await page.getByRole('button', { name: 'Help - Recording Tips' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await mockOnline(page)
  })

  test('ESCAPEARTIST keeps running after the network drops', async ({ page }) => {
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    const exportButton = page.getByRole('button', { name: 'Export video' })
    await expect(exportButton).toBeVisible()

    await mockOffline(page)

    // Editing is entirely local — the editor chrome must survive going offline
    await expect(exportButton).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save project' })).toBeEnabled()

    // …and it still reacts to input rather than sitting frozen
    await page.getByRole('button', { name: 'Add Text' }).click()
    await expect(page.getByText(/^1 clip · /)).toBeVisible()

    await mockOnline(page)
  })

  test('handles slow network', async ({ page }) => {
    await mockSlowNetwork(page, 2000)

    // Should still load — and reach a usable recorder, not just an empty shell
    await page.goto('http://localhost:5174', { timeout: 60000 })

    await expect(page.getByRole('button', { name: 'Start recording' })).toBeEnabled({
      timeout: 60000,
    })
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
