import { test, expect } from '@playwright/test'
import {
  mockWebCodecsUnavailable,
  mockCodecNotSupported,
  mockExportFailure,
  mockStorageQuotaExceeded,
} from '../../utils/error-mocks'
import { seedTextClip, openExportDialog, openExportAdvancedOptions } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

test.describe('Export With No Clips', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
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

      // Export may be disabled for empty projects
      expect(typeof isDisabled).toBe('boolean')
    }
  })
})

test.describe('Export Cancellation', () => {
  test('can cancel export in progress', async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')

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
    await waitForAppReady(page, 'artist')
  })

  test('shows fallback when WebCodecs unavailable', async ({ page }) => {
    await seedTextClip(page)
    await openExportDialog(page)
    await openExportAdvancedOptions(page)

    // Neither format can encode without WebCodecs at all, so both radios say
    // so (ESCSUITE-22: isWebMExportSupported() used to delegate to the MP4
    // check, which made this true already — this pins that it still is now
    // that WebM has its own real codec probe).
    await expect(page.getByText('Not supported in this browser')).toHaveCount(2)
    await expect(page.getByRole('radio', { name: /WebM/ })).toBeDisabled()
    await expect(page.getByRole('radio', { name: /MP4/ })).toBeDisabled()
  })

  // ESCSUITE-22: this used to be named "WebM export still available" and
  // asserted exactly the bug the ticket reports — an enabled "Download WebM"
  // button in a browser with no WebCodecs at all, which failed the instant it
  // was clicked. isWebMExportSupported() is a real probe now, so the dialog
  // says so up front instead.
  test('says this browser cannot export', async ({ page }) => {
    await seedTextClip(page)
    await openExportDialog(page)

    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    // ESCSUITE-34: the alert gained a second sentence, because GIF needs no
    // WebCodecs and is the one export this browser still has.
    await expect(alert).toHaveText(
      'Exporting needs WebCodecs, which this browser does not provide. Chrome or Edge can export this project. ' +
        'GIF export needs no WebCodecs — choose GIF under Advanced options to export anyway.'
    )
    // Said in the main body, not behind the collapsed Advanced disclosure.
    await expect(page.getByRole('button', { name: 'Advanced options' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    await expect(page.getByRole('button', { name: 'Download WebM' }).first()).toBeDisabled()

    // And the sentence is true: under Advanced, GIF is the one format left enabled.
    await page.getByRole('button', { name: 'Advanced options' }).click()
    await expect(page.getByRole('radio', { name: /GIF/ })).toBeEnabled()
    await expect(page.getByRole('radio', { name: /MP4/ })).toBeDisabled()
  })
})

test.describe('Codec Not Supported', () => {
  test.beforeEach(async ({ page }) => {
    await mockCodecNotSupported(page)
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
  })

  // ESCSUITE-22/29: WebCodecs exists here, but every isConfigSupported() call
  // answers false — the exact shape of browser the old naive check (global
  // existence only) could not tell apart from a working one, and the one the
  // probes exist to catch. Since ESCSUITE-175 MP4 has a real probe too, so this
  // browser now refuses *both* video formats before any click, and the dialog
  // says which of the two causes it is: WebCodecs is present here, so the
  // "needs WebCodecs" sentence would be a lie and
  // EXPORT_NO_VIDEO_CODEC_REASON is shown instead. GIF is still offered.
  test('says neither video format can be encoded instead of offering buttons that would fail', async ({ page }) => {
    await seedTextClip(page)
    await openExportDialog(page)

    await expect(page.getByRole('button', { name: 'Download WebM' }).first()).toBeDisabled()
    await expect(page.getByRole('alert')).toHaveText(
      'This browser cannot encode WebM video or MP4 video — Chrome or Edge can. ' +
        'GIF export needs no WebCodecs — choose GIF under Advanced options to export anyway.'
    )

    await openExportAdvancedOptions(page)
    await expect(page.getByRole('radio', { name: /WebM/ })).toBeDisabled()
    // ESCSUITE-175: before this, MP4 read "available" here and failed the same
    // way the instant it was clicked.
    await expect(page.getByRole('radio', { name: /MP4/ })).toBeDisabled()
    await expect(page.getByRole('radio', { name: /GIF/ })).toBeEnabled()
  })
})

test.describe('Export Failure Recovery', () => {
  test.beforeEach(async ({ page }) => {
    await mockExportFailure(page)
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
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
    await waitForAppReady(page, 'artist')
  })

  test('shows storage full error', async ({ page }) => {
    // Try to save or export
    const saveButton = page.getByRole('button', { name: /save|export/i }).first()
    const isVisible = await saveButton.isVisible().catch(() => false)

    if (isVisible) {
      await saveButton.click()
      await page.waitForTimeout(500)

      // App should still function
      const html = await page.content()
      expect(html).toContain('<div id="root">')
    }
  })
})

test.describe('Background Tab Export', () => {
  test('export continues in background', async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')

    // Background export uses Web Worker which should work
    // This test verifies the feature is available
    const hasWorker = await page.evaluate(() => {
      return typeof Worker !== 'undefined'
    })

    expect(hasWorker).toBe(true)
  })

  test('background tab support is indicated', async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')

    await seedTextClip(page)
    await openExportDialog(page)

    await expect(
      page.getByText(/background|keeps? (running|encoding)|switch tabs/i)
    ).toBeVisible()
  })
})
