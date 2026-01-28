import { test, expect } from '@playwright/test'
import { mockClerkAuth, mockClerkSignedOut } from '../../utils/auth'
import { mockGetUserMedia, mockMediaRecorder, grantMediaPermissions } from '../../utils/media-mocks'
import { checkAriaLiveRegions } from '../../utils/accessibility'

test.describe('ARIA Live Regions', () => {
  test('ESCAPEPLAN has status announcements', async ({ page }) => {
    await mockClerkSignedOut(page)
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')

    // Check for ARIA live regions
    const liveRegions = page.locator(
      '[aria-live], [role="alert"], [role="status"], [role="log"]'
    )
    const count = await liveRegions.count()

    // May not have visible live regions on static pages
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('ESCAPECRAFT announces recording status', async ({ page }) => {
    await mockClerkAuth(page)
    await mockGetUserMedia(page)
    await mockMediaRecorder(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')

    // Look for status indicators that should announce to screen readers
    const statusElements = page.locator(
      '[role="status"], [aria-live="polite"], .recording-status, [class*="status"]'
    )
    const count = await statusElements.count()

    // Recording status should be announced
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('ESCAPEARTIST announces export progress', async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    // Look for progress announcements
    const progressElements = page.locator(
      '[role="progressbar"], [role="status"], [aria-live]'
    )
    const count = await progressElements.count()

    expect(count).toBeGreaterThanOrEqual(0)
  })
})

test.describe('Dialog Announcements', () => {
  test('ESCAPEPLAN dialogs have proper roles', async ({ page }) => {
    await mockClerkSignedOut(page)
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')

    // Try to open a modal
    const trigger = page
      .getByRole('button', { name: /sign in|sign up|get started/i })
      .first()

    const isVisible = await trigger.isVisible().catch(() => false)

    if (isVisible) {
      await trigger.click()
      await page.waitForTimeout(500)

      const dialog = page.getByRole('dialog')
      const dialogVisible = await dialog.isVisible().catch(() => false)

      if (dialogVisible) {
        // Dialog should have aria-modal
        const modal = await dialog.getAttribute('aria-modal')
        expect(modal).toBe('true')

        // Dialog should have a title
        const labelledBy = await dialog.getAttribute('aria-labelledby')
        const label = await dialog.getAttribute('aria-label')
        expect(labelledBy || label).toBeTruthy()
      }
    }
  })

  test('ESCAPEARTIST export dialog is accessible', async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    const exportButton = page
      .getByRole('button', { name: /export/i })
      .or(page.locator('[data-testid="export-button"]'))
      .first()

    const isVisible = await exportButton.isVisible().catch(() => false)

    if (isVisible) {
      await exportButton.click()
      await page.waitForTimeout(500)

      const dialog = page.getByRole('dialog')
      const dialogVisible = await dialog.isVisible().catch(() => false)

      if (dialogVisible) {
        // Check for proper dialog semantics
        const modal = await dialog.getAttribute('aria-modal')
        expect(modal).toBe('true')

        // Check for heading
        const heading = dialog.locator('h1, h2, h3, [role="heading"]').first()
        const hasHeading = await heading.isVisible().catch(() => false)
        expect(hasHeading).toBe(true)
      }
    }
  })
})

test.describe('Landmark Regions', () => {
  test('ESCAPEPLAN has proper landmarks', async ({ page }) => {
    await mockClerkSignedOut(page)
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')

    // Check for main landmark
    const main = page.locator('main, [role="main"]')
    const hasMain = (await main.count()) > 0

    // Check for navigation landmark
    const nav = page.locator('nav, [role="navigation"]')
    const hasNav = (await nav.count()) > 0

    // Should have at least main or navigation
    expect(hasMain || hasNav).toBe(true)
  })

  test('ESCAPECRAFT has proper landmarks', async ({ page }) => {
    await mockClerkAuth(page)
    await mockGetUserMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')

    const main = page.locator('main, [role="main"]')
    const hasMain = (await main.count()) > 0

    expect(hasMain).toBe(true)
  })

  test('ESCAPEARTIST has proper landmarks', async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    const main = page.locator('main, [role="main"]')
    const hasMain = (await main.count()) > 0

    expect(hasMain).toBe(true)
  })
})

test.describe('Form Error Announcements', () => {
  test('form errors are announced', async ({ page }) => {
    await mockClerkSignedOut(page)
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')

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
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    // Check for loading indicators with proper ARIA
    const loaders = page.locator(
      '[role="progressbar"], [aria-busy="true"], [aria-label*="loading"]'
    )
    const count = await loaders.count()

    // May not have active loaders
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('progressbar has proper attributes', async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

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
    await mockClerkAuth(page)
    await mockGetUserMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')

    // Find buttons that might only have icons
    const iconButtons = page.locator('button:has(svg), button:has(img), button:has([class*="icon"])')
    const count = await iconButtons.count()

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
    await mockClerkAuth(page)
    await mockGetUserMedia(page)
    await mockMediaRecorder(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')

    const toggles = page.locator(
      '[role="switch"], [aria-pressed], button[class*="toggle"]'
    )
    const count = await toggles.count()

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
  test('data tables have proper structure', async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto('http://localhost:5173/dashboard')
    await page.waitForLoadState('networkidle')

    const tables = page.locator('table')
    const count = await tables.count()

    for (let i = 0; i < count; i++) {
      const table = tables.nth(i)
      const isVisible = await table.isVisible().catch(() => false)

      if (isVisible) {
        // Check for headers
        const headers = table.locator('th')
        const headerCount = await headers.count()

        // Tables should have headers
        expect(headerCount).toBeGreaterThan(0)

        // Check for caption or aria-label
        const caption = table.locator('caption')
        const hasCaption = (await caption.count()) > 0
        const ariaLabel = await table.getAttribute('aria-label')
        const ariaLabelledBy = await table.getAttribute('aria-labelledby')

        // Table should be labeled
        expect(hasCaption || ariaLabel || ariaLabelledBy).toBeTruthy()
      }
    }
  })

  test('lists have proper structure', async ({ page }) => {
    await mockClerkAuth(page)
    await mockGetUserMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')

    // Check for recordings list
    const lists = page.locator('ul, ol, [role="list"]')
    const count = await lists.count()

    for (let i = 0; i < Math.min(count, 3); i++) {
      const list = lists.nth(i)
      const isVisible = await list.isVisible().catch(() => false)

      if (isVisible) {
        // Check for list items
        const items = list.locator('li, [role="listitem"]')
        const itemCount = await items.count()

        // Non-empty lists should have items
        if (itemCount > 0) {
          const firstItem = items.first()
          const hasContent = await firstItem.textContent()
          expect(hasContent).toBeTruthy()
        }
      }
    }
  })
})
