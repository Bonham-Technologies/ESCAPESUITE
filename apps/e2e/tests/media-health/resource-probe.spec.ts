import { test, expect } from '@playwright/test'
import { installMediaHealthProbe } from '../../utils/mediaHealth'
import { installResourceProbe, readLiveCounts } from '../../utils/resourceProbe'

/**
 * ESCSUITE-350: the resource probe counts what it claims to. A probe that
 * always reads 0 would turn the soak (`tests/escapeartist/soak.spec.ts`)
 * into a green no-op, so each kind is made, counted live, released the way
 * the probe's table says, and counted gone, on a blank routed page.
 *
 * The page is served on `localhost` (routed, no server behind the port)
 * because WebCodecs exists only in a secure context.
 */
const ORIGIN = 'http://localhost:5999'

test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'readLiveCounts forces a GC through Chromium’s DevTools protocol'
)

test.beforeEach(async ({ page }) => {
  await page.route(`${ORIGIN}/**`, (route) =>
    route.fulfill({ body: '<!doctype html><title>probe</title>', contentType: 'text/html' })
  )
})

test('each kind is counted live until it is released', async ({ page }) => {
  // Both probes, mediaHealth's first: they compose over createElement.
  await installMediaHealthProbe(page)
  await installResourceProbe(page)
  await page.goto(ORIGIN)

  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>
    w.ctx = new AudioContext()
    w.offline = new OfflineAudioContext(1, 128, 8000)
    w.vdec = new VideoDecoder({ output: () => {}, error: () => {} })
    w.adec = new AudioDecoder({ output: () => {}, error: () => {} })
    w.worker = new Worker(URL.createObjectURL(new Blob([''], { type: 'text/javascript' })))
    const video = document.createElement('video')
    video.src = URL.createObjectURL(new Blob(['x'], { type: 'video/webm' }))
    w.video = video
    const audio = new Audio()
    audio.src = 'data:audio/wav;base64,'
    w.audio = audio
  })
  const held = await readLiveCounts(page)
  expect(held.live).toEqual({
    audioContext: 1,
    offlineAudioContext: 1,
    videoDecoder: 1,
    audioDecoder: 1,
    worker: 1,
    objectUrl: 2,
    mediaElement: 2,
  })
  // mediaHealth's probe still sees the element, so neither wrapper clobbered the other.
  expect(
    await page.evaluate(() => (window as unknown as { __mediaHealth: { elements: unknown[] } }).__mediaHealth.elements.length)
  ).toBe(1)
  // And the site names the caller, for a failure message.
  expect(held.liveSites.length).toBeGreaterThan(0)

  await page.evaluate(async () => {
    const w = window as unknown as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    await w.ctx.close()
    await w.offline.startRendering()
    w.vdec.close()
    w.adec.close()
    w.worker.terminate()
    URL.revokeObjectURL(w.video.src)
    w.video.src = ''
    w.audio.removeAttribute('src')
    w.audio.load()
  })
  const released = await readLiveCounts(page)
  // One object URL is left: the worker's script URL, never revoked here.
  expect(released.live).toEqual({
    audioContext: 0,
    offlineAudioContext: 0,
    videoDecoder: 0,
    audioDecoder: 0,
    worker: 0,
    objectUrl: 1,
    mediaElement: 0,
  })
  expect(released.created.mediaElement).toBe(2)
})

test('a dropped, unclosed decoder stops counting once it is collected', async ({ page }) => {
  // A dropped media element is not pinned the same way: Chromium can keep a
  // detached element with a source alive after the page lets go of it (it
  // did in about half the runs of an errored data: source), and the probe
  // then counts it, which errs towards reporting a leak.
  await installResourceProbe(page)
  await page.goto(ORIGIN)
  await page.evaluate(() => {
    // Made in a function of its own, so no local of this one holds it.
    const drop = () => {
      new VideoDecoder({ output: () => {}, error: () => {} })
    }
    drop()
    ;(window as unknown as { kept: VideoDecoder }).kept = new VideoDecoder({ output: () => {}, error: () => {} })
  })
  const after = await readLiveCounts(page)
  expect(after.created.videoDecoder).toBe(2)
  expect(after.live.videoDecoder).toBe(1)
})
