import { test, expect } from '@playwright/test'
import { waitForAppReady } from '../../utils/ready'

test.describe('ESCAPEPLAN Mobile Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('http://localhost:5173')
    await waitForAppReady(page, 'plan')
  })

  // ESCSUITE-213: this asserted `<div id="root">` was in the markup, which a
  // hub whose `Layout` returns `<main>HUNTK-MUTANT</main>` satisfies just as
  // well — the root div is in `index.html`, not in anything React rendered.
  // The three parts of the shell are named instead: the header's nav, the
  // hero's own `h1`, and the footer's legal links.
  test('landing page renders on mobile', async ({ page }) => {
    await expect(
      page
        .getByRole('navigation', { name: /main navigation/i })
        .getByRole('link', { name: 'GitHub' })
    ).toBeVisible()

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/how-to videos/i)

    await expect(page.getByRole('link', { name: 'Download ESCAPECRAFT' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Download ESCAPEARTIST' })).toBeVisible()

    await expect(page.getByRole('link', { name: /privacy policy/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /terms of service/i })).toBeVisible()
  })

  test('header navigation stays visible on mobile', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: /main navigation/i })
    await expect(nav).toBeVisible()
    await expect(nav.getByRole('link', { name: 'GitHub' })).toBeVisible()
  })

  // ESCSUITE-213: the whole body used to sit behind `if (isVisible)` around a
  // `.catch(() => false)`, so a hero that never rendered skipped the only
  // assertion. `Home.module.css`'s `@media (max-width: 768px)` rule is what
  // the name claims — it turns `.heroCta` into a column — so that is what is
  // asserted, with the original's "narrower than the viewport" claim kept
  // unconditionally beside it.
  test('hero section stacks vertically', async ({ page }) => {
    const record = page.getByRole('button', { name: 'Start recording' })
    const edit = page.getByRole('button', { name: 'Open the editor' })
    await expect(record).toBeVisible()
    await expect(edit).toBeVisible()

    const recordBox = (await record.boundingBox())!
    const editBox = (await edit.boundingBox())!
    // Stacked, not side by side: the editor CTA starts below the recorder CTA
    expect(editBox.y).toBeGreaterThanOrEqual(recordBox.y + recordBox.height)
    expect(editBox.x).toBe(recordBox.x)

    const hero = page.locator('section').first()
    await expect(hero).toBeVisible()
    expect((await hero.boundingBox())!.width).toBeLessThanOrEqual(375)
  })

  // ESCSUITE-213: the loop ran over however many `p` elements the page
  // happened to have — zero of them on a hub that rendered nothing — and each
  // iteration was itself guarded by `if (isVisible)`. The count is pinned
  // first and every paragraph is asserted visible.
  test('text is readable on mobile', async ({ page }) => {
    // `Home.tsx`'s nine body paragraphs: the hero subtitle, the hero's links
    // line, one per tool card, one per feature, and the open-source blurb.
    const paragraphs = page.locator('main p')
    await expect(paragraphs).toHaveCount(9)
    await expect(paragraphs.first()).toContainText(/records and edits screencasts/i)

    for (let i = 0; i < 9; i++) {
      const p = paragraphs.nth(i)
      await expect(p).toBeVisible()
      const fontSize = await p.evaluate((el) => parseFloat(window.getComputedStyle(el).fontSize))
      // Text should be at least 14px for readability. The hero's links line
      // is the tightest at `0.9rem` (14.4px).
      expect(fontSize).toBeGreaterThanOrEqual(14)
    }
  })

  // ESCSUITE-213: same shape as the paragraph loop — `getByRole('button')`
  // over an empty page is an empty list and five `if (isVisible)` no-ops.
  // The hub's four CTA buttons are named instead.
  test('buttons are touch-friendly size', async ({ page }) => {
    for (const name of [
      'Start recording',
      'Open the editor',
      'Use ESCAPECRAFT',
      'Use ESCAPEARTIST',
    ]) {
      const button = page.getByRole('button', { name })
      await expect(button).toBeVisible()
      const box = (await button.boundingBox())!
      // `index.css`'s global `button` rule sets `min-height: 44px` for WCAG
      // 2.5.8 — these are the controls that rule exists for.
      expect(box.height).toBeGreaterThanOrEqual(44)
    }
  })

  // ESCSUITE-213: `body.scrollWidth <= 376` is true of a page with nothing on
  // it, so the bound is asserted only after the widest thing the hero renders
  // — its `h1` — has laid out at something like the viewport's width.
  test('no horizontal scroll on mobile', async ({ page }) => {
    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toBeVisible()
    await expect(heading).toContainText(/how-to videos/i)
    expect((await heading.boundingBox())!.width).toBeGreaterThan(200)

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
  })

  test('tool cards stack on mobile', async ({ page }) => {
    const craftButton = page.getByRole('button', { name: 'Use ESCAPECRAFT' })
    const artistButton = page.getByRole('button', { name: 'Use ESCAPEARTIST' })

    const craftBox = await craftButton.boundingBox()
    const artistBox = await artistButton.boundingBox()

    expect(craftBox).not.toBeNull()
    expect(artistBox).not.toBeNull()

    if (craftBox && artistBox) {
      // Stacked: the second card sits below the first
      expect(artistBox.y).toBeGreaterThan(craftBox.y)
    }
  })
})

test.describe('ESCAPEPLAN Tablet Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto('http://localhost:5173')
    await waitForAppReady(page, 'plan')
  })

  // ESCSUITE-213: the mobile case's twin, and vacuous for the same reason.
  test('landing page renders on tablet', async ({ page }) => {
    await expect(
      page
        .getByRole('navigation', { name: /main navigation/i })
        .getByRole('link', { name: 'GitHub' })
    ).toBeVisible()

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/how-to videos/i)

    await expect(page.getByRole('link', { name: 'Download ESCAPECRAFT' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Download ESCAPEARTIST' })).toBeVisible()

    await expect(page.getByRole('link', { name: /privacy policy/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /terms of service/i })).toBeVisible()
  })

  // ESCSUITE-198/202 K-8: this used to be `test.skip` under a stale "skipped
  // in CI due to rendering timing issues" comment — ESCSUITE-177's
  // `waitForAppReady` (React's first commit, not `networkidle`) already
  // fixed the timing hazard the comment blamed. `Layout.tsx` always renders
  // a real `<header>` with a real `<nav>` inside it, so both are asserted
  // directly rather than the weaker "one or the other" `isVisible` guard.
  test('navigation adapts to tablet', async ({ page }) => {
    await expect(page.locator('header')).toBeVisible()
    await expect(page.locator('nav')).toBeVisible()
  })

  test('tool cards adapt layout', async ({ page }) => {
    const toolCards = page.locator('[class*="toolCard"]')
    expect(await toolCards.count()).toBe(2)
  })
})

test.describe('ESCAPEPLAN Desktop Layout', () => {
  test('tool cards sit side by side on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('http://localhost:5173')
    await waitForAppReady(page, 'plan')

    const craftBox = await page
      .getByRole('button', { name: 'Use ESCAPECRAFT' })
      .boundingBox()
    const artistBox = await page
      .getByRole('button', { name: 'Use ESCAPEARTIST' })
      .boundingBox()

    expect(craftBox).not.toBeNull()
    expect(artistBox).not.toBeNull()

    // Side by side: the second card sits to the right of the first, on one row
    expect(artistBox!.x).toBeGreaterThan(craftBox!.x)
    expect(artistBox!.y).toBe(craftBox!.y)
  })
})
