import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-358: a paused seek slower than the preview's 300 ms fallback must
 * still end on the frame it lands on.
 *
 * A far seek into a long recording whose key frames are sparse (a
 * MediaRecorder take) decodes forward from the last key frame and takes
 * seconds: 2.4 s to 109 s into a 15-minute VP8 WebM, measured in Chromium.
 * The fallback used to end the wait, so the frame the seek landed on was never
 * painted and the paused preview stayed on the frame from before the click —
 * the "viewer froze on the timeline click" users reported.
 *
 * Such a file is megabytes and its seek time depends on the machine, so the
 * slowness is made instead: an init script holds every `currentTime` write
 * back for `SLOW_SEEK_MS` once the test asks for it, reporting the target
 * and `seeking` meanwhile, exactly as a slow seek looks to the page. The
 * element keeps its old frame until the held write lands and fires its real
 * 'seeked'.
 *
 * Chromium only, like `preview-first-paint.spec.ts`: the canvas readback and
 * the timings were measured there.
 */

const FIXTURE = resolvePath(dirname(fileURLToPath(import.meta.url)), '../../fixtures/frame-rate/testsrc-30fps.webm')

/** How long a held seek takes: well past the 300 ms fallback. */
const SLOW_SEEK_MS = 1500

declare global {
  interface Window {
    __slowSeekMs?: number
  }
}

/** A hash of the whole preview canvas, read off its backing store. */
function canvasHash(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
    let hash = 0
    for (let i = 0; i < data.length; i += 7) hash = (hash * 31 + data[i]) >>> 0
    return hash
  })
}

test.describe('ESCSUITE-358: a slow paused seek still paints its frame', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Measured and pinned on Chromium only')

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const own = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')!
      const seeking = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'seeking')!
      const held = new WeakMap<HTMLMediaElement, number>()
      Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
        configurable: true,
        get(this: HTMLMediaElement) {
          return held.has(this) ? held.get(this)! : own.get!.call(this)
        },
        set(this: HTMLMediaElement, time: number) {
          const delay = window.__slowSeekMs
          if (!delay) {
            own.set!.call(this, time)
            return
          }
          held.set(this, time)
          setTimeout(() => {
            held.delete(this)
            own.set!.call(this, time)
          }, delay)
        },
      })
      Object.defineProperty(HTMLMediaElement.prototype, 'seeking', {
        configurable: true,
        get(this: HTMLMediaElement) {
          return held.has(this) || seeking.get!.call(this)
        },
      })
    })
    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')
  })

  test('the paused preview repaints when a seek slower than the fallback lands', async ({ page }) => {
    await importMediaAndAddToTimeline(page, FIXTURE)
    // Settle the first paint (ESCSUITE-264) before anything is measured.
    await page.waitForTimeout(1000)

    await page.evaluate((ms) => {
      window.__slowSeekMs = ms
    }, SLOW_SEEK_MS)

    // Click the track 1.5 s into the 2 s clip: a paused seek.
    const track = page.locator('[class*="trackContainer"]').first()
    const box = (await track.boundingBox())!
    const pixelsPerSecond = await page.evaluate(() => {
      const clip = document.querySelector('[data-clip-id]') as HTMLElement
      return clip.getBoundingClientRect().width / 2
    })
    await page.mouse.click(box.x + pixelsPerSecond * 1.5, box.y + 30)

    // Past the fallback, before the held seek lands: what the click painted.
    await page.waitForTimeout(600)
    const beforeLanding = await canvasHash(page)

    // Once the seek lands, the canvas shows the frame at 1.5 s.
    await expect
      .poll(() => canvasHash(page), { timeout: SLOW_SEEK_MS + 3000 })
      .not.toBe(beforeLanding)
  })
})
