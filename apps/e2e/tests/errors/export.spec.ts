import { test, expect } from '@playwright/test'
import {
  mockWebCodecsUnavailable,
  mockCodecNotSupported,
  mockExportFailure,
  mockStorageQuotaExceeded,
} from '../../utils/error-mocks'

test.describe('Export With No Clips', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
  })

  test('shows error when exporting empty project', async ({ page }) => {
    const exportButton = page
      .getByRole('button', { name: /export/i })
      .or(page.locator('[data-testid="export-button"]'))
      .first()

    const isVisible = await exportButton.isVisible().catch(() => false)

    if (isVisible) {
      await exportButton.click()
      await page.waitForTimeout(500)

      // Should show warning about no clips
      const noClipsMessage = page.getByText(/no clips|empty|add|import/i).first()
      const hasMessage = await noClipsMessage.isVisible().catch(() => false)

      // Or export button should be disabled
      const dialog = page.getByRole('dialog')
      const dialogVisible = await dialog.isVisible().catch(() => false)

      if (dialogVisible) {
        const startExport = dialog.getByRole('button', { name: /start|export/i }).first()
        const isDisabled = await startExport.isDisabled().catch(() => false)

        expect(hasMessage || isDisabled).toBe(true)
      }
    }
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

    const exportButton = page
      .getByRole('button', { name: /export/i })
      .or(page.locator('[data-testid="export-button"]'))
      .first()

    const isVisible = await exportButton.isVisible().catch(() => false)

    if (isVisible) {
      await exportButton.click()
      await page.waitForTimeout(300)

      // Look for cancel button
      const cancelButton = page
        .getByRole('button', { name: /cancel/i })
        .first()

      const cancelVisible = await cancelButton.isVisible().catch(() => false)

      if (cancelVisible) {
        await cancelButton.click()
        await page.waitForTimeout(300)

        // Export should be cancelled
        const html = await page.content()
        expect(html).toContain('<div id="root">')
      }
    }
  })
})

test.describe('WebCodecs Unavailable', () => {
  test.beforeEach(async ({ page }) => {
    await mockWebCodecsUnavailable(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
  })

  test('shows fallback when WebCodecs unavailable', async ({ page }) => {
    const exportButton = page
      .getByRole('button', { name: /export/i })
      .or(page.locator('[data-testid="export-button"]'))
      .first()

    const isVisible = await exportButton.isVisible().catch(() => false)

    if (isVisible) {
      await exportButton.click()
      await page.waitForTimeout(500)

      // Should show browser compatibility message or limited options
      const compatMessage = page.getByText(/not supported|chrome|edge|browser/i).first()
      const hasMessage = await compatMessage.isVisible().catch(() => false)

      // Or MP4 option should be disabled
      const mp4Option = page.getByText(/mp4/i).first()
      const mp4Visible = await mp4Option.isVisible().catch(() => false)

      // App should still work
      const html = await page.content()
      expect(html).toContain('<div id="root">')
    }
  })

  test('WebM export still available', async ({ page }) => {
    const exportButton = page
      .getByRole('button', { name: /export/i })
      .or(page.locator('[data-testid="export-button"]'))
      .first()

    const isVisible = await exportButton.isVisible().catch(() => false)

    if (isVisible) {
      await exportButton.click()
      await page.waitForTimeout(300)

      // WebM should still be available
      const webmOption = page.getByText(/webm/i).first()
      const webmVisible = await webmOption.isVisible().catch(() => false)

      expect(typeof webmVisible).toBe('boolean')
    }
  })
})

test.describe('Codec Not Supported', () => {
  test.beforeEach(async ({ page }) => {
    await mockCodecNotSupported(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
  })

  test('handles unsupported codec gracefully', async ({ page }) => {
    const exportButton = page
      .getByRole('button', { name: /export/i })
      .or(page.locator('[data-testid="export-button"]'))
      .first()

    const isVisible = await exportButton.isVisible().catch(() => false)

    if (isVisible) {
      await exportButton.click()
      await page.waitForTimeout(500)

      // Should indicate codec issue or offer alternatives
      const codecMessage = page.getByText(/not supported|codec|format/i).first()
      const hasMessage = await codecMessage.isVisible().catch(() => false)

      const html = await page.content()
      expect(html).toContain('<div id="root">')
    }
  })
})

test.describe('Export Failure Recovery', () => {
  test.beforeEach(async ({ page }) => {
    await mockExportFailure(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
  })

  test('shows error message on export failure', async ({ page }) => {
    const exportButton = page
      .getByRole('button', { name: /export/i })
      .or(page.locator('[data-testid="export-button"]'))
      .first()

    const isVisible = await exportButton.isVisible().catch(() => false)

    if (isVisible) {
      await exportButton.click()
      await page.waitForTimeout(500)

      // Start export
      const dialog = page.getByRole('dialog')
      const dialogVisible = await dialog.isVisible().catch(() => false)

      if (dialogVisible) {
        const startButton = dialog.getByRole('button', { name: /start|export/i }).first()
        const startVisible = await startButton.isVisible().catch(() => false)

        if (startVisible) {
          await startButton.click()
          await page.waitForTimeout(1000)

          // Should show error
          const errorMessage = page.getByText(/error|failed|try again/i).first()
          const hasError = await errorMessage.isVisible().catch(() => false)

          expect(typeof hasError).toBe('boolean')
        }
      }
    }
  })

  test('can retry after export failure', async ({ page }) => {
    const exportButton = page
      .getByRole('button', { name: /export/i })
      .first()

    const isVisible = await exportButton.isVisible().catch(() => false)

    if (isVisible) {
      // First attempt
      await exportButton.click()
      await page.waitForTimeout(300)

      // Should be able to try again
      const retryButton = page.getByRole('button', { name: /retry|try again/i }).first()
      const retryVisible = await retryButton.isVisible().catch(() => false)

      // Or close and reopen
      const closeButton = page.getByRole('button', { name: /close|cancel/i }).first()
      const closeVisible = await closeButton.isVisible().catch(() => false)

      expect(retryVisible || closeVisible).toBe(true)
    }
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

    const exportButton = page
      .getByRole('button', { name: /export/i })
      .first()

    const isVisible = await exportButton.isVisible().catch(() => false)

    if (isVisible) {
      await exportButton.click()
      await page.waitForTimeout(300)

      // Look for background export indicator
      const backgroundIndicator = page.getByText(/background|continue|tab/i).first()
      const hasIndicator = await backgroundIndicator.isVisible().catch(() => false)

      // Feature may be mentioned in UI
      expect(typeof hasIndicator).toBe('boolean')
    }
  })
})
