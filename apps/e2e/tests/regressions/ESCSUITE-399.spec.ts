import { test, expect } from '@playwright/test'
import { importMediaAndAddToTimeline } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-399: in Safari, ARTIST's preview stayed black.
 *
 * The preview draws each frame from a `<video>` it builds per source, and it
 * never put those elements in the document. WebKit draws a video's frames only
 * while the element is laid out on screen, so `drawImage` from a detached one
 * painted nothing. They now live in a 1 px transparent host on screen.
 *
 * The init script reproduces WebKit's rule in Chromium and Firefox: drawing a
 * `<video>` that is not in the document draws nothing. WebKit gets no init
 * script, since its own rule applies.
 */

test('the preview draws the paused frame of an imported video', async ({ page, browserName }) => {
  if (browserName !== 'webkit') {
    await page.addInitScript(() => {
      const drawImage = CanvasRenderingContext2D.prototype.drawImage as (...args: unknown[]) => void
      CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
        if (args[0] instanceof HTMLVideoElement && !args[0].isConnected) return
        drawImage.apply(this, args)
      } as typeof CanvasRenderingContext2D.prototype.drawImage
    })
  }
  await page.goto('http://localhost:5175')
  await waitForAppReady(page, 'artist')

  await importMediaAndAddToTimeline(page)
  await page.getByTitle('Go to start (Home)').click()

  const nonBlackPixels = () =>
    page.evaluate(() => {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement
      const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
      let count = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 10 || data[i + 1] > 10 || data[i + 2] > 10) count++
      }
      return count
    })
  await expect.poll(nonBlackPixels, { timeout: 15_000 }).toBeGreaterThan(0)
})
