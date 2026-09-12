import { Frame, Page, expect } from '@playwright/test'

/**
 * ESCAPEARTIST test helpers.
 *
 * Every helper takes a `Page` or a `Frame`: ESCAPEARTIST is also driven inside
 * an iframe (see tests/integration/host-embedding.spec.ts), and the locator
 * calls below are identical on both, so one signature covers both callers.
 */
type ArtistScope = Page | Frame

export const ARTIST_URL = 'http://localhost:5175'

/**
 * Put one clip on the ESCAPEARTIST timeline.
 *
 * "Export video" stays disabled while the timeline is empty — there is nothing
 * to encode — so any test whose subject is the export dialog has to seed a clip
 * first. A text overlay is the cheapest seed there is: no file to upload and no
 * media to decode, one click creates both the clip and the track holding it.
 */
export async function seedTextClip(page: ArtistScope): Promise<void> {
  await page.getByRole('button', { name: 'Add Text' }).click()
  await expect(page.getByText(/^1 clip · 1 track$/)).toBeVisible({ timeout: 15_000 })
}

/**
 * Open the export dialog. The project must already hold a clip — see
 * {@link seedTextClip}.
 *
 * Idempotent: calling it on an already-open dialog leaves it open rather than
 * clicking "Export video" a second time. Callers that export more than once in
 * a row (the perf benchmarks) would otherwise have to track dialog state
 * themselves.
 */
export async function openExportDialog(page: ArtistScope): Promise<void> {
  const heading = page.getByRole('heading', { name: 'Export Video' })
  if (!(await heading.isVisible())) {
    const exportButton = page.getByRole('button', { name: 'Export video' })
    await expect(exportButton).toBeEnabled()
    await exportButton.click()
  }
  await expect(heading).toBeVisible()
}

/**
 * Reveal the export dialog's format / quality / resolution controls, which sit
 * behind an "Advanced options" disclosure.
 *
 * Idempotent, and for a sharper reason than tidiness: the dialog stays mounted
 * when it closes, so its disclosure state survives into the next open. A blind
 * click would then *collapse* the controls the caller asked to see. The
 * disclosure publishes `aria-expanded`, so ask it.
 */
export async function openExportAdvancedOptions(page: ArtistScope): Promise<void> {
  const disclosure = page.getByRole('button', { name: 'Advanced options' })
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') {
    await disclosure.click()
  }
  await expect(page.getByRole('radio', { name: /WebM/ })).toBeVisible()
}
