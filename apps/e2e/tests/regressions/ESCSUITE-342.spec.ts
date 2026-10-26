import { test, expect } from '@playwright/test'
import { mockCameraPermissionDenied } from '../../utils/error-mocks'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-342 (owner decision A1): a camera that fails at Start degrades the
 * take instead of costing it. CRAFT asks for the camera after the share
 * picker has been answered, and a camera failure used to throw that share
 * away with "nothing was recorded". Now the take records the screen without
 * the camera, shows no picture-in-picture overlay, and the notice says the
 * camera is not in this recording, so the user does not find the missing
 * overlay only at playback.
 *
 * `mockSyntheticMedia` answers the share picker with a real stream;
 * `mockCameraPermissionDenied` on top rejects only `getUserMedia`'s video
 * branch with `NotAllowedError`, so the screen and the microphone open and the
 * camera is refused.
 */

const CAMERA_NOT_IN_TAKE =
  'The camera could not be opened (permission refused or blocked in site settings) — recording the screen without it: the camera is not in this recording.'

test.beforeEach(async ({ page }) => {
  await mockSyntheticMedia(page)
  await mockCameraPermissionDenied(page)
  await grantMediaPermissions(page)
  await page.goto('http://localhost:5174')
  await waitForAppReady(page, 'craft')
})

test('a refused camera at Start records the screen and says the camera is missing', async ({
  page,
  browserName,
}) => {
  // Same WebKit Blob-in-IndexedDB gap as the other real recording specs
  // (ESCSUITE-177): this test needs the take saved at the end.
  test.skip(
    browserName === 'webkit',
    'WebKit cannot store a Blob in IndexedDB in Playwright (UnknownError: Error preparing Blob/File data to be stored in object store)'
  )
  test.setTimeout(120_000)

  // Capability detection is async; Start acquires no stream if clicked before
  // it finishes.
  const screenSource = page
    .locator('[class*="sourceToggle"]')
    .filter({ hasText: 'Screen' })
    .last()
  await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })

  const webcamToggle = page.getByRole('button', { name: 'Webcam', exact: true })
  await webcamToggle.click()
  await expect(webcamToggle).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Start recording' }).click()

  await expect(page.getByText(CAMERA_NOT_IN_TAKE)).toBeVisible({ timeout: 30_000 })
  // The take is running: a screen take, so the preview mirrors the screen in
  // a <video> rather than showing a compositor canvas with an empty overlay.
  await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible()
  await expect(page.locator('main canvas')).toHaveCount(0)

  // This is the take's length, not a settle.
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Stop recording' }).click()
  await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toBeVisible({
    timeout: 30_000,
  })
})
