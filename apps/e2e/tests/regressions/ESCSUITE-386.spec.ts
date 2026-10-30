import { test, expect, type Locator, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, makeToneWav } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'
import { clipFromLeft, clipSpans, pixelsPerSecond, razorSplit, timelineClips } from '../../utils/timeline'

/**
 * ESCSUITE-386: the Ripple Edit tool's start trim left a gap.
 *
 * Ripple promises "Trim and shift subsequent clips", but only an end trim
 * did: the release measured the shift from the clip's end, which a start trim
 * never moves, so dragging the second piece's start edge right trimmed its
 * head and left a hole in front of it (black and silence in the export). A
 * ripple start trim now keeps the clip where it started and moves the clips
 * after it up by what it took off the head.
 *
 * The clip is a synthesised WAV, which every browser here decodes.
 */

const CLIP_SECONDS = 10

/** Drag `clip`'s start trim handle by `dxSec` seconds (negative is left), in small steps. */
async function dragStartEdgeBy(page: Page, clip: Locator, dxSec: number, pxPerSec: number): Promise<void> {
  const box = await clip.boundingBox()
  expect(box, 'the clip to trim is not on screen').not.toBeNull()
  // The start handle is the clip's first 8 px.
  const x = box!.x + 3
  const y = box!.y + box!.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  const steps = 10
  for (let i = 1; i <= steps; i++) await page.mouse.move(x + (dxSec * pxPerSec * i) / steps, y)
  await page.mouse.up()
}

test.describe('ESCSUITE-386: a ripple start trim closes the gap it leaves', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')
  })

  test('trimming 2 s off the second piece’s head keeps it at 5 s and moves nothing out of place', async ({ page }) => {
    await importMediaAndAddToTimeline(page, {
      name: 'tone.wav',
      mimeType: 'audio/wav',
      buffer: makeToneWav(CLIP_SECONDS),
    })
    const clip = timelineClips(page).first()
    await expect(clip).toBeVisible()
    const pxPerSec = await pixelsPerSecond(clip, CLIP_SECONDS)

    await razorSplit(page, clip, 5, pxPerSec)
    await expect(timelineClips(page)).toHaveCount(2)
    const before = await clipSpans(page, pxPerSec)
    expect(before[1].start, 'the second piece starts at 5 s').toBeCloseTo(5, 1)

    await page.getByTitle(/^Ripple Edit/).click()
    await dragStartEdgeBy(page, await clipFromLeft(page, 1), 2, pxPerSec)

    const [first, second] = await clipSpans(page, pxPerSec)
    expect(first.end, 'the first piece still ends at 5 s').toBeCloseTo(5, 1)
    expect(second.start, 'the trimmed piece still starts at 5 s: no gap in front of it').toBeCloseTo(5, 1)
    // About 2 s: the handle is grabbed a few pixels in, so the trim is a hair over.
    expect(second.end, 'the trimmed piece is about 2 s shorter').toBeCloseTo(8, 0)
  })
})
