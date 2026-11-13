import { test, expect } from '@playwright/test'
import { waitForAppReady } from '../../utils/ready'
import { runAxeCheck } from '../../utils/accessibility'

/**
 * ESCSUITE-455: the hub answered every made-up URL with its home page — the
 * hosting rewrote unknown paths to the hub, and the hub's router then redirected
 * them to `/`. The status half (a real 404 from the hosting) is pinned by
 * `tests/production/not-found.spec.ts` against the combined build; this pins the
 * page half against the hub itself: an unknown path shows a not-found page at
 * its own URL, with keyboard-reachable links home and to both tools.
 */
const HUB = 'http://localhost:5173'

test.describe('ESCSUITE-455: unknown hub paths show a not-found page', () => {
  test.beforeEach(async ({ page }) => {
    // The hub's analytics script is not served locally.
    await page.route('**/va.vercel-scripts.com/**', (route) => route.abort())
  })

  test('a made-up path shows "Page not found" instead of the home page', async ({ page }) => {
    await page.goto(`${HUB}/no-such-page-xyz`)
    await waitForAppReady(page, 'plan')

    await expect(page).toHaveURL(`${HUB}/no-such-page-xyz`)
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start recording' })).toHaveCount(0)
    await expect(page).toHaveTitle(/page not found/i)

    const main = page.getByRole('main')
    await expect(main.getByRole('link', { name: /home page/i })).toBeVisible()
    await expect(main.getByRole('link', { name: /ESCAPECRAFT/ })).toBeVisible()
    await expect(main.getByRole('link', { name: /ESCAPEARTIST/ })).toBeVisible()
  })

  test('the home link is reachable by keyboard and goes home', async ({ page }) => {
    await page.goto(`${HUB}/no-such-page-xyz`)
    await waitForAppReady(page, 'plan')

    const home = page.getByRole('main').getByRole('link', { name: /home page/i })
    await expect(home).toBeVisible()
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab')
      if (await home.evaluate((el) => el === document.activeElement)) break
    }
    await expect(home).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(`${HUB}/`)
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible()
  })

  // The page is links inside running text, which is where a palette tuned for
  // one theme fails contrast in the other. `?theme=` is the theme system's own
  // override and does not persist.
  for (const theme of ['dark', 'light'] as const) {
    test(`the not-found page passes axe-core (${theme} theme)`, async ({ page }) => {
      await page.goto(`${HUB}/no-such-page-xyz?theme=${theme}`)
      await waitForAppReady(page, 'plan')
      if (theme === 'light') {
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
      } else {
        await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light')
      }
      await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()

      const results = await runAxeCheck(page, {})
      expect(results.violations).toEqual([])
    })
  }
})
