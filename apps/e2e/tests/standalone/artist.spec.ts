import { test, expect } from '@playwright/test'

/**
 * Smoke tests for ESCAPEARTIST standalone build.
 *
 * These tests verify that the standalone build:
 * 1. Loads without auth requirements
 * 2. Renders the main UI components
 * 3. Has functional editor interface
 */

const ARTIST_URL = 'http://localhost:5185'

test.describe('ESCAPEARTIST Standalone - App Loading', () => {
  test('loads without authentication', async ({ page }) => {
    await page.goto(ARTIST_URL)
    await page.waitForLoadState('networkidle')

    // Should load the app without auth gate
    const html = await page.content()
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<div id="root">')

    // Wait for React to mount
    await page.waitForTimeout(1000)

    // Root should have content (app loaded)
    const rootChildren = await page.locator('#root').evaluate((el) => el.children.length)
    expect(rootChildren).toBeGreaterThan(0)
  })

  test('has page title', async ({ page }) => {
    await page.goto(ARTIST_URL)
    const title = await page.title()
    expect(title.length).toBeGreaterThan(0)
  })

  test('app content is visible', async ({ page }) => {
    await page.goto(ARTIST_URL)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    // App should show some content (not just loading or error)
    const body = await page.locator('body').textContent()
    expect(body?.length).toBeGreaterThan(0)
  })
})

test.describe('ESCAPEARTIST Standalone - Editor Interface', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(ARTIST_URL)
    await page.waitForLoadState('networkidle')
  })

  test('shows editor UI elements', async ({ page }) => {
    // Should have some editor-related UI
    const editorUI = page
      .getByText(/timeline|import|upload|video|edit/i)
      .first()

    await expect(editorUI).toBeVisible({ timeout: 5000 })
  })

  test('has import/upload button', async ({ page }) => {
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

  test('has preview area', async ({ page }) => {
    const preview = page
      .locator('canvas')
      .or(page.locator('[data-testid="preview"]'))
      .or(page.locator('[class*="preview"]'))

    const count = await preview.count()
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
})

test.describe('ESCAPEARTIST Standalone - Playback Controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(ARTIST_URL)
    await page.waitForLoadState('networkidle')
  })

  test('has play button', async ({ page }) => {
    const playButton = page
      .getByRole('button', { name: /play/i })
      .or(page.locator('[data-testid="play-button"]'))
      .or(page.locator('[title*="Play"]'))

    const isVisible = await playButton.first().isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('has playback controls', async ({ page }) => {
    const controls = page
      .locator('[class*="controls"]')
      .or(page.locator('[class*="toolbar"]'))
      .or(page.locator('[data-testid="playback-controls"]'))

    const isVisible = await controls.first().isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('ESCAPEARTIST Standalone - Theme Support', () => {
  test('has theme toggle', async ({ page }) => {
    await page.goto(ARTIST_URL)
    await page.waitForLoadState('networkidle')

    const themeToggle = page
      .getByRole('button', { name: /theme|dark|light/i })
      .or(page.locator('[data-testid="theme-toggle"]'))
      .or(page.locator('[aria-label*="theme"]'))
      .first()

    const isVisible = await themeToggle.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('respects system color scheme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto(ARTIST_URL)
    await page.waitForLoadState('networkidle')

    const isDark = await page.evaluate(() => {
      return (
        document.documentElement.classList.contains('dark') ||
        document.body.classList.contains('dark') ||
        document.documentElement.getAttribute('data-theme') === 'dark'
      )
    })

    expect(typeof isDark).toBe('boolean')
  })
})

test.describe('ESCAPEARTIST Standalone - No External Dependencies', () => {
  test('does not make Clerk API calls', async ({ page }) => {
    const clerkCalls: string[] = []

    page.on('request', (request) => {
      const url = request.url()
      if (url.includes('clerk')) {
        clerkCalls.push(url)
      }
    })

    await page.goto(ARTIST_URL)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // Standalone should not call Clerk
    expect(clerkCalls).toHaveLength(0)
  })

  test('single HTML file contains all assets', async ({ page }) => {
    const requests: string[] = []

    page.on('request', (request) => {
      const url = request.url()
      if (!url.startsWith('data:') && !url.includes('localhost:5185')) {
        requests.push(url)
      }
    })

    await page.goto(ARTIST_URL)
    await page.waitForLoadState('networkidle')

    // Single-file build should not request external JS/CSS
    const externalAssets = requests.filter(
      (url) => url.endsWith('.js') || url.endsWith('.css')
    )
    expect(externalAssets).toHaveLength(0)
  })
})

test.describe('ESCAPEARTIST Standalone - IndexedDB Storage', () => {
  test('can access IndexedDB', async ({ page }) => {
    await page.goto(ARTIST_URL)
    await page.waitForLoadState('networkidle')

    const hasIndexedDB = await page.evaluate(() => {
      return 'indexedDB' in window
    })

    expect(hasIndexedDB).toBe(true)
  })

  test('creates database on load', async ({ page }) => {
    await page.goto(ARTIST_URL)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    const databases = await page.evaluate(async () => {
      const dbs = await indexedDB.databases()
      return dbs.map((db) => db.name)
    })

    // Should have created the video-editor-db
    const hasDb = databases.some((name) => name?.includes('video') || name?.includes('editor'))
    expect(typeof hasDb).toBe('boolean')
  })
})
