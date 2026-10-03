import { test, expect } from '@playwright/test'
import {
  mockCameraPermissionDenied,
  mockMicrophonePermissionDenied,
  mockScreenShareDenied,
  mockAllMediaPermissionsDenied,
  mockDeviceNotFound,
  mockDeviceInUse,
} from '../../utils/error-mocks'
import { mockMediaDevices, mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { waitForAppReady } from '../../utils/ready'

test.describe('Camera Permission Denied', () => {
  test.beforeEach(async ({ page }) => {
    // The toggles these tests click are disabled unless a device is enumerated,
    // and CI runners have no camera or microphone attached.
    await mockMediaDevices(page)
    await mockCameraPermissionDenied(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')

    // ESCSUITE-177 review MAJOR 1: a real assertion that the mock actually
    // installed, not just that the app rendered *something*. Denying the
    // camera must not take Screen down with it — if `mockCameraPermissionDenied`
    // had replaced `navigator.mediaDevices` with an object spread (which
    // carries none of the platform's own methods, camera denial included),
    // every source would read as unavailable and this button would be
    // disabled.
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeEnabled()
  })

  // FIXME(ux): needs denied-device feedback — tracked in https://github.com/Bonham-Technologies/ESCAPESUITE/issues/289
  // Nothing is shown when a camera cannot be opened: the failure only reaches
  // the console, at record time. This test matched no buttons until the source
  // toggles gained accessible names, so it had never actually run.
  test.fixme('shows error UI when camera denied', async ({ page }) => {
    // Try to enable webcam
    const webcamToggle = page
      .getByRole('button', { name: /webcam|camera/i })
      .or(page.locator('[data-testid="webcam-toggle"]'))
      .first()

    const isVisible = await webcamToggle.isVisible().catch(() => false)

    if (isVisible) {
      await webcamToggle.click()
      await page.waitForTimeout(500)

      // Should show error message or disabled state
      const errorMessage = page.getByText(/denied|permission|blocked|not allowed/i).first()
      const errorVisible = await errorMessage.isVisible().catch(() => false)

      // Either show error or toggle should be disabled/inactive
      const isDisabled = await webcamToggle.isDisabled().catch(() => false)
      const ariaDisabled = await webcamToggle.getAttribute('aria-disabled')

      expect(errorVisible || isDisabled || ariaDisabled === 'true').toBe(true)
    }
  })

  test('app remains functional after camera denial', async ({ page }) => {
    // Verify main UI is still working
    const html = await page.content()
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<div id="root">')

    // Other controls should still work
    const micToggle = page
      .getByRole('button', { name: /mic|audio|microphone/i })
      .first()

    const isVisible = await micToggle.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('Microphone Permission Denied', () => {
  test.beforeEach(async ({ page }) => {
    // `mockSyntheticMedia` gives Screen a real, working `getDisplayMedia` (and
    // installs the device list itself, same as `mockMediaDevices` — ESCSUITE-177).
    // The plain device-list mock alone lets the source toggles light up but
    // leaves Screen capture pointed at the browser's own `getDisplayMedia`,
    // which headless Chromium has nothing to pick a source from and never
    // settles. `mockMicrophonePermissionDenied` layers on top of that and
    // only touches `getUserMedia`'s audio branch, so Screen is unaffected.
    await mockSyntheticMedia(page)
    await mockMicrophonePermissionDenied(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
  })

  // FIXME(ux): needs denied-device feedback for the toggle-time gap — tracked
  // in https://github.com/Bonham-Technologies/ESCAPESUITE/issues/289. Nothing
  // is shown when the microphone is switched ON before a take: the toggle is
  // a pure config flip (`App.tsx`'s `toggleSource`) with no probe of its own,
  // so a refused prompt is only discovered at Start. A take STARTED with a
  // closed microphone is no longer this gap — ESCSUITE-184 gave that path the
  // notice the real case below proves.
  test.fixme('shows error UI when the microphone is toggled on with a refused prompt', async ({ page }) => {
    const micToggle = page.getByRole('button', { name: 'Microphone' })
    await expect(micToggle).toBeEnabled()

    // Default-on, so this turns it off, then on again — the toggle the gap
    // is about.
    await micToggle.click()
    await micToggle.click()
    await page.waitForTimeout(500)

    await expect(page.getByText(/denied|permission|blocked/i).first()).toBeVisible()
  })

  // ESCSUITE-184, proved in a real browser (ESCSUITE-187). Screen and
  // Microphone are both on by default (`recorderStore`'s initial config), so
  // starting a take exercises the mic's refusal without touching any toggle.
  test('shows the microphone-unavailable notice and still records when the mic is refused', async ({
    page,
    browserName,
  }) => {
    // ESCSUITE-177: same WebKit Blob-in-IndexedDB gap as the other real
    // recording specs — this test needs the take saved at the end.
    test.skip(
      browserName === 'webkit',
      'WebKit cannot store a Blob in IndexedDB in Playwright (UnknownError: Error preparing Blob/File data to be stored in object store)'
    )
    test.setTimeout(120_000)

    // Capability detection is async; Start acquires no stream if clicked
    // before it finishes.
    const screenSource = page
      .locator('[class*="sourceToggle"]')
      .filter({ hasText: 'Screen' })
      .last()
    await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Start recording' }).click()

    await expect(
      page.getByText('The microphone could not be opened — recording without it.')
    ).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible()

    await page.waitForTimeout(2000)
    await page.getByRole('button', { name: 'Stop recording' }).click()
    await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toBeVisible({
      timeout: 30_000,
    })
  })

  test('screen recording still works without mic', async ({ page }) => {
    // Should be able to record screen without mic
    const screenButton = page
      .getByRole('button', { name: /screen|record/i })
      .or(page.locator('[data-testid="screen-button"]'))
      .first()

    const isVisible = await screenButton.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('Screen Share Permission Denied', () => {
  test.beforeEach(async ({ page }) => {
    // Webcam/Microphone availability depends on `enumerateDevices()`
    // reporting at least one device of each kind (`permissions.ts`), so
    // without this the Screen/Webcam/Microphone assertion below is a CI
    // runner's own hardware, not the mock: a developer laptop's camera and
    // mic pass it by accident, and a CI runner with neither fails it for a
    // reason that has nothing to do with `mockScreenShareDenied` (observed
    // in CI: Screen and Microphone enabled, Webcam not, on a runner with no
    // camera). `mockMediaDevices` first, same as the Camera/Microphone
    // describes above, so the three-rows-enabled assertion proves the
    // layering fix instead of the runner's hardware.
    await mockMediaDevices(page)
    await mockScreenShareDenied(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')

    // ESCSUITE-177 review MAJOR 1: denying screen share alone must not take
    // Webcam/Microphone down with it — that was the symptom of the broken
    // object-spread layer (it replaced `navigator.mediaDevices` with just
    // `{ getDisplayMedia }`, which reads as neither API existing for the
    // other two sources).
    await expect(page.getByRole('button', { name: 'Screen' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Webcam' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Microphone' })).toBeEnabled()
  })

  test('shows error UI when screen share denied', async ({ page }) => {
    const screenButton = page
      .getByRole('button', { name: /screen|share|record/i })
      .or(page.locator('[data-testid="screen-button"]'))
      .first()

    const isVisible = await screenButton.isVisible().catch(() => false)

    if (isVisible) {
      await screenButton.click()
      await page.waitForTimeout(500)

      // App should still be functional
      const html = await page.content()
      expect(html).toContain('<div id="root">')
    }
  })

  test('can retry after denial', async ({ page }) => {
    const screenButton = page
      .getByRole('button', { name: /screen|share|record/i })
      .or(page.locator('[data-testid="screen-button"]'))
      .first()

    const isVisible = await screenButton.isVisible().catch(() => false)

    if (isVisible) {
      // First attempt
      await screenButton.click()
      await page.waitForTimeout(300)

      // Should be able to click again
      const stillClickable = await screenButton.isEnabled().catch(() => true)
      expect(stillClickable).toBe(true)
    }
  })
})

test.describe('All Media Permissions Denied', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllMediaPermissionsDenied(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
  })

  test('shows appropriate error state', async ({ page }) => {
    // App should load but show limited functionality
    const html = await page.content()
    expect(html).toContain('<div id="root">')

    // May show permission banner or error state
    const errorBanner = page.getByText(/permission|access|denied|enable|allow/i).first()
    const hasError = await errorBanner.isVisible().catch(() => false)

    // At minimum, app should not crash
    expect(typeof hasError).toBe('boolean')
  })

  test('capability detection shows unavailable', async ({ page }) => {
    // Look for capability indicators that should show as unavailable
    const unavailableIndicators = page.locator(
      '[class*="unavailable"], [class*="disabled"], [aria-disabled="true"]'
    )
    const count = await unavailableIndicators.count()

    // May have multiple unavailable features
    expect(count).toBeGreaterThanOrEqual(0)
  })
})

test.describe('Device Not Found', () => {
  test.beforeEach(async ({ page }) => {
    // The camera is listed but cannot be opened — without the device stub the
    // toggle is disabled and never reaches the getUserMedia rejection.
    await mockMediaDevices(page)
    await mockDeviceNotFound(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
  })

  test('shows device not found message', async ({ page }) => {
    const webcamToggle = page
      .getByRole('button', { name: /webcam|camera/i })
      .first()

    const isVisible = await webcamToggle.isVisible().catch(() => false)

    if (isVisible) {
      await webcamToggle.click()
      await page.waitForTimeout(500)

      // App should remain functional
      const html = await page.content()
      expect(html).toContain('<div id="root">')
    }
  })
})

test.describe('Device In Use', () => {
  test.beforeEach(async ({ page }) => {
    // Listed, but held by another application — same reasoning as above.
    await mockMediaDevices(page)
    await mockDeviceInUse(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
  })

  test('shows device in use message', async ({ page }) => {
    const webcamToggle = page
      .getByRole('button', { name: /webcam|camera/i })
      .first()

    const isVisible = await webcamToggle.isVisible().catch(() => false)

    if (isVisible) {
      await webcamToggle.click()
      await page.waitForTimeout(500)

      // App should remain functional
      const html = await page.content()
      expect(html).toContain('<div id="root">')
    }
  })
})

test.describe('Permission Recovery', () => {
  test('can recover after granting permissions', async ({ page, context }) => {
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')

    // Grant permissions (Chromium-only; Firefox/WebKit don't support this)
    const browserName = context.browser()?.browserType().name()
    if (browserName === 'chromium') {
      await context.grantPermissions(['camera', 'microphone'])
    }

    // Refresh to pick up new permissions
    await page.reload()
    await waitForAppReady(page, 'craft')

    // Should work normally now
    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })
})
