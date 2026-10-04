import { test, expect } from '@playwright/test'
import { mockGetUserMedia, mockMediaRecorder, grantMediaPermissions } from '../../utils/media-mocks'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-207: `mockGetUserMedia` used to hand back an inert object literal
 * shaped like a `MediaStream` (`getTracks()` etc. all returning `[]`), not a
 * real one. The instant the preview tried `previewRef.current.srcObject =
 * previewStream` (`useMediaStreams.ts`), that threw `TypeError: Failed to
 * set the 'srcObject' property on 'HTMLMediaElement': The provided value is
 * not of type '(MediaSourceHandle or MediaStream)'` — synchronously, inside
 * a passive effect, uncaught (no error boundary above it) — and
 * `WebCodecsRecorder` separately failed the take with "No video track
 * available for recording". Every existing consumer of this mock tolerates
 * both failures silently (none reads `getTracks()`, and the ones that click
 * "Start recording" all use `mockSyntheticMedia` instead), which is how the
 * gap went unnoticed; this is the one direct pin of the fix.
 */
test.describe('mockGetUserMedia hands back a real MediaStream', () => {
  test('recording actually starts, with no uncaught page error', async ({ page }) => {
    await mockGetUserMedia(page)
    await mockMediaRecorder(page)
    await grantMediaPermissions(page)

    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(String(err)))

    await page.goto('http://localhost:5174')
    await waitForAppReady(page, 'craft')

    const screenSource = page
      .locator('[class*="sourceToggle"]')
      .filter({ hasText: 'Screen' })
      .last()
    await expect(screenSource.getByRole('button')).toBeEnabled({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Start recording' }).click()
    await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({
      timeout: 30_000,
    })

    expect(pageErrors).toEqual([])
  })
})
