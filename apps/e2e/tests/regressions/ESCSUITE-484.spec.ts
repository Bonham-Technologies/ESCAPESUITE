import { test, expect } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, makeToneWav } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'
import { timelineClips } from '../../utils/timeline'
import { installSpeechStub, STUB_WORDS, stubRecord, transcribeButton } from '../../utils/speechStub'

/**
 * ESCSUITE-484: stopping a transcription while it listens keeps the captions
 * heard so far.
 *
 * Repro from the ticket: Transcribe on a clip, let the recogniser hear some
 * words, press Stop transcribing. Before the fix every word heard was thrown
 * away ("Transcription stopped. No captions were added.") and the Captions
 * track stayed empty, though a run can listen for up to 3 hours. Now the
 * words heard so far land on the Captions track, the notice says how many and
 * where it stopped, and one Ctrl+Z takes them off.
 *
 * The recogniser is the stub in `utils/speechStub.ts` (with a vendor brand, so
 * the headless shell's real `available()` is never called): its first words
 * are final 2.5 s into the run. The test waits on the stub's own record of
 * what it said, never on a fixed delay, so it runs alike in every engine.
 */

const CLIP_SECONDS = 20

test.describe('ESCSUITE-484: a stopped transcription keeps the captions heard so far', () => {
  test.describe.configure({ timeout: 60_000 })

  test('Stop mid-run leaves the words heard so far on the Captions track, in one undo step', async ({ page }) => {
    await installSpeechStub(page, { api: 'local', answer: 'available' })
    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')
    await importMediaAndAddToTimeline(page, { name: 'speech.wav', mimeType: 'audio/wav', buffer: makeToneWav(CLIP_SECONDS) })
    await expect(timelineClips(page)).toHaveCount(1)

    // The run plays the timeline's sound through an AudioContext. A browser
    // with no audio output (headless Firefox in a container without a sound
    // device) never lets one run, so the transcription never starts listening
    // there: nothing this ticket changed can be seen.
    const audioRuns = await page.evaluate(async () => {
      const ctx = new AudioContext()
      const resumed = await Promise.race([
        ctx.resume().then(() => ctx.state === 'running'),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3_000)),
      ])
      void ctx.close()
      return resumed
    })
    test.skip(!audioRuns, 'this browser has no running AudioContext (no audio output), so a transcription never listens')

    await transcribeButton(page).click()
    await expect(page.getByText(/Transcribing on this device/)).toBeVisible({ timeout: 15_000 })
    // Wait until the stub has settled on its first words.
    await expect
      .poll(async () => (await stubRecord(page)).said.some((r) => r.isFinal && r.transcript === STUB_WORDS[0]), {
        timeout: 15_000,
      })
      .toBe(true)

    await page.getByRole('button', { name: 'Stop transcribing' }).click()

    // Stopped at once, well before the 20 s clip ends, and says where.
    await expect(
      page.getByText(/^Transcription stopped at 0:\d\d\. Added [12] captions? heard before then to the Captions track\.$/)
    ).toBeVisible({ timeout: 2_000 })
    await expect(page.getByText('Transcription stopped. No captions were added.')).toHaveCount(0)
    await expect(transcribeButton(page)).toBeVisible()

    // The words heard so far are a caption clip on the Captions track.
    await expect(timelineClips(page).filter({ hasText: STUB_WORDS[0] })).toHaveCount(1)
    await expect(page.getByText(/^\d+ clips · 2 tracks$/)).toBeVisible()

    // One undo takes the kept captions back off, track and all.
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Control+z')
    await expect(timelineClips(page)).toHaveCount(1)
    await expect(page.getByText(/^1 clip · 1 track$/)).toBeVisible()
  })
})
