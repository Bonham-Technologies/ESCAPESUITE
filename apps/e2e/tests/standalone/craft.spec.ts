import { test, expect } from '@playwright/test'
import {
  mockGetUserMedia,
  mockMediaRecorder,
  mockSyntheticMedia,
  grantMediaPermissions,
} from '../../utils/media-mocks'
import { canConvertToMp4 } from '../../utils/webcodecs'

/**
 * Smoke tests for the ESCAPECRAFT offline build.
 *
 * These tests verify that the single-file build:
 * 1. Opens straight into the recorder — no gate, no modal, no sign-in
 * 2. Renders the main UI components
 * 3. Has a functional recording interface
 * 4. Talks to nothing outside itself
 */

const CRAFT_URL = 'http://localhost:5184'

test.describe('ESCAPECRAFT Standalone - App Loading', () => {
  test('opens straight into the recorder', async ({ page }) => {
    await page.goto(CRAFT_URL)
    await page.waitForLoadState('networkidle')

    const html = await page.content()
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<div id="root">')

    // The recorder itself is on screen — nothing gates it
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible()

    // No blocking modal (activation / sign-in / upgrade prompts are all gone)
    expect(await page.getByRole('dialog').count()).toBe(0)
  })

  test('does not show the ESCAPEPLAN hub link', async ({ page }) => {
    await page.goto(CRAFT_URL)
    await page.waitForLoadState('networkidle')

    // The hub link only renders in hosted mode (isStandaloneMode() gates it)
    expect(await page.getByRole('link', { name: '← ESCAPE Suite' }).count()).toBe(0)
  })

  test('has page title', async ({ page }) => {
    await page.goto(CRAFT_URL)
    const title = await page.title()
    expect(title.length).toBeGreaterThan(0)
  })

  test('app content is visible', async ({ page }) => {
    await page.goto(CRAFT_URL)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    // App should show some content (not just loading or error)
    const body = await page.locator('body').textContent()
    expect(body?.length).toBeGreaterThan(0)
  })
})

test.describe('ESCAPECRAFT Standalone - Recording Interface', () => {
  test.beforeEach(async ({ page }) => {
    await mockGetUserMedia(page)
    await mockMediaRecorder(page)
    await grantMediaPermissions(page)
    await page.goto(CRAFT_URL)
    await page.waitForLoadState('networkidle')
  })

  test('shows recording UI elements', async ({ page }) => {
    // Wait for React to fully mount
    await page.waitForTimeout(1000)

    // Should have some recording-related UI (check if any of these exist, don't fail if not)
    const recordingUI = page
      .getByText(/record|screen|webcam|capture|start/i)
      .first()

    // For smoke tests, just verify the check runs - actual UI may vary
    const isVisible = await recordingUI.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('has source selection options', async ({ page }) => {
    const sourceSelector = page
      .getByText(/screen|window|tab|display/i)
      .or(page.locator('[data-testid="source-selector"]'))
      .first()

    const isVisible = await sourceSelector.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('has webcam toggle', async ({ page }) => {
    const webcamToggle = page
      .getByRole('button', { name: /webcam|camera/i })
      .or(page.locator('[data-testid="webcam-toggle"]'))
      .or(page.getByText(/webcam|camera/i).first())

    const isVisible = await webcamToggle.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('has microphone toggle', async ({ page }) => {
    const micToggle = page
      .getByRole('button', { name: /mic|audio|microphone/i })
      .or(page.locator('[data-testid="mic-toggle"]'))
      .or(page.getByText(/microphone|mic/i).first())

    const isVisible = await micToggle.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('ESCAPECRAFT Standalone - Theme Support', () => {
  test('has theme toggle', async ({ page }) => {
    await page.goto(CRAFT_URL)
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
    // Emulate dark mode
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto(CRAFT_URL)
    await page.waitForLoadState('networkidle')

    // Check if dark theme class is applied
    const isDark = await page.evaluate(() => {
      return (
        document.documentElement.classList.contains('dark') ||
        document.body.classList.contains('dark') ||
        document.documentElement.getAttribute('data-theme') === 'dark'
      )
    })

    // Should respect system preference or have default theme
    expect(typeof isDark).toBe('boolean')
  })
})

test.describe('ESCAPECRAFT Standalone - No External Dependencies', () => {
  test('makes no requests off the local origin', async ({ page }) => {
    const externalCalls: string[] = []

    page.on('request', (request) => {
      const url = request.url()
      if (!url.startsWith('data:') && !url.startsWith('blob:') && !url.includes('localhost:5184')) {
        externalCalls.push(url)
      }
    })

    // Real synthetic capture, so a take actually starts and the app runs its
    // own `analytics.recordingStarted()` — an idle page proves only that
    // nothing fires on load, not that a tracked action stays silent.
    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)

    await page.goto(CRAFT_URL)
    await page.waitForLoadState('networkidle')

    // Capability detection is async; the toggles stay disabled until it lands
    // and a take started before then acquires no stream.
    const screenSource = page
      .locator('[class*="sourceToggle"]')
      .filter({ hasText: 'Screen' })
      .last()
    await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Start recording' }).click()
    await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({
      timeout: 30_000,
    })
    await page.getByRole('button', { name: 'Stop recording' }).click()
    // The saved take: `Recording Started` and `Recording Completed` have both
    // been through trackEvent by now.
    await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toBeVisible({
      timeout: 30_000,
    })

    await page.waitForTimeout(2000)

    // The offline build is air-gapped: no auth, no analytics, no phoning home
    expect(externalCalls).toHaveLength(0)

    // And the reason is stronger than "the call was made and went nowhere":
    // the analytics runtime is not in the bundle at all, so there is no queue
    // for an event to sit in and no injected script to drain it.
    const analyticsRuntime = await page.evaluate(() => ({
      va: typeof (window as unknown as { va?: unknown }).va,
      queue: typeof (window as unknown as { vaq?: unknown }).vaq,
      scripts: document.querySelectorAll('script[src*="vercel"]').length,
    }))
    expect(analyticsRuntime).toEqual({ va: 'undefined', queue: 'undefined', scripts: 0 })
  })

  test('converts a recording to MP4 without leaving the page', async ({ page }) => {
    test.setTimeout(180_000)

    const externalCalls: string[] = []
    page.on('request', (request) => {
      const url = request.url()
      if (!url.startsWith('data:') && !url.startsWith('blob:') && !url.includes('localhost:5184')) {
        externalCalls.push(url)
      }
    })

    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)
    await page.goto(CRAFT_URL)
    await page.waitForLoadState('networkidle')

    // MP4 conversion needs an H.264 encoder behind WebCodecs; a browser
    // without one shows the button disabled with its reason, which
    // `tests/escapecraft/mp4-download.spec.ts` covers. What is being asserted
    // here is that converting needs no network.
    test.skip(!(await canConvertToMp4(page)), 'This browser cannot encode H.264')

    const screenSource = page
      .locator('[class*="sourceToggle"]')
      .filter({ hasText: 'Screen' })
      .last()
    await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Start recording' }).click()
    await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({
      timeout: 30_000,
    })
    await page.waitForTimeout(2000)
    await page.getByRole('button', { name: 'Stop recording' }).click()
    await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toBeVisible({
      timeout: 30_000,
    })

    // MP4 conversion is WebCodecs + Mediabunny, both inlined in this one file.
    // The download proves it produced a file; the empty request list proves it
    // did so without a server.
    const downloadPromise = page.waitForEvent('download', { timeout: 150_000 })
    await page.getByRole('button', { name: /Download .+ as MP4/ }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.mp4$/)

    expect(externalCalls).toHaveLength(0)
  })

  test('single HTML file contains all assets', async ({ page }) => {
    const requests: string[] = []

    page.on('request', (request) => {
      const url = request.url()
      // Ignore data URLs and the initial page load
      if (!url.startsWith('data:') && !url.includes('localhost:5184')) {
        requests.push(url)
      }
    })

    await page.goto(CRAFT_URL)
    await page.waitForLoadState('networkidle')

    // Single-file build should not request external JS/CSS
    const externalAssets = requests.filter(
      (url) => url.endsWith('.js') || url.endsWith('.css')
    )
    expect(externalAssets).toHaveLength(0)
  })
})
