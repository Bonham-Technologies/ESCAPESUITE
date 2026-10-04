import { test, expect } from '@playwright/test'
import { mockGetUserMedia, mockMediaRecorder, grantMediaPermissions } from '../../utils/media-mocks'
import { seedTextClip } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

test.describe('ARIA Live Regions', () => {
  // ESCSUITE-202: ESCAPEPLAN is a static marketing/legal site — three pages,
  // no dynamic state, nothing that would ever need a live region
  // (`grep -rn "aria-live" apps/plan/src` has no matches). "ESCAPEPLAN has
  // status announcements" had no feature to find and is deleted rather than
  // kept as a placeholder (`count >= 0`) for one.

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

  // ESCSUITE-202: a real app defect, not fixed here (test-only ticket). The
  // export dialog's progress section (`components/Export/ExportDialog.tsx`,
  // the `.progressInfo`/`.progressBar` block around line 583) carries no
  // `role="progressbar"`, `aria-live` or `aria-busy` anywhere — the
  // "Encoding frame N/M" text and the percentage are visual-only, so a
  // screen-reader user gets no spoken update while an export runs. The
  // dialog's handful of `role="status"` spans are all *after*-the-fact notes
  // (an estimated size, a "no audio" summary once the export completes),
  // never the live phase/percentage. "ESCAPEARTIST announces export
  // progress" and "progressbar has proper attributes" below had no real
  // `role="progressbar"` or live region to find and are deleted rather than
  // kept as `count >= 0` placeholders for one.
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
  // ESCSUITE-198/202 K-8: these three used to be `test.skip` under a stale
  // "skipped in CI due to rendering timing issues" comment —
  // ESCSUITE-177's `waitForAppReady` (React's first commit, not
  // `networkidle`) already fixed the timing hazard the comment blamed, and
  // the belt-and-braces `waitForSelector('#root')` + `waitForTimeout(500)`
  // it stood in for is redundant with that. Unskipped, and each asserts the
  // real landmarks its own app's source renders directly, rather than the
  // weaker "main, nav, or header" fallback.
  test('ESCAPEPLAN has proper landmarks', async ({ page }) => {
    await page.goto('http://localhost:5173')
    await waitForAppReady(page, 'plan')

    await expect(page.locator('main')).toBeVisible()
    await expect(page.locator('nav')).toBeVisible()
    await expect(page.locator('header')).toBeVisible()
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

  test('ESCAPEARTIST has proper landmarks', async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')

    await expect(page.locator('main')).toBeVisible()
    await expect(page.locator('header')).toBeVisible()
  })
})

// ESCSUITE-202: ESCAPEPLAN has no `<form>` anywhere (`grep -rln "<form"
// apps/plan/src` has no matches — it is a static marketing/legal site, no
// sign-up, no contact form). "Form Error Announcements" › "form errors are
// announced" had no feature to find — wrapped in two nested `if`s around a
// `count >= 0`, it could not have failed for any reason — and is deleted
// rather than kept as a placeholder for a form that does not exist.

// ESCSUITE-202: "Progress Indicator Announcements" is the same real gap
// `ARIA Live Regions`' deleted export-progress cases document above — no
// `role="progressbar"` exists anywhere in ESCAPEARTIST, so both
// "loading states are announced" and "progressbar has proper attributes"
// were `count >= 0` / `if (isVisible)` placeholders for a control that was
// never there to find. Not fixed here (test-only ticket); see the comment
// above `ARIA Live Regions`' closing brace for the real defect.

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
