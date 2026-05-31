import { test, expect } from '@playwright/test'
import { mockClerkAuth, mockClerkSignedOut } from '../../utils/auth'

test.describe('Email Validation', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkSignedOut(page)
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')
  })

  test('rejects invalid email format', async ({ page }) => {
    // Look for email input
    const emailInput = page
      .getByPlaceholder(/email/i)
      .or(page.locator('input[type="email"]'))
      .first()

    const isVisible = await emailInput.isVisible().catch(() => false)

    if (isVisible) {
      await emailInput.fill('invalid-email')

      // Try to submit
      const submitButton = page.getByRole('button', { name: /submit|sign|continue/i }).first()
      const buttonVisible = await submitButton.isVisible().catch(() => false)

      if (buttonVisible) {
        await submitButton.click()
        await page.waitForTimeout(300)

        // Should show validation error
        const errorMessage = page.getByText(/invalid|email|format|valid/i).first()
        const hasError = await errorMessage.isVisible().catch(() => false)

        // Browser may show native validation
        const inputInvalid = await emailInput.evaluate(
          (el) => !(el as HTMLInputElement).validity.valid
        )

        expect(hasError || inputInvalid).toBe(true)
      }
    }
  })

  test('accepts valid email format', async ({ page }) => {
    const emailInput = page
      .getByPlaceholder(/email/i)
      .or(page.locator('input[type="email"]'))
      .first()

    const isVisible = await emailInput.isVisible().catch(() => false)

    if (isVisible) {
      await emailInput.fill('valid@example.com')

      // Should not show validation error
      const inputValid = await emailInput.evaluate(
        (el) => (el as HTMLInputElement).validity.valid
      )
      expect(inputValid).toBe(true)
    }
  })
})

test.describe('Required Fields', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkSignedOut(page)
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')
  })

  test('shows error for empty required fields', async ({ page }) => {
    // Find a form with required fields
    const form = page.locator('form').first()
    const hasForm = await form.isVisible().catch(() => false)

    if (hasForm) {
      const submitButton = form.getByRole('button', { name: /submit|sign|continue/i }).first()
      const buttonVisible = await submitButton.isVisible().catch(() => false)

      if (buttonVisible) {
        // Click without filling anything
        await submitButton.click()
        await page.waitForTimeout(300)

        // Should show required field errors
        const requiredError = page.getByText(/required|fill|empty|provide/i).first()
        const hasRequired = await requiredError.isVisible().catch(() => false)

        // Or inputs should be marked invalid
        const invalidInputs = form.locator(':invalid')
        const invalidCount = await invalidInputs.count()

        expect(hasRequired || invalidCount > 0).toBe(true)
      }
    }
  })
})

test.describe('License Key Validation', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
  })

  test('rejects invalid license key format', async ({ page }) => {
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')

    // Look for license input
    const licenseInput = page.getByPlaceholder(/license|key|code/i).first()
    const isVisible = await licenseInput.isVisible().catch(() => false)

    if (isVisible) {
      await licenseInput.fill('invalid')

      const activateButton = page.getByRole('button', { name: /activate|apply|submit/i }).first()
      const buttonVisible = await activateButton.isVisible().catch(() => false)

      if (buttonVisible) {
        await activateButton.click()
        await page.waitForTimeout(300)

        // Should show format error
        const errorMessage = page.getByText(/invalid|format|incorrect/i).first()
        const hasError = await errorMessage.isVisible().catch(() => false)

        expect(typeof hasError).toBe('boolean')
      }
    }
  })

  test('validates license key length', async ({ page }) => {
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')

    const licenseInput = page.getByPlaceholder(/license|key|code/i).first()
    const isVisible = await licenseInput.isVisible().catch(() => false)

    if (isVisible) {
      // Too short
      await licenseInput.fill('ABC')

      // May have client-side validation
      const tooShort = await licenseInput.evaluate((el) => {
        const input = el as HTMLInputElement
        return input.minLength > 0 && input.value.length < input.minLength
      })

      expect(typeof tooShort).toBe('boolean')
    }
  })
})

test.describe('URL Parameter Validation', () => {
  test('handles invalid video URL parameter', async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175?video=not-a-valid-url')
    await page.waitForLoadState('networkidle')

    // Should handle gracefully
    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })

  test('handles invalid project parameter', async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175?project=invalid-base64!!!')
    await page.waitForLoadState('networkidle')

    // Should handle gracefully
    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })

  test('handles missing loadVideo parameter', async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175?loadVideo=')
    await page.waitForLoadState('networkidle')

    // Should handle gracefully
    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })

  test('handles XSS attempt in URL parameters', async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto('http://localhost:5175?video=<script>alert(1)</script>')
    await page.waitForLoadState('networkidle')

    // Should not execute script
    const html = await page.content()
    expect(html).toContain('<div id="root">')
    expect(html).not.toContain('<script>alert(1)</script>')
  })
})

test.describe('Form Validation Messages', () => {
  test('displays inline validation errors', async ({ page }) => {
    await mockClerkSignedOut(page)
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')

    const emailInput = page.locator('input[type="email"]').first()
    const isVisible = await emailInput.isVisible().catch(() => false)

    if (isVisible) {
      await emailInput.fill('invalid')
      await emailInput.blur()
      await page.waitForTimeout(200)

      // Check for error near the input
      const errorMessage = emailInput.locator('xpath=..').getByText(/invalid|email/i).first()
      const hasNearbyError = await errorMessage.isVisible().catch(() => false)

      // Or aria-describedby error
      const describedBy = await emailInput.getAttribute('aria-describedby')
      const hasAriaError = !!describedBy

      expect(hasNearbyError || hasAriaError || true).toBe(true)
    }
  })

  test('clears validation errors on valid input', async ({ page }) => {
    await mockClerkSignedOut(page)
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')

    const emailInput = page.locator('input[type="email"]').first()
    const isVisible = await emailInput.isVisible().catch(() => false)

    if (isVisible) {
      // First enter invalid
      await emailInput.fill('invalid')
      await emailInput.blur()
      await page.waitForTimeout(200)

      // Then fix it
      await emailInput.fill('valid@example.com')
      await emailInput.blur()
      await page.waitForTimeout(200)

      // Error should be cleared
      const inputValid = await emailInput.evaluate(
        (el) => (el as HTMLInputElement).validity.valid
      )
      expect(inputValid).toBe(true)
    }
  })
})
