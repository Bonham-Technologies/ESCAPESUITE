import { test, expect, type Locator, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, makeToneWav } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-487: Remove silences' Minimum gap has a floor of 0.1 s. Peaks are
 * 10 ms each, so a gap of 0 s matched every quiet 10 ms bucket: on a long
 * recording the dialog listed thousands of tiny pauses (three buttons each)
 * and Remove all shredded the clip in one step. Before the fix 0 was a valid
 * value and found the pauses again with it.
 *
 * Now 0 is marked invalid with the dialog's usual hint ("Enter a number from
 * 0.1 to 60."), the list stays as the valid settings found it, and Remove all
 * is disabled until every field reads, so nothing is cut with settings the
 * fields do not show.
 *
 * The clip is the synthesised WAV of ESCSUITE-463 (runs in every browser):
 * tone, a 1 s pause at 2–3 s, tone, a 0.4 s pause at 4–4.4 s, tone. With the
 * defaults only the long pause is listed; any minimum gap of 0.3 s or less
 * lists the short one too.
 */

const SAMPLE_RATE = 8000
const CLIP_SECONDS = 6
const PAUSES = [
  { start: 2, end: 3 },
  { start: 4, end: 4.4 },
]

/** The clip: a 440 Hz tone with digital silence over each of {@link PAUSES}. */
function toneWithPauses(): Buffer {
  const wav = makeToneWav(CLIP_SECONDS, SAMPLE_RATE)
  const byteAt = (seconds: number) => 44 + Math.round(seconds * SAMPLE_RATE) * 2
  for (const pause of PAUSES) wav.fill(0, byteAt(pause.start), byteAt(pause.end))
  return wav
}

/** Select the clip and press Find silences in the inspector. */
async function findSilences(page: Page): Promise<Locator> {
  const clip = page.locator('[data-clip-id]').first()
  const box = (await clip.boundingBox())!
  await clip.click({ position: { x: box.width / CLIP_SECONDS, y: box.height / 2 } })
  await page.getByRole('button', { name: 'Find silences' }).click()
  const dialog = page.getByRole('dialog', { name: 'Remove silences' })
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('ESCSUITE-487: Remove silences refuses a minimum gap under 0.1 s', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')
    await importMediaAndAddToTimeline(page, { name: 'talk.wav', mimeType: 'audio/wav', buffer: toneWithPauses() })
  })

  test('0 is marked invalid with the hint, nothing is found with it, and Remove all is disabled', async ({ page }) => {
    const dialog = await findSilences(page)
    const minGap = dialog.getByLabel('Minimum gap (s)', { exact: true })
    const status = dialog.getByRole('status')
    const removeAll = dialog.getByRole('button', { name: 'Remove all' })
    await expect(status).toHaveText(/^1 pause found · 0\.80 s will be cut$/)
    await expect(removeAll).toBeEnabled()

    await test.step('type 0: the field is invalid and says what it takes', async () => {
      await minGap.fill('0')
      await expect(minGap).toHaveAttribute('aria-invalid', 'true')
      await expect(dialog.getByText('Enter a number from 0.1 to 60.')).toBeVisible()
    })

    await test.step('the list is not found again with 0, and Remove all cannot run', async () => {
      await expect(status).toHaveText(/^1 pause found · 0\.80 s will be cut$/)
      await expect(dialog.getByRole('list', { name: 'Pauses to cut' }).getByRole('listitem')).toHaveCount(1)
      await expect(removeAll).toBeDisabled()
    })

    await test.step('the floor itself is accepted: 0.1 finds the short pause too and Remove all is back', async () => {
      await minGap.fill('0.1')
      await expect(minGap).not.toHaveAttribute('aria-invalid')
      await expect(status).toHaveText(/^2 pauses found/)
      await expect(removeAll).toBeEnabled()
    })
  })
})
