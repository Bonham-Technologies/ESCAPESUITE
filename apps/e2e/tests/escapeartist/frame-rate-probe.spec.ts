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
 * that the 120 fps WebM may instead be refused as 30 `'assumed'` on a busy
 * machine (ESCSUITE-333; see `mayRefuse`). MP4s are exact. A WebM stamps frames in whole milliseconds, so over eight frames it
 * cannot separate a rate from its NTSC neighbour and either is accepted.
 *
 * Chromium only: `presentedFrames` and the half-speed sampling were measured
 * there; Firefox/WebKit admission is a follow-up.
 */

const FIXTURES = resolvePath(dirname(fileURLToPath(import.meta.url)), '../../fixtures/frame-rate')

interface Case {
  file: string
  /** Accepted stored rates. */
  rates: number[]
  /**
   * The probe may refuse this file on a busy machine, storing the 30 'assumed'
   * placeholder instead of a measurement (ESCSUITE-333). True only for the
   * 120 fps WebM: its frames are stamped in whole milliseconds, and a page that
   * misses about eleven callbacks in a row can round the run to one interval
   * more than the compositor's counter, which ESCSUITE-278's spacing check
   * refuses on purpose. A loaded CI runner did exactly that on 2026-10-18 (run
   * 39096461073). The refusal is the safe side; a wrong 'measured' rate is
   * still a failure.
   */
  mayRefuse?: boolean
}

const CASES: Case[] = [
  { file: 'testsrc-24fps.mp4', rates: [24] },
  { file: 'testsrc-30fps.mp4', rates: [30] },
  { file: 'testsrc-60fps.mp4', rates: [60] },
  { file: 'testsrc-120fps.mp4', rates: [120] },
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
