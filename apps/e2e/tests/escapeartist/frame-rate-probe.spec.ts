import { test, expect, type Page } from '@playwright/test'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ARTIST_URL } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-277: the import-time frame-rate probe (ESCSUITE-276,
 * `apps/artist/src/core/frameRateProbe.ts`) in a real browser.
 *
 * Its unit doubles model `requestVideoFrameCallback`; only a real `<video>`
 * shows what Chromium presents at half speed, and a real run once read a 60 fps
 * WebM as 20. Each fixture (fixtures/frame-rate/README.md) is imported through
 * the uploader's file input and the stored source read back through the
 * documented `GET_STATE`: it must be `'measured'` at the file's rate, except
 * that a 120 fps file, MP4 or WebM, may instead be refused as 30 `'assumed'`
 * on a busy machine (ESCSUITE-333, ESCSUITE-336; see `mayRefuse`). A WebM
 * stamps frames in whole milliseconds, so over eight frames it cannot separate
 * a rate from its NTSC neighbour and either is accepted; an MP4's rate is
 * exact.
 *
 * A refusal logs its reason (`[frame-rate probe] refused: …`, ESCSUITE-336)
 * and the test copies it into a `frame-rate refusal` annotation, so a CI run
 * that stored 30 `'assumed'` says which check fired and on what callbacks.
 *
 * Chromium only: `presentedFrames` and the half-speed sampling were measured
 * there; Firefox/WebKit admission is a follow-up.
 */

/**
 * `FRAME_RATE_CPU_THROTTLE=4` runs every case under CDP CPU throttling, the
 * loaded-runner reproduction ESCSUITE-336 asks for:
 *
 *   FRAME_RATE_CPU_THROTTLE=4 pnpm exec playwright test frame-rate-probe --project=chromium --repeat-each=10
 */
const CPU_THROTTLE = Number(process.env.FRAME_RATE_CPU_THROTTLE ?? 1)

const FIXTURES = resolvePath(dirname(fileURLToPath(import.meta.url)), '../../fixtures/frame-rate')

interface Case {
  file: string
  /** Accepted stored rates. */
  rates: number[]
  /**
   * The probe may refuse this file on a busy machine, storing the 30 'assumed'
   * placeholder instead of a measurement. True for the two 120 fps files: at
   * half speed they present a frame every 16.7 ms, and a loaded page can skip
   * one without presenting it. The next presented frame's media time steps
   * over it while the compositor's counter does not, and ESCSUITE-278's check
   * refuses that run on purpose (`frames-skipped-unpresented`); exact MP4
   * timestamps would not prevent it. The WebM can also get there by
   * millisecond rounding over a long callback stall. Loaded CI runners refused
   * the WebM on 2026-10-18 (run 39096461073, ESCSUITE-333) and the MP4 on
   * 2026-10-20 (run 39369091051, ESCSUITE-336). Under 4x CDP CPU throttling
   * the WebM was refused 2 runs in 10, both `frames-skipped-unpresented`. The
   * MP4's own reason was not observed (the run predates the refusal log, and
   * the container that investigated it had no H.264 decoder); it most likely
   * hit the same check, and every other check that can refuse it
   * (`too-few-frames` from a slow decoder start, `decoder-queue-grew`) is a
   * designed safe side too. The `frame-rate refusal` annotation will say which
   * next time. The refusal is the safe side; a wrong 'measured' rate is still
   * a failure.
   */
  mayRefuse?: boolean
}

const CASES: Case[] = [
  { file: 'testsrc-24fps.mp4', rates: [24] },
  { file: 'testsrc-30fps.mp4', rates: [30] },
  { file: 'testsrc-60fps.mp4', rates: [60] },
  { file: 'testsrc-120fps.mp4', rates: [120], mayRefuse: true },
  { file: 'testsrc-29.97fps.mp4', rates: [29.97] },
  { file: 'testsrc-24fps.webm', rates: [24, 23.976] },
  { file: 'testsrc-30fps.webm', rates: [30, 29.97] },
  { file: 'testsrc-60fps.webm', rates: [60, 59.94] },
  { file: 'testsrc-120fps.webm', rates: [120, 119.88], mayRefuse: true },
]

interface StoredSource {
  frameRate: number
  frameRateSource?: string
  name?: string
}

/** The editor's imported sources, through `GET_STATE`. */
async function getSources(page: Page): Promise<StoredSource[]> {
  return page.evaluate(
    () =>
      new Promise<StoredSource[]>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('GET_STATE never answered')), 15_000)
        const onMessage = (event: Event) => {
          const detail = (event as CustomEvent).detail
          if (detail?.type !== 'STATE') return
          clearTimeout(timer)
          window.removeEventListener('videoeditor:message', onMessage)
          resolve(detail.payload.videos)
        }
        window.addEventListener('videoeditor:message', onMessage)
        window.postMessage({ type: 'GET_STATE' }, '*')
      })
  )
}

test.describe('import-time frame-rate probe', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'rVFC presentedFrames measured on Chromium only; Firefox/WebKit admission is a follow-up')
  })

  for (const { file, rates, mayRefuse } of CASES) {
    const title = mayRefuse
      ? `${file} is measured at ${rates.join(' or ')} fps, or refused as 30 assumed`
      : `${file} is measured at ${rates.join(' or ')} fps`
    test(title, async ({ page }) => {
      // The probe names why it refused a run (ESCSUITE-336); keep it with the result.
      const refusals: string[] = []
      page.on('console', (message) => {
        if (message.text().startsWith('[frame-rate probe]')) refusals.push(message.text())
      })
      if (CPU_THROTTLE > 1) {
        const cdp = await page.context().newCDPSession(page)
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })
      }
      await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
      await waitForAppReady(page, 'artist')
      await page.locator('input[type="file"]').setInputFiles(resolvePath(FIXTURES, file))
      await expect(page.getByRole('button', { name: 'Add to timeline' })).toBeVisible({ timeout: 30_000 })

      const sources = await getSources(page)
      expect(sources).toHaveLength(1)
      test.info().annotations.push({
        type: 'frame-rate',
        description: `${sources[0].frameRate} (${sources[0].frameRateSource})`,
      })
      for (const refusal of refusals) test.info().annotations.push({ type: 'frame-rate refusal', description: refusal })
      if (mayRefuse && sources[0].frameRateSource === 'assumed') {
        // The refusal: the placeholder, never another number (ESCSUITE-333).
        expect(sources[0].frameRate).toBe(30)
        return
      }
      expect(sources[0].frameRateSource).toBe('measured')
      expect(rates).toContain(sources[0].frameRate)
    })
  }
})

// ESCSUITE-327: the probe is gated to Chromium, so Firefox stores the placeholder
// instead of a reading it cannot vouch for (measured 2026-10-17 on Firefox 157,
// the 120 fps MP4 read 124.62 and the 30 fps WebM 34.33, both 'measured').
test.describe('import-time frame-rate probe, engine gate', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'firefox', 'the gate pin runs on Firefox; WebKit is refused by the probe too but Playwright\'s WebKit cannot import media (ESCSUITE-258)')
  })

  test('testsrc-120fps.mp4 is stored as 30 assumed, not a Firefox reading', async ({ page }) => {
    await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
    await waitForAppReady(page, 'artist')
    await page.locator('input[type="file"]').setInputFiles(resolvePath(FIXTURES, 'testsrc-120fps.mp4'))
    await expect(page.getByRole('button', { name: 'Add to timeline' })).toBeVisible({ timeout: 30_000 })

    const sources = await getSources(page)
    expect(sources).toHaveLength(1)
    expect(sources[0].frameRate).toBe(30)
    expect(sources[0].frameRateSource).toBe('assumed')
  })
})
