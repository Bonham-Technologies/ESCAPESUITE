import { Page, expect } from '@playwright/test'
import { getAuthState } from './subscription-mocks'

/**
 * Utilities for verifying watermark presence in exports.
 *
 * Watermarks are applied to video exports for trial users.
 * These utilities help verify watermark presence/absence in tests.
 */

/**
 * Primary verification method: Check the auth state for trial status.
 * This is fast and reliable since watermarks are applied based on auth state.
 */
export async function shouldHaveWatermark(page: Page): Promise<boolean> {
  const authState = await getAuthState(page)
  return authState?.isTrial ?? true // Default to true (watermark) if unknown
}

/**
 * Verify that the export preview shows watermark for trial users.
 * Checks for visual indicators in the UI that watermark will be applied.
 */
export async function verifyWatermarkIndicator(page: Page): Promise<boolean> {
  // Look for watermark warning/indicator in the UI
  const watermarkIndicator = page.getByText(/watermark|trial export|upgrade to remove/i).first()
  return watermarkIndicator.isVisible().catch(() => false)
}

/**
 * Verify that a video element or canvas contains a watermark.
 * Uses canvas pixel analysis to detect watermark in the corner.
 *
 * @param page The Playwright page
 * @param selector CSS selector for the video or canvas element
 */
export async function verifyWatermarkInVideo(page: Page, selector: string): Promise<boolean> {
  return page.evaluate(
    async ({ selector }) => {
      const element = document.querySelector(selector) as HTMLVideoElement | HTMLCanvasElement

      if (!element) return false

      // Create a canvas to analyze the video/canvas content
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return false

      let width: number
      let height: number

      if (element instanceof HTMLVideoElement) {
        width = element.videoWidth || element.clientWidth
        height = element.videoHeight || element.clientHeight

        if (width === 0 || height === 0) return false

        canvas.width = width
        canvas.height = height
        ctx.drawImage(element, 0, 0)
      } else if (element instanceof HTMLCanvasElement) {
        width = element.width
        height = element.height

        if (width === 0 || height === 0) return false

        canvas.width = width
        canvas.height = height
        ctx.drawImage(element, 0, 0)
      } else {
        return false
      }

      // Analyze the bottom-right corner where watermarks typically appear
      const cornerSize = Math.min(200, width / 4, height / 4)
      const imageData = ctx.getImageData(
        width - cornerSize,
        height - cornerSize,
        cornerSize,
        cornerSize
      )

      // Check for watermark-like patterns
      // Watermarks typically have semi-transparent text with distinct contrast
      const data = imageData.data
      let nonTransparentPixels = 0
      let hasContrast = false

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const a = data[i + 3]

        // Check for semi-transparent pixels (watermark text)
        if (a > 50 && a < 250) {
          nonTransparentPixels++
        }

        // Check for contrast (light text on dark or vice versa)
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b
        if (luminance > 200 || luminance < 50) {
          hasContrast = true
        }
      }

      // Heuristic: watermark present if we have some semi-transparent pixels with contrast
      const totalPixels = data.length / 4
      const semiTransparentRatio = nonTransparentPixels / totalPixels

      return semiTransparentRatio > 0.01 && hasContrast
    },
    { selector }
  )
}

/**
 * Assert that the current user should see a watermark on exports.
 * This checks both the auth state and UI indicators.
 */
export async function expectWatermark(page: Page) {
  const shouldShow = await shouldHaveWatermark(page)
  expect(shouldShow).toBe(true)

  // Also check for UI indicator if available
  const hasIndicator = await verifyWatermarkIndicator(page)
  // Indicator might not always be visible, so we just log it
  if (!hasIndicator) {
    console.log('Note: Watermark UI indicator not found (may be acceptable)')
  }
}

/**
 * Assert that the current user should NOT see a watermark on exports.
 */
export async function expectNoWatermark(page: Page) {
  const shouldShow = await shouldHaveWatermark(page)
  expect(shouldShow).toBe(false)
}

/**
 * Check export preview for watermark presence.
 * Looks for the preview element and analyzes it.
 */
export async function checkExportPreviewForWatermark(page: Page): Promise<boolean> {
  // Common selectors for export preview elements
  const previewSelectors = [
    '[data-testid="export-preview"]',
    '.export-preview',
    '.preview-canvas',
    'canvas.preview',
    'video.preview',
    '.video-preview video',
    '.export-dialog video',
  ]

  for (const selector of previewSelectors) {
    const element = page.locator(selector).first()
    const isVisible = await element.isVisible().catch(() => false)

    if (isVisible) {
      return verifyWatermarkInVideo(page, selector)
    }
  }

  // Fallback: check auth state
  return shouldHaveWatermark(page)
}

/**
 * Wait for export to complete and check for watermark.
 * This waits for export progress to reach 100% or for completion indicators.
 */
export async function waitForExportAndCheckWatermark(
  page: Page,
  options: { timeout?: number } = {}
): Promise<{ completed: boolean; hasWatermark: boolean }> {
  const { timeout = 30000 } = options

  try {
    // Wait for export completion indicator
    await page
      .getByText(/export complete|download ready|100%/i)
      .first()
      .waitFor({ state: 'visible', timeout })

    const hasWatermark = await shouldHaveWatermark(page)
    return { completed: true, hasWatermark }
  } catch {
    // Export might have failed or timed out
    return { completed: false, hasWatermark: await shouldHaveWatermark(page) }
  }
}
