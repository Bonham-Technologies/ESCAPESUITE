import { test, expect, type Locator, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, makeToneWav } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-463: every opening of Remove silences shows its fields at the
 * defaults, beside the list of pauses the inspector found with them. Before
 * #1098, `SilenceDialog` kept the values typed in a cancelled session in its
 * own state, so had it stayed mounted they would have shown on the next
 * opening beside a list found with the defaults; #1098 makes every opening
 * start over on its own.
 *
 * Limit: in today's editor this spec does not catch a revert of #1098. App
 * mounts the dialog only while a review is open, so Cancel unmounts it and
 * the fields reset anyway. The spec guards the whole open, change, Cancel,
 * reopen flow instead. With the dialog mounted for good and #1098 undone it
 * fails in Chromium, Firefox and WebKit (the threshold reads -30 on reopening).
 *
 * The clip is a synthesised WAV, imported through the media library, so the
 * spec runs in every browser: tone, a 1 s pause at 2–3 s, tone, a 0.4 s pause
 * at 4–4.4 s, tone. With the defaults (-40 dBFS, 0.7 s, 0.1 s padding) only the
 * long pause is listed, cut from 2.1 s to 2.9 s; with a 0.3 s minimum gap the
 * short one is listed too.
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

const field = (dialog: Locator, label: string) => dialog.getByLabel(label, { exact: true })

/**
 * Select the clip by clicking it `atSeconds` into its length, and press Find
 * silences in the inspector. A click on a clip also moves the playhead there,
 * so each opening clicks at a different time: the playhead line drawn over
 * the last spot would take the click.
 */
async function findSilences(page: Page, atSeconds: number): Promise<Locator> {
  const clip = page.locator('[data-clip-id]').first()
  const box = (await clip.boundingBox())!
  await clip.click({ position: { x: (box.width * atSeconds) / CLIP_SECONDS, y: box.height / 2 } })
  await page.getByRole('button', { name: 'Find silences' }).click()
  const dialog = page.getByRole('dialog', { name: 'Remove silences' })
  await expect(dialog).toBeVisible()
  return dialog
}

/** The dialog shows the defaults, and only the pause the defaults find. */
async function expectDefaults(dialog: Locator): Promise<void> {
  await expect(field(dialog, 'Threshold (dBFS)')).toHaveValue('-40')
  await expect(field(dialog, 'Minimum gap (s)')).toHaveValue('0.7')
  await expect(field(dialog, 'Padding (s)')).toHaveValue('0.1')
  await expect(dialog.getByRole('status')).toHaveText(/^1 pause found · 0\.80 s will be cut$/)
  const rows = dialog.getByRole('list', { name: 'Pauses to cut' }).getByRole('listitem')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText(/0:02\.10 – 0:02\.90/)
}

test.describe('ESCSUITE-463: reopening Remove silences after Cancel shows the default settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')
    await importMediaAndAddToTimeline(page, { name: 'talk.wav', mimeType: 'audio/wav', buffer: toneWithPauses() })
  })

  test('a cancelled session’s threshold and minimum gap are gone, and the list matches the defaults', async ({ page }) => {
    const first = await findSilences(page, 1)
    await expectDefaults(first)

    await test.step('change the threshold and the minimum gap: the short pause is listed too', async () => {
      await field(first, 'Threshold (dBFS)').fill('-30')
      await field(first, 'Minimum gap (s)').fill('0.3')
      await expect(first.getByRole('status')).toHaveText(/^2 pauses found/)
    })

    await first.getByRole('button', { name: 'Cancel' }).click()
    await expect(first).toBeHidden()

    await test.step('reopen: the fields read the defaults, beside the list the defaults find', async () => {
      await expectDefaults(await findSilences(page, 5))
    })
  })
})
