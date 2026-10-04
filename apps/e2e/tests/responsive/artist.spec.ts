import { test, expect } from '@playwright/test'
import {
  seedTextClip,
  openExportDialog,
  openExportAdvancedOptions,
  inspector,
} from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

test.describe('ESCAPEARTIST Mobile Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
  })

  test('editor renders on mobile', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Export video' })).toBeVisible()
  })

  test('toolbar fits within mobile width', async ({ page }) => {
    const toolbar = page.locator('[class*="toolbar"]').first()
    await expect(toolbar).toBeVisible()
    const box = (await toolbar.boundingBox())!
    expect(box.width).toBeLessThanOrEqual(375)
  })
})

// ESCSUITE-202: there is no hamburger/mobile-menu control anywhere in
// apps/artist/src — a deleted "mobile menu toggle exists" test used to stand
// in for one here. The two real collapse controls (`MediaLibrarySidebar`'s
// and `InspectorSidebar`'s own collapse buttons, plus the floating
// `MobileInspectorToggle` shown only below the 900px breakpoint) are covered
// below, the same shape ESCSUITE-201 gave CRAFT's deleted "Settings Panel
// Responsive" describe.

test.describe('ESCAPEARTIST Tablet Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
  })

  test('timeline visible on tablet', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Add new track' })).toBeVisible()
  })

  test('panels fit within tablet width', async ({ page }) => {
    const mediaSidebar = page.locator('aside').filter({ has: page.locator('#media-library-title') })

    for (const panel of [mediaSidebar, inspector(page)]) {
      await expect(panel).toBeVisible()
      const box = (await panel.boundingBox())!
      expect(box.width).toBeLessThanOrEqual(768)
    }
  })
})

test.describe('ESCAPEARTIST Panel Auto-Collapse', () => {
  test('media sidebar collapses at 900px breakpoint', async ({ page }) => {
    await page.setViewportSize({ width: 899, height: 768 })
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')

    // Prove the page actually rendered the editor before trusting the
    // absence below (ESCSUITE-201 hunt K-U1): a gutted page would also hide
    // this text.
    await expect(page.getByRole('button', { name: 'Export video' })).toBeVisible()

    // `App.module.css`'s `@media (max-width: 900px)` rule hides the
    // sidebar's expanded header text, shrinking it to a 40px strip.
    await expect(page.getByText('Media Library')).toBeHidden()
  })

  test('media sidebar expanded above breakpoint', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')

    await expect(page.getByText('Media Library')).toBeVisible()
  })
})

test.describe('ESCAPEARTIST Inspector Panel Responsive', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
  })

  test('inspector slides out on mobile', async ({ page }) => {
    // `MobileInspectorToggle` — the floating round button shown only below
    // the 900px breakpoint — toggles the slide-out panel shut and back open.
    const toggle = page.getByRole('button', { name: /^(Hide|Show) inspector$/ })
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-label', 'Hide inspector')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-label', 'Show inspector')
    await expect(inspector(page)).toHaveClass(/inspectorCollapsed/)

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-label', 'Hide inspector')
  })

  test('inspector full width on mobile', async ({ page }) => {
    await expect(inspector(page)).toBeVisible()
    // The slide-out panel is a fixed ~300px width (plus border), not the
    // 375px viewport's — it overlays the editor rather than reflowing to
    // fill it.
    const box = (await inspector(page).boundingBox())!
    expect(box.width).toBeLessThan(350)
    expect(box.width).toBeGreaterThan(280)
  })
})

test.describe('ESCAPEARTIST Export Dialog Responsive', () => {
  test('export dialog fits mobile screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')

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
    await waitForAppReady(page, 'artist')

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
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
  })

  test('overlay tools accessible on mobile', async ({ page }) => {
    // The inspector's empty-state overlay buttons, visible on screen (the
    // slide-out panel defaults open) at a phone width.
    await expect(page.getByRole('button', { name: 'Add Text' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Rectangle' })).toBeVisible()
  })

  test('overlay tool buttons are touch-friendly', async ({ page }) => {
    for (const name of ['Add Text', 'Rectangle', 'Ellipse', 'Arrow', 'Blur']) {
      const button = page.getByRole('button', { name })
      await expect(button).toBeVisible()
      const box = (await button.boundingBox())!
      // WCAG 2.2 AA 2.5.8 Target Size (Minimum) is 24x24 — the level this
      // repo actually audits (see `accessibility/core.spec.ts`).
      expect(box.height).toBeGreaterThanOrEqual(24)
    }
  })
})

test.describe('ESCAPEARTIST Timeline Responsive', () => {
  test('timeline scrollable on narrow viewports', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 480 })
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')

    // `.trackContainer` is the real scrollable element — `.tracksArea`
    // itself clips (`overflow-x: hidden`), with the horizontal scroll one
    // level in.
    const trackContainer = page.locator('[class*="trackContainer"]').first()
    await expect(trackContainer).toBeVisible()
    const overflow = await trackContainer.evaluate((el) => window.getComputedStyle(el).overflowX)
    expect(['auto', 'scroll']).toContain(overflow)
  })

  test('timeline controls visible on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')

    await expect(page.getByTitle('Play (Space)')).toBeVisible()
  })
})

test.describe('ESCAPEARTIST Landscape Mode', () => {
  test('editor works in landscape', async ({ page }) => {
    await page.setViewportSize({ width: 812, height: 375 }) // iPhone X landscape
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')

    await expect(page.getByRole('button', { name: 'Export video' })).toBeVisible()
  })

  test('preview visible in landscape', async ({ page }) => {
    await page.setViewportSize({ width: 812, height: 375 })
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')

    // The preview's own wrapper, present whether it is showing the "Add
    // clips to the timeline to preview" placeholder or the canvas.
    await expect(page.locator('[class*="videoWrapper"]').first()).toBeVisible()
  })
})
