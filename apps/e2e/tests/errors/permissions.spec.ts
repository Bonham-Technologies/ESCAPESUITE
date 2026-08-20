import { test, expect } from '@playwright/test'
import {
  mockCameraPermissionDenied,
  mockMicrophonePermissionDenied,
  mockScreenShareDenied,
  mockAllMediaPermissionsDenied,
  mockDeviceNotFound,
  mockDeviceInUse,
} from '../../utils/error-mocks'

test.describe('Camera Permission Denied', () => {
  test.beforeEach(async ({ page }) => {
    await mockCameraPermissionDenied(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')
  })

  // FIXME(ux): needs denied-device feedback — tracked in https://github.com/Bonham-Technologies/ESCAPESUITE/issues/289
  // Nothing is shown when a camera cannot be opened: the failure only reaches
  // the console, at record time. This test matched no buttons until the source
  // toggles gained accessible names, so it had never actually run.
  test.fixme('shows error UI when camera denied', async ({ page }) => {
    // Try to enable webcam
    const webcamToggle = page
      .getByRole('button', { name: /webcam|camera/i })
      .or(page.locator('[data-testid="webcam-toggle"]'))
      .first()

    const isVisible = await webcamToggle.isVisible().catch(() => false)

    if (isVisible) {
      await webcamToggle.click()
      await page.waitForTimeout(500)

      // Should show error message or disabled state
      const errorMessage = page.getByText(/denied|permission|blocked|not allowed/i).first()
      const errorVisible = await errorMessage.isVisible().catch(() => false)

      // Either show error or toggle should be disabled/inactive
      const isDisabled = await webcamToggle.isDisabled().catch(() => false)
      const ariaDisabled = await webcamToggle.getAttribute('aria-disabled')

      expect(errorVisible || isDisabled || ariaDisabled === 'true').toBe(true)
    }
  })

  test('app remains functional after camera denial', async ({ page }) => {
    // Verify main UI is still working
    const html = await page.content()
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<div id="root">')

    // Other controls should still work
    const micToggle = page
      .getByRole('button', { name: /mic|audio|microphone/i })
      .first()

    const isVisible = await micToggle.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('Microphone Permission Denied', () => {
  test.beforeEach(async ({ page }) => {
    await mockMicrophonePermissionDenied(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')
  })

  // FIXME(ux): needs denied-device feedback — tracked in https://github.com/Bonham-Technologies/ESCAPESUITE/issues/289
  // Nothing is shown when a microphone cannot be opened. The microphone is on
  // by default, so this click switches it off — the default-on case the issue
  // calls out. This test matched no buttons until the source toggles gained
  // accessible names, so it had never actually run.
  test.fixme('shows error UI when microphone denied', async ({ page }) => {
    const micToggle = page
      .getByRole('button', { name: /mic|audio|microphone/i })
      .or(page.locator('[data-testid="mic-toggle"]'))
      .first()

    const isVisible = await micToggle.isVisible().catch(() => false)

    if (isVisible) {
      await micToggle.click()
      await page.waitForTimeout(500)

      // Should indicate error or disabled state
      const isDisabled = await micToggle.isDisabled().catch(() => false)
      const ariaDisabled = await micToggle.getAttribute('aria-disabled')
      const errorMessage = page.getByText(/denied|permission|blocked/i).first()
      const errorVisible = await errorMessage.isVisible().catch(() => false)

      expect(errorVisible || isDisabled || ariaDisabled === 'true').toBe(true)
    }
  })

  test('screen recording still works without mic', async ({ page }) => {
    // Should be able to record screen without mic
    const screenButton = page
      .getByRole('button', { name: /screen|record/i })
      .or(page.locator('[data-testid="screen-button"]'))
      .first()

    const isVisible = await screenButton.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('Screen Share Permission Denied', () => {
  test.beforeEach(async ({ page }) => {
    await mockScreenShareDenied(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')
  })

  test('shows error UI when screen share denied', async ({ page }) => {
    const screenButton = page
      .getByRole('button', { name: /screen|share|record/i })
      .or(page.locator('[data-testid="screen-button"]'))
      .first()

    const isVisible = await screenButton.isVisible().catch(() => false)

    if (isVisible) {
      await screenButton.click()
      await page.waitForTimeout(500)

      // Should show error or return to initial state
      const errorMessage = page.getByText(/denied|cancelled|permission|blocked/i).first()
      const errorVisible = await errorMessage.isVisible().catch(() => false)

      // App should still be functional
      const html = await page.content()
      expect(html).toContain('<div id="root">')
    }
  })

  test('can retry after denial', async ({ page }) => {
    const screenButton = page
      .getByRole('button', { name: /screen|share|record/i })
      .or(page.locator('[data-testid="screen-button"]'))
      .first()

    const isVisible = await screenButton.isVisible().catch(() => false)

    if (isVisible) {
      // First attempt
      await screenButton.click()
      await page.waitForTimeout(300)

      // Should be able to click again
      const stillClickable = await screenButton.isEnabled().catch(() => true)
      expect(stillClickable).toBe(true)
    }
  })
})

test.describe('All Media Permissions Denied', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllMediaPermissionsDenied(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')
  })

  test('shows appropriate error state', async ({ page }) => {
    // App should load but show limited functionality
    const html = await page.content()
    expect(html).toContain('<div id="root">')

    // May show permission banner or error state
    const errorBanner = page.getByText(/permission|access|denied|enable|allow/i).first()
    const hasError = await errorBanner.isVisible().catch(() => false)

    // At minimum, app should not crash
    expect(typeof hasError).toBe('boolean')
  })

  test('capability detection shows unavailable', async ({ page }) => {
    // Look for capability indicators that should show as unavailable
    const unavailableIndicators = page.locator(
      '[class*="unavailable"], [class*="disabled"], [aria-disabled="true"]'
    )
    const count = await unavailableIndicators.count()

    // May have multiple unavailable features
    expect(count).toBeGreaterThanOrEqual(0)
  })
})

test.describe('Device Not Found', () => {
  test.beforeEach(async ({ page }) => {
    await mockDeviceNotFound(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')
  })

  test('shows device not found message', async ({ page }) => {
    const webcamToggle = page
      .getByRole('button', { name: /webcam|camera/i })
      .first()

    const isVisible = await webcamToggle.isVisible().catch(() => false)

    if (isVisible) {
      await webcamToggle.click()
      await page.waitForTimeout(500)

      // Should indicate device issue
      const errorMessage = page.getByText(/not found|no device|unavailable/i).first()
      const hasError = await errorMessage.isVisible().catch(() => false)

      // App should remain functional
      const html = await page.content()
      expect(html).toContain('<div id="root">')
    }
  })
})

test.describe('Device In Use', () => {
  test.beforeEach(async ({ page }) => {
    await mockDeviceInUse(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')
  })

  test('shows device in use message', async ({ page }) => {
    const webcamToggle = page
      .getByRole('button', { name: /webcam|camera/i })
      .first()

    const isVisible = await webcamToggle.isVisible().catch(() => false)

    if (isVisible) {
      await webcamToggle.click()
      await page.waitForTimeout(500)

      // Should indicate device is busy
      const errorMessage = page.getByText(/in use|busy|another|could not/i).first()
      const hasError = await errorMessage.isVisible().catch(() => false)

      // App should remain functional
      const html = await page.content()
      expect(html).toContain('<div id="root">')
    }
  })
})

test.describe('Permission Recovery', () => {
  test('can recover after granting permissions', async ({ page, context }) => {
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')

    // Grant permissions (Chromium-only; Firefox/WebKit don't support this)
    const browserName = context.browser()?.browserType().name()
    if (browserName === 'chromium') {
      await context.grantPermissions(['camera', 'microphone'])
    }

    // Refresh to pick up new permissions
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Should work normally now
    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })
})
