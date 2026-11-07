import { test, expect, type Page } from '@playwright/test'
import { inspector, mobileInspectorToggle, seedTextClip } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-345: below 900px the inspector starts collapsed.
 *
 * Below the 900px breakpoint the inspector is a fixed slide-out panel. It used
 * to start open, so a phone (390x844) loaded the editor with the panel over
 * the preview, the media library and most of the timeline. It now starts
 * shut there, and opens only from the floating toggle; at 900px and up it
 * starts expanded as before. Until the user toggles it, it follows the
 * breakpoint when the window is resized; once they have, their choice holds
 * until a reload.
 */

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 800 }

async function load(page: Page, viewport: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(viewport)
  await page.goto('http://localhost:5175')
  await waitForAppReady(page, 'artist')
  // Prove the editor rendered before trusting any "collapsed" below.
  await expect(page.getByRole('button', { name: 'Export video' })).toBeVisible()
}

test('a phone loads with the inspector shut and off the screen', async ({ page }) => {
  await load(page, PHONE)

  await expect(inspector(page)).toHaveClass(/inspectorCollapsed/)
  await expect(mobileInspectorToggle(page)).toHaveAttribute('aria-label', 'Show inspector')
  // Slid out past the right edge, so it covers nothing.
  await expect
    .poll(async () => (await inspector(page).boundingBox())?.x ?? 0)
    .toBeGreaterThanOrEqual(PHONE.width - 1)
  await expect(page.locator('[class*="videoWrapper"]').first()).toBeVisible()
})

test('a desktop window still loads with the inspector expanded', async ({ page }) => {
  await load(page, DESKTOP)

  await expect(inspector(page)).not.toHaveClass(/inspectorCollapsed/)
  await expect(page.getByRole('button', { name: 'Add Text' })).toBeVisible()
})

test('selecting a clip on a phone does not open the inspector', async ({ page }) => {
  await load(page, PHONE)
  // Opens the inspector with the toggle to reach "Add Text".
  await seedTextClip(page)

  const toggle = mobileInspectorToggle(page)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-label', 'Show inspector')

  const clip = page.locator('[data-clip-id]').first()
  await clip.click()
  await expect(clip).toHaveClass(/clipSelected/)

  await expect(inspector(page)).toHaveClass(/inspectorCollapsed/)
  await expect(toggle).toHaveAttribute('aria-label', 'Show inspector')
})

test('untouched, the inspector follows the breakpoint across a resize', async ({ page }) => {
  await load(page, PHONE)
  await expect(inspector(page)).toHaveClass(/inspectorCollapsed/)

  await page.setViewportSize(DESKTOP)
  await expect(inspector(page)).not.toHaveClass(/inspectorCollapsed/)

  await page.setViewportSize(PHONE)
  await expect(inspector(page)).toHaveClass(/inspectorCollapsed/)
})

test('opened on a phone, the inspector stays open across a resize', async ({ page }) => {
  await load(page, PHONE)
  const toggle = mobileInspectorToggle(page)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-label', 'Hide inspector')

  await page.setViewportSize(DESKTOP)
  await expect(inspector(page)).not.toHaveClass(/inspectorCollapsed/)

  await page.setViewportSize(PHONE)
  await expect(inspector(page)).not.toHaveClass(/inspectorCollapsed/)
  await expect(toggle).toHaveAttribute('aria-label', 'Hide inspector')
})

test('collapsed on a desktop, the inspector stays collapsed across a resize', async ({ page }) => {
  await load(page, DESKTOP)
  await page.getByRole('button', { name: 'Hide inspector panel' }).click()
  await expect(inspector(page)).toHaveClass(/inspectorCollapsed/)

  await page.setViewportSize(PHONE)
  await expect(inspector(page)).toHaveClass(/inspectorCollapsed/)

  await page.setViewportSize(DESKTOP)
  await expect(inspector(page)).toHaveClass(/inspectorCollapsed/)
  await expect(page.getByRole('button', { name: 'Show inspector panel' })).toBeVisible()
})
