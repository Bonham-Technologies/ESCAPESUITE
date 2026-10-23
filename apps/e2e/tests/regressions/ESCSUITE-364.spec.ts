import { test, expect, type Locator, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, makeToneWav } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'
import { clipFromLeft, clipSpans, pixelsPerSecond, timelineClips } from '../../utils/timeline'

/**
 * ESCSUITE-364: a ripple trim missed the clip butted against the trimmed one,
 * so the clips slid into each other.
 *
 * Split a clip at `t` and ripple-trim the first half's end back to `e`: the
 * release shifts the second half by `e - t`, to `t + (e - t)`, which for many
 * pairs of times is a float hair short of `e` (0.09999999999999998 for 0.1).
 * The next ripple trim lengthens the first half and shifts the clips that
 * start at or after its old end, `e`; with a strict `>=` the second half,
 * a hair before `e`, was left behind and the first half now covered it.
 * `shiftClipsAfter` now counts a clip within the overlap tolerance as after.
 *
 * The pointer lands on whole pixels, so the times the app computes are
 * `(clientX - left + scrollLeft) / pixelsPerSecond`. The test reads that
 * geometry and searches for a split pixel and a trim pixel whose times hit
 * the float case, computing them exactly as the app does, then drives the
 * razor and the ripple tool there. The clip is a synthesised WAV, which every
 * browser here decodes.
 */

const CLIP_SECONDS = 10

/**
 * The app's `pixelsPerSecond`: `PIXELS_PER_SECOND_BASE * zoom`, 50 px at the
 * zoom of 1 a fresh editor opens at. The page does not expose the zoom, so the
 * test asserts the clip is drawn at exactly this scale before it relies on it.
 */
const PPS = 50

/** The track area's left edge and scroll: the origin `pointerTime` measures from. */
async function trackOrigin(page: Page): Promise<{ left: number; scrollLeft: number }> {
  return page.evaluate(() => {
    // `styles.trackContainer`, the timeline's scrolling track area.
    const container = [...document.querySelectorAll<HTMLElement>('[class*="trackContainer"]')].find((el) =>
      el.querySelector('[data-clip-id]')
    )!
    return { left: container.getBoundingClientRect().left, scrollLeft: container.scrollLeft }
  })
}

/** Drag `clip`'s end trim handle until the pointer is at `toX`, in small steps. */
async function dragEndEdgeTo(page: Page, clip: Locator, toX: number): Promise<void> {
  const box = await clip.boundingBox()
  expect(box, 'the clip to trim is not on screen').not.toBeNull()
  // The end handle is the clip's last 8 px.
  const x = box!.x + box!.width - 3
  const y = box!.y + box!.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  const steps = 10
  for (let i = 1; i <= steps; i++) await page.mouse.move(Math.round(x + ((toX - x) * i) / steps), y)
  await page.mouse.move(toX, y)
  await page.mouse.up()
}

test.describe('ESCSUITE-364: a ripple trim moves the clip butted against it', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')
  })

  test('after a split, a ripple trim shorter then longer keeps the second half after the first', async ({ page }) => {
    await importMediaAndAddToTimeline(page, {
      name: 'tone.wav',
      mimeType: 'audio/wav',
      buffer: makeToneWav(CLIP_SECONDS),
    })
    const clip = timelineClips(page).first()
    await expect(clip).toBeVisible()
    const pps = PPS
    // A layout or zoom change must fail here, not leave the search below
    // computing times the app does not.
    expect(await pixelsPerSecond(clip, CLIP_SECONDS), 'the timeline is at zoom 1 (50 px per second)').toBe(PPS)
    const { left, scrollLeft } = await trackOrigin(page)
    const box = (await clip.boundingBox())!
    expect(box.x, 'the clip sits at 0 s, on the track area\'s left edge').toBe(left - scrollLeft)

    // `pointerTime`, as the app computes it for a pointer at `x`.
    const timeAt = (x: number) => (x - left + scrollLeft) / pps
    // The search assumes the clip sits at 0 s (asserted above): its split
    // offset is then the pointer time itself.
    // A split pixel (2-6 s in) and a trim pixel (at least 0.5 s, well short of
    // the split) where the ripple's shift lands the second half short of the end.
    let pick: { splitX: number; trimX: number } | undefined
    for (let splitX = Math.ceil(box.x + 2 * pps); !pick && splitX < box.x + 6 * pps; splitX++) {
      const t = timeAt(splitX) // the clip is at 0 s, so this is the split offset too
      for (let trimX = Math.ceil(box.x + 0.5 * pps); trimX < splitX - 0.5 * pps; trimX++) {
        const e = timeAt(trimX)
        if (t + (e - t) < e) {
          pick = { splitX, trimX }
          break
        }
      }
    }
    expect(pick, 'a split and a trim that hit the float case').toBeDefined()
    const { splitX, trimX } = pick!

    // Park the playhead past the clips, off the trim handles it would cover.
    const park = () => page.mouse.click(box.x + (CLIP_SECONDS + 1) * pps, box.y + box.height / 2)
    await park()

    // Split at `splitX`, on the whole pixel.
    await page.getByTitle(/^Razor Tool/).click()
    await page.mouse.click(splitX, box.y + box.height / 2)
    await page.getByTitle(/^Selection Tool/).click()
    await expect(timelineClips(page)).toHaveCount(2)

    // Ripple tool: trim the first half's end back to `trimX`, then 2 s longer.
    await page.getByTitle(/^Ripple Edit/).click()
    await dragEndEdgeTo(page, await clipFromLeft(page, 0), trimX)
    const [shortFirst, shortSecond] = await clipSpans(page, pps)
    expect(shortSecond.start, 'the first ripple pulled the second half back').toBeCloseTo(shortFirst.end, 1)

    // A trim leaves the playhead on the edge it moved, over the handle: park it again.
    await park()
    await dragEndEdgeTo(page, await clipFromLeft(page, 0), trimX + Math.round(2 * pps))

    const [first, second] = await clipSpans(page, pps)
    expect(first.end - shortFirst.end, 'the first half is 2 s longer').toBeCloseTo(2, 1)
    // Half a pixel of slack for rounding of the box edges.
    expect(second.start, 'the second half still starts at or after the first one ends').toBeGreaterThanOrEqual(
      first.end - 0.5 / pps
    )
  })
})
