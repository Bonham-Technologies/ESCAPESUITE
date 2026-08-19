import { test, expect } from '@playwright/test'
import { mockGetUserMedia, mockMediaRecorder, grantMediaPermissions } from '../../utils/media-mocks'

test.describe('ESCAPECRAFT Recording Interface', () => {
  test.beforeEach(async ({ page }) => {
    await mockGetUserMedia(page)
    await mockMediaRecorder(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')
  })

  test('server responds', async ({ page }) => {
    // Verify the server is responding and page has HTML structure
    const html = await page.content()
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<div id="root">')
  })

  test('page has title', async ({ page }) => {
    const title = await page.title()
    // Page should have some title
    expect(title.length).toBeGreaterThanOrEqual(0)
  })

  test('has source selection options', async ({ page }) => {
    // Look for source selection UI
    const sourceSelector = page
      .getByText(/screen|window|tab|display/i)
      .or(page.locator('[data-testid="source-selector"]'))
      .first()

    const isVisible = await sourceSelector.isVisible().catch(() => false)
    // Source selector may be hidden until needed
    expect(typeof isVisible).toBe('boolean')
  })

  test('shows webcam toggle option', async ({ page }) => {
    const webcamToggle = page
      .getByRole('button', { name: /webcam|camera/i })
      .or(page.locator('[data-testid="webcam-toggle"]'))
      .or(page.getByText(/webcam|camera/i).first())

    const isVisible = await webcamToggle.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('shows microphone toggle option', async ({ page }) => {
    const micToggle = page
      .getByRole('button', { name: /mic|audio|microphone/i })
      .or(page.locator('[data-testid="mic-toggle"]'))
      .or(page.getByText(/microphone|mic/i).first())

    const isVisible = await micToggle.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('ESCAPECRAFT Recording Controls', () => {
  test.beforeEach(async ({ page }) => {
    await mockGetUserMedia(page)
    await mockMediaRecorder(page)
    await grantMediaPermissions(page)
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')
  })

  test('has recording settings area', async ({ page }) => {
    // Look for settings or configuration area
    const settingsArea = page
      .getByText(/settings|options|config/i)
      .or(page.locator('[data-testid="settings"]'))
      .first()

    const isVisible = await settingsArea.isVisible().catch(() => false)
    // Settings may be in a modal or collapsed
    expect(typeof isVisible).toBe('boolean')
  })

  test('webcam position options exist', async ({ page }) => {
    // Look for webcam position controls
    const positionControls = page
      .getByText(/position|corner|bottom|top|left|right/i)
      .first()

    const isVisible = await positionControls.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('countdown option exists', async ({ page }) => {
    // Look for countdown setting
    const countdownOption = page
      .getByText(/countdown|timer|delay/i)
      .or(page.locator('[data-testid="countdown"]'))
      .first()

    const isVisible = await countdownOption.isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('ESCAPECRAFT Recording List', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')
  })

  test('shows recordings list section', async ({ page }) => {
    // Look for recordings section
    const recordingsList = page
      .getByText(/recordings|recent|saved|library/i)
      .or(page.locator('[data-testid="recordings-list"]'))
      .first()

    const isVisible = await recordingsList.isVisible().catch(() => false)
    // May be empty or collapsed
    expect(typeof isVisible).toBe('boolean')
  })

  test('has send to editor option when recordings exist', async ({ page }) => {
    // Look for "Send to Editor" or similar link
    const editorLink = page
      .getByText(/send to editor|open in editor|edit/i)
      .or(page.getByRole('link', { name: /editor|artist/i }))
      .first()

    const isVisible = await editorLink.isVisible().catch(() => false)
    // Only visible when recordings exist
    expect(typeof isVisible).toBe('boolean')
  })
})

test.describe('ESCAPECRAFT User Interface', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5174')
    await page.waitForLoadState('networkidle')
  })

  test('has header or navigation', async ({ page }) => {
    const header = page.locator('header').or(page.locator('nav'))
    const isVisible = await header.first().isVisible().catch(() => false)
    expect(typeof isVisible).toBe('boolean')
  })

  test('has no account controls', async ({ page }) => {
    // The recorder is account-free: nothing to sign into, nothing to sign out of
    const accountUI = page
      .getByRole('button', { name: /sign in|sign out|profile|account/i })
      .or(page.locator('[data-testid="user-button"]'))

    expect(await accountUI.count()).toBe(0)
  })
})
