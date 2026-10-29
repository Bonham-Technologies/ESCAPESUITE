import { test, expect } from '@playwright/test'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-394: in Firefox a microphone-only take never stopped. With no video
 * track the take goes to the MediaRecorder recorder, which always asked for a
 * video type (`video/webm;codecs=vp8,opus`). Firefox's MediaRecorder, given an
 * audio-only stream and that type, delivers no data, never fires `stop`, and
 * so Stop froze the timer and the take never reached the library. Chromium
 * accepts the combination, so this spec fails on the old code only in Firefox
 * (the nightly runs it there; PR CI runs Chromium).
 */
test('a microphone-only take stops and is saved to the library', async ({ page, browserName }) => {
  // Same WebKit Blob-in-IndexedDB gap as the other real recording specs
  // (ESCSUITE-177): this test needs the take saved at the end.
  test.skip(
    browserName === 'webkit',
    'WebKit cannot store a Blob in IndexedDB in Playwright (UnknownError: Error preparing Blob/File data to be stored in object store)'
  )
  test.setTimeout(120_000)
  await mockSyntheticMedia(page)
  await grantMediaPermissions(page)
  await page.goto('http://localhost:5174')
  await waitForAppReady(page, 'craft')

  const screen = page.getByRole('button', { name: 'Screen', exact: true })
  await expect(screen).toBeEnabled({ timeout: 30_000 })
  await screen.click()
  await expect(screen).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: 'Microphone', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )

  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({ timeout: 30_000 })
  // This is the take's length, not a settle.
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Stop recording' }).click()

  // The take is delivered and saved: it has a row in the library, and CRAFT
  // is ready for the next one.
  await expect(page.getByRole('button', { name: /^Play / })).toHaveCount(1, { timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Start recording' })).toBeEnabled()
})
