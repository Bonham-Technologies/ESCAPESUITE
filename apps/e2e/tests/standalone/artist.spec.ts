import { test, expect } from '@playwright/test'
import { seedTextClip } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

/**
 * Smoke tests for the ESCAPEARTIST offline build.
 *
 * These tests verify that the single-file build:
 * 1. Opens straight into the editor — no gate, no modal, no sign-in
 * 2. Renders the main UI components
 * 3. Has a functional editor interface
 * 4. Talks to nothing outside itself
 */

const ARTIST_URL = 'http://localhost:5185'

test.describe('ESCAPEARTIST Standalone - App Loading', () => {
  test('opens straight into the editor', async ({ page }) => {
    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')

    // The editor itself is on screen — nothing gates it
    await expect(page.getByRole('button', { name: 'Export video' })).toBeVisible()

    // No blocking modal (activation / sign-in / upgrade prompts are all gone)
    expect(await page.getByRole('dialog').count()).toBe(0)
  })

  test('does not show the ESCAPEPLAN hub link', async ({ page }) => {
    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')

    // Prove the page actually rendered the editor before trusting the
    // absence below — a gutted build would also show zero hub links
    // (ESCSUITE-202 hunt K-U1).
    await expect(page.getByRole('button', { name: 'Export video' })).toBeVisible()

    // The hub link only renders in hosted mode (isStandaloneMode() gates it)
    expect(await page.getByRole('link', { name: '← ESCAPE Suite' }).count()).toBe(0)
  })

  test('has page title', async ({ page }) => {
    await page.goto(ARTIST_URL)
    await expect(page).toHaveTitle(/ESCAPEARTIST/)
  })

  test('app content is visible', async ({ page }) => {
    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')

    // A distinct real element from "opens straight into the editor" above:
    // the app's header, always rendered.
    await expect(page.locator('header')).toBeVisible()
  })
})

test.describe('ESCAPEARTIST Standalone - Editor Interface', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')
    await seedTextClip(page)
  })

  test('shows editor UI elements', async ({ page }) => {
    await expect(page.getByText('Media Library')).toBeVisible()
    await expect(page.getByText(/^1 clip · 1 track$/)).toBeVisible()
  })

  test('has import/upload button', async ({ page }) => {
    // The real drop zone (`VideoUploader.tsx`) — its file `<input>` is
    // `display: none`, so the visible affordance is its own text.
    await expect(page.getByText('Drop media or click to browse')).toBeVisible()
  })

  test('has timeline component', async ({ page }) => {
    await expect(page.locator('[data-track-id]')).toHaveCount(1)
  })

  test('has preview area', async ({ page }) => {
    await expect(page.locator('canvas')).toBeVisible()
  })

  test('has export button', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Export video' })).toBeEnabled()
  })
})

test.describe('ESCAPEARTIST Standalone - Playback Controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')
  })

  test('has play button', async ({ page }) => {
    await expect(page.getByTitle('Play (Space)')).toBeVisible()
  })

  test('has playback controls', async ({ page }) => {
    await expect(page.getByTitle('Go to start (Home)')).toBeVisible()
    await expect(page.getByTitle('Play (Space)')).toBeVisible()
    await expect(page.getByTitle('Go to end (End)')).toBeVisible()
  })
})

test.describe('ESCAPEARTIST Standalone - Theme Support', () => {
  // There is no theme-toggle button anywhere in ESCAPEARTIST — the same
  // ESCSUITE-201 finding for ESCAPECRAFT applies here, confirmed with the
  // same grep (`ThemeToggle` has no importer in apps/artist/src). "has
  // theme toggle" had no feature to find and is deleted rather than kept as
  // a placeholder for a control that does not exist.

  test('defaults to dark on a fresh load regardless of system color scheme', async ({
    page,
  }) => {
    // `theme.ts`'s `DEFAULT_THEME` is 'dark', not 'system' — so a fresh load
    // with no stored preference stays dark even when the OS prefers light.
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')

    // Prove the page actually rendered the editor before trusting the
    // absence below.
    await expect(page.getByRole('button', { name: 'Export video' })).toBeVisible()

    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/)

    // The attribute is the mechanism; the computed colour is the behaviour —
    // `styles/index.css`'s `body { background-color: var(--bg-primary) }`
    // resolves to the dark theme's `#1a1a2e` by default and only the light
    // theme's `#ffffff` under `:root[data-theme="light"]`, so this would go
    // red if the app ever behaved like light mode while leaving the
    // attribute off.
    const bodyBackground = await page.evaluate(
      () => window.getComputedStyle(document.body).backgroundColor
    )
    expect(bodyBackground).toBe('rgb(26, 26, 46)')
  })
})

test.describe('ESCAPEARTIST Standalone - No External Dependencies', () => {
  test('makes no requests off the local origin', async ({ page }) => {
    // A real `seedTextClip` + real WebM export + the 2s settle below
    // comfortably exceeds the default 30s test budget without headroom.
    test.setTimeout(120_000)

    const externalCalls: string[] = []

    page.on('request', (request) => {
      const url = request.url()
      if (!url.startsWith('data:') && !url.startsWith('blob:') && !url.includes('localhost:5185')) {
        externalCalls.push(url)
      }
    })

    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')

    // A real export, so the app actually does something beyond an idle load
    // — an idle page proves only that nothing fires on load, not that a
    // real action stays silent.
    await seedTextClip(page)
    await page.getByRole('button', { name: 'Export video' }).click()
    await page.getByRole('button', { name: 'Download WebM' }).first().click()
    // `.first()` since ESCSUITE-215: the progress view's live region carries
    // the same words a second time, for ears rather than eyes.
    await expect(page.getByText('Export complete!').first()).toBeVisible({ timeout: 30_000 })

    await page.waitForTimeout(2000)

    // The offline build is air-gapped: no auth, no analytics, no phoning home
    expect(externalCalls).toHaveLength(0)

    // And the reason is stronger than "the call was made and went nowhere":
    // the analytics runtime is not in the bundle at all, so there is no
    // queue for an event to sit in and no injected script to drain it.
    const analyticsRuntime = await page.evaluate(() => ({
      va: typeof (window as unknown as { va?: unknown }).va,
      queue: typeof (window as unknown as { vaq?: unknown }).vaq,
      scripts: document.querySelectorAll('script[src*="vercel"]').length,
    }))
    expect(analyticsRuntime).toEqual({ va: 'undefined', queue: 'undefined', scripts: 0 })
  })

  test('single HTML file contains all assets', async ({ page }) => {
    const requests: string[] = []

    page.on('request', (request) => {
      const url = request.url()
      // Ignore data URLs and the initial page load
      if (!url.startsWith('data:') && !url.includes('localhost:5185')) {
        requests.push(url)
      }
    })

    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')

    // Single-file build should not request external JS/CSS
    const externalAssets = requests.filter(
      (url) => url.endsWith('.js') || url.endsWith('.css')
    )
    expect(externalAssets).toHaveLength(0)
  })
})

test.describe('ESCAPEARTIST Standalone - IndexedDB Storage', () => {
  // ESCSUITE-202 fix round 1 (review finding 3): `'indexedDB' in window`
  // tests that Chromium implements IndexedDB, which it cannot fail to do —
  // the same K-9 shape ("asserts only that the browser has standard APIs")
  // the ticket's own rule bans. "creates database on load" below already
  // supersedes it: it gates on the real "Media Library" render and then
  // asserts the real `video-editor-db` database by name.

  test('creates database on load', async ({ page }) => {
    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')

    // The media library reads the shared database on mount to list what is
    // already stored — proof the app actually did something, not just that
    // the check ran.
    await expect(page.getByText('Media Library')).toBeVisible()

    const databases = await page.evaluate(async () => {
      const dbs = await indexedDB.databases()
      return dbs.map((db) => db.name)
    })

    expect(databases).toContain('video-editor-db')
  })
})
