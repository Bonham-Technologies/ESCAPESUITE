import { test, expect } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, makeToneWav } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'
import { timelineClips } from '../../utils/timeline'
import { installSpeechStub, transcribeButton } from '../../utils/speechStub'

/**
 * ESCSUITE-432: a transcription started in one project must not add its
 * captions to whichever project is open when it finishes.
 *
 * Repro from the ticket: Transcribe on a 6 s clip, then File > New Project
 * mid-run. Before the fix, the new, empty project gained the old project's
 * captions when the sound finished playing ("1 clip · 2 tracks") and the
 * button kept reading "Stop transcribing" until then. Now replacing the
 * project stops the run at once, says so, and adds nothing.
 *
 * The recogniser is the stub in `utils/speechStub.ts` (with a vendor brand, so
 * the headless shell's real `available()` is never called).
 */

const CLIP_SECONDS = 6
const STOPPED = 'Transcription stopped. No captions were added.'

test.describe('ESCSUITE-432: transcription stops when the project is replaced', () => {
  test.describe.configure({ timeout: 60_000 })

  test('File > New Project mid-run stops the transcription and the new project stays empty', async ({ page }) => {
    await installSpeechStub(page, { api: 'local', answer: 'available' })
    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')
    await importMediaAndAddToTimeline(page, { name: 'speech.wav', mimeType: 'audio/wav', buffer: makeToneWav(CLIP_SECONDS) })
    await expect(timelineClips(page)).toHaveCount(1)

    await transcribeButton(page).click()
    await expect(page.getByText(/Transcribing on this device/)).toBeVisible({ timeout: 15_000 })
    // Let the stub hear its first words, so the run has something to add.
    await page.waitForTimeout(3_000)

    // New Project confirms before discarding unsaved clips.
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'File menu' }).click()
    await page.getByRole('menuitem', { name: /New Project/ }).click()

    // Stopped at once, not when the old sound finishes playing.
    await expect(page.getByText(STOPPED)).toBeVisible({ timeout: 2_000 })
    await expect(transcribeButton(page)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Stop transcribing' })).toHaveCount(0)

    // Well past the end of the old clip: still nothing on the new project.
    await page.waitForTimeout((CLIP_SECONDS + 2) * 1000)
    await expect(timelineClips(page)).toHaveCount(0)
    await expect(page.getByText(/Transcribed \d+ captions? onto the Captions track/)).toHaveCount(0)
    await expect(page.getByText(/^1 clip/)).toHaveCount(0)
  })
})
