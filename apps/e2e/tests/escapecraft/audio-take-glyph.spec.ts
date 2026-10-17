import { test, expect } from '@playwright/test'
import { mockSyntheticMedia, grantMediaPermissions } from '../../utils/media-mocks'
import { waitForAppReady } from '../../utils/ready'

// ESCSUITE-319: a microphone-only take's playback dialog draws ONE centred
// glyph (the play triangle while paused, the speaker while playing), never the
// ESCSUITE-233 speaker with a play overlay stacked on it.
test('an audio-only take shows one centred glyph, paused and playing', async ({ page }) => {
  test.setTimeout(120_000)
  await mockSyntheticMedia(page, { width: 1280, height: 720 })
  await grantMediaPermissions(page)
  await page.goto('http://localhost:5174')
  await waitForAppReady(page, 'craft')
  const screen = page.getByRole('button', { name: 'Screen', exact: true })
  await expect(screen).toBeEnabled({ timeout: 30_000 })
  await screen.click()
  await expect(screen).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: 'Microphone', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(3000)
  await page.getByRole('button', { name: 'Stop recording' }).click()
  await expect(page.getByRole('button', { name: /^Play / })).toHaveCount(1, { timeout: 30_000 })
  await page.getByRole('button', { name: /^Play / }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const wrapper = dialog.locator('[class*="videoWrapper"]')
  const glyphs = () =>
    wrapper.locator('svg').evaluateAll((els) => {
      const boxes = els.map((e) => e.getBoundingClientRect())
      let overlapArea = 0
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]
          const b = boxes[j]
          const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
          const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
          overlapArea += ix * iy
        }
      }
      return { count: els.length, overlapArea }
    })

  const placeholder = dialog.getByTestId('audio-placeholder')
  await expect(placeholder).toHaveAttribute('data-glyph', 'play')
  expect(await glyphs()).toEqual({ count: 1, overlapArea: 0 })

  await placeholder.click()
  await expect(placeholder).toHaveAttribute('data-glyph', 'speaker')
  expect(await glyphs()).toEqual({ count: 1, overlapArea: 0 })
})
