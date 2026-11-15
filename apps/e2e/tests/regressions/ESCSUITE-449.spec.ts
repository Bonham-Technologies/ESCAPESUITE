import { test, expect, type Locator, type Page } from '@playwright/test'
import { openRemoveSilences, openSilenceTake } from '../../utils/silenceTake'

/**
 * ESCSUITE-449: "Remove silences" polish. After removing one pause the notice
 * said "Ctrl+Z puts them back"; a take with a locked linked row only learned
 * it was refused after "Remove all". Now the notice reads "puts it back" for
 * one pause, and a locked row is named when the dialog opens, with "Remove all"
 * disabled. Chromium only, as ESCSUITE-403: the take is seeded as Blobs in
 * IndexedDB.
 */

/** The track header button titled `title` on the row `clip` sits on. */
async function rowButton(page: Page, clip: Locator, title: string): Promise<Locator> {
  const row = (await clip.boundingBox())!
  const middle = row.y + row.height / 2
  for (const button of await page.getByTitle(title, { exact: true }).all()) {
    const header = (await button.locator('xpath=ancestor::*[contains(@class, "trackHeader")][1]').boundingBox())!
    if (middle >= header.y && middle <= header.y + header.height) return button
  }
  throw new Error(`no ${title} button level with the clip`)
}

test.describe('ESCSUITE-449: Remove silences polish', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'The take is seeded as Blobs in IndexedDB: Chromium only')

  test('removing one pause says Ctrl+Z puts it back', async ({ page }) => {
    test.setTimeout(90_000)
    await openSilenceTake(page, 'e2e-449-screen')
    const dialog = await openRemoveSilences(page)
    await dialog.getByRole('button', { name: 'Remove all' }).click()
    await expect(page.getByText(/^Removed 1 pause \(\d\.\d\d s\)\. Ctrl\+Z puts it back\./)).toBeVisible()
  })

  test('a locked linked row is named on open and Remove all is disabled', async ({ page }) => {
    test.setTimeout(90_000)
    await openSilenceTake(page, 'e2e-449-locked')
    const micPart = page.locator('[data-clip-id]').filter({ hasText: /microphone/ }).first()
    await (await rowButton(page, micPart, 'Lock track')).click()

    const dialog = await openRemoveSilences(page)
    await expect(dialog.getByRole('alert')).toHaveText(/a track this take sits on is locked/)
    await expect(dialog.getByRole('button', { name: 'Remove all' })).toBeDisabled()
  })
})
