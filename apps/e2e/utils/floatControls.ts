import { expect, type Page } from '@playwright/test'

/**
 * ESCAPECRAFT "Float controls" helpers (ESCSUITE-400), shared by the dev-server
 * spec (`tests/escapecraft/float-controls.spec.ts`) and the offline-build one
 * (`tests/standalone/craft.spec.ts`).
 */

/**
 * Record every `documentPictureInPicture.requestWindow()` call's options in
 * `window.__floatRequests`, passing each one through to the real API. Headless
 * Chromium ignores the requested size, so this is how a test sees what the app
 * asked for. Must run before navigation.
 */
export async function recordFloatingWindowRequests(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const target = window as unknown as {
      __floatRequests: unknown[]
      documentPictureInPicture?: { requestWindow: (options: unknown) => Promise<Window> }
    }
    target.__floatRequests = []
    const api = target.documentPictureInPicture
    if (!api) return
    const real = api.requestWindow.bind(api)
    api.requestWindow = (options: unknown) => {
      target.__floatRequests.push(options)
      return real(options)
    }
  })
}

/** Click "Float controls" and return the Picture-in-Picture window's page. */
export async function openFloatingControls(page: Page): Promise<Page> {
  const opened = page.context().waitForEvent('page')
  await page.getByRole('button', { name: 'Float controls' }).click()
  const floating = await opened
  await expect(floating.getByRole('main', { name: 'Recorder controls' })).toBeVisible()
  return floating
}

/**
 * Close the Picture-in-Picture window from inside it, the way its own close
 * button does, and wait until it is gone. Not `page.close()`: on Playwright's
 * Firefox that never settles for a Picture-in-Picture window.
 */
export async function closeFloatingControls(floating: Page): Promise<void> {
  const closed = floating.waitForEvent('close')
  // Deferred, so the evaluate has answered before the window goes away;
  // closing inline races the reply against the target closing.
  await floating.evaluate(() => {
    setTimeout(() => window.close(), 0)
  })
  await closed
}

/**
 * Start a take from the page and wait for it to be recording. Capture
 * detection is async, so the Screen toggle must be enabled first — a take
 * started before then acquires no stream.
 */
export async function startTake(page: Page): Promise<void> {
  const screenSource = page.locator('[class*="sourceToggle"]').filter({ hasText: 'Screen' }).last()
  await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({ timeout: 30_000 })
}
