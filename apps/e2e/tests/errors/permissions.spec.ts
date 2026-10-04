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
  // the console, at record time. Bodiless on purpose — the K-1-family shapes
  // a real version of this test would need (isVisible().catch(), an
  // isDisabled-or-error disjunction) must not survive even unexecuted.
  test.fixme('shows error UI when camera denied', async () => {})

  test('app remains functional after camera denial', async ({ page }) => {
    // Other controls should still work — the camera denial must not take the
    // rest of the recorder down with it.
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Microphone' })).toBeVisible()
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
  // Bodiless on purpose — a real version needs the toggle-time notice
  // issue #289 asks for, which does not exist yet to assert against.
  test.fixme(
    'shows error UI when the microphone is toggled on with a refused prompt',
    async () => {}
  )

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

    // This is the take's length, not a settle.
    await page.waitForTimeout(2000)
    await page.getByRole('button', { name: 'Stop recording' }).click()
    await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toBeVisible({
      timeout: 30_000,
    })
  })

  test('screen recording still works without mic', async ({ page }) => {
    // Should be able to record screen without mic
    await expect(page.getByRole('button', { name: 'Screen' })).toBeEnabled()
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
    // Screen is on by default, so Start Recording is what actually calls
    // `getDisplayMedia` — `mockScreenShareDenied` makes it reject with
    // NotAllowedError. `requestScreenCapture` (`core/permissions.ts`)
    // re-wraps that into `Error('Screen capture permission denied', { cause })`
    // with the NotAllowedError carried as `cause` — `startFailureNotice`
    // (ESCSUITE-210) reads the name through `cause`, so this is the
    // refusal-specific sentence, not the generic one.
    await page.getByRole('button', { name: 'Start recording' }).click()

    await expect(
      page.getByText('The browser refused the capture — nothing was recorded.')
    ).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeEnabled()
  })

  test('can retry after denial', async ({ page }) => {
    const startButton = page.getByRole('button', { name: 'Start recording' })

    await startButton.click()
    await expect(
      page.getByText('The browser refused the capture — nothing was recorded.')
    ).toBeVisible({ timeout: 10_000 })

    // Should be able to click again, and the second attempt fails the same
    // way rather than hanging or crashing.
    await expect(startButton).toBeEnabled()
    await startButton.click()
    await expect(
      page.getByText('The browser refused the capture — nothing was recorded.')
    ).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('All Media Permissions Denied', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllMediaPermissionsDenied(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
  })

  test('shows appropriate error state', async ({ page }) => {
    // `mockAllMediaPermissionsDenied` has `enumerateDevices()` report no
    // devices at all — `permissions.ts` reads that as "no camera"/"no
    // microphone" and disables the two toggles that need one, rather than
    // crashing the app.
    await expect(page.getByRole('button', { name: 'Webcam' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Microphone' })).toBeDisabled()
  })

  test('capability detection shows unavailable', async ({ page }) => {
    // Look for capability indicators that should show as unavailable
    const unavailableIndicators = page.locator(
      '[class*="unavailable"], [class*="disabled"], [aria-disabled="true"]'
    )
    const count = await unavailableIndicators.count()

    // The webcam and microphone rows both grey out with no device enumerated.
    expect(count).toBeGreaterThan(0)
  })
})

test.describe('Device Not Found', () => {
  test.beforeEach(async ({ page }) => {
    // `mockSyntheticMedia` first so Screen's `getDisplayMedia` is real and
    // working (the device-mock layers replay on top of whatever is already
    // layered, see `media-mocks.ts`'s `installMediaDevicesLayer`) —
    // otherwise Start Recording would hang against headless Chromium's real,
    // picker-less `getDisplayMedia` before ever reaching the webcam's own
    // rejection this test is about. The camera is listed but cannot be
    // opened — without the device stub the toggle is disabled and never
    // reaches the getUserMedia rejection.
    await mockSyntheticMedia(page)
    await mockDeviceNotFound(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
  })

  test('shows device not found message', async ({ page }) => {
    const screenSource = page
      .locator('[class*="sourceToggle"]')
      .filter({ hasText: 'Screen' })
      .last()
    await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })

    const webcamToggle = page.getByRole('button', { name: 'Webcam', exact: true })
    await webcamToggle.click()
    await expect(webcamToggle).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('button', { name: 'Start recording' }).click()

    // `mockDeviceNotFound` throws `NotFoundError` for every `getUserMedia`
    // call, which `startFailureNotice` reports as this sentence (not the
    // NotAllowedError-specific one).
    await expect(page.getByText('The recording could not be started.')).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeEnabled()
  })
})

test.describe('Device In Use', () => {
  test.beforeEach(async ({ page }) => {
    // Same reasoning as "Device Not Found" above: real screen capture, a
    // webcam that is listed but cannot be opened.
    await mockSyntheticMedia(page)
    await mockDeviceInUse(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')
  })

  test('shows device in use message', async ({ page }) => {
    const screenSource = page
      .locator('[class*="sourceToggle"]')
      .filter({ hasText: 'Screen' })
      .last()
    await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })

    const webcamToggle = page.getByRole('button', { name: 'Webcam', exact: true })
    await webcamToggle.click()
    await expect(webcamToggle).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('button', { name: 'Start recording' }).click()

    // `mockDeviceInUse` throws `NotReadableError`, also reported as the
    // generic start-failure sentence.
    await expect(page.getByText('The recording could not be started.')).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeEnabled()
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
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible()
  })
})
