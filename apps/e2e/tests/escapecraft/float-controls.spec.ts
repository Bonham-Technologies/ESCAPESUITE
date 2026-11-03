import { test, expect, type Page } from '@playwright/test'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { waitForAppReady } from '../../utils/ready'
import { runAxeCheck } from '../../utils/accessibility'
import { recordFloatingWindowRequests, openFloatingControls, startTake } from '../../utils/floatControls'

/**
 * ESCSUITE-400: "Float controls" puts the recorder's timer, level meters and
 * transport buttons in a Document Picture-in-Picture window, so a take of
 * another app can be watched and stopped without coming back to the tab.
 *
 * No shim: headless Chromium implements `documentPictureInPicture.requestWindow()`
 * on a secure origin, and the window it opens is a Playwright page of its own
 * (found through the context's `page` event). Headless Chromium does not size
 * that window, though — it opens at the context's viewport — so the 360x160
 * ceiling is asserted twice: as what the app asked `requestWindow()` for, and
 * by setting the window's page to exactly 360x160 and checking the controls fit
 * it with nothing scrolled out of view.
 *
 * Where the API exists the window-opening tests run; where it does not they
 * skip, and the last test pins that the button is then not drawn (WebKit, in
 * the nightly's cross-browser run). Playwright's Firefox does expose the API,
 * and CRAFT draws and fills the window there, but its driver cannot close a
 * browser context that holds a Picture-in-Picture window (`Browser.removeBrowserContext`:
 * "this[#windows][aWindow.__SSi] is undefined"), so every such test fails in
 * teardown; those are skipped on Firefox by name.
 */

const CRAFT_URL = 'http://localhost:5174'

/** Open CRAFT, skipping the test where the browser has no Document Picture-in-Picture. */
async function openCraft(page: Page): Promise<void> {
  await recordFloatingWindowRequests(page)
  await mockSyntheticMedia(page)
  await grantMediaPermissions(page)
  await page.goto(CRAFT_URL)
  await waitForAppReady(page, 'craft')
  test.skip(
    !(await page.evaluate(() => 'documentPictureInPicture' in window)),
    'No Document Picture-in-Picture in this browser; the absent case is below'
  )
}

/** What the library shows for each take, minus its name, newest first. */
async function libraryRows(page: Page) {
  const rows = page.locator('[class*="recordingItem"]')
  return rows.evaluateAll((items) =>
    items.map((item) => {
      const name = item.querySelector('[class*="recordingName"]')?.textContent ?? ''
      return {
        thumbnail: item.querySelector('img') !== null,
        meta: (item.querySelector('[class*="recordingMeta"]')?.textContent ?? '').replace(/[\d.]+/g, '#'),
        buttons: [...item.querySelectorAll('button')].map((button) =>
          (button.getAttribute('aria-label') ?? '').replace(name, '<take>')
        ),
        durationSeconds: (() => {
          const match = /(\d+):(\d+)/.exec(item.querySelector('[class*="recordingMeta"]')?.textContent ?? '')
          return match ? Number(match[1]) * 60 + Number(match[2]) : 0
        })(),
      }
    })
  )
}

/** Every stored take: its size and whether a `<video>` reads a real duration from it. */
async function storedTakes(page: Page) {
  return page.evaluate(
    () =>
      new Promise<Array<{ size: number; finite: boolean; meta: Record<string, unknown> }>>((resolve, reject) => {
        const request = indexedDB.open('video-editor-db')
        request.onerror = () => reject(new Error('Failed to open video-editor-db'))
        request.onsuccess = () => {
          const getAll = request.result.transaction('videos', 'readonly').objectStore('videos').getAll()
          getAll.onsuccess = async () => {
            const records = getAll.result as Array<{ blob: Blob; metadata: Record<string, unknown> }>
            const out = []
            for (const record of records) {
              const video = document.createElement('video')
              video.preload = 'metadata'
              const url = URL.createObjectURL(record.blob)
              const finite = await new Promise<boolean>((done) => {
                video.onloadedmetadata = () => done(Number.isFinite(video.duration))
                video.onerror = () => done(false)
                video.src = url
              })
              URL.revokeObjectURL(url)
              out.push({ size: record.blob.size, finite, meta: record.metadata })
            }
            resolve(out)
          }
        }
      })
  )
}

test.describe('ESCAPECRAFT Float controls (ESCSUITE-400)', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(
      browserName === 'firefox',
      "Playwright's Firefox cannot close a context holding a Picture-in-Picture window (Browser.removeBrowserContext)"
    )
  })

  test('opens a window no bigger than 360x160 showing the timer, meters, Pause and Stop, and it passes axe', async ({ page }) => {
    await openCraft(page)
    await startTake(page)

    const floating = await openFloatingControls(page)
    expect(await page.evaluate(() => (window as unknown as { __floatRequests: unknown[] }).__floatRequests)).toEqual([
      { width: 360, height: 160 },
    ])
    await expect(page.getByRole('button', { name: 'Float controls' })).toHaveAttribute('aria-pressed', 'true')

    // Headless Chromium opens the window at the context viewport; give it the
    // size the app asked for, and everything must still be in view.
    await floating.setViewportSize({ width: 360, height: 160 })
    const controls = floating.getByRole('main', { name: 'Recorder controls' })
    await expect(controls.getByText(/^\d\d:\d\d$/)).toBeInViewport({ ratio: 1 })
    await expect(controls.getByText('Mic')).toBeInViewport({ ratio: 1 })
    await expect(controls.locator('[class*="meterBar"]').first()).toBeInViewport({ ratio: 1 })
    await expect(controls.getByRole('button', { name: 'Pause recording' })).toBeInViewport({ ratio: 1 })
    await expect(controls.getByRole('button', { name: 'Stop recording' })).toBeInViewport({ ratio: 1 })
    await expect(controls.getByRole('button', { name: 'Cancel recording' })).toBeInViewport({ ratio: 1 })
    const overflow = await floating.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }))
    expect(overflow.width).toBeLessThanOrEqual(360)
    expect(overflow.height).toBeLessThanOrEqual(160)

    // The timer in the window ticks with the take.
    const timer = controls.getByText(/^\d\d:\d\d$/)
    await expect(timer).not.toHaveText('00:00', { timeout: 5_000 })

    // The window's own document, audited on its own (styles copied, title and
    // language set, one landmark).
    await expect(floating).toHaveTitle('ESCAPECRAFT controls')
    const results = await runAxeCheck(floating)
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
  })

  test('Stop in the window ends the take, and it reaches the library like one stopped on the page', async ({ page }) => {
    test.setTimeout(90_000)
    await openCraft(page)

    // Take 1: stopped on the page, as the reference.
    await startTake(page)
    await page.waitForTimeout(2000)
    await page.getByRole('button', { name: 'Stop recording' }).click()
    await expect(page.getByRole('button', { name: /^Play / })).toHaveCount(1, { timeout: 30_000 })

    // Take 2: started on the page, stopped in the floating window.
    const floating = await openFloatingControls(page)
    await startTake(page)
    await page.waitForTimeout(2000)
    await floating.getByRole('button', { name: 'Stop recording' }).click()
    await expect(page.getByRole('button', { name: /^Play / })).toHaveCount(2, { timeout: 30_000 })

    // Both windows are back at rest.
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeEnabled()
    await expect(floating.getByRole('button', { name: 'Start recording' })).toBeVisible()

    const [newest, reference] = await libraryRows(page)
    expect(newest.durationSeconds).toBeGreaterThanOrEqual(1)
    expect({ ...newest, durationSeconds: 0 }).toEqual({ ...reference, durationSeconds: 0 })

    const stored = await storedTakes(page)
    expect(stored).toHaveLength(2)
    for (const take of stored) {
      expect(take.size).toBeGreaterThan(1000)
      expect(take.finite).toBe(true)
    }
    const shape = (meta: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(meta).filter(([key]) => !/^(id|name|duration|size|recordedAt|createdAt)$/.test(key))
      )
    expect(shape(stored[0].meta)).toEqual(shape(stored[1].meta))
  })

  test('closing the window leaves the take recording, with the page controls in step', async ({ page }) => {
    await openCraft(page)
    await startTake(page)
    const floating = await openFloatingControls(page)
    await expect(floating.getByRole('button', { name: 'Pause recording' })).toBeVisible()

    await floating.close()

    await expect(page.getByRole('button', { name: 'Float controls' })).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Stop recording' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Cancel recording' })).toBeVisible()
    // Still recording: the page's timer keeps moving after the window is gone.
    const timer = page.locator('[class*="timer"]')
    const before = await timer.textContent()
    await expect(timer).not.toHaveText(before ?? '', { timeout: 5_000 })

    // And the take still stops and saves from the page.
    await page.getByRole('button', { name: 'Stop recording' }).click()
    await expect(page.getByRole('button', { name: /^Play / })).toHaveCount(1, { timeout: 30_000 })
  })

  test('R, P and S work inside the window', async ({ page }) => {
    await openCraft(page)
    const screenSource = page.locator('[class*="sourceToggle"]').filter({ hasText: 'Screen' }).last()
    await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })
    const floating = await openFloatingControls(page)

    await floating.keyboard.press('r')
    await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({ timeout: 30_000 })

    await floating.keyboard.press('p')
    await expect(page.getByRole('button', { name: 'Resume recording' })).toBeVisible()
    await expect(floating.getByRole('button', { name: 'Resume recording' })).toBeVisible()

    await floating.keyboard.press('p')
    await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible()

    await floating.keyboard.press('s')
    await expect(page.getByRole('button', { name: /^Play / })).toHaveCount(1, { timeout: 30_000 })
  })
})

test.describe('ESCAPECRAFT Float controls where the API is missing (ESCSUITE-400)', () => {
  test('the button is drawn exactly when Document Picture-in-Picture exists', async ({ page, browserName }) => {
    await page.goto(CRAFT_URL)
    await waitForAppReady(page, 'craft')
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible()

    const hasApi = await page.evaluate(() => 'documentPictureInPicture' in window)
    // Chromium ships it and WebKit (Safari) does not; Firefox varies by build.
    if (browserName === 'chromium') expect(hasApi).toBe(true)
    if (browserName === 'webkit') expect(hasApi).toBe(false)
    await expect(page.getByRole('button', { name: 'Float controls' })).toHaveCount(hasApi ? 1 : 0)
  })
})
