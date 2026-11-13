import { test, expect } from '@playwright/test'
import { openRemoveSilences, openSilenceTake } from '../../utils/silenceTake'

/**
 * ESCSUITE-441: in "Remove silences", Enter on a pause's Keep button removed
 * that row, and the focused button with it, so keyboard focus fell to the page
 * body (WCAG 2.4.3). Focus now moves to the next row's Keep, else the previous
 * row's, else Cancel; the status line says how many pauses are left.
 *
 * The take is the A/V fixture (`utils/silenceTake.ts`), which has one pause, so
 * Keep empties the list and focus goes to Cancel. The unit test
 * (`SilenceDialog.test.tsx`) covers the next and previous rows. Chromium only,
 * as ESCSUITE-403: the take is seeded as Blobs in IndexedDB.
 */

test.describe('ESCSUITE-441: Keep in Remove silences keeps keyboard focus in the dialog', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'The take is seeded as Blobs in IndexedDB: Chromium only')

  test('Enter on Keep moves focus to Cancel when no pause is left, not to the page body', async ({ page }) => {
    test.setTimeout(90_000)
    await openSilenceTake(page, 'e2e-441-screen')
    const dialog = await openRemoveSilences(page)

    const keep = dialog.getByRole('button', { name: /^Keep the pause at 0:02\.\d\d$/ })
    await keep.focus()
    await expect(keep).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(dialog.getByRole('status')).toHaveText('No pauses to cut with these settings.')
    await expect(dialog.getByRole('listitem')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY')

    // Focus is on Cancel, so the next Enter closes the dialog, cutting nothing.
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByText(/^2 clips · 2 tracks$/)).toBeVisible()
  })
})
