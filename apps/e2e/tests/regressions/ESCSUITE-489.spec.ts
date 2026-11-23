import { test, expect } from '@playwright/test'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-489: the hub's not-found page kept the home page's canonical link
 * and og:url (the running page pointed both at `/`), and nothing told search
 * engines not to index a dead URL. The hosted `404.html` now carries a
 * not-found head (`tests/production/spa-fallback.spec.ts` checks the served
 * HTML); this checks the running page agrees with it, and that the noindex
 * goes away again once the visitor follows the link home.
 */
const HUB = 'http://localhost:5173'

test.describe('ESCSUITE-489: the not-found page has its own head', () => {
  test.beforeEach(async ({ page }) => {
    // The hub's analytics script is not served locally.
    await page.route('**/va.vercel-scripts.com/**', (route) => route.abort())
  })

  test('an unknown path is noindex, with no canonical or og:url, until the visitor goes home', async ({ page }) => {
    await page.goto(`${HUB}/no-such-page-escsuite-489`)
    await waitForAppReady(page, 'plan')
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()

    await expect(page).toHaveTitle('Page not found — ESCAPE Suite')
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0)
    await expect(page.locator('meta[property="og:url"]')).toHaveCount(0)
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /does not exist/)

    await page.getByRole('main').getByRole('link', { name: /home page/i }).click()
    await expect(page).toHaveURL(`${HUB}/`)
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0)
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://escapesuite.tech/')
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', 'https://escapesuite.tech/')
  })
})
