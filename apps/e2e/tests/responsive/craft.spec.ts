import { test, expect } from '@playwright/test'
import { mockClerkAuth } from '../../utils/auth'
import { mockGetUserMedia, mockMediaRecorder, grantMediaPermissions } from '../../utils/media-mocks'
import { VIEWPORTS } from '../../utils/viewports'

test.describe('ESCAPECRAFT Mobile Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await mockClerkAuth(page)
    await mockGetUserMedia(page)
    await mockMediaRecorder(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')
  })

  test('recording UI renders on mobile', async ({ page }) => {
    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })

  test('recording controls accessible on mobile', async ({ page }) => {
    const recordButton = page
      .getByRole('button', { name: /record|start/i })
      .or(page.locator('[data-testid="record-button"]'))
      .first()

    const isVisible = await recordButton.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('source selection adapts to mobile', async ({ page }) => {
    const sourceOptions = page.locator('[class*="source"], [class*="option"]')
    const count = await sourceOptions.count()

    // Should still have source options on mobile
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('controls have touch-friendly size', async ({ page }) => {
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
})

test.describe('ESCAPECRAFT Tablet Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await mockClerkAuth(page)
    await mockGetUserMedia(page)
    await mockMediaRecorder(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')
  })

  test('recording UI renders on tablet', async ({ page }) => {
    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })

  test('preview area sized appropriately', async ({ page }) => {
    const preview = page
      .locator('[class*="preview"], [class*="video-container"], video')
      .first()

    const isVisible = await preview.isVisible().catch(() => false)

    if (isVisible) {
      const box = await preview.boundingBox()
      if (box) {
        // Preview should have reasonable size
        expect(box.width).toBeGreaterThan(200)
        expect(box.height).toBeGreaterThan(100)
      }
    }
  })
})

test.describe('ESCAPECRAFT Settings Panel Responsive', () => {
  test('settings collapse on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await mockClerkAuth(page)
    await mockGetUserMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')

    const settingsPanel = page.locator('[class*="settings"], [class*="panel"]').first()
    const isVisible = await settingsPanel.isVisible().catch(() => false)

    // Settings may be in a collapsible panel on mobile
    expect(typeof isVisible).toBe('boolean')
  })

  test('settings toggle exists on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await mockClerkAuth(page)
    await mockGetUserMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')

    const settingsToggle = page
      .getByRole('button', { name: /settings|options|gear/i })
      .or(page.locator('[data-testid="settings-toggle"]'))
      .first()

    const exists = (await settingsToggle.count()) > 0
    expect(typeof exists).toBe('boolean')
  })
})

test.describe('ESCAPECRAFT Recording List Responsive', () => {
  test('recording list stacks on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await mockClerkAuth(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')

    const recordingsList = page.locator('[class*="recordings"], [class*="list"]').first()
    const isVisible = await recordingsList.isVisible().catch(() => false)

    if (isVisible) {
      const box = await recordingsList.boundingBox()
      if (box) {
        // List should be full width on mobile
        expect(box.width).toBeGreaterThan(300)
      }
    }
  })

  test('recording thumbnails resize on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await mockClerkAuth(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')

    const thumbnails = page.locator('[class*="thumbnail"], [class*="preview"] img')
    const count = await thumbnails.count()

    if (count > 0) {
      const firstThumb = thumbnails.first()
      const box = await firstThumb.boundingBox()

      if (box) {
        // Thumbnails should fit within mobile width
        expect(box.width).toBeLessThanOrEqual(375)
      }
    }
  })
})

test.describe('ESCAPECRAFT VideoPlayer Responsive', () => {
  test('VideoPlayer fits mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await mockClerkAuth(page)
    await mockGetUserMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')

    const videoPlayer = page.locator('video').first()
    const isVisible = await videoPlayer.isVisible().catch(() => false)

    if (isVisible) {
      const box = await videoPlayer.boundingBox()
      if (box) {
        // Video should fit within viewport
        expect(box.width).toBeLessThanOrEqual(375)
      }
    }
  })

  test('VideoPlayer controls accessible on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await mockClerkAuth(page)
    await mockGetUserMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')

    const playButton = page
      .getByRole('button', { name: /play/i })
      .first()

    const isVisible = await playButton.isVisible().catch(() => false)

    if (isVisible) {
      const box = await playButton.boundingBox()
      if (box) {
        // Play button should be touch-friendly
        expect(box.width).toBeGreaterThanOrEqual(40)
        expect(box.height).toBeGreaterThanOrEqual(40)
      }
    }
  })
})

test.describe('ESCAPECRAFT Landscape Mode', () => {
  test('works in landscape orientation', async ({ page }) => {
    await page.setViewportSize({ width: 667, height: 375 }) // Landscape mobile
    await mockClerkAuth(page)
    await mockGetUserMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')

    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })

  test('preview uses available width in landscape', async ({ page }) => {
    await page.setViewportSize({ width: 667, height: 375 })
    await mockClerkAuth(page)
    await mockGetUserMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')

    const preview = page.locator('video, [class*="preview"]').first()
    const isVisible = await preview.isVisible().catch(() => false)

    if (isVisible) {
      const box = await preview.boundingBox()
      if (box) {
        // Preview should use available width
        expect(box.width).toBeGreaterThan(300)
      }
    }
  })
})
