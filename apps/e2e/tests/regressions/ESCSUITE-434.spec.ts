import { test, expect, type Page } from '@playwright/test'
import {
  SILENCE_CUT,
  clipSpansOf,
  clipsLabelled,
  markerTimes,
  openRemoveSilences,
  openSilenceTake,
  seekByRuler,
} from '../../utils/silenceTake'

/**
 * ESCSUITE-434: "Remove silences" cut the pauses out of a take's own rows only,
 * so a Blur, a marker and the out point after a pause drifted out of step with
 * what they were placed on. "Move everything after each cut" (on by default)
 * moves every unlocked row, the markers and the in/out points by the time cut
 * before them; an overlay a cut crosses is shortened, not split; one Ctrl+Z
 * puts it all back.
 *
 * The take is the A/V fixture (`utils/silenceTake.ts`); its one pause is cut
 * from 2.1 s to 2.9 s. Chromium only, as ESCSUITE-403: the take is seeded as
 * Blobs in IndexedDB.
 */

const CUT_LENGTH = SILENCE_CUT.end - SILENCE_CUT.start
/** Half a timeline pixel at the default zoom, and some: screen boxes round. */
const TOLERANCE = 0.05
const BLUR = /Blur Region/

/** Add a 5 s Blur at `seconds`, from the inspector's empty state. */
async function addBlurAt(page: Page, seconds: number) {
  await seekByRuler(page, seconds)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Blur', exact: true }).click()
}

const outPointTitle = (page: Page) => page.getByTitle(/^Set out point \(O\)/)

async function outPoint(page: Page): Promise<number> {
  const title = (await outPointTitle(page).getAttribute('title')) ?? ''
  const match = /(\d+):(\d+\.\d+)$/.exec(title)
  expect(match, `no out point in "${title}"`).not.toBeNull()
  return Number(match![1]) * 60 + Number(match![2])
}

test.describe('ESCSUITE-434: Remove silences moves everything after each cut', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'The take is seeded as Blobs in IndexedDB: Chromium only')

  test('a Blur, a marker and the out point after the pause move with the take, and one Ctrl+Z restores them', async ({ page }) => {
    test.setTimeout(90_000)
    await openSilenceTake(page, 'e2e-434-screen')

    await test.step('a Blur across the pause, a Blur after it, a marker and an out point after it', async () => {
      await addBlurAt(page, 1)
      await addBlurAt(page, 3.5)
      await seekByRuler(page, 4)
      await page.keyboard.press('Escape')
      await page.keyboard.press('m')
      await page.keyboard.press('o')
      await expect(page.getByText(/^4 clips · 4 tracks$/)).toBeVisible()
      const blurs = await clipSpansOf(page, clipsLabelled(page, BLUR))
      expect(blurs.map((b) => b.start)).toEqual([expect.closeTo(1, 1), expect.closeTo(3.5, 1)])
      expect(await markerTimes(page)).toEqual([expect.closeTo(4, 1)])
    })
    const blursBefore = await clipSpansOf(page, clipsLabelled(page, BLUR))
    const [markerBefore] = await markerTimes(page)
    const outBefore = await outPoint(page)

    await test.step('Remove all, with the box on as it opens', async () => {
      const dialog = await openRemoveSilences(page)
      await expect(dialog.getByRole('checkbox', { name: 'Move everything after each cut' })).toBeChecked()
      await dialog.getByRole('button', { name: 'Remove all' }).click()
      await expect(page.getByRole('dialog')).toBeHidden()
      // The take is cut in two on both rows; each Blur stays one clip.
      await expect(page.getByText(/^6 clips · 4 tracks$/)).toBeVisible()
    })

    await test.step('the Blur across the pause is shortened by it, the one after moves left by it', async () => {
      const [across, after] = await clipSpansOf(page, clipsLabelled(page, BLUR))
      expect(Math.abs(across.start - blursBefore[0].start), 'the Blur across the pause starts where it did').toBeLessThan(TOLERANCE)
      expect(Math.abs(across.end - (blursBefore[0].end - CUT_LENGTH)), 'the Blur across the pause is shortened by it').toBeLessThan(TOLERANCE)
      expect(Math.abs(after.start - (blursBefore[1].start - CUT_LENGTH)), 'the Blur after the pause moves left by it').toBeLessThan(TOLERANCE)
      expect(Math.abs(after.end - after.start - (blursBefore[1].end - blursBefore[1].start)), 'and keeps its length').toBeLessThan(TOLERANCE)
      const [marker] = await markerTimes(page)
      expect(Math.abs(marker - (markerBefore - CUT_LENGTH)), `the marker moves left by the pause (${marker})`).toBeLessThan(TOLERANCE)
      expect(Math.abs((await outPoint(page)) - (outBefore - CUT_LENGTH)), 'the out point moves left by the pause').toBeLessThan(TOLERANCE)
    })

    await test.step('one Ctrl+Z puts the take, both Blurs, the marker and the out point back', async () => {
      await page.locator('body').click({ position: { x: 1, y: 1 } })
      await page.keyboard.press('Control+z')
      await expect(page.getByText(/^4 clips · 4 tracks$/)).toBeVisible()
      const blurs = await clipSpansOf(page, clipsLabelled(page, BLUR))
      for (let i = 0; i < 2; i++) {
        expect(Math.abs(blurs[i].start - blursBefore[i].start)).toBeLessThan(TOLERANCE)
        expect(Math.abs(blurs[i].end - blursBefore[i].end)).toBeLessThan(TOLERANCE)
      }
      expect(Math.abs((await markerTimes(page))[0] - markerBefore)).toBeLessThan(TOLERANCE)
      expect(Math.abs((await outPoint(page)) - outBefore)).toBeLessThan(TOLERANCE)
    })
  })
})
