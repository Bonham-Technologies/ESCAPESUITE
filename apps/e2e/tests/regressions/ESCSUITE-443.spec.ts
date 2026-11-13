import { test, expect, type Locator } from '@playwright/test'
import { openRemoveSilences, openSilenceTake } from '../../utils/silenceTake'
import { playheadSeconds } from '../../utils/timeline'

/**
 * ESCSUITE-443: the "Remove silences" list showed each pause as text with a
 * Keep button, and the modal covers the transport, so a pause could only be
 * judged by its timestamp. Each row now has "Go to" (the playhead to the
 * pause's start) and "Play" (from 1 s before the pause to 1 s after it, then
 * it stops), both named for the pause's time.
 *
 * The take is the A/V fixture (`utils/silenceTake.ts`), with one pause.
 * Chromium only, as ESCSUITE-403: the take is seeded as Blobs in IndexedDB.
 */

/** A listed time, `m:ss.cc`, as a pattern and in seconds. */
const AT = String.raw`\d+:\d\d\.\d\d`

const secondsOf = (clock: string) => {
  const [minutes, rest] = clock.split(':')
  return Number(minutes) * 60 + Number(rest)
}

/** The row's pause, read off its `m:ss.cc – m:ss.cc` text. */
async function pauseOf(row: Locator): Promise<{ start: number; end: number }> {
  const text = (await row.textContent()) ?? ''
  const match = /(\d+:\d\d\.\d\d) – (\d+:\d\d\.\d\d)/.exec(text)
  expect(match, `no pause in "${text}"`).not.toBeNull()
  return { start: secondsOf(match![1]), end: secondsOf(match![2]) }
}

test.describe('ESCSUITE-443: Remove silences lets you go to and play a pause before cutting it', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'The take is seeded as Blobs in IndexedDB: Chromium only')

  test('Go to moves the playhead to the pause, and Play plays it with a second either side, then stops', async ({ page }) => {
    test.setTimeout(90_000)
    await openSilenceTake(page, 'e2e-443-screen')
    const dialog = await openRemoveSilences(page)
    const row = dialog.getByRole('listitem')
    const pause = await pauseOf(row)

    await test.step('Go to, from the keyboard, puts the playhead on the pause start', async () => {
      // Selecting the clip put the playhead where it was clicked, not on the pause.
      expect(Math.abs((await playheadSeconds(page)) - pause.start)).toBeGreaterThan(0.1)
      const goTo = row.getByRole('button', { name: new RegExp(`^Go to the pause at ${AT}$`) })
      await goTo.focus()
      await page.keyboard.press('Enter')
      await expect.poll(() => playheadSeconds(page)).toBeCloseTo(pause.start, 1)
      await expect(row).toHaveAttribute('aria-current', 'true')
      // Nothing is cut and the dialog stays open.
      await expect(dialog.getByRole('status')).toHaveText(/^1 pause found/)
    })

    await test.step('Play plays from 1 s before the pause and stops 1 s after it', async () => {
      const play = row.getByRole('button', { name: new RegExp(`^Play the pause at ${AT}$`) })
      await play.focus()
      await page.keyboard.press('Enter')
      await expect(page.getByTitle('Pause (Space)')).toBeAttached()
      await expect(page.getByTitle('Play (Space)')).toBeAttached({ timeout: 10_000 })
      expect(await playheadSeconds(page)).toBeCloseTo(pause.end + 1, 1)
      await expect(dialog).toBeVisible()
    })
  })

  test('a row keeps its times and all three buttons inside the dialog at 390 px', async ({ page }) => {
    test.setTimeout(90_000)
    await openSilenceTake(page, 'e2e-443-narrow')
    const dialog = await openRemoveSilences(page)
    await page.setViewportSize({ width: 390, height: 844 })
    const list = dialog.getByRole('list', { name: 'Pauses to cut' })
    const listBox = (await list.boundingBox())!
    for (const name of [/^Go to the pause/, /^Play the pause/, /^Keep the pause/]) {
      const box = (await list.getByRole('button', { name }).boundingBox())!
      expect(box.x, `${name} starts inside the list`).toBeGreaterThanOrEqual(listBox.x)
      expect(box.x + box.width, `${name} ends inside the list`).toBeLessThanOrEqual(listBox.x + listBox.width + 0.5)
    }
    expect(await list.evaluate((el) => el.scrollWidth <= el.clientWidth), 'the list does not scroll sideways').toBe(true)
  })
})
