import { test, expect, type Page } from '@playwright/test'
import { mockSyntheticMedia, mockGetUserMedia, mockMediaRecorder, grantMediaPermissions } from '../../utils/media-mocks'
import { waitForAppReady } from '../../utils/ready'

/**
 * Records a short real take — `mockSyntheticMedia` hands the recorder a real
 * canvas-backed stream, so there is a genuine decodable file to save — and
 * opens its playback dialog from the library row's "Play" button. Same shape
 * as `accessibility/keyboard-navigation.spec.ts`'s helper of the same name;
 * duplicated rather than imported because that file's copy is private to a
 * describe ESCSUITE-201 does not own exclusively, and the brief asks for a
 * report note instead of a shared-helper edit (see report-201.md).
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

/** Records a take and leaves it in the library, without opening playback. */
async function recordATake(page: Page): Promise<void> {
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
  await expect(page.getByRole('button', { name: /^Play / })).toBeVisible({ timeout: 30_000 })
}

test.describe('VideoPlayer Component', () => {
  test.beforeEach(async ({ page, browserName }) => {
    // ESCSUITE-177: WebKit cannot store a Blob in IndexedDB in Playwright
    // (`UnknownError: Error preparing Blob/File data to be stored in object
    // store`), and every test below needs a saved take before there is a
    // playback dialog to open.
    test.skip(
      browserName === 'webkit',
      'WebKit cannot store a Blob in IndexedDB in Playwright (UnknownError: Error preparing Blob/File data to be stored in object store)'
    )
    test.setTimeout(120_000)

    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
  })

  test('play/pause toggle works', async ({ page }) => {
    await recordAndOpenPlayback(page)

    const toggle = page.getByTitle(/^(Play|Pause) \(Space\)$/)
    const initialTitle = await toggle.getAttribute('title')
    await toggle.click()

    await expect(
      page.getByTitle(initialTitle === 'Play (Space)' ? 'Pause (Space)' : 'Play (Space)')
    ).toBeVisible()
  })

  test('seeking via progress bar works', async ({ page }) => {
    await recordAndOpenPlayback(page)

    const video = page.locator('video')
    await expect.poll(() => video.evaluate((el) => (el as HTMLVideoElement).duration)).toBeGreaterThan(0)

    const progressBar = page.locator('[class*="progressContainer"]')
    await expect(progressBar).toBeVisible()
    const box = (await progressBar.boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

    await expect
      .poll(() => video.evaluate((el) => (el as HTMLVideoElement).currentTime))
      .toBeGreaterThan(0)
  })

  test('volume control works', async ({ page }) => {
    await recordAndOpenPlayback(page)

    // The slider stays in the DOM always but is only interactive on hover or
    // focus-within (`VideoPlayer.module.css`) — `.focus()` has no
    // actionability checks, so it reaches the hidden-until-focused control
    // and brings it on screen.
    const volumeSlider = page.getByRole('slider', { name: 'Volume' })
    await volumeSlider.focus()
    await expect(volumeSlider).toBeVisible()

    const initialValue = await volumeSlider.inputValue()
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => volumeSlider.inputValue()).not.toBe(initialValue)

    const video = page.locator('video')
    await expect
      .poll(() => video.evaluate((el) => (el as HTMLVideoElement).volume))
      .not.toBe(1)
  })

  test('keyboard shortcuts work', async ({ page }) => {
    await recordAndOpenPlayback(page)

    // Space toggles play/pause on the dialog body — the Close button claims
    // Space for its own activation instead (ESCSUITE-185), so this focuses
    // the dialog rather than the button.
    const transportToggle = page.getByTitle(/^(Play|Pause) \(Space\)$/)
    if ((await transportToggle.getAttribute('title')) === 'Play (Space)') {
      await transportToggle.click()
    }
    await expect(page.getByTitle('Pause (Space)')).toBeVisible()

    await page.getByRole('dialog').focus()
    await page.keyboard.press('Space')
    await expect(page.getByTitle('Play (Space)')).toBeVisible()

    // M toggles mute
    const video = page.locator('video')
    expect(await video.evaluate((el) => (el as HTMLVideoElement).muted)).toBe(false)
    await page.keyboard.press('m')
    expect(await video.evaluate((el) => (el as HTMLVideoElement).muted)).toBe(true)
  })
})

test.describe('Download Menu', () => {
  test.beforeEach(async ({ page, browserName }) => {
    test.skip(
      browserName === 'webkit',
      'WebKit cannot store a Blob in IndexedDB in Playwright (UnknownError: Error preparing Blob/File data to be stored in object store)'
    )
    test.setTimeout(120_000)

    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
  })

  // ESCSUITE-201: there is no dropdown "menu" to open at all — CRAFT shows a
  // row of three download buttons (WebM, MP4, M4A) on each saved take, never
  // a click-to-open menu. The two tests below assert the real row buttons;
  // this one had no feature to find and is deleted rather than kept as a
  // placeholder for a UI that does not exist.

  test('WebM instant download available', async ({ page }) => {
    await recordATake(page)

    const list = page.locator('section', { has: page.getByRole('heading', { name: 'Recordings' }) })
    const webmButton = list.locator('button[title="Download WebM"]')
    await expect(webmButton).toBeVisible()
    await expect(webmButton).toBeEnabled()
  })

  test('MP4 conversion option available', async ({ page }) => {
    await recordATake(page)

    const list = page.locator('section', { has: page.getByRole('heading', { name: 'Recordings' }) })
    const mp4Button = list.getByRole('button', { name: /^Download .+ as MP4$/ })
    await expect(mp4Button).toBeVisible()
    await expect(mp4Button).toBeEnabled()
  })
})

test.describe('Recording Controls', () => {
  test.beforeEach(async ({ page }) => {
    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
  })

  test('countdown display appears', async ({ page }) => {
    const screenSource = page
      .locator('[class*="sourceToggle"]')
      .filter({ hasText: 'Screen' })
      .last()
    await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Start recording' }).click()

    // `CountdownOverlay.tsx`'s real 3-2-1 overlay, which clicking "Start
    // recording" always reaches before any track is actually recorded.
    const countdown = page.locator('[class*="countdownNumber"]')
    await expect(countdown).toBeVisible({ timeout: 10_000 })
    await expect(countdown).toHaveText(/^[1-3]$/)

    // Leave it running rather than cancel — the countdown finishing into a
    // real take is exercised elsewhere; this test is only about the overlay.
    await page.getByRole('button', { name: 'Pause recording' }).waitFor({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Stop recording' }).click()
  })

  test('recording timer updates during recording', async ({ page }) => {
    const screenSource = page
      .locator('[class*="sourceToggle"]')
      .filter({ hasText: 'Screen' })
      .last()
    await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Start recording' }).click()
    await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({
      timeout: 30_000,
    })

    // `RecordingDurationReadout` ticks once a second off the store.
    const timer = page.locator('[class*="timer"]').filter({ hasText: /\d:\d\d/ })
    const initialText = await timer.textContent()

    await expect.poll(() => timer.textContent(), { timeout: 10_000 }).not.toBe(initialText)

    await page.getByRole('button', { name: 'Stop recording' }).click()
  })
})

test.describe('PiP Controls', () => {
  test.beforeEach(async ({ page }) => {
    await mockGetUserMedia(page)
    await mockMediaRecorder(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
    // The PiP settings panel (`WebcamOverlaySettings.tsx`) only draws once
    // the webcam is on.
    await page.getByRole('button', { name: 'Webcam' }).click()
  })

  test('PiP position controls exist', async ({ page }) => {
    const positionGroup = page.getByRole('group', { name: 'Webcam position' })
    await expect(positionGroup).toBeVisible()
    const buttons = positionGroup.getByRole('button')
    await expect(buttons).toHaveCount(4)
    // bottom-right is the stored default.
    await expect(buttons.filter({ hasText: 'bottom right' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  test('PiP size slider works', async ({ page }) => {
    const sizeSlider = page.getByRole('slider', { name: 'Webcam overlay size' })
    await expect(sizeSlider).toBeVisible()

    const initialValue = await sizeSlider.inputValue()
    await sizeSlider.focus()
    await page.keyboard.press('ArrowRight')

    await expect.poll(() => sizeSlider.inputValue()).not.toBe(initialValue)
  })

  test('webcam shape toggle exists', async ({ page }) => {
    const shapeGroup = page.getByRole('group', { name: 'Webcam shape' })
    await expect(shapeGroup).toBeVisible()

    const circle = shapeGroup.getByRole('button', { name: 'circle' })
    const rectangle = shapeGroup.getByRole('button', { name: 'rectangle' })
    await expect(circle).toHaveAttribute('aria-pressed', 'true')
    await expect(rectangle).toHaveAttribute('aria-pressed', 'false')

    await rectangle.click()

    await expect(rectangle).toHaveAttribute('aria-pressed', 'true')
    await expect(circle).toHaveAttribute('aria-pressed', 'false')
  })
})

test.describe('Source Selection', () => {
  test.beforeEach(async ({ page }) => {
    await mockGetUserMedia(page)
    await mockMediaRecorder(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
  })

  // ESCSUITE-201: CRAFT has no discrete "mode" buttons — a webcam-only or
  // picture-in-picture take is reached by combining the Screen and Webcam
  // toggles, not by choosing a named option. The three tests below assert
  // that real combination instead of a button that does not exist.

  test('screen source option available', async ({ page }) => {
    const screenToggle = page.getByRole('button', { name: 'Screen' })
    await expect(screenToggle).toBeVisible()
    // On by default.
    await expect(screenToggle).toHaveAttribute('aria-pressed', 'true')
  })

  test('webcam only option available', async ({ page }) => {
    const screenToggle = page.getByRole('button', { name: 'Screen' })
    // `exact: true` because turning the webcam on also reveals the "Record
    // webcam as a separate track" button, whose accessible name contains
    // "webcam" too — but only once Screen is also on (see the PiP test
    // below), which is the one case this name would otherwise be ambiguous.
    const webcamToggle = page.getByRole('button', { name: 'Webcam', exact: true })

    await screenToggle.click()
    await webcamToggle.click()

    await expect(screenToggle).toHaveAttribute('aria-pressed', 'false')
    await expect(webcamToggle).toHaveAttribute('aria-pressed', 'true')
  })

  test('PiP mode option available', async ({ page }) => {
    const screenToggle = page.getByRole('button', { name: 'Screen' })
    // `exact: true` — once Screen and Webcam are both on, the panel below
    // also shows a "Record webcam as a separate track" button, whose name
    // contains "webcam" and would otherwise make this locator ambiguous.
    const webcamToggle = page.getByRole('button', { name: 'Webcam', exact: true })

    // Screen is already on; turning the webcam on too is what PiP mode is.
    await webcamToggle.click()

    await expect(screenToggle).toHaveAttribute('aria-pressed', 'true')
    await expect(webcamToggle).toHaveAttribute('aria-pressed', 'true')
    // The PiP-specific settings panel is the real signature of the mode.
    await expect(page.getByRole('heading', { name: 'Webcam Overlay' })).toBeVisible()
  })
})

test.describe('Audio Controls', () => {
  test.beforeEach(async ({ page }) => {
    await mockGetUserMedia(page)
    await mockMediaRecorder(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
  })

  test('microphone toggle works', async ({ page }) => {
    const micToggle = page.getByRole('button', { name: 'Microphone' })
    await expect(micToggle).toBeVisible()
    const initialState = await micToggle.getAttribute('aria-pressed')
    expect(initialState).not.toBeNull()

    await micToggle.click()

    await expect(micToggle).toHaveAttribute(
      'aria-pressed',
      initialState === 'true' ? 'false' : 'true'
    )
  })

  test('system audio toggle available', async ({ page }) => {
    const systemAudioToggle = page.getByRole('button', { name: 'System Audio' })
    await expect(systemAudioToggle).toBeVisible()
    await expect(systemAudioToggle).toHaveAttribute('aria-pressed', 'false')
  })
})
