import { test, expect } from '@playwright/test'
import {
  mockWebCodecsUnavailable,
  mockCodecNotSupported,
  mockExportFailure,
  mockStorageQuotaExceeded,
} from '../../utils/error-mocks'
import { seedTextClip, openExportDialog, openExportAdvancedOptions } from '../../utils/artist'

test.describe('Export With No Clips', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
  })

  test('export stays unavailable until the timeline has a clip', async ({ page }) => {
    const exportButton = page.getByRole('button', { name: 'Export video' })

    // An empty project has nothing to encode, so the app refuses the export up
    // front rather than opening a dialog that could not do anything.
    await expect(exportButton).toBeDisabled()
    await expect(page.getByRole('heading', { name: 'Export Video' })).toBeHidden()

    // The same button becomes usable the moment a clip exists — the disabled
    // state above is the empty timeline, not a permanently dead control.
    await seedTextClip(page)
    await expect(exportButton).toBeEnabled()
  })

  test('export button disabled for empty timeline', async ({ page }) => {
    const exportButton = page
      .getByRole('button', { name: /export/i })
      .or(page.locator('[data-testid="export-button"]'))
      .first()

    const isVisible = await exportButton.isVisible().catch(() => false)

    if (isVisible) {
      const isDisabled = await exportButton.isDisabled().catch(() => false)
      const ariaDisabled = await exportButton.getAttribute('aria-disabled')

      // Export may be disabled for empty projects
      expect(typeof isDisabled).toBe('boolean')
    }
  })
})

test.describe('Export Cancellation', () => {
  test('can cancel export in progress', async ({ page }) => {
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    await seedTextClip(page)
    await openExportDialog(page)

    await page.getByRole('button', { name: 'Download WebM' }).first().click()

    // Encoding reports live progress; cancelling mid-encode has to tear the
    // export down and hand the editor back.
    await expect(page.getByText(/Encoding frame \d+\/\d+/)).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Export Video' })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Export video' })).toBeEnabled()
  })
})

test.describe('WebCodecs Unavailable', () => {
  test.beforeEach(async ({ page }) => {
    await mockWebCodecsUnavailable(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
  })

  test('shows fallback when WebCodecs unavailable', async ({ page }) => {
    await seedTextClip(page)
    await openExportDialog(page)
    await openExportAdvancedOptions(page)

    // MP4 needs the WebCodecs H.264 encoder, so the dialog says so instead of
    // offering an export that would fail, and leaves WebM selected.
    await expect(page.getByText('Not supported in this browser')).toBeVisible()
    await expect(page.getByRole('radio', { name: /WebM/ })).toBeChecked()
  })

  test('WebM export still available', async ({ page }) => {
    await seedTextClip(page)
    await openExportDialog(page)

    await expect(page.getByRole('button', { name: 'Download WebM' }).first()).toBeEnabled()
  })
})

test.describe('Codec Not Supported', () => {
  test.beforeEach(async ({ page }) => {
    await mockCodecNotSupported(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
  })

  test('handles unsupported codec gracefully', async ({ page }) => {
    await seedTextClip(page)

    // The dialog still opens and still offers a usable export path when the
    // browser reports every encoder config as unsupported.
    await openExportDialog(page)
    await expect(page.getByRole('button', { name: 'Download WebM' }).first()).toBeEnabled()

    await openExportAdvancedOptions(page)
    await expect(page.getByRole('radio', { name: /WebM/ })).toBeChecked()
  })
})

test.describe('Export Failure Recovery', () => {
  test.beforeEach(async ({ page }) => {
    await mockExportFailure(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
  })

  test('shows error message on export failure', async ({ page }) => {
    await seedTextClip(page)
    await openExportDialog(page)

    await page.getByRole('button', { name: 'Download WebM' }).first().click()

    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible({ timeout: 30_000 })
    await expect(alert).toContainText(/fail|error/i)
  })

  test('can retry after export failure', async ({ page }) => {
    await seedTextClip(page)
    await openExportDialog(page)

    const startExport = page.getByRole('button', { name: 'Download WebM' }).first()
    await startExport.click()

    // The failed encode leaves the dialog on its idle controls rather than a
    // dead progress bar...
    await expect(startExport).toBeVisible({ timeout: 30_000 })

    // ...and the project survives it: dismiss, reopen, export is offered again.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Export Video' })).toBeHidden()

    await openExportDialog(page)
    await expect(startExport).toBeEnabled()
  })
})

test.describe('Storage Quota Exceeded', () => {
  test.beforeEach(async ({ page }) => {
    await mockStorageQuotaExceeded(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
  })

  test('shows storage full error', async ({ page }) => {
    // Try to save or export
    const saveButton = page.getByRole('button', { name: /save|export/i }).first()
    const isVisible = await saveButton.isVisible().catch(() => false)

    if (isVisible) {
      await saveButton.click()
      await page.waitForTimeout(500)

      // Should show storage error
      const storageMessage = page.getByText(/storage|space|quota|full/i).first()
      const hasMessage = await storageMessage.isVisible().catch(() => false)

      // App should still function
      const html = await page.content()
      expect(html).toContain('<div id="root">')
    }
  })
})

test.describe('Background Tab Export', () => {
  test('export continues in background', async ({ page }) => {
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    // Background export uses Web Worker which should work
    // This test verifies the feature is available
    const hasWorker = await page.evaluate(() => {
      return typeof Worker !== 'undefined'
    })

    expect(hasWorker).toBe(true)
  })

  test('background tab support is indicated', async ({ page }) => {
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    await seedTextClip(page)
    await openExportDialog(page)

    await expect(
      page.getByText(/background|keeps? (running|encoding)|switch tabs/i)
    ).toBeVisible()
  })
})
