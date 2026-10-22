import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline } from '../../utils/artist'
import {
  AV_FIXTURE_MP4,
  AV_FIXTURE_SILENCE,
  AV_FIXTURE_TIMING,
  AV_FIXTURE_WEBM,
  expectPreviewAlive,
  expectWaveformDrawn,
  installMediaHealthProbe,
  waveformCanvas,
} from '../../utils/mediaHealth'
import { waitForAppReady } from '../../utils/ready'
import {
  analyseAudio,
  clipFromLeft,
  clipSpans,
  deleteClip,
  dragClipBy,
  exportWebM,
  levelBetween,
  longestSilence,
  pixelsPerSecond,
  playheadSeconds,
  razorSplit,
  reopenProject,
  saveProject,
  timelineClips,
  type ClipSpan,
} from '../../utils/timeline'

/**
 * Journey: cut the pause out of a recording (ESCSUITE-351).
 *
 * "Remove the pauses" is the edit users name, so it is walked here the way
 * they do it: razor the recording at both ends of a pause, delete the pause,
 * drag the rest left to close the gap. Then save, reopen and export, and
 * check what a user would hear. The export's audio has to be the original
 * minus the pause, with no silence left at the join and tone on both sides of
 * it. A cut that trims the picture but not the sound, or that loses audio when
 * a clip moves, fails here even when an export file appears.
 *
 * The source is the A/V fixture (tone 0–2 s, silence 2–3 s, tone 3–5 s), as
 * WebM and as its MP4 twin.
 *
 * Chromium only: export goes through WebCodecs.
 */

/** One video frame at the fixture's 30 fps: the export's duration tolerance. */
const FRAME = 1 / 30

/** The timeline after the edit: two clips, butted together. */
async function expectCutTimeline(page: Page, pxPerSec: number): Promise<ClipSpan[]> {
  await expect(timelineClips(page)).toHaveCount(2)
  await expect(page.getByText(/^2 clips · 1 track$/)).toBeVisible()
  const spans = await clipSpans(page, pxPerSec)
  expect(spans[0].start).toBeCloseTo(0, 1)
  expect(Math.abs(spans[1].start - spans[0].end), 'a gap or overlap is left at the join').toBeLessThan(FRAME)
  return spans
}

/**
 * Both clips draw their waveform, and the preview plays across the join with
 * sound: playback from the start has to carry the playhead past `join`, and
 * the preview has to still be alive there. Watched only after the join, so a
 * first clip that played fine cannot stand in for a second that froze.
 */
async function expectCutPlaysThroughJoin(page: Page, join: number): Promise<void> {
  for (const clip of await timelineClips(page).all()) {
    await expectWaveformDrawn(waveformCanvas(page, clip))
  }
  await page.getByTitle('Go to start (Home)').click()
  await page.getByTitle('Play (Space)').click()
  // Polled tightly: the clip after the join is only ~2 s long, and the watch
  // below has to finish inside it, before playback reaches the end.
  await expect
    .poll(() => playheadSeconds(page), {
      message: 'playback stalled before the join',
      timeout: 10_000,
      intervals: [50],
    })
    .toBeGreaterThan(join + 0.1)
  await expectPreviewAlive(page, { forMs: 800 })
  // Playback may have reached the end of the 4 s timeline and stopped itself.
  const pause = page.getByTitle('Pause (Space)')
  if (await pause.isVisible()) await pause.click()
}

test.describe('Journey: cut the pauses out of a recording', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Export goes through WebCodecs, which only Chromium-based browsers implement'
  )

  for (const [label, fixture] of [
    ['WebM', AV_FIXTURE_WEBM],
    ['MP4', AV_FIXTURE_MP4],
  ] as const) {
    test(`split, delete the pause, close the gap, save, reopen, export (${label} source)`, async ({
      page,
      browser,
    }) => {
      test.setTimeout(120_000)
      const { duration, silence } = AV_FIXTURE_TIMING
      let pxPerSec = 0
      let cut = 0
      let firstClip = 0

      await test.step('import the recording and put it on the timeline', async () => {
        await installMediaHealthProbe(page)
        await page.goto(ARTIST_URL)
        await waitForAppReady(page, 'artist')
        await importMediaAndAddToTimeline(page, fixture)
        // Zoomed in, so one pixel is ~5 ms and a razor click lands well inside a frame.
        for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Zoom in timeline' }).click()
        pxPerSec = await pixelsPerSecond(timelineClips(page).first(), duration)
        await expectWaveformDrawn(waveformCanvas(page), { silence: AV_FIXTURE_SILENCE })
      })

      await test.step('razor at both ends of the pause', async () => {
        const recording = timelineClips(page).first()
        await razorSplit(page, recording, silence.start, pxPerSec)
        await expect(timelineClips(page)).toHaveCount(2)
        // The right-hand piece now starts at the pause.
        await razorSplit(page, await clipFromLeft(page, 1), silence.end - silence.start, pxPerSec)
        await expect(timelineClips(page)).toHaveCount(3)
        const spans = await clipSpans(page, pxPerSec)
        expect(spans[1].start).toBeCloseTo(silence.start, 1)
        expect(spans[1].end).toBeCloseTo(silence.end, 1)
        cut = spans[1].end - spans[1].start
      })

      await test.step('delete the pause and drag the rest left to close the gap', async () => {
        await deleteClip(page, await clipFromLeft(page, 1))
        await expect(timelineClips(page)).toHaveCount(2)
        await dragClipBy(page, await clipFromLeft(page, 1), -cut, pxPerSec)
        const spans = await expectCutTimeline(page, pxPerSec)
        firstClip = spans[0].end - spans[0].start
        await expectCutPlaysThroughJoin(page, spans[0].end)
      })

      const saved = await test.step('save the project', () => saveProject(page))

      await test.step('reopen it in a fresh browser and export what a user hears', async () => {
        const { page: reopened, context } = await reopenProject(browser, saved, installMediaHealthProbe)
        try {
          for (let i = 0; i < 6; i++) await reopened.getByRole('button', { name: 'Zoom in timeline' }).click()
          // Re-measured, not carried over: nothing says the reopen keeps the zoom.
          const reopenedPxPerSec = await pixelsPerSecond(await clipFromLeft(reopened, 0), firstClip)
          const spans = await expectCutTimeline(reopened, reopenedPxPerSec)
          await expectCutPlaysThroughJoin(reopened, spans[0].end)

          const audio = await analyseAudio(reopened, await exportWebM(reopened))
          const join = spans[0].end
          expect(audio.duration, 'the export is not the recording minus the pause').toBeGreaterThan(
            duration - cut - FRAME
          )
          expect(audio.duration, 'the export is not the recording minus the pause').toBeLessThan(
            duration - cut + FRAME
          )
          expect(longestSilence(audio), 'silence is left in the exported audio').toBeLessThanOrEqual(0.1)
          // The tone sits at ~0.57 RMS; silence at 0.
          expect(levelBetween(audio, join - 0.2, join - 0.05), 'no tone before the join').toBeGreaterThan(0.2)
          expect(levelBetween(audio, join + 0.05, join + 0.2), 'no tone after the join').toBeGreaterThan(0.2)
        } finally {
          await context.close()
        }
      })
    })
  }
})
