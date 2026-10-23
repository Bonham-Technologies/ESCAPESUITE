import { test, expect, type Locator, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, makeToneWav } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'
import { clipSpans, dragClipBy, pixelsPerSecond, timelineClips } from '../../utils/timeline'

/**
 * ESCSUITE-363: dragging a clip's start edge left past 0 s moved its end.
 *
 * `computeTrimUpdate` clamped the clip's new position to 0 but not the in
 * point it derived from the same pointer, so with the pointer out over the
 * track headers the in point ran on while the clip stayed at 0: the clip's
 * END moved right (into the clip after it, if any) and its picture and sound
 * slipped against the timeline. The in point now stops where the clip
 * reaches 0, so the end stays put.
 *
 * The clip is a synthesised WAV, which every browser here decodes.
 */

const CLIP_SECONDS = 8

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

test.describe('ESCSUITE-363: a start trim dragged past 0 s keeps the clip end', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')
  })

  test('dragging the start edge of a clip at 0 s out over the track header leaves its right edge where it was', async ({
    page,
  }) => {
    await importMediaAndAddToTimeline(page, {
      name: 'tone.wav',
      mimeType: 'audio/wav',
      buffer: makeToneWav(CLIP_SECONDS),
    })
    const clip = timelineClips(page).first()
    await expect(clip).toBeVisible()
    const pxPerSec = await pixelsPerSecond(clip, CLIP_SECONDS)

    // Trim 2 s off the front (in point 2 s, now at 2 s), then move the clip
    // back to 0 s: a clip at 0 s that has source to give back.
    // The playhead sits on 0 s and covers the start handle: park it past the clip.
    const box = (await clip.boundingBox())!
    await page.mouse.click(box.x + (CLIP_SECONDS + 1) * pxPerSec, box.y + box.height / 2)
    await expect(page.locator('[data-playhead]')).not.toHaveCSS('left', '0px')

    await dragStartEdgeBy(page, clip, 2, pxPerSec)
    await dragClipBy(page, clip, -3, pxPerSec)
    const [before] = await clipSpans(page, pxPerSec)
    expect(before.start, 'the clip sits at 0 s').toBeCloseTo(0, 1)
    expect(before.end, 'the clip is about 6 s long: it has source to give back').toBeCloseTo(6, 0)

    // Drag the start edge 1.5 s left, past 0 s and over the track header.
    const rowLeft = await clip.evaluate((el) => (el.parentElement as HTMLElement).getBoundingClientRect().left)
    const clipLeft = (await clip.boundingBox())!.x
    expect(clipLeft - 1.5 * pxPerSec, 'the pointer ends left of 0 s').toBeLessThan(rowLeft)
    await dragStartEdgeBy(page, clip, -1.5, pxPerSec)

    const [after] = await clipSpans(page, pxPerSec)
    expect(after.start, 'the clip still starts at 0 s').toBeCloseTo(0, 1)
    // One pixel of slack for rounding of the box edges.
    expect(Math.abs(after.end - before.end) * pxPerSec, 'the right edge did not move').toBeLessThanOrEqual(1)
  })
})
