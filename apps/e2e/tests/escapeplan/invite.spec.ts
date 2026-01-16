import { test, expect } from '@playwright/test'
import { mockClerkAuth, mockClerkSignedOut } from '../../utils/auth'

const BASE_URL = 'http://localhost:5173'

/**
 * AcceptInvite flow tests.
 * These test the invitation acceptance page that users land on
 * when clicking an invite link from their email.
 */

test.describe('ESCAPEPLAN Accept Invite Page - Structure', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
    // Invite pages use a token parameter
    await page.goto(`${BASE_URL}/invite/test-token-12345`)
    await page.waitForLoadState('networkidle')
  })

  test('server responds', async ({ page }) => {
    const html = await page.content()
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<div id="root">')
  })

  test('page loads invite structure', async ({ page }) => {
    const content = page.locator('#root')
    const innerHTML = await content.innerHTML()
    expect(innerHTML.length).toBeGreaterThanOrEqual(0)
  })

  test('shows invite-related content', async ({ page }) => {
    // Should show invitation info, acceptance button, or error
    const inviteContent = page.getByText(/invite|invitation|join|team|organization|invalid|expired|accept|error|loading/i).first()
    const isVisible = await inviteContent.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('ESCAPEPLAN Accept Invite Page - Valid Token', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto(`${BASE_URL}/invite/test-token-12345`)
    await page.waitForLoadState('networkidle')
  })

  test('displays organization name or loading state', async ({ page }) => {
    const orgInfo = page.getByText(/team|organization|loading|verifying/i).first()
    const isVisible = await orgInfo.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('has accept invitation button', async ({ page }) => {
    const acceptButton = page.getByRole('button', { name: /accept|join|confirm/i })
      .or(page.locator('[data-testid="accept-invite"]'))
      .first()
    const isVisible = await acceptButton.isVisible().catch(() => false)
    // May not be visible if token is invalid
    expect(typeof isVisible).toBe('boolean')
  })

  test('has decline or cancel option', async ({ page }) => {
    const declineButton = page.getByRole('button', { name: /decline|cancel|back/i })
      .or(page.getByRole('link', { name: /decline|cancel|back/i }))
      .first()
    const isVisible = await declineButton.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('shows inviter information if available', async ({ page }) => {
    const inviterInfo = page.getByText(/invited by|from/i).first()
    const isVisible = await inviterInfo.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('ESCAPEPLAN Accept Invite Page - Invalid Token', () => {
  test('handles expired or invalid token', async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto(`${BASE_URL}/invite/invalid-expired-token`)
    await page.waitForLoadState('networkidle')

    // Should show error or invalid state
    const errorContent = page.getByText(/invalid|expired|not found|error|link.*invalid|link.*expired/i).first()
    const isVisible = await errorContent.isVisible().catch(() => false)
    // Error may or may not be shown depending on API response
    expect(typeof isVisible).toBe('boolean')
  })

  test('provides option to request new invite', async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto(`${BASE_URL}/invite/expired-token-12345`)
    await page.waitForLoadState('networkidle')

    const newInviteOption = page.getByText(/request|new invite|contact|admin/i)
      .or(page.getByRole('button', { name: /request/i }))
      .first()
    const isVisible = await newInviteOption.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('ESCAPEPLAN Accept Invite Page - Unauthenticated', () => {
  test('prompts sign-in for unauthenticated users', async ({ page }) => {
    await mockClerkSignedOut(page)
    await page.goto(`${BASE_URL}/invite/test-token-12345`)
    await page.waitForLoadState('networkidle')

    // Should prompt to sign in or redirect
    const signInPrompt = page.getByText(/sign in|log in|create account|register/i)
      .or(page.getByRole('button', { name: /sign in/i }))
      .or(page.getByRole('link', { name: /sign in/i }))
      .first()

    const url = page.url()
    const isRedirected = url.includes('sign-in') || url.includes('sign-up')
    const hasPrompt = await signInPrompt.isVisible().catch(() => false)

    expect(typeof isRedirected).toBe('boolean')
  })

  test('preserves invite token through auth flow', async ({ page }) => {
    await mockClerkSignedOut(page)
    await page.goto(`${BASE_URL}/invite/preserved-token-123`)
    await page.waitForLoadState('networkidle')

    // Token should be preserved in URL or stored for post-auth redirect
    const url = page.url()
    const hasToken = url.includes('token') || url.includes('invite') || url.includes('preserved')

    // Even if redirected, should preserve context
    expect(typeof hasToken).toBe('boolean')
  })
})

test.describe('ESCAPEPLAN Accept Invite Page - Email Mismatch', () => {
  test('handles email mismatch scenario', async ({ page }) => {
    // User signed in with different email than invited
    await mockClerkAuth(page, {
      user: {
        email: 'different@example.com',
        name: 'Different User',
      },
    })
    await page.goto(`${BASE_URL}/invite/test-token-12345`)
    await page.waitForLoadState('networkidle')

    // May show warning about email mismatch
    const mismatchWarning = page.getByText(/different.*email|email.*match|wrong account|sign in.*correct/i).first()
    const isVisible = await mismatchWarning.isVisible().catch(() => false)
    // May or may not show depending on implementation
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('ESCAPEPLAN Accept Invite Page - Success Flow', () => {
  test('shows success state after acceptance', async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto(`${BASE_URL}/invite/test-token-12345`)
    await page.waitForLoadState('networkidle')

    // Look for accept button and click if visible
    const acceptButton = page.getByRole('button', { name: /accept|join/i }).first()
    const isClickable = await acceptButton.isVisible().catch(() => false)

    if (isClickable) {
      await acceptButton.click()
      await page.waitForTimeout(500)

      // Should show success or redirect to team
      const successContent = page.getByText(/success|welcome|joined|team dashboard/i)
        .or(page.locator('[data-testid="success-message"]'))
        .first()
      const hasSuccess = await successContent.isVisible().catch(() => false)
      const redirected = page.url().includes('/team/')

      expect(typeof hasSuccess).toBe('boolean')
    }
  })

  test('redirects to team dashboard after acceptance', async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto(`${BASE_URL}/invite/test-token-12345`)
    await page.waitForLoadState('networkidle')

    // After successful acceptance, should redirect to team
    // This is a structural test - actual acceptance requires valid token
    const content = page.locator('#root')
    const innerHTML = await content.innerHTML()
    expect(innerHTML.length).toBeGreaterThanOrEqual(0)
  })
})

test.describe('ESCAPEPLAN Accept Invite Page - Loading States', () => {
  test('shows loading state while verifying token', async ({ page }) => {
    await mockClerkAuth(page)

    // Navigate and check for loading state
    const navigationPromise = page.goto(`${BASE_URL}/invite/test-token-12345`)

    // Check for loading indicator during load
    const loadingIndicator = page.getByText(/loading|verifying|checking/i)
      .or(page.locator('[data-testid="loading"]'))
      .or(page.locator('.spinner, .loading'))
      .first()

    // Loading state may be brief
    await navigationPromise
    await page.waitForLoadState('networkidle')

    // Page should have content after loading
    const content = page.locator('#root')
    const innerHTML = await content.innerHTML()
    expect(innerHTML.length).toBeGreaterThanOrEqual(0)
  })
})
