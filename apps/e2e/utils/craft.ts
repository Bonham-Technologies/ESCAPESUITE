import { Page, expect } from '@playwright/test'

/**
 * ESCAPECRAFT test helpers.
 *
 * Both of these need `mockSyntheticMedia` already installed and the page
 * already navigated — a real, canvas-backed stream, not the inert
 * `mockGetUserMedia` stub, which has no actual video tracks and whose
 * stream-shaped (but not-a-real-`MediaStream`) object throws when the
 * preview `<video>`'s `srcObject` is assigned it (`useMediaStreams.ts`).
 */

/**
 * Starts a take and waits for the recorder to actually be running.
 * Capability detection is async, so this waits for the Screen toggle to be
 * enabled before clicking Start — a take started before that finishes
 * acquires no stream.
 */
async function startAndWaitForRecording(page: Page): Promise<void> {
  const screenSource = page
    .locator('[class*="sourceToggle"]')
    .filter({ hasText: 'Screen' })
    .last()
  await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })

  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({
    timeout: 30_000,
  })
}

/**
 * Records a short real take and leaves it saved in the library, without
 * opening playback.
 */
export async function recordATake(page: Page): Promise<void> {
  await startAndWaitForRecording(page)
  // This is the take's length, not a settle — two seconds of real frames so
  // there is something to save and play back, not a wait for anything to
  // finish happening.
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Stop recording' }).click()
  await expect(page.getByRole('button', { name: /^Play / })).toBeVisible({ timeout: 30_000 })
}

/**
 * Records a short real take and opens its playback dialog from the library
 * row's "Play" button.
 */
export async function recordAndOpenPlayback(page: Page): Promise<void> {
  await recordATake(page)

  await page.getByRole('button', { name: /^Play / }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
}
