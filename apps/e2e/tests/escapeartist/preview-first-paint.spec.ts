import { resolve as resolvePath } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { ARTIST_FIXTURE_MP4, ARTIST_URL, importMediaAndAddToTimeline } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-264: the paused preview must not stay black once a clip is on it.
 *
 * The preview paints a paused frame when the clip set or the playhead
 * changes. A `<video>` the preview has only just created has no decoded frame
 * yet, so that paint draws nothing over the black fill — and before this
 * ticket nothing painted again while the playhead stood still, so the canvas
 * stayed black (about one headless run in three). The same held for a frame
 * step: the canvas has to end on the frame the seek lands on.
 *
 * Neither case touches the playhead or the transport before it samples:
 * "Go to start", which `video-import.spec.ts` clicks first, is itself a
 * paint and would hide exactly the paint this pins.
 *
 * The step uses a 2 s source, not the 1 s headless fixture: the transport's
 * step is one second, so from 0 s it lands on 1.0 s — the *end* of a 1 s
 * clip, where no clip is active and black is the right frame.
 */

/** 2 s, 30 fps; its colour changes every eight frames (fixtures/decode-worker/README.md). */
const SEGMENTS_MP4 = resolvePath(ARTIST_FIXTURE_MP4, '../../decode-worker/segments.mp4')

/**
 * `segments.mp4`'s centre pixel as `ffmpeg … -pix_fmt rgb24` decodes it: frame 0
 * (0 s) and frame 30 (1 s), which sit in different eight-frame colour segments.
 */
const SEGMENTS_AT_0S = [212, 68, 117] as const
const SEGMENTS_AT_1S = [153, 96, 134] as const

type Rgb = readonly [number, number, number]

/** The preview canvas's centre pixel, read off its backing store. */
function centrePixel(page: Page): Promise<Rgb> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement
    const ctx = canvas.getContext('2d')!
    const { data } = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1)
    return [data[0], data[1], data[2]] as const
  })
}

const isBlack = ([r, g, b]: Rgb) => r <= 10 && g <= 10 && b <= 10
const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

test.describe('ESCAPEARTIST preview first paint (ESCSUITE-264)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')
  })

  test('the paused canvas shows the clip once it is added, without a seek', async ({ page }) => {
    await importMediaAndAddToTimeline(page)
    // The only canvas on the page is the preview's (the source has no audio,
    // so no waveform canvas is drawn on the timeline).
    await expect(page.locator('canvas')).toHaveCount(1)

    // The fixture is solid red. Polled, so a slow first decode is waited
    // for — but a canvas nothing repaints stays black until the timeout.
    await expect.poll(() => centrePixel(page).then(isBlack)).toBe(false)
    const [r, g, b] = await centrePixel(page)
    expect(r).toBeGreaterThan(200)
    expect(g).toBeLessThan(40)
    expect(b).toBeLessThan(40)
  })

  test('a frame step paints the frame it lands on', async ({ page }) => {
    await importMediaAndAddToTimeline(page, SEGMENTS_MP4)
    await expect(page.locator('canvas')).toHaveCount(1)

    // The step's own subject is the seek, so start from a canvas already
    // showing frame 0 (a first paint that never came fails here, not below).
    await expect
      .poll(async () => {
        const pixel = await centrePixel(page)
        return !isBlack(pixel) && distance(pixel, SEGMENTS_AT_0S) < distance(pixel, SEGMENTS_AT_1S)
      })
      .toBe(true)

    await page.keyboard.press('ArrowRight')

    // Closer to frame 30's colour than to frame 0's: not black, and not the
    // frame before the seek.
    await expect
      .poll(async () => {
        const pixel = await centrePixel(page)
        return !isBlack(pixel) && distance(pixel, SEGMENTS_AT_1S) < distance(pixel, SEGMENTS_AT_0S)
      })
      .toBe(true)
  })
})
