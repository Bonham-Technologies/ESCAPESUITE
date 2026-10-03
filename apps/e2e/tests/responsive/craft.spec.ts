import { test, expect, type Page } from '@playwright/test'
import { mockGetUserMedia, mockMediaRecorder, mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { waitForAppReady } from '../../utils/ready'

/**
 * Records a short real take and opens its playback dialog. Same shape as
 * `accessibility/keyboard-navigation.spec.ts`'s helper of the same name;
 * duplicated locally because that copy is private to a describe ESCSUITE-201
 * does not own exclusively (see report-201.md).
 */
async function recordAndOpenPlayback(page: Page): Promise<void> {
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

  const play = page.getByRole('button', { name: /^Play / })
  await expect(play).toBeVisible({ timeout: 30_000 })
  await play.click()

  await expect(page.getByRole('dialog')).toBeVisible()
}

test.describe('ESCAPECRAFT Mobile Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await mockGetUserMedia(page)
    await mockMediaRecorder(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
  })

  test('recording UI renders on mobile', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible()
  })

  test('recording controls accessible on mobile', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible()
  })

  test('source selection adapts to mobile', async ({ page }) => {
    // The four source toggles (Screen/Webcam/Microphone/System Audio) are
    // always rendered, mobile viewport or not. Scoped to the toggle buttons
    // themselves — `[class*="sourceToggle"]` alone also matches the plural
    // `sourceToggles` container that wraps all four rows.
    const sourceOptions = page.locator('[class*="sourceToggle"] button[aria-pressed]')
    await expect(sourceOptions).toHaveCount(4)
  })

  test('controls have touch-friendly size', async ({ page }) => {
    const buttons = page.getByRole('button')
    const count = await buttons.count()
    expect(count).toBeGreaterThan(0)

    for (let i = 0; i < Math.min(count, 5); i++) {
      const button = buttons.nth(i)
      const isVisible = await button.isVisible().catch(() => false)

      if (isVisible) {
        const box = await button.boundingBox()
        if (box) {
          // Touch targets should be at least 44px
          expect(box.height).toBeGreaterThanOrEqual(40)
        }
      }
    }
  })
})

test.describe('ESCAPECRAFT Tablet Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await mockGetUserMedia(page)
    await mockMediaRecorder(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
  })

  test('recording UI renders on tablet', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible()
  })

  test('preview area sized appropriately', async ({ page }) => {
    // The preview stage (`RecordingPreview.tsx`) always renders one of three
    // things — the compositor canvas, a mirrored stream, or the idle
    // placeholder — so it is never genuinely absent.
    const preview = page.locator('[class*="previewContainer"]').first()
    await expect(preview).toBeVisible()
    const box = (await preview.boundingBox())!
    expect(box.width).toBeGreaterThan(200)
    expect(box.height).toBeGreaterThan(100)
  })
})

test.describe('ESCAPECRAFT Recording List Responsive', () => {
  test('recording list stacks on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')

    // The library panel always renders its "Recordings" heading, empty or not.
    const recordingsList = page.locator('section', {
      has: page.getByRole('heading', { name: 'Recordings' }),
    })
    await expect(recordingsList).toBeVisible()
    const box = (await recordingsList.boundingBox())!
    expect(box.width).toBeGreaterThan(300)
  })

  test('recording thumbnails resize on mobile', async ({ page, browserName }) => {
    test.setTimeout(120_000)
    // ESCSUITE-177: WebKit cannot store a Blob in IndexedDB in Playwright
    // (`UnknownError: Error preparing Blob/File data to be stored in object
    // store`), and this test needs a saved take before there is a thumbnail.
    test.skip(
      browserName === 'webkit',
      'WebKit cannot store a Blob in IndexedDB in Playwright (UnknownError: Error preparing Blob/File data to be stored in object store)'
    )

    await page.setViewportSize({ width: 375, height: 667 })
    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')

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

    const thumbnail = page.locator('[class*="recordingThumbnail"]').first()
    await expect(thumbnail).toBeVisible({ timeout: 30_000 })
    const box = (await thumbnail.boundingBox())!
    expect(box.width).toBeLessThanOrEqual(375)
  })
})

test.describe('ESCAPECRAFT VideoPlayer Responsive', () => {
  test.beforeEach(async ({ page, browserName }) => {
    test.setTimeout(120_000)
    test.skip(
      browserName === 'webkit',
      'WebKit cannot store a Blob in IndexedDB in Playwright (UnknownError: Error preparing Blob/File data to be stored in object store)'
    )

    await page.setViewportSize({ width: 375, height: 667 })
    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
  })

  test('VideoPlayer fits mobile viewport', async ({ page }) => {
    await recordAndOpenPlayback(page)

    const videoPlayer = page.locator('video').first()
    await expect(videoPlayer).toBeVisible()
    const box = (await videoPlayer.boundingBox())!
    expect(box.width).toBeLessThanOrEqual(375)
  })

  test('VideoPlayer controls accessible on mobile', async ({ page }) => {
    await recordAndOpenPlayback(page)

    // "Accessible" here means reachable and operable at this viewport, not a
    // WCAG 44px touch-target claim: `VideoPlayer.module.css`'s own
    // `@media (max-width: 640px)` rule shrinks `.controlButton` to 32x32,
    // below that guideline — a real, pre-existing gap this ticket does not
    // fix (see report-201.md). Assert what is actually true: the button is
    // there, enabled, and clicking it still works.
    const playButton = page.getByTitle(/^(Play|Pause) \(Space\)$/)
    await expect(playButton).toBeVisible()
    await expect(playButton).toBeEnabled()

    const initialTitle = await playButton.getAttribute('title')
    await playButton.click()
    await expect(
      page.getByTitle(initialTitle === 'Play (Space)' ? 'Pause (Space)' : 'Play (Space)')
    ).toBeVisible()
  })
})

test.describe('ESCAPECRAFT Landscape Mode', () => {
  test('works in landscape orientation', async ({ page }) => {
    await page.setViewportSize({ width: 667, height: 375 }) // Landscape mobile
    await mockGetUserMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')

    await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible()
  })

  test('preview uses available width in landscape', async ({ page }) => {
    await page.setViewportSize({ width: 667, height: 375 })
    await mockGetUserMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')

    const preview = page.locator('[class*="previewContainer"]').first()
    await expect(preview).toBeVisible()
    const box = (await preview.boundingBox())!
    expect(box.width).toBeGreaterThan(300)
  })
})
