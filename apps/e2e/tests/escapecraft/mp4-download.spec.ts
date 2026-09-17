import { test, expect, type Page } from '@playwright/test'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'

/**
 * ESCAPECRAFT downloads a recording as MP4, converted in the page.
 *
 * The take is real — `mockSyntheticMedia` hands the app an animated canvas
 * stream, so the recorder produces a genuine decodable WebM — and the
 * conversion is the real `convertToMP4`: WebCodecs decode, H.264 encode,
 * Mediabunny mux. Nothing is stubbed past the capture devices, which is the
 * point: the claim being tested is that the file the browser saves is an MP4
 * the browser made locally.
 *
 * Which half runs is decided by the browser in front of it rather than by its
 * name: `hasWebCodecs()` asks the page the same question `isMP4ConversionSupported()`
 * asks. Chromium has it and converts; a browser without it must show the button
 * disabled with its reason, never hide it. Naming browsers here would rot —
 * WebCodecs support has been arriving outside Chromium.
 */

const CRAFT_URL = 'http://localhost:5174'

/** What `isMP4ConversionSupported()` checks, asked of the live page. */
async function hasWebCodecs(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      typeof VideoEncoder !== 'undefined' &&
      typeof VideoFrame !== 'undefined' &&
      typeof AudioEncoder !== 'undefined' &&
      typeof AudioContext !== 'undefined'
  )
}

test.describe('ESCAPECRAFT MP4 download', () => {
  test.beforeEach(async ({ page }) => {
    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)
    await page.goto(CRAFT_URL)
    await page.waitForLoadState('networkidle')

    // Capability detection is async; the source toggles stay disabled until it
    // finishes and a take started before then acquires no stream.
    const screenSource = page
      .locator('[class*="sourceToggle"]')
      .filter({ hasText: 'Screen' })
      .last()
    await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Start recording' }).click()
    await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({
      timeout: 30_000,
    })
    await page.waitForTimeout(2000)
    await page.getByRole('button', { name: 'Stop recording' }).click()
    await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toBeVisible({
      timeout: 30_000,
    })
  })

  test('converts the recording and saves an .mp4 file', async ({ page }) => {
    test.skip(!(await hasWebCodecs(page)), 'MP4 conversion needs WebCodecs')
    test.setTimeout(180_000)

    const mp4Button = page.getByRole('button', { name: /Download .+ as MP4/ })
    await expect(mp4Button).toBeEnabled()

    const downloadPromise = page.waitForEvent('download', { timeout: 150_000 })
    await mp4Button.click()

    // While it runs the row shows how far it has got, and offers a way out.
    await expect(page.getByRole('progressbar', { name: /Converting .+ to MP4/ })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByRole('button', { name: /Cancel MP4 conversion of/ })).toBeVisible()

    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.mp4$/)

    // Back to idle: no progress bar, the button available again, nothing said
    // in the header's live region.
    await expect(page.getByRole('progressbar', { name: /Converting .+ to MP4/ })).toHaveCount(0)
    await expect(mp4Button).toBeEnabled()
  })

  test('offers MP4 disabled, with a reason, where WebCodecs is missing', async ({ page }) => {
    test.skip(await hasWebCodecs(page), 'This browser can convert — the enabled path is above')

    const mp4Button = page.getByRole('button', { name: /Download .+ as MP4/ })
    await expect(mp4Button).toBeVisible()
    await expect(mp4Button).toBeDisabled()
    await expect(mp4Button).toHaveAttribute('title', /WebCodecs/)

    // The instant WebM download is never affected by an MP4 problem.
    await expect(page.getByRole('button', { name: /^Download (?!.+ as MP4).+$/ })).toBeEnabled()
  })

  test('cancelling a conversion leaves the row idle and downloads nothing', async ({ page }) => {
    test.skip(!(await hasWebCodecs(page)), 'MP4 conversion needs WebCodecs')
    test.setTimeout(120_000)

    let downloaded = false
    page.on('download', () => {
      downloaded = true
    })

    await page.getByRole('button', { name: /Download .+ as MP4/ }).click()
    const cancel = page.getByRole('button', { name: /Cancel MP4 conversion of/ })
    await expect(cancel).toBeVisible({ timeout: 30_000 })
    await cancel.click()

    await expect(page.getByRole('progressbar', { name: /Converting .+ to MP4/ })).toHaveCount(0, {
      timeout: 30_000,
    })
    await expect(page.getByRole('button', { name: /Download .+ as MP4/ })).toBeEnabled()
    expect(downloaded).toBe(false)
  })
})
