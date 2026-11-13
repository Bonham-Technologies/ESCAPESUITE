import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, makeToneWav } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'
import { timelineClips } from '../../utils/timeline'
import { runAxeCheck } from '../../utils/accessibility'
import { STUB_WORDS, installSpeechStub, stubRecord, transcribeButton } from '../../utils/speechStub'

/**
 * ESCSUITE-442: transcribing twice stacked a second copy of every caption.
 * `addCaptionCues` only ever appended, and "Transcribe to captions" never
 * looked at the Captions track, so the second run's cues sat on top of the
 * first's and were drawn and burned into the export together.
 *
 * Now a press with captions already on the track asks "Replace the existing
 * captions, or add to them?" in the editor's own dialog, with Cancel.
 *
 * The recogniser is the stub in `utils/speechStub.ts`, which also presents a
 * Google Chrome brand: the headless shell's real `available()` kills the
 * renderer, and the control is hidden in a bare Chromium embedder.
 */

const CLIP_SECONDS = 8
const DONE = 'Transcribed 2 captions onto the Captions track.'
const QUESTION = 'Replace the existing captions, or add to them?'

async function openWithTone(page: Page): Promise<void> {
  await installSpeechStub(page, { api: 'local', answer: 'available' })
  await page.goto(ARTIST_URL)
  await waitForAppReady(page, 'artist')
  await importMediaAndAddToTimeline(page, { name: 'speech.wav', mimeType: 'audio/wav', buffer: makeToneWav(CLIP_SECONDS) })
  await expect(timelineClips(page)).toHaveCount(1)
}

/** Press Transcribe and wait for the run to land its two cues. */
async function transcribeOnce(page: Page): Promise<void> {
  await transcribeButton(page).click()
  await expect(page.getByText(DONE)).toBeVisible({ timeout: 30_000 })
}

/** The two stub cues, each exactly once, beside the tone. */
async function expectOneSetOfCues(page: Page): Promise<void> {
  await expect(timelineClips(page)).toHaveCount(1 + STUB_WORDS.length)
  for (const words of STUB_WORDS) await expect(timelineClips(page).filter({ hasText: words })).toHaveCount(1)
}

test.describe('ESCSUITE-442: transcribing again asks before stacking captions', () => {
  test.describe.configure({ timeout: 90_000 })

  test('Replace swaps the captions for the new run, leaving one set', async ({ page }) => {
    await openWithTone(page)
    await transcribeOnce(page)
    await expectOneSetOfCues(page)
    // The first run's notice goes, so the second one can be waited for.
    await expect(page.getByText(DONE)).toHaveCount(0, { timeout: 15_000 })

    await transcribeButton(page).click()
    const dialog = page.getByRole('dialog', { name: QUESTION })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    const results = await runAxeCheck(page, { includeSelector: '[role="dialog"]' })
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])

    await dialog.getByRole('button', { name: 'Replace' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText(DONE)).toBeVisible({ timeout: 30_000 })
    await expectOneSetOfCues(page)
    expect((await stubRecord(page)).constructed).toBe(2)
  })

  test('Cancel and Escape leave the captions alone and listen to nothing', async ({ page }) => {
    await openWithTone(page)
    await transcribeOnce(page)
    const before = await stubRecord(page)

    await transcribeButton(page).click()
    const dialog = page.getByRole('dialog', { name: QUESTION })
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(transcribeButton(page)).toBeFocused()

    await transcribeButton(page).click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    await page.waitForTimeout(500)
    await expectOneSetOfCues(page)
    const after = await stubRecord(page)
    expect(after.constructed).toBe(before.constructed)
    expect(after.available).toEqual(before.available)
  })
})
