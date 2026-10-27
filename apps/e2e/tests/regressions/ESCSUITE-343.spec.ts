import { test, expect } from '@playwright/test'
import { installMediaDevicesLayer } from '../../utils/media-mocks'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-343: a source the browser cannot capture is shown as off.
 *
 * The default config has the microphone on. With no microphone attached the
 * toggle greyed out but stayed drawn ON and announced "pressed", while the
 * take silently recorded no mic. Now an unavailable source renders unpressed
 * (without touching the stored preference, so it comes back on when the
 * device appears), and the reason it is unavailable reaches assistive tech as
 * the toggle's description rather than only as a hover tooltip.
 *
 * `enumerateDevices` is stubbed to list a camera and no `audioinput`, which is
 * what capability detection (`apps/craft/src/core/permissions.ts`) reads as
 * "No microphone found on this device".
 */

const NO_MICROPHONE = 'No microphone found on this device'

test.beforeEach(async ({ page }) => {
  await installMediaDevicesLayer(page)
  await page.addInitScript(() => {
    const enumerateDevices = async () =>
      [
        { deviceId: 'mock-camera', kind: 'videoinput', label: 'Mock Camera', groupId: 'mock' },
      ].map((device) => ({ ...device, toJSON: () => device })) as MediaDeviceInfo[]

    ;(window as unknown as { __layerMediaDevices: (o: Record<string, unknown>) => void })
      .__layerMediaDevices({ enumerateDevices })
  })
  await page.goto('http://localhost:5174')
  await waitForAppReady(page, 'craft')
})

test('a missing microphone shows its toggle as off and says why', async ({ page }) => {
  const micToggle = page.getByRole('button', { name: 'Microphone', exact: true })
  const webcamToggle = page.getByRole('button', { name: 'Webcam', exact: true })

  // Capability detection is async: wait until it has run (the camera is
  // listed, so the webcam toggle comes alive) before judging the mic.
  await expect(webcamToggle).toBeEnabled({ timeout: 30_000 })

  await expect(micToggle).toBeDisabled()
  await expect(micToggle).toHaveAttribute('aria-pressed', 'false')
  await expect(micToggle).not.toHaveClass(/active/)
  await expect(micToggle).toHaveAccessibleDescription(NO_MICROPHONE)
})
