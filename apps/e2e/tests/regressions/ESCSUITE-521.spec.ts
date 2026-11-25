import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, inspector, makeToneWav } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'
import { clipSpansOf, clipsLabelled, markerTimes, seekByRuler } from '../../utils/silenceTake'

/**
 * ESCSUITE-521: a clip's speed change ripples only the clip's own rows, so a
 * caption and a chapter marker after it stay where they were, out of step
 * with what they were placed on, and nothing said so. The change now names
 * what did not move in one status notice, in "Remove silences'" words; with
 * nothing left behind there is no notice; one Ctrl+Z still puts it all back.
 *
 * The take is a 6 s tone split at 3 s: the first piece is set to 2×, so the
 * second moves from 3 s to 1.5 s, while a caption at 4–5 s and a marker at
 * 5.5 s stay put. Synthesised WAV and an SRT through the library's file
 * input: every browser.
 */

const TONE = /^tone\.wav/
const CAPTION = /Still here/
/** Half a timeline pixel at the default zoom, and some: screen boxes round. */
const TOLERANCE = 0.05
const SRT = ['1', '00:00:04,000 --> 00:00:05,000', 'Still here.', ''].join('\n')
const NOTICE = '1 clip on other tracks did not move: 1 caption. 1 marker did not move.'

/** The tone's pieces, left to right. */
const tonePieces = (page: Page) => clipSpansOf(page, clipsLabelled(page, TONE))

/** Click the leftmost tone piece, selecting it. */
async function selectFirstPiece(page: Page) {
  const pieces = clipsLabelled(page, TONE)
  const lefts = await pieces.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().left))
  await pieces.nth(lefts.indexOf(Math.min(...lefts))).click({ position: { x: 8, y: 8 } })
}

/** The editor's status notice saying what a change left behind. */
const leftBehindNotice = (page: Page) => page.getByRole('status').filter({ hasText: 'did not move' })

async function setSpeed(page: Page, label: string) {
  const section = inspector(page).getByRole('button', { name: /^Speed/ })
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click()
  await inspector(page).getByRole('button', { name: label, exact: true }).click()
  await expect(inspector(page).getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true')
}

test.describe('ESCSUITE-521: a speed change says what it left behind', () => {
  test.beforeEach(async ({ page }) => {
    // Vercel Analytics' dev script is a third-party host: never reached from a test.
    await page.route('https://va.vercel-scripts.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: '' })
    )
    test.setTimeout(90_000)
    await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
    await waitForAppReady(page, 'artist')
    await importMediaAndAddToTimeline(page, { name: 'tone.wav', mimeType: 'audio/wav', buffer: makeToneWav(6) })
    // Split at 3 s: two pieces on one row, the second after the first.
    await selectFirstPiece(page)
    await seekByRuler(page, 3)
    await page.keyboard.press('Control+b')
    await expect(page.getByText(/^2 clips · /)).toBeVisible()
  })

  test('a caption and a marker after the sped clip are named in one status notice, and Ctrl+Z restores the timeline', async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles({ name: 'talk.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(SRT) })
    await expect(page.getByText('Imported 1 caption onto the Captions track.')).toBeVisible({ timeout: 15_000 })
    await seekByRuler(page, 5.5)
    await page.keyboard.press('Escape')
    await page.keyboard.press('m')
    await expect(page.getByText(/^3 clips · /)).toBeVisible()
    expect(await markerTimes(page)).toEqual([expect.closeTo(5.5, 1)])

    const piecesBefore = await tonePieces(page)
    const [captionBefore] = await clipSpansOf(page, clipsLabelled(page, CAPTION))
    expect(piecesBefore.map((p) => p.start)).toEqual([expect.closeTo(0, 1), expect.closeTo(3, 1)])

    await selectFirstPiece(page)
    await setSpeed(page, '2×')

    // AC1 and AC3: one notice, announced as a status message.
    await expect(leftBehindNotice(page)).toHaveText(NOTICE)
    await expect(leftBehindNotice(page)).toHaveCount(1)

    // The ripple moved the second piece; the caption and the marker stayed.
    const piecesAfter = await tonePieces(page)
    expect(Math.abs(piecesAfter[0].end - 1.5), 'the sped piece runs 1.5 s').toBeLessThan(TOLERANCE)
    expect(Math.abs(piecesAfter[1].start - 1.5), 'the second piece moves up to 1.5 s').toBeLessThan(TOLERANCE)
    const [captionAfter] = await clipSpansOf(page, clipsLabelled(page, CAPTION))
    expect(Math.abs(captionAfter.start - captionBefore.start), 'the caption did not move').toBeLessThan(TOLERANCE)
    expect((await markerTimes(page))[0]).toBeCloseTo(5.5, 1)

    // AC4: one Ctrl+Z puts the pieces back where they were.
    await page.locator('body').click({ position: { x: 1, y: 1 } })
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await tonePieces(page))[1].start, { message: 'the second piece is back at 3 s' }).toBeCloseTo(3, 1)
    const restored = await tonePieces(page)
    for (let i = 0; i < 2; i++) {
      expect(Math.abs(restored[i].start - piecesBefore[i].start)).toBeLessThan(TOLERANCE)
      expect(Math.abs(restored[i].end - piecesBefore[i].end)).toBeLessThan(TOLERANCE)
    }
    expect(Math.abs((await clipSpansOf(page, clipsLabelled(page, CAPTION)))[0].start - captionBefore.start)).toBeLessThan(TOLERANCE)
  })

  test('no notice when nothing is left behind', async ({ page }) => {
    await selectFirstPiece(page)
    await setSpeed(page, '2×')
    await expect.poll(async () => (await tonePieces(page))[1].start, { message: 'the second piece moves up' }).toBeCloseTo(1.5, 1)
    // Give a notice the time it would take to show.
    await page.waitForTimeout(500)
    await expect(leftBehindNotice(page)).toHaveCount(0)
  })
})
