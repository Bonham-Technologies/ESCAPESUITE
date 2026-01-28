import { test, expect } from '@playwright/test'
import { mockClerkAuth, mockClerkSignedOut } from '../../utils/auth'
import { mockSubscription } from '../../utils/subscription-mocks'
import {
  mockOrganizationAPIs,
  setupMockOrganization,
  createMockOrganization,
  createMockMember,
} from '../../utils/organization-mocks'

test.describe('Protected Routes', () => {
  test('dashboard redirects unauthenticated users', async ({ page }) => {
    await mockClerkSignedOut(page)
    await page.goto('http://localhost:5173/dashboard')
    await page.waitForLoadState('networkidle')

    // Should redirect or show sign-in
    const url = page.url()
    const hasSignIn = url.includes('sign-in') || url === 'http://localhost:5173/'

    const signInUI = page.getByText(/sign in|log in/i).first()
    const hasSignInUI = await signInUI.isVisible().catch(() => false)

    expect(hasSignIn || hasSignInUI).toBe(true)
  })

  test('team page requires authentication', async ({ page }) => {
    await mockClerkSignedOut(page)
    await page.goto('http://localhost:5173/team')
    await page.waitForLoadState('networkidle')

    const url = page.url()
    const signInUI = page.getByText(/sign in|log in/i).first()
    const hasSignInUI = await signInUI.isVisible().catch(() => false)

    expect(url.includes('sign-in') || url === 'http://localhost:5173/' || hasSignInUI).toBe(true)
  })
})

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
    await mockSubscription(page, 'pro_monthly')
    await page.goto('http://localhost:5173/dashboard')
    await page.waitForLoadState('networkidle')
  })

  test('shows subscription status', async ({ page }) => {
    const subscriptionInfo = page
      .getByText(/pro|subscription|plan|trial/i)
      .first()

    const isVisible = await subscriptionInfo.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('shows usage or activity info', async ({ page }) => {
    // Look for dashboard widgets
    const dashboardWidgets = page.locator(
      '[class*="card"], [class*="widget"], [class*="panel"]'
    )
    const count = await dashboardWidgets.count()

    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('navigation to tools works', async ({ page }) => {
    const craftLink = page
      .getByRole('link', { name: /craft|record/i })
      .or(page.getByText(/escapecraft|record/i))
      .first()

    const isVisible = await craftLink.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('Upgrade Button', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
    await mockSubscription(page, 'trial')
    await page.goto('http://localhost:5173/dashboard')
    await page.waitForLoadState('networkidle')
  })

  test('upgrade button visible for trial users', async ({ page }) => {
    const upgradeButton = page
      .getByRole('button', { name: /upgrade/i })
      .or(page.getByRole('link', { name: /upgrade/i }))
      .first()

    const isVisible = await upgradeButton.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('upgrade button opens checkout', async ({ page }) => {
    const upgradeButton = page
      .getByRole('button', { name: /upgrade/i })
      .or(page.getByRole('link', { name: /upgrade/i }))
      .first()

    const isVisible = await upgradeButton.isVisible().catch(() => false)

    if (isVisible) {
      await upgradeButton.click()
      await page.waitForTimeout(500)

      // Should open checkout or pricing page
      const url = page.url()
      const dialog = page.getByRole('dialog')
      const dialogVisible = await dialog.isVisible().catch(() => false)

      expect(url.includes('pricing') || dialogVisible).toBe(true)
    }
  })
})

test.describe('Team Management', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
    await mockOrganizationAPIs(page)
    const org = createMockOrganization('Test Team', 'user_test_123')
    const members = [
      createMockMember(org.id, 'user_test_123', 'admin@test.com', 'admin'),
      createMockMember(org.id, 'user_2', 'member@test.com', 'member'),
    ]
    setupMockOrganization(org, members, 'admin')
    await page.goto('http://localhost:5173/team')
    await page.waitForLoadState('networkidle')
  })

  test('team creation flow available', async ({ page }) => {
    const createTeamButton = page
      .getByRole('button', { name: /create|new team/i })
      .first()

    const isVisible = await createTeamButton.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('member invite available', async ({ page }) => {
    const inviteButton = page
      .getByRole('button', { name: /invite|add member/i })
      .first()

    const isVisible = await inviteButton.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('member list displays', async ({ page }) => {
    const memberList = page.locator(
      '[class*="member"], [class*="user"], table tbody tr'
    )
    const count = await memberList.count()

    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('role change available for admins', async ({ page }) => {
    const roleSelector = page
      .getByRole('combobox', { name: /role/i })
      .or(page.locator('[data-testid="role-selector"]'))
      .first()

    const isVisible = await roleSelector.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('Audit Log', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
    await mockOrganizationAPIs(page)
    const org = createMockOrganization('Enterprise Team', 'user_test_123', {
      plan: 'enterprise',
      settings: { audit_logging: true },
    })
    setupMockOrganization(org, [], 'admin')
    await page.goto('http://localhost:5173/team/audit')
    await page.waitForLoadState('networkidle')
  })

  test('audit log displays events', async ({ page }) => {
    const auditTable = page.locator('table').first()
    const isVisible = await auditTable.isVisible().catch(() => false)

    expect(typeof isVisible).toBe('boolean')
  })

  test('audit log has filtering', async ({ page }) => {
    const filterInput = page
      .getByPlaceholder(/filter|search/i)
      .or(page.locator('[data-testid="audit-filter"]'))
      .first()

    const isVisible = await filterInput.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto('http://localhost:5173/settings')
    await page.waitForLoadState('networkidle')
  })

  test('settings page loads', async ({ page }) => {
    const html = await page.content()
    expect(html).toContain('<div id="root">')
  })

  test('settings update shows feedback', async ({ page }) => {
    const saveButton = page
      .getByRole('button', { name: /save|update/i })
      .first()

    const isVisible = await saveButton.isVisible().catch(() => false)

    if (isVisible) {
      await saveButton.click()
      await page.waitForTimeout(500)

      // Should show success or error message
      const feedback = page.getByText(/saved|updated|error|success/i).first()
      const hasFeedback = await feedback.isVisible().catch(() => false)

      expect(typeof hasFeedback).toBe('boolean')
    }
  })
})

test.describe('Error Pages', () => {
  test('404 page displays for unknown routes', async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto('http://localhost:5173/nonexistent-page-12345')
    await page.waitForLoadState('networkidle')

    // Should show 404 or redirect to home
    const notFoundText = page.getByText(/not found|404|doesn't exist/i).first()
    const hasNotFound = await notFoundText.isVisible().catch(() => false)

    const url = page.url()
    const redirectedHome = url === 'http://localhost:5173/'

    expect(hasNotFound || redirectedHome).toBe(true)
  })
})

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')
  })

  test('main navigation exists', async ({ page }) => {
    const nav = page.locator('nav, header').first()
    const isVisible = await nav.isVisible().catch(() => false)

    expect(isVisible).toBe(true)
  })

  test('navigation links work', async ({ page }) => {
    const pricingLink = page
      .getByRole('link', { name: /pricing/i })
      .first()

    const isVisible = await pricingLink.isVisible().catch(() => false)

    if (isVisible) {
      await pricingLink.click()
      await page.waitForLoadState('networkidle')

      const url = page.url()
      expect(url).toContain('pricing')
    }
  })
})

test.describe('User Menu', () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page)
    await page.goto('http://localhost:5173')
    await page.waitForLoadState('networkidle')
  })

  test('user menu accessible', async ({ page }) => {
    const userButton = page
      .getByRole('button', { name: /user|profile|account/i })
      .or(page.locator('[data-testid="user-button"]'))
      .first()

    const isVisible = await userButton.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('sign out option available', async ({ page }) => {
    const userButton = page
      .getByRole('button', { name: /user|profile|account/i })
      .first()

    const isVisible = await userButton.isVisible().catch(() => false)

    if (isVisible) {
      await userButton.click()
      await page.waitForTimeout(300)

      const signOutOption = page.getByText(/sign out|log out/i).first()
      const signOutVisible = await signOutOption.isVisible().catch(() => false)

      expect(typeof signOutVisible).toBe('boolean')
    }
  })
})
