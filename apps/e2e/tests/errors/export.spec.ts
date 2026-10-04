import { test, expect } from '@playwright/test'
import {
  mockWebCodecsUnavailable,
  mockCodecNotSupported,
  mockExportFailure,
  mockStorageQuotaExceeded,
} from '../../utils/error-mocks'
import {
  ARTIST_FIXTURE_MP4,
  seedTextClip,
  openExportDialog,
  openExportAdvancedOptions,
} from '../../utils/artist'
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

  // ESCSUITE-202 K-1/K-4: "export button disabled for empty timeline" used
  // to wrap its only assertion in `if (isVisible)` around a bare
  // `typeof isDisabled === 'boolean'` check — always true, and skipped
  // outright if the locator somehow missed. The test directly above already
  // makes the real claim (disabled, then enabled once a clip exists) with a
  // real assertion, so the weaker sibling is deleted rather than kept
  // alongside it.
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

  // K-U4 (ESCSUITE-207): `MockVideoEncoder` used to declare no
  // `encodeQueueSize` at all, so `core/exportTypes.ts`'s
  // `waitForEncoderBackpressure` — `while (encoder.encodeQueueSize >
  // threshold)` — read `undefined > 0` as `false` and never ran its body
  // under this mock. This does not touch either test above (neither reads
  // the queue); it only proves the stand-in now answers the one question a
  // real exporter's backpressure wait asks an encoder.
  test('MockVideoEncoder.encodeQueueSize grows with encode and resets on flush', async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      type QueuedEncoder = {
        state: string
        encodeQueueSize: number
        configure: (config: unknown) => void
        encode: (frame: unknown) => void
        flush: () => Promise<void>
        close: () => void
      }
      const Ctor = (window as unknown as { VideoEncoder: new (init: unknown) => QueuedEncoder })
        .VideoEncoder
      const encoder = new Ctor({ output: () => {}, error: () => {} })

      encoder.configure({})
      const beforeEncode = encoder.encodeQueueSize

      encoder.encode({})
      encoder.encode({})
      encoder.encode({})
      const afterEncode = encoder.encodeQueueSize

      let flushRejected = false
      try {
        await encoder.flush()
      } catch {
        flushRejected = true
      }
      const afterFlush = encoder.encodeQueueSize

      encoder.close()
      const afterClose = encoder.encodeQueueSize

      return { beforeEncode, afterEncode, flushRejected, afterFlush, afterClose }
    })

    expect(result.beforeEncode).toBe(0)
    expect(result.afterEncode).toBe(3)
    expect(result.flushRejected).toBe(true)
    expect(result.afterFlush).toBe(0)
    expect(result.afterClose).toBe(0)
  })
})

test.describe('Storage Quota Exceeded', () => {
  test.beforeEach(async ({ page }) => {
    await mockStorageQuotaExceeded(page)
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
  })

  test('shows storage full error', async ({ page }) => {
    // ESCSUITE-202 K-5: this used to install the mock and then never write
    // anything — `shows storage full error` with no write to fail.
    //
    // "Save Project" (Ctrl+S) is a file download, not an IndexedDB write —
    // it does not touch `db.put` at all unless the project references a
    // source video. The editor's autosave does write (`saveSessionState`,
    // `db.put('settings', …)`), but its failure is swallowed into
    // `console.error` with nothing shown to the user — a real, surfaced gap,
    // not something this test can observe. Importing media is the one write
    // path whose failure *is* reported: `VideoUploader.tsx`'s catch turns a
    // `QuotaExceededError` from `db.put('videos', …)` into a visible row.
    await page.locator('input[type="file"]').setInputFiles(ARTIST_FIXTURE_MP4)

    await expect(
      page.getByText('Storage quota exceeded. Remove some media to free up space.')
    ).toBeVisible({ timeout: 30_000 })
  })
})

test.describe('Background Tab Export', () => {
  test('an MP4 export runs to completion', async ({ page }) => {
    // ESCSUITE-202 K-9: `typeof Worker !== 'undefined'` tests that Chromium
    // implements the Worker constructor, not that ESCAPEARTIST's export does
    // anything with it. The real claim worth proving is that a real MP4
    // export — the CLAUDE.md-documented "MP4 exports run at full speed even
    // in background tabs" names `core/exportMP4.ts`'s frame loop, a plain
    // `for` loop with no rAF/rVFC in it, as the actual mechanism — reaches
    // completion. Not named for backgrounding: a second page brought to
    // front in the same context (`page.context().newPage()` +
    // `bringToFront()`) still reports `document.visibilityState ===
    // 'visible'` on this `page` under headless Chromium, confirmed by a red
    // run here, so there is no way to drive genuine tab-hidden throttling
    // from this suite — and the app reads no `visibilitychange`/
    // `document.hidden` itself (`grep -rn "visibilitychange|document.hidden"
    // apps/artist/src` has no matches) for a redefined property to exercise
    // either. A real `seedTextClip` + real MP4 encode comfortably clears the
    // default 30s test budget without headroom, so it gets its own.
    test.setTimeout(120_000)

    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
    await seedTextClip(page)
    await openExportDialog(page)
    await openExportAdvancedOptions(page)
    await page.getByRole('radio', { name: /MP4/ }).check()

    await page.getByRole('button', { name: 'Download MP4' }).first().click()
    await expect(page.getByText(/Encoding frame \d+\/\d+/)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Export complete!')).toBeVisible({ timeout: 60_000 })
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
