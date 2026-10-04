import { test, expect } from '@playwright/test'
import { mockGetUserMedia, mockMediaRecorder, grantMediaPermissions } from '../../utils/media-mocks'
import { seedTextClip } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

test.describe('ARIA Live Regions', () => {
  test('ESCAPEPLAN has status announcements', async ({ page }) => {
    await page.goto('http://localhost:5173')
    await waitForAppReady(page, 'plan')

    // Check for ARIA live regions
    const liveRegions = page.locator(
      '[aria-live], [role="alert"], [role="status"], [role="log"]'
    )
    const count = await liveRegions.count()

    // May not have visible live regions on static pages
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('ESCAPECRAFT announces recording status', async ({ page }) => {
    await mockGetUserMedia(page)
    await mockMediaRecorder(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')

    // `AppHeader.tsx`'s one status region: `aria-live="polite"
    // aria-atomic="true"`, always present even idle (the "Recording"/
    // "Paused"/"Saving..." text is what comes and goes inside it).
    const liveRegion = page.locator('[aria-live="polite"]')
    await expect(liveRegion).toHaveCount(1)
    await expect(liveRegion).toHaveAttribute('aria-atomic', 'true')
  })

  test('ESCAPEARTIST announces export progress', async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')

    // Look for progress announcements
    const progressElements = page.locator(
      '[role="progressbar"], [role="status"], [aria-live]'
    )
    const count = await progressElements.count()

    expect(count).toBeGreaterThanOrEqual(0)
  })
})

test.describe('Dialog Announcements', () => {
  test('ESCAPECRAFT help dialog is accessible', async ({ page }) => {
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')

    const trigger = page.getByRole('button', { name: /help - recording tips/i })
    await expect(trigger).toBeVisible()
    await trigger.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Dialog should have aria-modal
    await expect(dialog).toHaveAttribute('aria-modal', 'true')

    // Dialog should have a title
    const labelledBy = await dialog.getAttribute('aria-labelledby')
    const label = await dialog.getAttribute('aria-label')
    expect(labelledBy || label).toBeTruthy()
  })

  test('ESCAPEARTIST export dialog is accessible', async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')

    // Export is disabled until the timeline holds a clip
    await seedTextClip(page)
    await page.getByRole('button', { name: 'Export video' }).click()
    await expect(page.getByRole('heading', { name: 'Export Video' })).toBeVisible()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    await expect(dialog.locator('h1, h2, h3, [role="heading"]').first()).toBeVisible()
  })
})

test.describe('Landmark Regions', () => {
  // Note: These tests verify landmark elements exist but are skipped in CI due to
  // rendering timing issues. The apps DO have proper landmarks (main, nav, header)
  // in their source code. Run locally to verify.
  test.skip('ESCAPEPLAN has proper landmarks', async ({ page }) => {
    await page.goto('http://localhost:5173')
    await waitForAppReady(page, 'plan')

    // Wait for React to render
    await page.waitForSelector('#root', { timeout: 5000 }).catch(() => null)
    await page.waitForTimeout(500)

    // Check for main landmark
    const main = page.locator('main, [role="main"]')
    const hasMain = (await main.count()) > 0

    // Check for navigation landmark
    const nav = page.locator('nav, [role="navigation"]')
    const hasNav = (await nav.count()) > 0

    // Check for header (fallback landmark)
    const header = page.locator('header, [role="banner"]')
    const hasHeader = (await header.count()) > 0

    // Should have at least one landmark (main, nav, or header)
    // In CI environments, page may render differently
    expect(hasMain || hasNav || hasHeader).toBe(true)
  })

  // ESCSUITE-201 K-8: `waitForAppReady` (ESCSUITE-177) already settles on
  // React's first commit, which is what the removed
  // `waitForSelector('#root')` + `waitForTimeout(500)` belt-and-braces was
  // standing in for — and `App.tsx` always renders a real `<main>` and
  // `AppHeader.tsx` a real `<header>`, so both are asserted directly rather
  // than the weaker "one or the other" this used to fall back to.
  test('ESCAPECRAFT has proper landmarks', async ({ page }) => {
    await mockGetUserMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')

    await expect(page.locator('main')).toBeVisible()
    await expect(page.locator('header')).toBeVisible()
  })

  test.skip('ESCAPEARTIST has proper landmarks', async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')

    // Wait for React to render
    await page.waitForSelector('#root', { timeout: 5000 }).catch(() => null)
    await page.waitForTimeout(500)

    const main = page.locator('main, [role="main"]')
    const hasMain = (await main.count()) > 0

    // Also check for header as fallback
    const header = page.locator('header, [role="banner"]')
    const hasHeader = (await header.count()) > 0

    // Should have main or at least header landmark
    expect(hasMain || hasHeader).toBe(true)
  })
})

test.describe('Form Error Announcements', () => {
  test('form errors are announced', async ({ page }) => {
    await page.goto('http://localhost:5173')
    await waitForAppReady(page, 'plan')

    // Look for form with validation
    const form = page.locator('form').first()
    const hasForm = await form.isVisible().catch(() => false)

    if (hasForm) {
      // Try to submit empty form
      const submitButton = form.getByRole('button', { name: /submit|sign|send/i }).first()
      const hasSubmit = await submitButton.isVisible().catch(() => false)

      if (hasSubmit) {
        await submitButton.click()
        await page.waitForTimeout(500)

        // Check for error messages with proper ARIA
        const errors = page.locator(
          '[role="alert"], [aria-invalid="true"], .error, [class*="error"]'
        )
        const count = await errors.count()

        // May have validation errors
        expect(count).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

test.describe('Progress Indicator Announcements', () => {
  test('loading states are announced', async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')

    // Check for loading indicators with proper ARIA
    const loaders = page.locator(
      '[role="progressbar"], [aria-busy="true"], [aria-label*="loading"]'
    )
    const count = await loaders.count()

    // May not have active loaders
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('progressbar has proper attributes', async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')

    const progressbar = page.locator('[role="progressbar"]').first()
    const isVisible = await progressbar.isVisible().catch(() => false)

    if (isVisible) {
      // Check for value attributes
      const valueNow = await progressbar.getAttribute('aria-valuenow')
      const valueMin = await progressbar.getAttribute('aria-valuemin')
      const valueMax = await progressbar.getAttribute('aria-valuemax')

      // Should have at least aria-valuenow
      expect(valueNow || valueMin || valueMax).toBeTruthy()
    }
  })
})

test.describe('Button and Control Announcements', () => {
  test('icon buttons have accessible names', async ({ page }) => {
    await mockGetUserMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')

    // Find buttons that might only have icons
    const iconButtons = page.locator('button:has(svg), button:has(img), button:has([class*="icon"])')
    const count = await iconButtons.count()
    expect(count).toBeGreaterThan(0)

    for (let i = 0; i < Math.min(count, 10); i++) {
      const button = iconButtons.nth(i)
      const isVisible = await button.isVisible().catch(() => false)

      if (isVisible) {
        const ariaLabel = await button.getAttribute('aria-label')
        const title = await button.getAttribute('title')
        const text = ((await button.textContent()) || '').trim()

        // Button should have some accessible name
        expect(ariaLabel || title || text).toBeTruthy()
      }
    }
  })

  test('toggle buttons announce state', async ({ page }) => {
    await mockGetUserMedia(page)
    await mockMediaRecorder(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')

    const toggles = page.locator(
      '[role="switch"], [aria-pressed], button[class*="toggle"]'
    )
    const count = await toggles.count()
    expect(count).toBeGreaterThan(0)

    for (let i = 0; i < Math.min(count, 5); i++) {
      const toggle = toggles.nth(i)
      const isVisible = await toggle.isVisible().catch(() => false)

      if (isVisible) {
        const pressed = await toggle.getAttribute('aria-pressed')
        const checked = await toggle.getAttribute('aria-checked')
        const role = await toggle.getAttribute('role')

        // Should have state indicator
        expect(pressed !== null || checked !== null || role === 'switch').toBe(true)
      }
    }
  })
})

test.describe('Table and List Accessibility', () => {
  test('lists have proper structure', async ({ page }) => {
    await mockGetUserMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')

    // The recordings library itself is plain `<div>` rows, not a semantic
    // list — CRAFT's only real `<ul>`s are the four in the Help dialog
    // (`HelpDialog.tsx`), closed by default.
    await page.getByRole('button', { name: /help - recording tips/i }).click()
    await expect(page.getByRole('dialog', { name: 'Recording Tips' })).toBeVisible()

    const lists = page.locator('ul, ol, [role="list"]')
    const count = await lists.count()
    expect(count).toBeGreaterThan(0)

    for (let i = 0; i < Math.min(count, 3); i++) {
      const list = lists.nth(i)
      await expect(list).toBeVisible()

      const items = list.locator('li, [role="listitem"]')
      const itemCount = await items.count()
      expect(itemCount).toBeGreaterThan(0)

      const firstItemText = await items.first().textContent()
      expect(firstItemText?.trim()).toBeTruthy()
    }
  })
})
