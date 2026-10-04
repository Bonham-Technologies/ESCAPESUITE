import { test, expect } from '@playwright/test'
import { mockGetUserMedia, mockMediaRecorder, mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { recordAndOpenPlayback } from '../../utils/craft'
import { waitForAppReady } from '../../utils/ready'

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

  // Not just visible — actually operable at this viewport: Enter on the
  // focused button is the platform's own activation (the same native
  // behaviour `keyboard-navigation.spec.ts`'s CRAFT cases assert), and
  // reaching the countdown is the real, observable "accessible" the test's
  // name promises, rather than repeating the visibility check above.
  //
  // Re-navigates with `mockSyntheticMedia`'s real stream instead of the
  // describe's inert `mockGetUserMedia` one: assigning that inert,
  // stream-shaped-but-not-a-`MediaStream` object to the preview `<video>`'s
  // `srcObject` throws inside a passive effect with no error boundary
  // around it, crashing the whole app before the countdown ever renders
  // (`useMediaStreams.ts`).
  test('recording controls accessible on mobile', async ({ page }) => {
    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')

    const screenSource = page
      .locator('[class*="sourceToggle"]')
      .filter({ hasText: 'Screen' })
      .last()
    await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })

    const startButton = page.getByRole('button', { name: 'Start recording' })
    await startButton.focus()
    await page.keyboard.press('Enter')

    await expect(page.getByRole('button', { name: 'Cancel countdown' })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('source selection adapts to mobile', async ({ page }) => {
    // The four source toggles (Screen/Webcam/Microphone/System Audio) are
    // always rendered, mobile viewport or not. Scoped to the toggle buttons
    // themselves — `[class*="sourceToggle"]` alone also matches the plural
    // `sourceToggles` container that wraps all four rows.
    const sourceOptions = page.locator('[class*="sourceToggle"] button[aria-pressed]')
    await expect(sourceOptions).toHaveCount(4)
  })

  // WCAG 2.2 AA 2.5.8 Target Size (Minimum) is 24x24 — the level this repo
  // actually audits (`runAxeCheck(page, { includeTags: ['wcag2aa'] })`
  // throughout `accessibility/core.spec.ts`). AAA's 2.5.5 (44x44) is a
  // separate, unclaimed target: the source toggles (`SourceToggles.tsx`'s
  // `.toggle`, App.module.css) are exactly 44x24, clearing AA by their
  // height alone and falling short of AAA — see
  // `ESCAPECRAFT VideoPlayer Responsive`'s "VideoPlayer controls accessible
  // on mobile" below for the one control already known to miss AAA too.
  test('controls have touch-friendly size', async ({ page }) => {
    const startButton = page.getByRole('button', { name: 'Start recording' })
    await expect(startButton).toBeVisible()
    const startBox = (await startButton.boundingBox())!
    expect(startBox.height).toBeGreaterThanOrEqual(24)

    for (const name of ['Screen', 'Webcam', 'Microphone', 'System Audio']) {
      const toggle = page.getByRole('button', { name, exact: true })
      await expect(toggle).toBeVisible()
      const box = (await toggle.boundingBox())!
      expect(box.height).toBeGreaterThanOrEqual(24)
    }
  })
})

// ESCSUITE-201: there is no collapsible settings panel in CRAFT (verified:
// no gear/settings control anywhere in apps/craft/src — the sidebar is
// static) — a deleted `ESCAPECRAFT Settings Panel Responsive` describe
// ("settings collapse on mobile", "settings toggle exists on mobile") used
// to stand in for one here.

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
    // This is the take's length, not a settle — two seconds of real frames
    // so there is something to save and a thumbnail to measure.
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
    // WCAG touch-target claim: `VideoPlayer.module.css`'s own
    // `@media (max-width: 640px)` rule shrinks `.controlButton` to 32x32,
    // which clears AA 2.5.8's 24x24 minimum but misses AAA 2.5.5's 44x44 —
    // a real, pre-existing gap this ticket does not fix (see
    // report-201.md). Assert what is actually true: the button is there,
    // enabled, and clicking it still works.
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
