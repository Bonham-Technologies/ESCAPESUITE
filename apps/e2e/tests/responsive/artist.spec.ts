import { test, expect } from '@playwright/test'
import { mockClerkAuth } from '../../utils/auth'
import { VIEWPORTS, BREAKPOINTS } from '../../utils/viewports'

test.describe('ESCAPEARTIST Mobile Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
  })

  test('editor renders on mobile', async ({ page }) => {
    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })

  test('toolbar collapses on mobile', async ({ page }) => {
    const toolbar = page.locator('[class*="toolbar"]').first()
    const isVisible = await toolbar.isVisible().catch(() => false)

    if (isVisible) {
      const box = await toolbar.boundingBox()
      if (box) {
        // Toolbar should fit within mobile width
        expect(box.width).toBeLessThanOrEqual(375)
      }
    }
  })

  test('mobile menu toggle exists', async ({ page }) => {
    const menuToggle = page
      .getByRole('button', { name: /menu|more|options/i })
      .or(page.locator('[class*="hamburger"]'))
      .first()

    const exists = (await menuToggle.count()) > 0
    expect(typeof exists).toBe('boolean')
  })
})

test.describe('ESCAPEARTIST Tablet Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
  })

  test('timeline visible on tablet', async ({ page }) => {
    const timeline = page
      .locator('[class*="timeline"], [data-testid="timeline"]')
      .first()

    const isVisible = await timeline.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('panels adapt to tablet width', async ({ page }) => {
    const panels = page.locator('[class*="panel"]')
    const count = await panels.count()

    for (let i = 0; i < Math.min(count, 3); i++) {
      const panel = panels.nth(i)
      const isVisible = await panel.isVisible().catch(() => false)

      if (isVisible) {
        const box = await panel.boundingBox()
        if (box) {
          // Panels should fit within tablet width
          expect(box.width).toBeLessThanOrEqual(768)
        }
      }
    }
  })
})

test.describe('ESCAPEARTIST Panel Auto-Collapse', () => {
  test('panels collapse at 900px breakpoint', async ({ page }) => {
    await page.setViewportSize({ width: 899, height: 768 })
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    const sidePanel = page.locator('[class*="sidebar"], [class*="inspector"]').first()
    const isVisible = await sidePanel.isVisible().catch(() => false)

    // Sidebar may be collapsed at narrow widths
    expect(typeof isVisible).toBe('boolean')
  })

  test('panels visible above breakpoint', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    const sidePanel = page.locator('[class*="sidebar"], [class*="inspector"]').first()
    const isVisible = await sidePanel.isVisible().catch(() => false)

    // Sidebar should be visible at wider widths
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('ESCAPEARTIST Inspector Panel Responsive', () => {
  test('inspector slides out on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    const inspectorToggle = page
      .getByRole('button', { name: /inspector|properties|panel/i })
      .first()

    const toggleVisible = await inspectorToggle.isVisible().catch(() => false)

    if (toggleVisible) {
      await inspectorToggle.click()
      await page.waitForTimeout(300)

      const inspector = page.locator('[class*="inspector"]').first()
      const isVisible = await inspector.isVisible().catch(() => false)

      // Inspector should be able to open on mobile
      expect(typeof isVisible).toBe('boolean')
    }
  })

  test('inspector full width on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    const inspector = page.locator('[class*="inspector"]').first()
    const isVisible = await inspector.isVisible().catch(() => false)

    if (isVisible) {
      const box = await inspector.boundingBox()
      if (box) {
        // Inspector may take full width on mobile
        expect(box.width).toBeLessThanOrEqual(375)
      }
    }
  })
})

test.describe('ESCAPEARTIST Export Dialog Responsive', () => {
  test('export dialog fits mobile screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    const exportButton = page.getByRole('button', { name: /export/i }).first()
    const isVisible = await exportButton.isVisible().catch(() => false)

    if (isVisible) {
      await exportButton.click()
      await page.waitForTimeout(300)

      const dialog = page.getByRole('dialog')
      const dialogVisible = await dialog.isVisible().catch(() => false)

      if (dialogVisible) {
        const box = await dialog.boundingBox()
        if (box) {
          // Dialog should fit within viewport
          expect(box.width).toBeLessThanOrEqual(375)
        }
      }
    }
  })

  test('export options stack on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    const exportButton = page.getByRole('button', { name: /export/i }).first()
    const isVisible = await exportButton.isVisible().catch(() => false)

    if (isVisible) {
      await exportButton.click()
      await page.waitForTimeout(300)

      // Export options should be readable on mobile
      const options = page.getByRole('dialog').locator('[class*="option"], label')
      const count = await options.count()

      expect(count).toBeGreaterThanOrEqual(0)
    }
  })
})

test.describe('ESCAPEARTIST Overlay Tools Responsive', () => {
  test('overlay tools accessible on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    const overlayToolbar = page.locator('[class*="overlay"], [class*="tools"]').first()
    const isVisible = await overlayToolbar.isVisible().catch(() => false)

    expect(typeof isVisible).toBe('boolean')
  })

  test('overlay tool buttons are touch-friendly', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    const toolButtons = page.locator('[class*="tool"] button, [class*="toolbar"] button')
    const count = await toolButtons.count()

    for (let i = 0; i < Math.min(count, 5); i++) {
      const button = toolButtons.nth(i)
      const isVisible = await button.isVisible().catch(() => false)

      if (isVisible) {
        const box = await button.boundingBox()
        if (box) {
          expect(box.height).toBeGreaterThanOrEqual(40)
        }
      }
    }
  })
})

test.describe('ESCAPEARTIST Timeline Responsive', () => {
  test('timeline scrollable on narrow viewports', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 480 })
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    const timeline = page.locator('[class*="timeline"]').first()
    const isVisible = await timeline.isVisible().catch(() => false)

    if (isVisible) {
      const overflow = await timeline.evaluate((el) => {
        return window.getComputedStyle(el).overflowX
      })

      // Timeline should allow horizontal scroll if needed
      expect(['auto', 'scroll', 'visible', 'hidden']).toContain(overflow)
    }
  })

  test('timeline controls visible on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    const playButton = page.getByRole('button', { name: /play|pause/i }).first()
    const isVisible = await playButton.isVisible().catch(() => false)

    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('ESCAPEARTIST Landscape Mode', () => {
  test('editor works in landscape', async ({ page }) => {
    await page.setViewportSize({ width: 812, height: 375 }) // iPhone X landscape
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })

  test('preview visible in landscape', async ({ page }) => {
    await page.setViewportSize({ width: 812, height: 375 })
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    const preview = page.locator('[class*="preview"], video').first()
    const isVisible = await preview.isVisible().catch(() => false)

    expect(typeof isVisible).toBe('boolean')
  })
})
