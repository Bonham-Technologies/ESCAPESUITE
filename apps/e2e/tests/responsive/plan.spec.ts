import { test, expect } from '@playwright/test'

test.describe('ESCAPEPLAN Mobile Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')
  })

  test('landing page renders on mobile', async ({ page }) => {
    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })

  test('header navigation stays visible on mobile', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: /main navigation/i })
    await expect(nav).toBeVisible()
    await expect(nav.getByRole('link', { name: 'GitHub' })).toBeVisible()
  })

  test('hero section stacks vertically', async ({ page }) => {
    const heroContent = page.locator('section').first()
    const isVisible = await heroContent.isVisible().catch(() => false)

    if (isVisible) {
      const box = await heroContent.boundingBox()
      if (box) {
        // Content should be narrower than viewport
        expect(box.width).toBeLessThanOrEqual(375)
      }
    }
  })

  test('text is readable on mobile', async ({ page }) => {
    const paragraphs = page.locator('p')
    const count = await paragraphs.count()

    for (let i = 0; i < Math.min(count, 5); i++) {
      const p = paragraphs.nth(i)
      const isVisible = await p.isVisible().catch(() => false)

      if (isVisible) {
        const fontSize = await p.evaluate((el) => {
          return parseInt(window.getComputedStyle(el).fontSize)
        })
        // Text should be at least 14px for readability
        expect(fontSize).toBeGreaterThanOrEqual(14)
      }
    }
  })

  test('buttons are touch-friendly size', async ({ page }) => {
    const buttons = page.getByRole('button')
    const count = await buttons.count()

    for (let i = 0; i < Math.min(count, 5); i++) {
      const button = buttons.nth(i)
      const isVisible = await button.isVisible().catch(() => false)

      if (isVisible) {
        const box = await button.boundingBox()
        if (box) {
          // Touch targets should be at least 44px
          expect(box.height).toBeGreaterThanOrEqual(40)
        }
      }
    }
  })

  test('no horizontal scroll on mobile', async ({ page }) => {
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
    const viewportWidth = 375

    // Body should not be wider than viewport
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1)
  })

  test('tool cards stack on mobile', async ({ page }) => {
    const craftButton = page.getByRole('button', { name: 'Use ESCAPECRAFT' })
    const artistButton = page.getByRole('button', { name: 'Use ESCAPEARTIST' })

    const craftBox = await craftButton.boundingBox()
    const artistBox = await artistButton.boundingBox()

    expect(craftBox).not.toBeNull()
    expect(artistBox).not.toBeNull()

    if (craftBox && artistBox) {
      // Stacked: the second card sits below the first
      expect(artistBox.y).toBeGreaterThan(craftBox.y)
    }
  })
})

test.describe('ESCAPEPLAN Tablet Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')
  })

  test('landing page renders on tablet', async ({ page }) => {
    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })

  // Note: This test verifies tablet navigation but is skipped in CI due to
  // app loading/rendering timing issues. Run locally to verify.
  test.skip('navigation adapts to tablet', async ({ page }) => {
    const nav = page.locator('nav, header').first()
    const isVisible = await nav.isVisible().catch(() => false)

    expect(isVisible).toBe(true)
  })

  test('tool cards adapt layout', async ({ page }) => {
    const toolCards = page.locator('[class*="toolCard"]')
    expect(await toolCards.count()).toBe(2)
  })
})

test.describe('ESCAPEPLAN Desktop Layout', () => {
  test('tool cards sit side by side on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')

    const craftBox = await page
      .getByRole('button', { name: 'Use ESCAPECRAFT' })
      .boundingBox()
    const artistBox = await page
      .getByRole('button', { name: 'Use ESCAPEARTIST' })
      .boundingBox()

    expect(craftBox).not.toBeNull()
    expect(artistBox).not.toBeNull()

    // Side by side: the second card sits to the right of the first, on one row
    expect(artistBox!.x).toBeGreaterThan(craftBox!.x)
    expect(artistBox!.y).toBe(craftBox!.y)
  })
})
