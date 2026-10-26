import { existsSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, openExportAdvancedOptions, openExportDialog } from '../../utils/artist'
import { describeAvSync, readAvSync } from '../../utils/avSync'
import { resolveCapturePath, type CapturePath } from '../../utils/capturePath'
import { CAPTURE_SIZE, CRAFT_URL } from '../../utils/craftPerf'
import { grantMediaPermissions, mockSyntheticMedia } from '../../utils/media-mocks'
import { waitForAppReady } from '../../utils/ready'
import { canConvertToMp4, canEncodeAac } from '../../utils/webcodecs'

/**
 * ESCSUITE-368 (user-reported): CRAFT audio drifted from its picture in
 * proportion to the take's length — about 3 s over 5 minutes. That was
 * ESCSUITE-296: the WebCodecs recorder stamped video on `performance.now()`
 * and audio on the samples its ScriptProcessor callbacks delivered, so every
 * callback a busy main thread never received took 85 ms out of the sound
 * (−143 ms/min under CPU ×4 before the fix, PR #846; ESCSUITE-299 then moved
 * capture to an AudioWorklet). This pins it end to end on both recorder paths
 * and through an ESCAPEARTIST export.
 *
 * Each take is {@link TAKE_SECONDS} against `mockSyntheticMedia(..., { markers:
 * true })` — a beep and a timecoded picture every 10 s on one wall-clock
 * schedule — and each file is read in the browser by `utils/avSync.ts`
 * (decodeAudioData for the beeps, Mediabunny for the frames' timecodes). The
 * sound's offset from its picture at the last beep must be within
 * {@link MAX_DRIFT_MS} of its offset at the first.
 *
 * - **screen + mic → WebCodecs / AudioWorklet**, under CDP CPU ×4: the load
 *   that broke ESCSUITE-296's recorder.
 * - **screen + webcam, composited PiP → MediaRecorder**: the path a user with a
 *   camera on records through.
 * - **That PiP take exported by ESCAPEARTIST** as WebM, and as MP4 where the
 *   browser has H.264 and AAC encoders (the bundled Chromium has neither, so
 *   CI exports WebM only). The export decodes the source the same way the
 *   measurement does (`core/audioMixer.ts`, samples laid end to end).
 *
 * MediaRecorder's Opus track has PTS gaps and overlaps. They are read as
 * jitter: the measurement lays the decoded samples end to end and never
 * treats a gap as silence. Where the gaps do not cancel (what is left is in the
 * failure message as "audio timestamps hold N ms more than its samples"), the
 * file plays in sync in a player that honours the timestamps but this reading,
 * and an ESCAPEARTIST export of it, moves by about that much.
 *
 * Chromium only: CDP throttling and the WebCodecs recorder.
 *
 * **Nightly, not per PR.** Each take case is ~2.5 min; the export case ~12 min
 * on a busy 4-core box, since ESCAPEARTIST decodes a WebM source through its
 * `<video>` path (the decode worker is MP4-only) — ~17 min together, against
 * a ~14 min `e2e` job. So the cases are tagged
 * `@nightly` and skip themselves unless `E2E_NIGHTLY=1`, for the nightly run
 * (ESCSUITE-353) to pick up:
 *
 *     E2E_NIGHTLY=1 pnpm --filter=@escapesuite/e2e exec playwright test --grep @nightly --project=chromium-strict
 */

const TAKE_SECONDS = 120
const MAX_DRIFT_MS = 50
/** A 120 s take holds 12 beeps; one at either end may fall outside the recorded window. */
const MIN_BEEPS = Math.floor(TAKE_SECONDS / 10) - 1
/** Generous ceilings for one take's setup, save, download and measurement around its {@link TAKE_SECONDS}. */
const TAKE_TIMEOUT_MS = (TAKE_SECONDS + 240) * 1000
/**
 * ESCAPEARTIST decodes a WebM source through its `<video>` path (the decode
 * worker is MP4-only), a seek per output frame: 2–5× the timeline's length in
 * a headless browser.
 */
const EXPORT_TIMEOUT_MS = TAKE_SECONDS * 6 * 1000

/** Where the PiP case leaves its take for the export case. */
function pipTakePath(outputDir: string): string {
  return path.join(outputDir, 'ESCSUITE-368-pip-take.webm')
}

interface Take {
  webcam: boolean
  cpuThrottle?: number
  capturePath: CapturePath
}

/** Record one take through the UI and save the app's own WebM download of it to `file`. */
async function recordTake(page: Page, take: Take, file: string): Promise<void> {
  const consoleLines: string[] = []
  page.on('console', (message) => consoleLines.push(message.text()))

  await mockSyntheticMedia(page, { ...CAPTURE_SIZE, markers: true })
  await grantMediaPermissions(page)
  await page.goto(CRAFT_URL)
  await waitForAppReady(page, 'craft')

  const source = (label: string) => page.getByRole('button', { name: label, exact: true })
  for (const label of ['Screen', 'Microphone']) {
    await expect(source(label)).toBeEnabled({ timeout: 30_000 })
    await expect(source(label)).toHaveAttribute('aria-pressed', 'true')
  }
  if (take.webcam) {
    await expect(source('Webcam')).toBeEnabled({ timeout: 30_000 })
    await source('Webcam').click()
    await expect(source('Webcam')).toHaveAttribute('aria-pressed', 'true')
  }

  const cdp = take.cpuThrottle ? await page.context().newCDPSession(page) : null
  await cdp?.send('Emulation.setCPUThrottlingRate', { rate: take.cpuThrottle! })
  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({ timeout: 60_000 })
  // The take's length: what the drift is measured over.
  await page.waitForTimeout(TAKE_SECONDS * 1000)
  await page.getByRole('button', { name: 'Stop recording' }).click()
  await expect(page.getByRole('button', { name: /Open .+ in Editor/ })).toHaveCount(1, { timeout: 180_000 })
  await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 })

  // Tripwire: the take went through the recorder this case is about.
  const recorder = take.capturePath === 'media-recorder' ? 'mediarecorder' : 'webcodecs'
  expect(resolveCapturePath(consoleLines, recorder), 'the audio capture path the take used').toBe(take.capturePath)

  const download = page.waitForEvent('download', { timeout: 60_000 })
  await page.getByRole('button', { name: /^Download (?!.+ as ).+$/ }).click()
  await (await download).saveAs(file)
}

/** Measure `file` and assert its sound stayed with its picture from the first beep to the last. */
async function expectInSync(page: Page, file: string, label: string): Promise<void> {
  const reading = await readAvSync(page.context(), file)
  const summary = `${label}: ${describeAvSync(reading)}`
  console.log(summary)
  test.info().annotations.push({ type: 'av-sync', description: summary })
  expect(reading.offsets.length, `beeps read with a timecoded picture — ${summary}`).toBeGreaterThanOrEqual(MIN_BEEPS)
  expect(Math.abs(reading.driftMs), `last beep's offset minus the first's — ${summary}`).toBeLessThan(MAX_DRIFT_MS)
}

/** Export the ESCAPEARTIST timeline at project resolution and save it to `file`. */
async function exportTimeline(page: Page, format: 'webm' | 'mp4', file: string): Promise<void> {
  await openExportDialog(page)
  await openExportAdvancedOptions(page)
  await page.getByRole('radio', { name: format === 'mp4' ? /MP4/ : /WebM/ }).check()
  await page.locator('select').filter({ has: page.locator('option[value="480p"]') }).selectOption('project')
  const download = page.waitForEvent('download', { timeout: EXPORT_TIMEOUT_MS })
  // The Advanced panel's button sits after the primary "Download WebM" in the DOM.
  await page.getByRole('button', { name: format === 'mp4' ? 'Download MP4' : 'Download WebM' }).last().click()
  await (await download).saveAs(file)
  await page.keyboard.press('Escape')
}

const NIGHTLY = process.env.E2E_NIGHTLY === '1'

test.describe('ESCSUITE-368: a long CRAFT take keeps its sound with its picture', { tag: '@nightly' }, () => {
  test.skip(!NIGHTLY, 'Nightly only (ESCSUITE-353): set E2E_NIGHTLY=1')
  // One worker, in order: the export case reads the composited case's take.
  // Not serial — a failed take must not hide the other recorder's result.
  test.describe.configure({ mode: 'default' })
  test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium only: CDP throttling and the WebCodecs recorder')

  test('screen + mic (WebCodecs, AudioWorklet) under CPU ×4', async ({ page }) => {
    test.setTimeout(TAKE_TIMEOUT_MS)
    const file = test.info().outputPath('webcodecs-take.webm')
    await recordTake(page, { webcam: false, cpuThrottle: 4, capturePath: 'worklet' }, file)
    await expectInSync(page, file, 'WebCodecs take')
  })

  test('screen + webcam composited (MediaRecorder)', async ({ page }) => {
    test.setTimeout(TAKE_TIMEOUT_MS)
    const file = pipTakePath(test.info().project.outputDir)
    await recordTake(page, { webcam: true, capturePath: 'media-recorder' }, file)
    await expectInSync(page, file, 'PiP take')
  })

  test('the composited take exported by ESCAPEARTIST', async ({ page }) => {
    test.setTimeout(EXPORT_TIMEOUT_MS * 2 + 120_000)
    const source = pipTakePath(test.info().project.outputDir)
    expect(existsSync(source), 'the composited case left its take behind').toBe(true)

    await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
    await waitForAppReady(page, 'artist')
    // The take is 1280x720: at the 720p preset it fills the frame at native
    // size, so the timecode strip is where the measurement reads it.
    await page.locator('#resolution-select').selectOption('720p')
    const confirm = page.getByTestId('resolution-change-confirm')
    if (await confirm.isVisible()) await confirm.getByRole('button', { name: 'Change Resolution' }).click()
    await expect(page.locator('#resolution-select')).toHaveValue('720p')
    await importMediaAndAddToTimeline(page, source)

    const formats: ('webm' | 'mp4')[] = ['webm']
    if ((await canConvertToMp4(page)) && (await canEncodeAac(page))) formats.push('mp4')
    else test.info().annotations.push({ type: 'skipped-format', description: 'MP4: no H.264 or no AAC encoder in this browser' })

    for (const format of formats) {
      const file = test.info().outputPath(`artist-export.${format}`)
      await exportTimeline(page, format, file)
      await expectInSync(page, file, `ESCAPEARTIST ${format.toUpperCase()} export`)
    }
  })
})
