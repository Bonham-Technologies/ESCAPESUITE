import { test, expect } from '@playwright/test'
import { seedTextClip } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

test.describe('ESCAPEARTIST Timeline Editing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
  })

  // ESCSUITE-202 K-3: "server responds" used to be a bare doctype/`<div
  // id="root">` check here — `video-import.spec.ts`'s own "server responds"
  // already covers that ground for this URL, and "timeline area is visible"
  // immediately below makes the same real claim this describe's name implies.

  test('timeline area is visible', async ({ page }) => {
    // The timeline's own chrome — Add Track and the zoom controls — rather
    // than a `[class*="timeline"]` substring that could match any of several
    // elements.
    await expect(page.getByRole('button', { name: 'Add new track' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Zoom in timeline' })).toBeVisible()
  })

  test('timeline shows track lanes when content exists', async ({ page }) => {
    await seedTextClip(page)
    // `data-track-id` is the real attribute `TimelineTrack.tsx` renders on
    // every lane.
    await expect(page.locator('[data-track-id]')).toHaveCount(1)
  })

  // ESCSUITE-198/202 K-8: the real "zoom controls work" case now lives in
  // `components.spec.ts` (it used to be permanently `test.skip`'d there under
  // a stale "skipped in CI" comment) — this file's own version never asserted
  // more than a bare `count >= 0`, which the unskipped test supersedes.

  test('has playhead or scrubber', async ({ page }) => {
    await expect(page.locator('[data-playhead]')).toBeVisible()
  })

  test('displays current time indicator', async ({ page }) => {
    const timecode = page.locator('[class*="timecode"]').first()
    await expect(timecode).toHaveText('00:00.000')

    await seedTextClip(page)
    await page.keyboard.press('ArrowRight')
    await expect(timecode).toHaveText('00:01.000')
  })
})

test.describe('ESCAPEARTIST Overlay Tools', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
  })

  test('has text overlay tool', async ({ page }) => {
    await page.getByRole('button', { name: 'Add Text' }).click()
    await expect(page.getByText(/^1 clip · 1 track$/)).toBeVisible()
  })

  test('has shape tools', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Rectangle' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ellipse' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Arrow' })).toBeVisible()
  })

  test('has blur tool', async ({ page }) => {
    await page.getByRole('button', { name: 'Blur' }).click()
    await expect(page.getByRole('heading', { name: 'Blur' })).toBeVisible()
  })
})

test.describe('ESCAPEARTIST Undo/Redo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5175')
    await waitForAppReady(page, 'artist')
  })

  test('has undo button', async ({ page }) => {
    // Distinct from `components.spec.ts`'s Toolbar describe: this proves the
    // shortcut actually works with focus off any input, not just that the
    // button exists and is clickable.
    await seedTextClip(page)
    await expect(page.getByText(/^1 clip/).first()).toBeVisible()

    await page.keyboard.press('Control+z')
    await expect(page.getByText(/^0 clips/)).toBeVisible()
  })

  test('has redo button', async ({ page }) => {
    await seedTextClip(page)
    await page.keyboard.press('Control+z')
    await expect(page.getByText(/^0 clips/)).toBeVisible()

    await page.keyboard.press('Control+y')
    await expect(page.getByText(/^1 clip/).first()).toBeVisible()
  })
})
