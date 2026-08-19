import { test, expect } from '@playwright/test'

const GITHUB_URL = 'https://github.com/Bonham-Technologies/ESCAPESUITE'

test.describe('Header', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')
  })

  test('shows the suite logo linking home', async ({ page }) => {
    const logo = page.getByRole('link', { name: /escape suite home/i })
    await expect(logo).toBeVisible()
    await expect(logo).toHaveAttribute('href', '/')
  })

  test('main navigation is the GitHub link plus the theme toggle', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: /main navigation/i })
    await expect(nav).toBeVisible()

    await expect(nav.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
      'href',
      GITHUB_URL
    )

    // ThemeToggle renders one button per mode (light / dark / system)
    await expect(nav.getByRole('button', { name: 'Light mode' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Dark mode' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'System preference' })).toBeVisible()
  })

  test('has no account or billing controls', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: /main navigation/i })
    const authControls = nav.getByRole('link', {
      name: /sign in|sign up|dashboard|pricing|account/i,
    })
    expect(await authControls.count()).toBe(0)
  })
})

test.describe('Theme toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')
  })

  test('switching modes updates the document theme', async ({ page }) => {
    const light = page.getByRole('button', { name: 'Light mode' })
    const dark = page.getByRole('button', { name: 'Dark mode' })

    // Light mode stamps data-theme="light" on <html>
    await light.click()
    await expect(light).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

    // Dark mode is the default styling, so the attribute is removed again
    await dark.click()
    await expect(dark).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light')
  })
})

test.describe('Footer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')
  })

  test('links to the legal pages', async ({ page }) => {
    await expect(page.getByRole('link', { name: /privacy policy/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /terms of service/i })).toBeVisible()
  })

  test('links to the GitHub repository', async ({ page }) => {
    const repoLink = page
      .getByRole('contentinfo')
      .getByRole('link', { name: 'GitHub' })
    await expect(repoLink).toHaveAttribute('href', GITHUB_URL)
    await expect(repoLink).toHaveAttribute('target', '_blank')
    await expect(repoLink).toHaveAttribute('rel', 'noopener noreferrer')
  })
})

test.describe('Per-route SEO', () => {
  const CANONICAL_ORIGIN = 'https://www.escapesuite.io'

  // index.html is served for every SPA route, so without per-route tags each
  // route would claim to be the homepage.
  const routes = [
    { path: '/', canonical: `${CANONICAL_ORIGIN}/`, title: /free, open-source/i },
    { path: '/privacy', canonical: `${CANONICAL_ORIGIN}/privacy`, title: /privacy policy/i },
    { path: '/terms', canonical: `${CANONICAL_ORIGIN}/terms`, title: /terms of service/i },
  ]

  for (const route of routes) {
    test(`${route.path} sets its own title and canonical`, async ({ page }) => {
      await page.goto(`http://localhost:5173${route.path}`)
      await page.waitForLoadState('networkidle')

      await expect(page).toHaveTitle(route.title)

      // Exactly one canonical must exist, pointing at this route.
      const canonicals = page.locator('link[rel="canonical"]')
      await expect(canonicals).toHaveCount(1)
      await expect(canonicals).toHaveAttribute('href', route.canonical)

      const description = page.locator('meta[name="description"]')
      await expect(description).toHaveCount(1)
      expect((await description.getAttribute('content'))?.length ?? 0).toBeGreaterThan(50)
    })
  }
})

test.describe('Routes', () => {
  test('privacy page renders', async ({ page }) => {
    await page.goto('http://localhost:5173/privacy')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('terms page renders', async ({ page }) => {
    await page.goto('http://localhost:5173/terms')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})
