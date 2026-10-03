import { test, expect } from '@playwright/test'
import {
  mockGetUserMedia,
  mockMediaRecorder,
  mockSyntheticMedia,
  grantMediaPermissions,
} from '../../utils/media-mocks'
import { canConvertToMp4 } from '../../utils/webcodecs'
import { waitForAppReady } from '../../utils/ready'

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
    await waitForAppReady(page, 'craft')

    // The recorder itself is on screen — nothing gates it
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible()

    // No blocking modal (activation / sign-in / upgrade prompts are all gone)
    expect(await page.getByRole('dialog').count()).toBe(0)
  })

  test('does not show the ESCAPEPLAN hub link', async ({ page }) => {
    await page.goto(CRAFT_URL)
    await waitForAppReady(page, 'craft')

    // Prove the page actually rendered the recorder before trusting the
    // absence below — a gutted build would also show zero hub links, which
    // is the pure-negative shape ESCSUITE-201 (hunt K-U1) flagged here.
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible()

    // The hub link only renders in hosted mode (isStandaloneMode() gates it)
    expect(await page.getByRole('link', { name: '← ESCAPE Suite' }).count()).toBe(0)
  })

  test('has page title', async ({ page }) => {
    await page.goto(CRAFT_URL)
    await expect(page).toHaveTitle(/ESCAPECRAFT/)
  })

  test('app content is visible', async ({ page }) => {
    await page.goto(CRAFT_URL)
    await waitForAppReady(page, 'craft')

    // A distinct real element from "opens straight into the recorder"
    // above: the app's header, always rendered.
    await expect(page.locator('header')).toBeVisible()
  })
})

test.describe('ESCAPECRAFT Standalone - Recording Interface', () => {
  test.beforeEach(async ({ page }) => {
    await mockGetUserMedia(page)
    await mockMediaRecorder(page)
    await grantMediaPermissions(page)
    await page.goto(CRAFT_URL)
    await waitForAppReady(page, 'craft')
  })

  test('shows recording UI elements', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Screen' })).toBeVisible()
  })

  test('has source selection options', async ({ page }) => {
    // The real source-selection UI is the Screen toggle (`SourceToggles.tsx`).
    await expect(page.getByRole('button', { name: 'Screen' })).toBeVisible()
  })

  test('has webcam toggle', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Webcam' })).toBeVisible()
  })

  test('has microphone toggle', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Microphone' })).toBeVisible()
  })
})

test.describe('ESCAPECRAFT Standalone - Theme Support', () => {
  // ESCSUITE-201: there is no theme-toggle button anywhere in ESCAPECRAFT —
  // `packages/shared/src/theme`'s `ThemeToggle` component exists but CRAFT
  // never renders it; the app only reads a stored preference or
  // `?theme=` (see `accessibility/core.spec.ts`'s theme audits). "has theme
  // toggle" had no feature to find and is deleted rather than kept as a
  // placeholder for a control that does not exist.

  test('defaults to dark on a fresh load regardless of system color scheme', async ({
    page,
  }) => {
    // `theme.ts`'s `DEFAULT_THEME` is 'dark', not 'system' — so a fresh
    // load with no stored preference stays dark even when the OS prefers
    // light. `applyTheme` sets `data-theme="light"` for light and removes
    // the attribute for dark, the same convention the live-theme audits in
    // `accessibility/core.spec.ts` use.
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto(CRAFT_URL)
    await waitForAppReady(page, 'craft')

    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/)
  })
})

test.describe('ESCAPECRAFT Standalone - No External Dependencies', () => {
  test('makes no requests off the local origin', async ({ page, browserName }) => {
    // ESCSUITE-177 review MEDIUM 4: this test records a real take, which
    // `useRecordingSave` stores as a Blob in IndexedDB — and Playwright's
    // WebKit cannot store a Blob there at all on this platform
    // (`UnknownError: Error preparing Blob/File data to be stored in object
    // store`, the same gap `escapecraft/mp4-download.spec.ts` and the other
    // specs listed in report-177.md were skipped for). Test-level, not
    // describe-level: the other tests in this file do not record and are
    // unaffected.
    test.skip(
      browserName === 'webkit',
      'WebKit cannot store a Blob in IndexedDB in Playwright (UnknownError: Error preparing Blob/File data to be stored in object store)'
    )

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
    await waitForAppReady(page, 'craft')

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

  test('converts a recording to MP4 without leaving the page', async ({ page, browserName }) => {
    test.setTimeout(180_000)
    // ESCSUITE-177 review MEDIUM 4: same WebKit Blob-in-IndexedDB gap as
    // "makes no requests off the local origin" above — this test needs the
    // recorded take saved too, before it ever gets to the MP4 conversion.
    test.skip(
      browserName === 'webkit',
      'WebKit cannot store a Blob in IndexedDB in Playwright (UnknownError: Error preparing Blob/File data to be stored in object store)'
    )

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
    await waitForAppReady(page, 'craft')

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
    await waitForAppReady(page, 'craft')

    // Single-file build should not request external JS/CSS
    const externalAssets = requests.filter(
      (url) => url.endsWith('.js') || url.endsWith('.css')
    )
    expect(externalAssets).toHaveLength(0)
  })
})
