import { test, expect } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, makeToneWav } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'
import { clipSpans, dragClipBy, pixelsPerSecond, timelineClips } from '../../utils/timeline'
import { installSpeechStub, STUB_WORDS, stubRecord, transcribeButton } from '../../utils/speechStub'

/**
 * ESCSUITE-486: a transcription edited during the run placed its captions
 * against the old timeline and said only that it had succeeded.
 *
 * "Transcribe to captions" hears the timeline as it was when the run started
 * and times its cues against that. A clip moved meanwhile (or a ripple edit,
 * or Remove silences) left every later caption out of step, under a plain
 * "Transcribed N captions onto the Captions track." Now the finishing notice
 * says the timeline changed while transcribing and that the captions follow
 * it as it was when the run started.
 *
 * The recogniser is the stub in `utils/speechStub.ts` (with a vendor brand, so
 * the headless shell's real `available()` is never called).
 */

const CLIP_SECONDS = 10
const MOVE_SECONDS = 3

test.describe('ESCSUITE-486: a timeline edited while transcribing is said so', () => {
  test.describe.configure({ timeout: 60_000 })

  test('moving a clip mid-run ends with a notice that the captions follow the timeline as it was', async ({ page, browserName }) => {
    await installSpeechStub(page, { api: 'local', answer: 'available' })
    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')
    await importMediaAndAddToTimeline(page, { name: 'speech.wav', mimeType: 'audio/wav', buffer: makeToneWav(CLIP_SECONDS) })
    await expect(timelineClips(page)).toHaveCount(1)
    const clip = timelineClips(page).first()
    const pxPerSec = await pixelsPerSecond(clip, CLIP_SECONDS)

    // As in ESCSUITE-484's spec: a browser with no audio output (headless
    // Firefox in a container without a sound device) never runs the
    // AudioContext the transcription plays the timeline through.
    const audioRuns = await page.evaluate(async () => {
      const ctx = new AudioContext()
      const resumed = await Promise.race([
        ctx.resume().then(() => ctx.state === 'running'),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3_000)),
      ])
      void ctx.close()
      return resumed
    })
    test.skip(browserName === 'firefox' && !audioRuns, 'this browser has no running AudioContext (no audio output), so a transcription never listens')
    expect(audioRuns, 'an AudioContext must run in this browser').toBe(true)

    await transcribeButton(page).click()
    await expect(page.getByText(/Transcribing on this device/)).toBeVisible({ timeout: 15_000 })
    await expect
      .poll(async () => (await stubRecord(page)).said.some((r) => r.isFinal && r.transcript === STUB_WORDS[0]), {
        timeout: 15_000,
      })
      .toBe(true)

    // Move the clip later along its track while the run is still listening.
    await dragClipBy(page, clip, MOVE_SECONDS, pxPerSec)
    const [moved] = await clipSpans(page, pxPerSec)
    expect(moved.start, 'the drag moved the clip').toBeGreaterThan(1)
    await expect(page.getByRole('button', { name: 'Stop transcribing' })).toBeVisible()

    await expect(
      page.getByText(
        /^Transcribed 2 captions onto the Captions track\. The timeline changed while transcribing; the captions follow it as it was when you started\.$/
      )
    ).toBeVisible({ timeout: 30_000 })
    await expect(timelineClips(page).filter({ hasText: STUB_WORDS[0] })).toHaveCount(1)
  })
})
