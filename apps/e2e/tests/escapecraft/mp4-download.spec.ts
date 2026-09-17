import { test, expect } from '@playwright/test'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { canConvertToMp4 } from '../../utils/webcodecs'

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
 * name: `canConvertToMp4()` (`utils/webcodecs.ts`, one copy shared with the
 * standalone spec) asks the page the same question `probeMP4Support()` asks —
 * WebCodecs present *and* the H.264 and AAC configurations the conversion uses
 * accepted. Chromium answers yes and converts; a browser that answers no must
 * show the button disabled with its reason, never hide it. Naming browsers here
 * would rot — WebCodecs support has been arriving outside Chromium.
 */

const CRAFT_URL = 'http://localhost:5174'

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
    test.skip(!(await canConvertToMp4(page)), 'This browser cannot encode H.264 + AAC')
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

  test('offers MP4 disabled, with a reason, where it cannot encode MP4', async ({ page }) => {
    test.skip(await canConvertToMp4(page), 'This browser can convert — the enabled path is above')

    const mp4Button = page.getByRole('button', { name: /Download .+ as MP4/ })
    await expect(mp4Button).toBeVisible()
    await expect(mp4Button).toBeDisabled()
    // Whichever half of the probe said no names itself in the reason.
    await expect(mp4Button).toHaveAttribute('title', /WebCodecs|H\.264|AAC/)

    // The instant WebM download is never affected by an MP4 problem.
    await expect(page.getByRole('button', { name: /^Download (?!.+ as MP4).+$/ })).toBeEnabled()
  })

  test('cancelling a conversion leaves the row idle and downloads nothing', async ({ page }) => {
    test.skip(!(await canConvertToMp4(page)), 'This browser cannot encode H.264 + AAC')
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
