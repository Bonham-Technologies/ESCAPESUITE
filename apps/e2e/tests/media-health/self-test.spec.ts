import { readFile } from 'node:fs/promises'
import { test, expect, type Page } from '@playwright/test'
import {
  AV_FIXTURE_WEBM,
  expectPreviewAlive,
  expectPreviewFrameChangesOnSeek,
  expectWaveformDrawn,
  installMediaHealthProbe,
  previewCanvas,
} from '../../utils/mediaHealth'

/**
 * ESCSUITE-348 AC 3: each media-health helper fails on the case it exists to
 * catch. A helper that always passes would turn every spec built on it into
 * a green no-op, so each one is run here against a page built to be broken in
 * exactly one way, beside a healthy control that passes.
 *
 * The pages are served from a fake origin (`page.route`), not the app, so
 * nothing but the one broken thing can make a case fail. The video is the A/V
 * WebM fixture, same-origin, so the canvas it is drawn on stays readable.
 */

const ORIGIN = 'http://media-health.test'

/**
 * A stand-in for ARTIST's preview: a `<video>` made with `createElement`
 * over a blob URL (never attached, as `usePreviewMedia.ts` makes them) and a canvas a rAF
 * loop draws it onto. `?mode=` breaks one thing:
 *  - `frozen`: the loop stops drawing, though the video plays on;
 *  - `seek-no-paint`: nothing repaints after a seek.
 * The Play button starts it unmuted (`?muted=1` keeps it muted), from a user
 * gesture, so autoplay policy does not decide the result.
 */
const PREVIEW_PAGE = `<!doctype html>
<canvas id="preview" width="640" height="360"></canvas>
<button id="play">Play</button>
<button id="seek">Seek</button>
<script>
  const params = new URLSearchParams(location.search)
  const mode = params.get('mode')
  const canvas = document.getElementById('preview')
  const ctx = canvas.getContext('2d')
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  const paint = () => ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  video.addEventListener('loadeddata', paint)
  if (mode !== 'seek-no-paint') video.addEventListener('seeked', paint)
  const loop = () => {
    if (mode !== 'frozen' && !video.paused) paint()
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  document.getElementById('play').onclick = () => {
    video.muted = params.get('muted') === '1'
    video.play()
  }
  document.getElementById('seek').onclick = () => { video.currentTime = 3.5 }
  window.videoReady = new Promise((r) => video.addEventListener('loadeddata', r))
  // A blob URL, as the app's are: over a plain 200 response with no range
  // support, a paused element never decodes the frame a seek lands on.
  fetch('/av.webm').then((r) => r.blob()).then((b) => { video.src = URL.createObjectURL(b) })
</script>`

/** A clip box holding one waveform canvas; `?draw=` picks what is drawn on it. */
const WAVEFORM_PAGE = `<!doctype html>
<div data-clip-id="clip" style="position:relative;width:500px;height:50px">
  <canvas class="waveform" width="500" height="50" style="width:500px;height:50px"></canvas>
</div>
<script>
  const draw = new URLSearchParams(location.search).get('draw')
  const ctx = document.querySelector('canvas').getContext('2d')
  ctx.fillStyle = 'rgba(74, 158, 255, 0.5)'
  for (let x = 0; x < 500; x++) {
    // The A/V fixtures' shape: tone, silence over 40–60 % of the clip, tone.
    const silent = x >= 200 && x < 300
    if (draw === 'flat') ctx.fillRect(x, 5, 1, 40)
    if (draw === 'tone-gap') silent ? ctx.fillRect(x, 24, 1, 1) : ctx.fillRect(x, 5, 1, 40)
  }
</script>`


test.beforeEach(async ({ page }) => {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname === '/av.webm') {
      await route.fulfill({ body: await readFile(AV_FIXTURE_WEBM), contentType: 'video/webm' })
    } else if (pathname === '/waveform') {
      await route.fulfill({ body: WAVEFORM_PAGE, contentType: 'text/html' })
    } else {
      await route.fulfill({ body: PREVIEW_PAGE, contentType: 'text/html' })
    }
  })
})

async function openPreview(page: Page, query = ''): Promise<void> {
  await installMediaHealthProbe(page)
  await page.goto(`${ORIGIN}/preview${query}`)
  await page.evaluate(() => (window as unknown as { videoReady: Promise<void> }).videoReady)
}

test.describe('media-health helpers fail on what they guard (ESCSUITE-348)', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Pinned on Chromium, which CI gates; WebKit has no webkitAudioDecodedByteCount'
  )

  test.describe('expectWaveformDrawn', () => {
    const silence = { start: 0.4, end: 0.6 }

    test('fails on a blank canvas', async ({ page }) => {
      await page.goto(`${ORIGIN}/waveform?draw=blank`)
      await expect(expectWaveformDrawn(page.locator('canvas'), { timeoutMs: 1000 })).rejects.toThrow(
        /nothing drawn/
      )
    })

    test('fails when the silent window draws as much as the tone', async ({ page }) => {
      await page.goto(`${ORIGIN}/waveform?draw=flat`)
      await expect(expectWaveformDrawn(page.locator('canvas'), { silence, timeoutMs: 1000 })).rejects.toThrow(
        /as much in the silent window/
      )
    })

    test('passes on a waveform with a quieter silent window', async ({ page }) => {
      await page.goto(`${ORIGIN}/waveform?draw=tone-gap`)
      await expectWaveformDrawn(page.locator('canvas'), { silence, timeoutMs: 1000 })
    })
  })

  test.describe('expectPreviewAlive', () => {
    test('fails on a paused video', async ({ page }) => {
      await openPreview(page)
      await expect(expectPreviewAlive(page, { forMs: 500 })).rejects.toThrow(/no preview media element is playing/)
    })

    test('fails on a stalled frame callback', async ({ page }) => {
      // Registered before the probe, so the probe's frame counter never runs:
      // the video plays and the canvas repaints, but no frame is presented.
      await page.addInitScript(() => {
        HTMLVideoElement.prototype.requestVideoFrameCallback = () => 0
      })
      await openPreview(page)
      await page.click('#play')
      await expect(expectPreviewAlive(page, { forMs: 500 })).rejects.toThrow(/presented no new frames/)
    })

    test('fails on a canvas that stopped repainting', async ({ page }) => {
      await openPreview(page, '?mode=frozen')
      await page.click('#play')
      await expect(expectPreviewAlive(page, { forMs: 500 })).rejects.toThrow(/did not repaint/)
    })

    test('fails on muted playback', async ({ page }) => {
      await openPreview(page, '?muted=1')
      await page.click('#play')
      await expect(expectPreviewAlive(page, { forMs: 500 })).rejects.toThrow(/preview is silent/)
    })

    test('fails without the probe installed', async ({ page }) => {
      await page.goto(`${ORIGIN}/preview`)
      await expect(expectPreviewAlive(page, { forMs: 100 })).rejects.toThrow(/installMediaHealthProbe/)
    })

    test('passes on a playing, painting, audible preview', async ({ page }) => {
      await openPreview(page)
      await page.click('#play')
      await expectPreviewAlive(page, { forMs: 500 })
    })
  })

  test.describe('expectPreviewFrameChangesOnSeek', () => {
    test('fails when a seek paints no new frame', async ({ page }) => {
      await openPreview(page, '?mode=seek-no-paint')
      await expect(
        expectPreviewFrameChangesOnSeek(page, () => page.click('#seek'), { timeoutMs: 1000 })
      ).rejects.toThrow(/no new frame/)
    })

    test('passes when the seek paints the frame it lands on', async ({ page }) => {
      await openPreview(page)
      await expect(previewCanvas(page)).toBeVisible()
      await expectPreviewFrameChangesOnSeek(page, () => page.click('#seek'))
    })
  })
})
