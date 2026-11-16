import { test, expect } from '@playwright/test'
import { clipSpansOf, clipsLabelled, openRemoveSilences, openSilenceTake, SILENCE_PPS } from '../../utils/silenceTake'
import { deleteClip, playheadSeconds, razorSplit } from '../../utils/timeline'

/**
 * ESCSUITE-462: "Play" on a pause in Remove silences plays from 1 s before the
 * pause to 1 s after it with the normal transport. With loop playback on and
 * the pause less than 1 s from the end of the timeline, playback wrapped round
 * to 0 at the end and played the start of the timeline, and Play's stop then
 * put the playhead 1 s after the pause, past the end. Play now suspends the
 * loop for its span and ends at the timeline's end at the latest; the loop
 * setting is left as it was.
 *
 * The take is the A/V fixture (`utils/silenceTake.ts`), one pause at 2–3 s,
 * cut short with the razor so the timeline ends 0.5 s after the pause.
 * Chromium only, as ESCSUITE-403: the take is seeded as Blobs in IndexedDB.
 */

/** Where the take is cut, so the timeline ends under 1 s after the pause (2.9 s). */
const TAKE_END = 3.4

test.describe('ESCSUITE-462: Play on a pause near the end plays that pause, with loop playback on', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'The take is seeded as Blobs in IndexedDB: Chromium only')

  test('plays from 1 s before the pause to the end of the timeline, without wrapping to 0 or seeking past the end', async ({ page }) => {
    test.setTimeout(90_000)
    await openSilenceTake(page, 'e2e-462-trailing')

    await test.step('cut the take short, so the timeline ends 0.5 s after the pause', async () => {
      const talk = clipsLabelled(page, /^Talk(?! —)/)
      // A razor cut on the screen part cuts its linked microphone too, and
      // Delete removes both tail pieces.
      await razorSplit(page, talk.first(), TAKE_END, SILENCE_PPS)
      await expect(page.getByText(/^4 clips · 2 tracks$/)).toBeVisible()
      const spans = await clipSpansOf(page, talk)
      const lefts = await talk.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().left))
      await deleteClip(page, talk.nth(lefts.indexOf(Math.max(...lefts))))
      await expect(page.getByText(/^2 clips · 2 tracks$/)).toBeVisible()
      expect(spans[0].end).toBeCloseTo(TAKE_END, 1)
    })
    const [{ end: timelineEnd }] = await clipSpansOf(page, clipsLabelled(page, /^Talk(?! —)/))

    const loop = page.getByTitle(/^Loop Playback (On|Off)/)
    await loop.click()
    await expect(loop).toHaveAttribute('title', /^Loop Playback On/)

    const dialog = await openRemoveSilences(page)
    const play = dialog.getByRole('button', { name: /^Play the pause at 0:02\.\d\d$/ })
    const pauseStart = Number(/0:(\d\d\.\d\d)$/.exec((await play.getAttribute('aria-label'))!)![1])

    // Read the playhead readout every frame for the length of the Play and a
    // little after: a wrap to 0 lasts only until the stop seeks away again.
    const sampled = page.evaluate(
      (ms) =>
        new Promise<number[]>((resolve) => {
          const times: number[] = []
          const until = performance.now() + ms
          const read = () => {
            const text = document.querySelector('[class*="timecode"]')?.textContent ?? ''
            const match = /(\d+):(\d+(?:\.\d+)?)/.exec(text)
            if (match) times.push(Number(match[1]) * 60 + Number(match[2]))
            if (performance.now() < until) requestAnimationFrame(read)
            else resolve(times)
          }
          requestAnimationFrame(read)
        }),
      4_500
    )
    await play.click()
    await expect(page.getByTitle('Pause (Space)')).toBeAttached()
    const times = await sampled

    await expect(page.getByTitle('Play (Space)')).toBeAttached({ timeout: 10_000 })
    const from = pauseStart - 1
    const played = times.filter((t) => t > from - 0.05)
    expect(played.length, 'the readout moved into the Play span').toBeGreaterThan(0)
    expect(Math.min(...times.slice(times.indexOf(played[0])))).toBeGreaterThanOrEqual(from - 0.05)
    expect(Math.max(...times)).toBeLessThanOrEqual(timelineEnd + 0.05)
    expect(await playheadSeconds(page)).toBeLessThanOrEqual(timelineEnd + 0.05)
    expect(await playheadSeconds(page)).toBeGreaterThan(pauseStart)
    // The user's loop setting is as it was.
    await expect(loop).toHaveAttribute('title', /^Loop Playback On/)
    await expect(dialog).toBeVisible()
  })
})
