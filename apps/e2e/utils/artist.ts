import { Page, expect } from '@playwright/test'

/**
 * ESCAPEARTIST test helpers.
 */

export const ARTIST_URL = 'http://localhost:5175'

/**
 * Put one clip on the ESCAPEARTIST timeline.
 *
 * "Export video" stays disabled while the timeline is empty — there is nothing
 * to encode — so any test whose subject is the export dialog has to seed a clip
 * first. A text overlay is the cheapest seed there is: no file to upload and no
 * media to decode, one click creates both the clip and the track holding it.
 */
export async function seedTextClip(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add Text' }).click()
  await expect(page.getByText(/^1 clip · 1 track$/)).toBeVisible({ timeout: 15_000 })
}

/**
 * Open the export dialog. The project must already hold a clip — see
 * {@link seedTextClip}.
 */
export async function openExportDialog(page: Page): Promise<void> {
  const exportButton = page.getByRole('button', { name: 'Export video' })
  await expect(exportButton).toBeEnabled()
  await exportButton.click()
  await expect(page.getByRole('heading', { name: 'Export Video' })).toBeVisible()
}

/**
 * Reveal the export dialog's format / quality / resolution controls, which sit
 * behind an "Advanced options" disclosure.
 */
export async function openExportAdvancedOptions(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Advanced options' }).click()
  await expect(page.getByRole('radio', { name: /WebM/ })).toBeVisible()
}
