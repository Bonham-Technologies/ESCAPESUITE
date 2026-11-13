import { test, expect, type Page } from '@playwright/test'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { waitForAppReady } from '../../utils/ready'
import { runAxeCheck } from '../../utils/accessibility'
import { openFloatingControls, closeFloatingControls } from '../../utils/floatControls'

/**
 * ESCSUITE-440: the "Float controls" window (ESCSUITE-400) is what the user
 * watches while the page sits behind the thing being recorded, so it has to
 * carry the countdown, the recorder's state and a blocked Record button's
 * reason itself.
 *
 * Before: during the 3-2-1 countdown the window showed "00:00" (the number was
 * drawn only by the page's overlay), its document had no live region, and a
 * blocked Record button kept its reason in `title` alone.
 *
 * No shim: headless Chromium implements `documentPictureInPicture` on a secure
 * origin and the window is a Playwright page of its own. It opens at the
 * context's viewport, so the window is set to the 360x160 the app asks for
 * before checking that everything fits.
 */

const CRAFT_URL = 'http://localhost:5174'

async function openCraft(page: Page): Promise<void> {
  await mockSyntheticMedia(page)
  await grantMediaPermissions(page)
  await page.goto(CRAFT_URL)
  await waitForAppReady(page, 'craft')
  // Capture detection is async; a take started before it answers acquires nothing.
  const screenSource = page.locator('[class*="sourceToggle"]').filter({ hasText: 'Screen' }).last()
  await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })
}

/** Everything fits the 360x160 window with nothing scrolled out of view. */
async function expectFits(floating: Page): Promise<void> {
  const size = await floating.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }))
  expect(size.width).toBeLessThanOrEqual(360)
  expect(size.height).toBeLessThanOrEqual(160)
}

async function expectNoAxeViolations(floating: Page): Promise<void> {
  const results = await runAxeCheck(floating)
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
}

test.describe('ESCSUITE-440: the Float controls window speaks for itself', () => {
  test.afterEach(async ({ page, context }) => {
    for (const other of context.pages()) {
      if (other !== page && !other.isClosed()) await closeFloatingControls(other)
    }
  })

  test('shows the countdown in place of the timer and announces every state of a take', async ({ page }) => {
    test.setTimeout(90_000)
    await openCraft(page)
    const floating = await openFloatingControls(page)
    await floating.setViewportSize({ width: 360, height: 160 })
    const controls = floating.getByRole('main', { name: 'Recorder controls' })

    // Every phrase the window's polite live region carries, as it changes.
    await floating.evaluate(() => {
      const said: string[] = []
      ;(window as unknown as { __said: string[] }).__said = said
      new MutationObserver(() => {
        const text = (document.querySelector('[aria-live="polite"]')?.textContent ?? '').trim()
        if (text && said[said.length - 1] !== text) said.push(text)
      }).observe(document.body, { childList: true, subtree: true, characterData: true })
    })
    const said = () => floating.evaluate(() => (window as unknown as { __said: string[] }).__said)

    await page.getByRole('button', { name: 'Start recording' }).click()

    // The countdown, where the timer was, and inside the window's bounds.
    const timer = controls.locator('[class*="timer"]')
    await expect(timer).toHaveText(/^[1-3]$/)
    await expect(timer).toBeInViewport({ ratio: 1 })
    await expect(controls.getByRole('button', { name: 'Cancel countdown' })).toBeInViewport({ ratio: 1 })
    await expectFits(floating)
    await expectNoAxeViolations(floating)

    // One polite, atomic region in the window's document.
    const region = floating.locator('[aria-live="polite"]')
    await expect(region).toHaveCount(1)
    await expect(region).toHaveAttribute('aria-atomic', 'true')

    // Then the take itself.
    await expect(controls.getByRole('button', { name: 'Pause recording' })).toBeVisible({ timeout: 30_000 })
    await expect(timer).toHaveText(/^\d\d:\d\d$/)
    await controls.getByRole('button', { name: 'Pause recording' }).click()
    await expect(region).toHaveText('Paused')
    await controls.getByRole('button', { name: 'Resume recording' }).click()
    await expect(region).toHaveText('Recording')
    await page.waitForTimeout(1000)
    await controls.getByRole('button', { name: 'Stop recording' }).click()
    await expect(region).toHaveText('Saved', { timeout: 30_000 })
    await expect(page.getByRole('button', { name: /^Play / })).toHaveCount(1)

    const phrases = await said()
    expect(phrases[0]).toMatch(/^Recording starts in [1-3]$/)
    expect(phrases.filter((phrase) => !phrase.startsWith('Recording starts in'))).toEqual([
      'Recording',
      'Paused',
      'Recording',
      'Saving...',
      'Saved',
    ])
  })

  test('prints why Record is blocked, as the button’s description, and still fits', async ({ page }) => {
    await openCraft(page)
    // Every source off: Record has nothing to capture.
    for (const source of ['Screen', 'Microphone']) {
      const toggle = page.locator('[class*="sourceToggle"]').filter({ hasText: source }).last().getByRole('button')
      if ((await toggle.getAttribute('aria-pressed')) === 'true') await toggle.click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    }

    const floating = await openFloatingControls(page)
    await floating.setViewportSize({ width: 360, height: 160 })
    const controls = floating.getByRole('main', { name: 'Recorder controls' })

    const reason = controls.getByText('Turn on a source before recording')
    await expect(reason).toBeInViewport({ ratio: 1 })
    const record = controls.getByRole('button', { name: 'Start recording' })
    await expect(record).toBeDisabled()
    await expect(record).toHaveAccessibleDescription('Turn on a source before recording')
    await expectFits(floating)
    await expectNoAxeViolations(floating)
  })
})
