import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { ARTIST_URL, makeToneWav } from '../../utils/artist'
import { analyseAudio, levelBetween } from '../../utils/timeline'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-367 (user-reported): every export of a two-hour CRAFT recording
 * failed. The export mixed the whole timeline's audio into one interleaved
 * Float32Array, 384,000 bytes a second, and Chromium refuses any single
 * buffer of 2 GiB or more, so anything past ~93 minutes threw "Array buffer
 * allocation failed" at "Extracting audio...". It mixed the whole timeline
 * even for a selected range, so a few seconds out of a long recording failed
 * the same way.
 *
 * This timeline is two hours long without two hours of media: a 2 s tone at
 * 0 s and the same tone at 7,200 s. The in and out points select the first
 * two seconds, and that section exports as WebM. On the broken build the
 * export errors out and no file is downloaded. Fixed, the file carries the
 * tone.
 *
 * The finished-file half of the bug (a muxer output over 2 GiB) needs gigabytes
 * of encoded video to reach, so it is pinned by the unit tests of
 * `core/chunkCollector.ts` instead. WebM, because the container's Chromium
 * has no AAC encoder and an MP4 export without one skips the mix entirely.
 *
 * Chromium only: export goes through WebCodecs.
 */

const TONE_SECONDS = 2
const LATE_TONE_AT = 7_200

function longProjectFile(wav: Buffer): Buffer {
  const clip = (id: string, timelinePosition: number) => ({
    id,
    sourceVideoId: 'tone',
    name: 'tone.wav',
    startTime: 0,
    endTime: TONE_SECONDS,
    duration: TONE_SECONDS,
    trackId: 'track1',
    timelinePosition,
    blendMode: 'normal',
    transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    effects: { blur: 0 },
    transition: { type: 'none', duration: 0.5 },
  })
  return Buffer.from(
    JSON.stringify({
      version: 1,
      project: {
        id: 'long-project',
        name: 'Two hours',
        created: 1700000000000,
        modified: 1700000000000,
        resolution: { width: 640, height: 360 },
        timeline: {
          tracks: [
            { id: 'track1', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 },
          ],
          clips: [clip('early', 0), clip('late', LATE_TONE_AT)],
          textOverlays: [],
          shapeOverlays: [],
          duration: LATE_TONE_AT + TONE_SECONDS,
        },
      },
      editor: { inPoint: 0, outPoint: TONE_SECONDS, markers: [] },
      videos: [{ id: 'tone', name: 'tone.wav', mimeType: 'audio/wav', data: wav.toString('base64') }],
    })
  )
}

test('a section of a two-hour timeline exports with its sound', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Export goes through WebCodecs, which only Chromium-based browsers implement')
  test.setTimeout(120_000)

  const exportErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') exportErrors.push(message.text())
  })

  await page.goto(ARTIST_URL)
  await waitForAppReady(page, 'artist')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'two-hours.veditor',
    mimeType: 'application/json',
    buffer: longProjectFile(makeToneWav(TONE_SECONDS, 48_000)),
  })
  await expect(page.getByText('Project loaded successfully')).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: 'Export video' }).click()
  const section = page.getByRole('button', { name: /^Export Section/ })
  await expect(section).toBeEnabled({ timeout: 15_000 })
  const downloadPromise = page.waitForEvent('download', { timeout: 90_000 })
  await section.click()
  const download = await downloadPromise.catch((error: unknown) => {
    throw new Error(`no file was exported; console errors: ${exportErrors.join(' | ') || 'none'} (${String(error)})`)
  })
  expect(download.suggestedFilename()).toMatch(/\.webm$/)
  const path = await download.path()
  expect(path, 'the export has no file').toBeTruthy()

  const audio = await analyseAudio(page, await readFile(path!))
  expect(audio.duration, 'the section is not two seconds long').toBeGreaterThan(TONE_SECONDS - 0.1)
  expect(audio.duration, 'the section is not two seconds long').toBeLessThan(TONE_SECONDS + 0.2)
  expect(levelBetween(audio, 0.2, 1.8), 'the section has no tone').toBeGreaterThan(0.1)
})
