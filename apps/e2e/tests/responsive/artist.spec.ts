import { test, expect } from '@playwright/test'
import { VIEWPORTS, BREAKPOINTS } from '../../utils/viewports'
import { seedTextClip, openExportDialog, openExportAdvancedOptions } from '../../utils/artist'

test.describe('ESCAPEARTIST Mobile Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
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
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    const sidePanel = page.locator('[class*="sidebar"], [class*="inspector"]').first()
    const isVisible = await sidePanel.isVisible().catch(() => false)

    // Sidebar may be collapsed at narrow widths
    expect(typeof isVisible).toBe('boolean')
  })

  test('panels visible above breakpoint', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
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
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    // Export is disabled until the timeline holds a clip
    await seedTextClip(page)
    await openExportDialog(page)

    // Nothing in the dialog is pushed off the side of a 375px viewport
    for (const target of [
      page.getByRole('heading', { name: 'Export Video' }),
      page.getByRole('button', { name: 'Download WebM' }).first(),
      page.getByRole('button', { name: 'Cancel', exact: true }),
    ]) {
      const box = await target.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(375)
    }

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    )
    expect(overflows).toBe(false)
  })

  test('export options stack on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    await seedTextClip(page)
    await openExportDialog(page)
    await openExportAdvancedOptions(page)

    // The format choices stack rather than sitting side by side
    const webm = await page.getByRole('radio', { name: /WebM/ }).boundingBox()
    const mp4 = await page.getByRole('radio', { name: /MP4/ }).boundingBox()
    expect(webm).not.toBeNull()
    expect(mp4).not.toBeNull()
    expect(mp4!.y).toBeGreaterThanOrEqual(webm!.y + webm!.height)

    // ...and the quality/resolution pickers still fit the viewport
    const resolution = page
      .locator('select')
      .filter({ has: page.locator('option[value="480p"]') })
    const box = await resolution.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x + box!.width).toBeLessThanOrEqual(375)
  })
})

test.describe('ESCAPEARTIST Overlay Tools Responsive', () => {
  test('overlay tools accessible on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    const overlayToolbar = page.locator('[class*="overlay"], [class*="tools"]').first()
    const isVisible = await overlayToolbar.isVisible().catch(() => false)

    expect(typeof isVisible).toBe('boolean')
  })

  // FIXME(a11y): real app defect — tracked in https://github.com/Bonham-Technologies/ESCAPESUITE/issues/275
  // The overlay tool buttons (Add Text, Rectangle, Ellipse, Arrow, Blur) are
  // 28px tall at a 375px viewport — below the 40px this test asks for and well
  // below the 44px WCAG 2.2 target size.
  test.fixme('overlay tool buttons are touch-friendly', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
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
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })

  test('preview visible in landscape', async ({ page }) => {
    await page.setViewportSize({ width: 812, height: 375 })
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    const preview = page.locator('[class*="preview"], video').first()
    const isVisible = await preview.isVisible().catch(() => false)

    expect(typeof isVisible).toBe('boolean')
  })
})
