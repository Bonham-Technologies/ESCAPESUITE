import { test, expect, type Page } from '@playwright/test'
import { clipSpansOf, clipsLabelled, openRemoveSilences, openSilenceTake, seekByRuler } from '../../utils/silenceTake'

/**
 * ESCSUITE-431: "Remove silences" said nothing about what it leaves where it
 * was. With "Move everything after each cut" cleared, a Blur after the pause
 * stays put while the take closes up under it; the dialog now says so before
 * the cut (as part of its accessible description) and the notice repeats it.
 *
 * The take is the A/V fixture (`utils/silenceTake.ts`); its one pause is cut
 * from 2.1 s to 2.9 s. Chromium only, as ESCSUITE-403.
 */

const BLUR = /Blur Region/
const TOLERANCE = 0.05

async function addBlurAt(page: Page, seconds: number) {
  await seekByRuler(page, seconds)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Blur', exact: true }).click()
}

test.describe('ESCSUITE-431: Remove silences warns about clips it leaves behind', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'The take is seeded as Blobs in IndexedDB: Chromium only')

  test('with the box cleared, a Blur after the pause is counted, stays put, and the notice says so', async ({ page }) => {
    test.setTimeout(90_000)
    await openSilenceTake(page, 'e2e-431-screen')
    await addBlurAt(page, 3.5)
    await expect(page.getByText(/^3 clips · 3 tracks$/)).toBeVisible()
    const [before] = await clipSpansOf(page, clipsLabelled(page, BLUR))

    const dialog = await openRemoveSilences(page)
    const warning = /1 clip on other tracks will not move: 1 blur\./
    // With the box on the Blur moves with the take: nothing is left behind.
    await expect(dialog).not.toContainText(warning)
    await dialog.getByRole('checkbox', { name: 'Move everything after each cut' }).uncheck()
    await expect(dialog).toContainText(warning)
    await expect(dialog).toHaveAccessibleDescription(warning)

    await dialog.getByRole('button', { name: 'Remove all' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByText(/^5 clips · 3 tracks$/)).toBeVisible()
    await expect(page.getByText(/Removed 1 pause .* 1 clip on other tracks did not move: 1 blur\./)).toBeVisible()

    const [after] = await clipSpansOf(page, clipsLabelled(page, BLUR))
    expect(Math.abs(after.start - before.start), 'the Blur starts where it did').toBeLessThan(TOLERANCE)
    expect(Math.abs(after.end - before.end), 'and ends where it did').toBeLessThan(TOLERANCE)
  })
})
