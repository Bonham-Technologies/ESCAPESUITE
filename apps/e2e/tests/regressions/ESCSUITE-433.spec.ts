import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, makeToneWav } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'
import { timelineClips } from '../../utils/timeline'
import { installSpeechStub, stubRecord, transcribeButton } from '../../utils/speechStub'

/**
 * ESCSUITE-433: transcription mixes the timeline at 16 kHz mono, and a
 * timeline longer than the supported 3 hours is refused before anything is
 * mixed, with a notice that names the limit and suggests a section.
 *
 * Before the fix the whole timeline was mixed at 48 kHz stereo first: past
 * 3 hours that allocation throws, and the user saw only "Could not transcribe
 * the timeline."
 *
 * The timeline is made 4 hours long by a second copy of a short tone clip
 * placed at 4:00:00, through the integration API's `GET_STATE` and
 * `LOAD_PROJECT`, posted from the page to itself (see `decode-worker.spec.ts`).
 * The recogniser is the stub in `utils/speechStub.ts`.
 */

const TOO_LONG = 'Cannot transcribe more than 3 hours at once. Save a copy of the project, cut it down to a section of up to 3 hours, and transcribe that.'

interface ProjectShape {
  timeline: { duration: number; clips: Array<Record<string, unknown> & { id: string; duration: number; timelinePosition: number }> }
}

/** The editor's project, through `GET_STATE`. */
function getProject(page: Page): Promise<ProjectShape> {
  return page.evaluate(
    () =>
      new Promise<ProjectShape>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('GET_STATE never answered')), 15_000)
        const onMessage = (event: Event) => {
          const detail = (event as CustomEvent).detail
          if (detail?.type !== 'STATE') return
          clearTimeout(timer)
          window.removeEventListener('videoeditor:message', onMessage)
          resolve(detail.payload.project)
        }
        window.addEventListener('videoeditor:message', onMessage)
        window.postMessage({ type: 'GET_STATE' }, '*')
      })
  )
}

test.describe('ESCSUITE-433: an over-long timeline is refused before mixing', () => {
  test.describe.configure({ timeout: 60_000 })

  test('a 4-hour timeline is refused with a notice naming the limit, and nothing listens', async ({ page }) => {
    await installSpeechStub(page, { api: 'local', answer: 'available' })
    await page.goto(ARTIST_URL)
    await waitForAppReady(page, 'artist')
    await importMediaAndAddToTimeline(page, { name: 'speech.wav', mimeType: 'audio/wav', buffer: makeToneWav(2) })
    await expect(timelineClips(page)).toHaveCount(1)

    const project = await getProject(page)
    const [clip] = project.timeline.clips
    const FOUR_HOURS = 4 * 60 * 60
    project.timeline.clips.push({ ...clip, id: `${clip.id}-late`, timelinePosition: FOUR_HOURS })
    project.timeline.duration = FOUR_HOURS + clip.duration
    await page.evaluate((payload) => window.postMessage({ type: 'LOAD_PROJECT', payload }, '*'), project)
    await expect.poll(async () => (await getProject(page)).timeline.clips.length, { timeout: 15_000 }).toBe(2)

    await transcribeButton(page).click()
    await expect(page.getByText(TOO_LONG)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Could not transcribe the timeline.')).toHaveCount(0)
    await expect(transcribeButton(page)).toBeEnabled()

    // Refused before anything was mixed or listened to.
    const record = await stubRecord(page)
    expect(record.constructed).toBe(0)
    expect(record.starts).toEqual([])
  })
})
