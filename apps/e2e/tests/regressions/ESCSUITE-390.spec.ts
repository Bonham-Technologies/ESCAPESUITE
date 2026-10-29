import { test, expect } from '@playwright/test'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-390: with no working audio output device (Firefox on a machine with
 * no sound server, found by the first cross-browser nightly, ESCSUITE-388), an
 * AudioContext stays `suspended` and its `resume()` never settles. Both
 * recorders awaited that promise while setting up a take, so Start left CRAFT
 * stuck: 00:00, a disabled Stop button, no notice, and no way out but a reload.
 *
 * Now the wait is bounded: a context that has not started in time fails the
 * take with a notice that names the audio, and CRAFT is back to idle.
 *
 * The init script reproduces the device-less browser in any engine: every
 * AudioContext reports `suspended` and `resume()` never settles.
 */

const AUDIO_UNAVAILABLE =
  'Audio could not be started (no working sound output device was found) — nothing was recorded.'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(AudioContext.prototype, 'state', {
      configurable: true,
      get: () => 'suspended',
    })
    AudioContext.prototype.resume = () => new Promise<void>(() => {})
  })
  await mockSyntheticMedia(page)
  await grantMediaPermissions(page)
  await page.goto('http://localhost:5174')
  await waitForAppReady(page, 'craft')
})

test('an AudioContext that never starts fails the take with a notice instead of hanging', async ({
  page,
}) => {
  // Capability detection is async; Start acquires no stream if clicked before
  // it finishes.
  const screenSource = page
    .locator('[class*="sourceToggle"]')
    .filter({ hasText: 'Screen' })
    .last()
  await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })

  await page.getByRole('button', { name: 'Start recording' }).click()

  await expect(page.getByText(AUDIO_UNAVAILABLE)).toBeVisible({ timeout: 20_000 })
  // Back to idle: Start is offered again and no take is running.
  await expect(page.getByRole('button', { name: 'Start recording' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Pause recording' })).toHaveCount(0)
})
