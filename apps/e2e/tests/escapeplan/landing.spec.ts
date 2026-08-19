import { test, expect } from '@playwright/test'

const GITHUB_URL = 'https://github.com/Bonham-Technologies/ESCAPESUITE'

test.describe('ESCAPEPLAN Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')
  })

  test('app loads without errors', async ({ page }) => {
    const html = await page.content()
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<div id="root">')
  })

  test('renders the hero headline', async ({ page }) => {
    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toBeVisible()
    await expect(heading).toContainText(/how-to videos/i)
  })

  test('hero offers both tools', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open the editor' })).toBeVisible()
  })

  test('tool cards launch ESCAPECRAFT and ESCAPEARTIST', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Use ESCAPECRAFT' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Use ESCAPEARTIST' })).toBeVisible()
  })

  test('links to the public GitHub repository', async ({ page }) => {
    const repoLinks = page.locator(`a[href="${GITHUB_URL}"]`)
    expect(await repoLinks.count()).toBeGreaterThan(0)
    await expect(repoLinks.first()).toHaveAttribute('target', '_blank')
  })

  test('offers the offline build download', async ({ page }) => {
    const releaseLink = page.locator(`a[href="${GITHUB_URL}/releases/latest"]`).first()
    await expect(releaseLink).toBeVisible()
  })

  test('has no auth or billing surface', async ({ page }) => {
    const body = page.locator('body')
    await expect(body).not.toContainText(/sign in/i)
    await expect(body).not.toContainText(/sign up/i)
    await expect(body).not.toContainText(/pricing/i)
    await expect(body).not.toContainText(/free trial/i)
  })
})

test.describe('ESCAPEPLAN Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')
  })

  test('page has working scroll', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 500))
    await page.waitForTimeout(300)

    const scrollY = await page.evaluate(() => window.scrollY)
    expect(scrollY).toBeGreaterThan(0)
  })

  test('legal pages are reachable from the footer', async ({ page }) => {
    await page.getByRole('link', { name: /privacy policy/i }).click()
    await expect(page).toHaveURL(/\/privacy$/)

    await page.getByRole('link', { name: /terms of service/i }).click()
    await expect(page).toHaveURL(/\/terms$/)
  })

  test('unknown routes fall back to the landing page', async ({ page }) => {
    await page.goto('http://localhost:5173/nonexistent-page-12345')
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL('http://localhost:5173/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})
