import { test, expect, type Page } from '@playwright/test'
import { importMediaAndAddToTimeline, makeToneWav } from '../../utils/artist'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-397: in Safari Private Browsing nothing could be imported or saved.
 *
 * WebKit's ephemeral sessions (Private Browsing, and every Playwright WebKit
 * context) refuse to store a Blob in IndexedDB: `put` fails with `UnknownError`
 * "Error preparing Blob/File data to be stored in object store". ARTIST's
 * import, its project reopen and CRAFT's save all stored the source as a Blob,
 * so each one failed. Now the bytes go in as an `ArrayBuffer` with the MIME
 * type beside them, and are read back as a Blob.
 *
 * The init script reproduces the refusal in Chromium and Firefox. WebKit gets
 * no init script: its own refusal, asynchronous and aborting the transaction,
 * is the one the fix has to recognise.
 */

async function refuseBlobsInIndexedDB(page: Page, browserName: string): Promise<void> {
  if (browserName === 'webkit') return
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (value && typeof value === 'object' && Object.values(value).some((v) => v instanceof Blob)) {
        throw new DOMException('Error preparing Blob/File data to be stored in object store', 'UnknownError')
      }
      return put.call(this, value, key)
    }
  })
}

test.describe('ESCSUITE-397: storage works where IndexedDB refuses Blobs', () => {
  test('ARTIST imports a source onto the timeline', async ({ page, browserName }) => {
    await refuseBlobsInIndexedDB(page, browserName)
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')

    // Without the fix the tile shows the storage error and "Add to timeline"
    // never appears.
    await importMediaAndAddToTimeline(page, {
      name: 'tone.wav',
      mimeType: 'audio/wav',
      buffer: makeToneWav(2),
    })
    await expect(page.getByTitle('tone.wav', { exact: true })).toBeVisible()
  })

  test('CRAFT saves a take to its library', async ({ page, browserName }) => {
    await refuseBlobsInIndexedDB(page, browserName)
    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
    const screenSource = page
      .locator('[class*="sourceToggle"]')
      .filter({ hasText: 'Screen' })
      .last()
    await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Start recording' }).click()
    await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(1500) // a take's length, not an arbitrary pause
    await page.getByRole('button', { name: 'Stop recording' }).click()
    await expect(page.getByRole('button', { name: /^Play / })).toHaveCount(1, { timeout: 30_000 })

    // The library is read back from IndexedDB on load, and playback reads the
    // stored bytes: both have to come back as the take.
    await page.reload()
    await waitForAppReady(page, 'craft')
    await expect(page.getByRole('button', { name: /^Play / })).toHaveCount(1, { timeout: 15_000 })
    await page.getByRole('button', { name: /^Play / }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect
      .poll(() => dialog.locator('video').evaluate((v: HTMLVideoElement) => v.duration), { timeout: 15_000 })
      .toBeGreaterThan(0)
  })
})
