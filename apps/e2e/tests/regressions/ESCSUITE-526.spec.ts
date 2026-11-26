import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, inspector, openExportDialog } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'
import { playheadSeconds, timelineClips } from '../../utils/timeline'
import { AV_FIXTURE_WEBM } from '../../utils/mediaHealth'

/**
 * ESCSUITE-526: at 1.5x the 5 s fixture ends at 3.333... s, which is no whole
 * number of frames. ESCSUITE-519 refused a section only when its in point was
 * at or past the end, so an in point less than one frame before that end left
 * "Export Section (0:03 - 0:03)" enabled, exporting a section shorter than a
 * frame. Now such a section is refused like one past the end: its button is
 * disabled and the dialog says why, in the same words.
 *
 * The out point is set at the end with End and O, the speed from the
 * inspector, and the in point with I after a click on the ruler half a frame
 * before the clip's right edge, where the timeline ends. The ruler maps a
 * pointer to a time with no snapping to frames. The timeline is zoomed in
 * first (four presses of =, 1.25x each) so a frame is about 4 px wide and a
 * click on a whole pixel, as Firefox and WebKit report it, still lands
 * inside the last frame.
 */

const FPS = 30
const SPED_UP_END = 5 / 1.5

/** Set the (only) clip's speed from the inspector's Speed section. */
async function setSpeed(page: Page, speed: number) {
  await timelineClips(page).first().click({ position: { x: 8, y: 8 } })
  await inspector(page).getByRole('button', { name: /^Speed/ }).click()
  const button = inspector(page).getByRole('button', { name: `${speed}×`, exact: true })
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect(timelineClips(page).first()).toContainText(`${speed}×`)
}

/** The text of every element a control's `aria-describedby` names. */
async function describedBy(page: Page, id: string | null): Promise<string> {
  const texts = await Promise.all(
    (id ?? '').split(/\s+/).filter(Boolean).map((one) => page.locator(`[id="${one}"]`).textContent())
  )
  return texts.join(' ')
}

test.describe('ESCSUITE-526: Export Section refuses less than a frame before a fractional end', () => {
  test.beforeEach(async ({ page }) => {
    // Vercel Analytics' dev script is a third-party host: never reached from a test.
    await page.route('https://va.vercel-scripts.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: '' })
    )
    await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
    await waitForAppReady(page, 'artist')
    await importMediaAndAddToTimeline(page, AV_FIXTURE_WEBM)
  })

  test('an in point within the last frame of a 1.5x clip cannot be exported, and the dialog says why', async ({ page }) => {
    test.setTimeout(120_000)
    // Out point at the end of the 5 s clip, then 1.5x: the timeline is 3.333... s.
    await page.keyboard.press('Escape')
    await page.keyboard.press('End')
    await expect.poll(() => playheadSeconds(page)).toBeCloseTo(5, 1)
    await page.keyboard.press('o')
    await setSpeed(page, 1.5)

    // Zoom in until a frame is several pixels wide. One step at a time: the
    // zoom-in handler scales the zoom it last rendered with, so a press sent
    // before the previous one has rendered would be lost.
    const clipWidth = async () => (await timelineClips(page).first().boundingBox())!.width
    for (let press = 0; press < 4; press++) {
      const before = await clipWidth()
      await page.keyboard.press('=')
      await expect.poll(clipWidth).toBeGreaterThan(before * 1.2)
    }

    // In point half a frame before the end, from a click on the ruler, once
    // the "Out point" notice that sits over the ruler has gone.
    await expect(page.getByText('Out point: 0:05')).toBeHidden({ timeout: 15_000 })
    const clip = (await timelineClips(page).first().boundingBox())!
    const ruler = (await page.getByRole('group', { name: 'Timeline ruler' }).boundingBox())!
    const framePx = clip.width / SPED_UP_END / FPS
    expect(framePx, 'a frame is wide enough to click inside').toBeGreaterThan(3)
    await page.mouse.click(Math.round(clip.x + clip.width - framePx / 2), ruler.y + ruler.height / 2)
    await expect
      .poll(() => playheadSeconds(page), { message: 'the playhead is in the last frame' })
      .toBeGreaterThan(SPED_UP_END - 1 / FPS)
    expect(await playheadSeconds(page), 'the playhead is before the end').toBeLessThan(SPED_UP_END - 0.005)
    await page.keyboard.press('i')

    await openExportDialog(page)
    const section = page.getByRole('button', { name: /^Export Section/ })
    // Before the fix: "Export Section (0:03 - 0:03)", enabled.
    await expect(section).toBeDisabled()
    await expect(section).toHaveText('Export Section (0:03 - 0:05)')
    const reason = 'Cannot export the section: it starts at 0:03, where the timeline ends'
    expect(await describedBy(page, await section.getAttribute('aria-describedby'))).toContain(reason)
    await expect(page.getByText(reason)).toBeVisible()

    // The whole (sped-up) timeline still exports.
    await expect(page.getByRole('button', { name: 'Export Full Video' })).toBeEnabled()
  })
})
