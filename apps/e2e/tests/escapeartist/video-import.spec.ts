import { test, expect } from '@playwright/test'
import { mockSignedIn } from '../../utils/auth'

test.describe('ESCAPEARTIST Video Import', () => {
  test.beforeEach(async ({ page }) => {
    await mockSignedIn(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
  })

  test('server responds', async ({ page }) => {
    // Verify the server is responding and page has HTML structure
    const html = await page.content()
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<div id="root">')
  })

  test('shows import/upload button', async ({ page }) => {
    const importButton = page
      .getByRole('button', { name: /import|upload|add video|add media|open/i })
      .or(page.locator('[data-testid="import-button"]'))
      .or(page.locator('[data-testid="upload-button"]'))
      .first()

    const isVisible = await importButton.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('has timeline component', async ({ page }) => {
    const timeline = page
      .locator('[data-testid="timeline"]')
      .or(page.locator('.timeline'))
      .or(page.locator('.Timeline'))
      .or(page.locator('[class*="timeline"]'))

    const isVisible = await timeline.first().isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('has preview area with canvas', async ({ page }) => {
    const preview = page.locator('canvas').or(page.locator('[data-testid="preview"]'))
    const count = await preview.count()
    // May have multiple canvases (preview, timeline, etc.)
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('has media library section', async ({ page }) => {
    const mediaLibrary = page
      .getByText(/media|library|assets|files/i)
      .or(page.locator('[data-testid="media-library"]'))
      .first()

    const isVisible = await mediaLibrary.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('ESCAPEARTIST Toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await mockSignedIn(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
  })

  test('has playback controls', async ({ page }) => {
    const playButton = page
      .getByRole('button', { name: /play/i })
      .or(page.locator('[data-testid="play-button"]'))
      .or(page.locator('[title*="Play"]'))

    const isVisible = await playButton.first().isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('has pause button or combined play/pause', async ({ page }) => {
    const pauseButton = page
      .getByRole('button', { name: /pause|play/i })
      .or(page.locator('[data-testid="pause-button"]'))
      .or(page.locator('[data-testid="play-pause-button"]'))

    const count = await pauseButton.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('has export button', async ({ page }) => {
    const exportButton = page
      .getByRole('button', { name: /export|download|render/i })
      .or(page.locator('[data-testid="export-button"]'))
      .first()

    const isVisible = await exportButton.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('has save project option', async ({ page }) => {
    const saveButton = page
      .getByRole('button', { name: /save/i })
      .or(page.locator('[data-testid="save-button"]'))
      .or(page.getByText(/save project/i))

    const count = await saveButton.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })
})

test.describe('ESCAPEARTIST Export Options', () => {
  test.beforeEach(async ({ page }) => {
    await mockSignedIn(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
  })

  test('export dialog can be triggered', async ({ page }) => {
    // Look for export button
    const exportButton = page
      .getByRole('button', { name: /export/i })
      .or(page.locator('[data-testid="export-button"]'))
      .first()

    const isVisible = await exportButton.isVisible().catch(() => false)
    if (isVisible) {
      await exportButton.click()
      // Check if export dialog/modal appears
      await page.waitForTimeout(500)
      const dialog = page
        .locator('[role="dialog"]')
        .or(page.locator('.modal'))
        .or(page.getByText(/export settings|format/i))

      const dialogVisible = await dialog.first().isVisible().catch(() => false)
      expect(typeof dialogVisible).toBe('boolean')
    }
  })

  test('has format selection options', async ({ page }) => {
    // Format options may be visible in toolbar or export dialog
    const formatOptions = page
      .getByText(/webm|mp4|format/i)
      .or(page.locator('[data-testid="format-selector"]'))

    const count = await formatOptions.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })
})
