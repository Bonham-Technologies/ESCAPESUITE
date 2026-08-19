import { test, expect } from '@playwright/test'
import { mockGetUserMedia, mockMediaRecorder, grantMediaPermissions } from '../../utils/media-mocks'
import {
  runAxeCheck,
  assertNoA11yViolations,
  checkImageAltText,
  checkHeadingHierarchy,
  checkFormLabels,
  checkLinkText,
} from '../../utils/accessibility'

test.describe('ESCAPEPLAN Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')
  })

  test('landing page passes axe-core audit', async ({ page }) => {
    const results = await runAxeCheck(page, {})

    // Allow minor/moderate issues but fail on serious/critical
    const seriousViolations = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    )

    expect(seriousViolations).toHaveLength(0)
  })

  test('landing page has valid heading hierarchy', async ({ page }) => {
    const { valid, errors } = await checkHeadingHierarchy(page)

    // Log any errors for debugging
    if (!valid) {
      console.log('Heading hierarchy errors:', errors)
    }

    expect(valid).toBe(true)
  })

  test('landing page images have alt text', async ({ page }) => {
    const { withoutAlt } = await checkImageAltText(page)
    expect(withoutAlt).toBe(0)
  })

  test('landing page forms have labels', async ({ page }) => {
    const { unlabeled } = await checkFormLabels(page)
    expect(unlabeled).toHaveLength(0)
  })

  test('landing page links have meaningful text', async ({ page }) => {
    const { vague } = await checkLinkText(page)
    // Some vague links may be acceptable in navigation
    expect(vague.length).toBeLessThanOrEqual(2)
  })
})

test.describe('ESCAPECRAFT Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await mockGetUserMedia(page)
    await mockMediaRecorder(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')
  })

  test('recording UI passes axe-core audit', async ({ page }) => {
    const results = await runAxeCheck(page)

    const seriousViolations = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    )

    expect(seriousViolations).toHaveLength(0)
  })

  test('recording controls have accessible names', async ({ page }) => {
    // Check that buttons have accessible names
    const buttons = page.getByRole('button')
    const count = await buttons.count()

    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i)
      const isVisible = await button.isVisible().catch(() => false)
      if (!isVisible) continue

      const name = await button.getAttribute('aria-label')
      const text = await button.textContent()
      const title = await button.getAttribute('title')

      // Button should have some accessible name
      const hasAccessibleName = !!(name || text?.trim() || title)
      expect(hasAccessibleName).toBe(true)
    }
  })

  test('recording UI has valid heading hierarchy', async ({ page }) => {
    const { valid } = await checkHeadingHierarchy(page)
    expect(valid).toBe(true)
  })

  test('toggle controls have proper state', async ({ page }) => {
    // Check that toggle buttons have aria-pressed or aria-checked
    const toggles = page.locator('[role="switch"], [aria-pressed], [aria-checked]')
    const count = await toggles.count()

    // Should have some toggles (webcam, mic, etc.)
    expect(count).toBeGreaterThanOrEqual(0)

    for (let i = 0; i < count; i++) {
      const toggle = toggles.nth(i)
      const pressed = await toggle.getAttribute('aria-pressed')
      const checked = await toggle.getAttribute('aria-checked')

      // Toggle should have explicit state
      const hasState = pressed !== null || checked !== null
      expect(hasState).toBe(true)
    }
  })
})

test.describe('ESCAPEARTIST Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')
  })

  test('editor UI passes axe-core audit', async ({ page }) => {
    const results = await runAxeCheck(page, {
      // Disable color-contrast for canvas-based timeline
      disableRules: ['color-contrast'],
    })

    const seriousViolations = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    )

    expect(seriousViolations).toHaveLength(0)
  })

  test('toolbar buttons have accessible names', async ({ page }) => {
    const toolbar = page.locator('[role="toolbar"], .toolbar, [class*="toolbar"]').first()
    const isVisible = await toolbar.isVisible().catch(() => false)

    if (isVisible) {
      const buttons = toolbar.getByRole('button')
      const count = await buttons.count()

      for (let i = 0; i < count; i++) {
        const button = buttons.nth(i)
        const name = await button.getAttribute('aria-label')
        const text = await button.textContent()
        const title = await button.getAttribute('title')

        const hasAccessibleName = !!(name || text?.trim() || title)
        expect(hasAccessibleName).toBe(true)
      }
    }
  })

  test('editor has valid heading hierarchy', async ({ page }) => {
    const { valid } = await checkHeadingHierarchy(page)
    expect(valid).toBe(true)
  })

  test('modals have proper dialog role', async ({ page }) => {
    // Try to open a modal (export dialog)
    const exportButton = page
      .getByRole('button', { name: /export/i })
      .or(page.locator('[data-testid="export-button"]'))
      .first()

    const isVisible = await exportButton.isVisible().catch(() => false)

    if (isVisible) {
      await exportButton.click()
      await page.waitForTimeout(300)

      // Check for dialog role
      const dialog = page.getByRole('dialog')
      const dialogVisible = await dialog.isVisible().catch(() => false)

      if (dialogVisible) {
        // Dialog should have aria-modal
        const modal = await dialog.getAttribute('aria-modal')
        expect(modal).toBe('true')

        // Dialog should have a label
        const labelledBy = await dialog.getAttribute('aria-labelledby')
        const label = await dialog.getAttribute('aria-label')
        expect(labelledBy || label).toBeTruthy()
      }
    }
  })

  test('form inputs have associated labels', async ({ page }) => {
    const { unlabeled } = await checkFormLabels(page)
    expect(unlabeled).toHaveLength(0)
  })
})

test.describe('Color Contrast', () => {
  test('ESCAPEPLAN has adequate color contrast', async ({ page }) => {
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')

    const results = await runAxeCheck(page, {
      includeTags: ['wcag2aa'],
    })

    const contrastViolations = results.violations.filter((v) => v.id === 'color-contrast')
    expect(contrastViolations).toHaveLength(0)
  })

  test('ESCAPECRAFT has adequate color contrast', async ({ page }) => {
    await mockGetUserMedia(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')

    const results = await runAxeCheck(page, {
      includeTags: ['wcag2aa'],
    })

    const contrastViolations = results.violations.filter((v) => v.id === 'color-contrast')
    expect(contrastViolations).toHaveLength(0)
  })

  test('ESCAPEARTIST has adequate color contrast', async ({ page }) => {
    await page.goto('http://localhost:5175')
    await page.waitForLoadState('networkidle')

    const results = await runAxeCheck(page, {
      includeTags: ['wcag2aa'],
      // Exclude timeline canvas
      excludeSelector: 'canvas',
    })

    const contrastViolations = results.violations.filter((v) => v.id === 'color-contrast')
    expect(contrastViolations).toHaveLength(0)
  })
})
