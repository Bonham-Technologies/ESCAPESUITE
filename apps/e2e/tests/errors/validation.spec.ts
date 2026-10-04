import { test, expect } from '@playwright/test'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCAPEARTIST accepts a handful of URL parameters from its integration API
 * (`?video=`, `?project=`, `?loadVideo=`). Bad input must never break the app.
 *
 * ESCSUITE-202 K-3: every case here used to assert nothing beyond
 * `<div id="root">`, which survives any amount of React failure. The real
 * claim each name makes — "handles gracefully" — is that the editor still
 * mounts and is still usable, not merely that a document was served.
 */

test.describe('URL Parameter Validation', () => {
  test('handles invalid video URL parameter', async ({ page }) => {
    await page.goto('http://localhost:5175?video=not-a-valid-url')
    await waitForAppReady(page, 'artist')

    await expect(page.getByRole('button', { name: 'Add Text' })).toBeVisible()
  })

  test('handles invalid project parameter', async ({ page }) => {
    await page.goto('http://localhost:5175?project=invalid-base64!!!')
    await waitForAppReady(page, 'artist')

    await expect(page.getByRole('button', { name: 'Add Text' })).toBeVisible()
  })

  test('handles missing loadVideo parameter', async ({ page }) => {
    await page.goto('http://localhost:5175?loadVideo=')
    await waitForAppReady(page, 'artist')

    await expect(page.getByRole('button', { name: 'Add Text' })).toBeVisible()
  })

  test('handles XSS attempt in URL parameters', async ({ page }) => {
    // The pure negative (no alert fires) is anchored by the positive above
    // it and by the editor actually mounting — a page that crashed before
    // ever running the injected script would also fire no alert.
    let alerted = false
    page.on('dialog', async (dialog) => {
      alerted = true
      await dialog.dismiss()
    })

    await page.goto('http://localhost:5175?video=' + encodeURIComponent('<script>alert(1)</script>'))
    await waitForAppReady(page, 'artist')

    await expect(page.getByRole('button', { name: 'Add Text' })).toBeVisible()
    expect(alerted).toBe(false)
  })
})
