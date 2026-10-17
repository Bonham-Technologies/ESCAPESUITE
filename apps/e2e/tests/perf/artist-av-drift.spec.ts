import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import {
  ARTIST_URL,
  importMediaAndAddToTimeline,
  openExportAdvancedOptions,
  openExportDialog,
} from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

/**
 * A/V drift rig, ESCAPEARTIST arm (ESCSUITE-297, hypothesis H4 for the editor).
 *
 * Every raw WebM ESCAPECRAFT's MediaRecorder path stores (composited PiP,
 * microphone alone) carries ~750 audio PTS gaps totalling ~2 s per 180 s. The
 * ESCAPECRAFT arm (`craft-av-drift.spec.ts`) showed CRAFT's own MP4 / M4A
 * conversions keep those gaps as silence. This arm asks the same of
 * ESCAPEARTIST's export: `core/audioMixer.ts` decodes each source with
 * `OfflineAudioContext.decodeAudioData` and places it by sample index, so a
 * decoder that concatenated packets across the gaps would make the exported
 * audio lead its picture by the sum of the gaps so far (~−700 ms/min); one
 * that renders the gaps as silence leaves the export as flat as its source.
 *
 * Not a benchmark and not a regression test: a measurement, read afterwards
 * by `scripts/av-drift-report.mjs`. Its only `expect`s are tripwires that the
 * export it measured is the one it meant to (the import landed one clip of
 * the source's length at the source's size, each export is that long within a
 * frame).
 *
 * Opt-in like the ESCAPECRAFT arm: only under `playwright.av-drift.config.ts`,
 * and only with `AV_DRIFT=1` **and** `AV_DRIFT_SOURCE` set (which in turn
 * makes the ESCAPECRAFT arm skip itself, so one invocation never starts a
 * three-minute take as well):
 *
 * | Variable | Values | Default |
 * |---|---|---|
 * | `AV_DRIFT_SOURCE` | path to a raw WebM an ESCAPECRAFT arm downloaded (its `measurement.json`, if beside it, supplies the marker schedule) | required |
 * | `AV_DRIFT_EXPORT` | `webm`, `mp4` | every format the browser can export with sound: WebM and MP4 in Chromium, WebM alone in Firefox (no AAC encoder, so its MP4 would be silent) |
 *
 *     AV_DRIFT=1 AV_DRIFT_SOURCE=/abs/path/recording_….webm \
 *       pnpm --filter @escapesuite/e2e run test:av-drift artist-av-drift --project=chromium
 *
 * The source is imported at 1280x720 (the project resolution is set to the
 * 720p preset first, so the clip fills the frame at native size) and exported
 * at the project resolution, so the per-frame timecode strip and the flashes
 * sit exactly where the report's readers look for them in the ESCAPECRAFT
 * files.
 *
 * Output, in `apps/e2e/av-drift-results/artist-<browser>[-<format>]/` (emptied
 * first; the format suffix only when `AV_DRIFT_EXPORT` is set):
 * the source copied in as `raw`, each export as `artist-webm` / `artist-mp4`,
 * and a `measurement.json` the report reads like an ESCAPECRAFT arm's.
 */

const ENABLED = process.env.AV_DRIFT === '1' && !!process.env.AV_DRIFT_SOURCE
const SOURCE = process.env.AV_DRIFT_SOURCE ? path.resolve(process.env.AV_DRIFT_SOURCE) : ''
const ONLY = process.env.AV_DRIFT_EXPORT
if (ONLY !== undefined && ONLY !== 'webm' && ONLY !== 'mp4') {
  throw new Error(`AV_DRIFT_EXPORT=${ONLY} is not one of webm, mp4`)
}
const FFPROBE = process.env.FFPROBE ?? 'ffprobe'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RESULTS_ROOT = path.resolve(HERE, '../../av-drift-results')

/** One output frame at the exporters' 30 fps. */
const FRAME_S = 1 / 30
/**
 * The audio stream may run past the timeline by its codec's framing: AAC
 * frames are 1024 samples (21.3 ms at 48 kHz) plus priming, Opus 20 ms — the
 * first Chromium MP4 export's AAC stream ended 68.7 ms past a 182.31 s
 * timeline while its video ended 22 ms short of it.
 */
const AUDIO_FRAMING_S = 0.1
/** The size the ESCAPECRAFT synthetic devices capture at, and the report's readers expect. */
const SIZE = { width: 1280, height: 720 }

type ExportKind = 'artist-webm' | 'artist-mp4'

interface SavedFile {
  file: string
  kind: 'raw' | ExportKind
  row: string
  role: string
  browser?: string
  exportSeconds?: number
}

interface ProbedStream {
  codec_type: string
  codec_name: string
  width?: number
  height?: number
  duration?: string
}

function probe(file: string): { duration: number; streams: ProbedStream[] } {
  const result = spawnSync(
    FFPROBE,
    ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,duration', '-of', 'json', file],
    { encoding: 'utf8' }
  )
  if (result.error) throw new Error(`${FFPROBE}: ${result.error.message} (the rig needs ffprobe on PATH)`)
  const parsed = JSON.parse(result.stdout) as { format?: { duration?: string }; streams?: [] }
  return { duration: Number(parsed.format?.duration), streams: parsed.streams ?? [] }
}

interface ProjectShape {
  resolution: { width: number; height: number }
  timeline: {
    duration: number
    clips: Array<{ duration: number; timelinePosition: number; transform?: Record<string, number> }>
  }
}

/** The editor's project, through the documented `GET_STATE` integration message. */
async function getProject(page: Page): Promise<ProjectShape> {
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

async function setProjectTo720p(page: Page): Promise<void> {
  await page.locator('#resolution-select').selectOption('720p')
  const confirm = page.getByTestId('resolution-change-confirm')
  if (await confirm.isVisible()) await confirm.getByRole('button', { name: 'Change Resolution' }).click()
  await expect.poll(async () => (await getProject(page)).resolution).toEqual(SIZE)
}

async function exportOnce(page: Page, format: 'webm' | 'mp4', dir: string, timeoutMs: number): Promise<{ file: string; seconds: number }> {
  await openExportDialog(page)
  await openExportAdvancedOptions(page)
  await page.getByRole('radio', { name: format === 'mp4' ? /MP4/ : /WebM/ }).check()
  await page
    .locator('select')
    .filter({ has: page.locator('option[value="480p"]') })
    .selectOption('project')
  const started = Date.now()
  const downloadPromise = page.waitForEvent('download', { timeout: timeoutMs })
  // The Advanced panel's button sits after the primary "Download WebM" in the DOM.
  await page.getByRole('button', { name: format === 'mp4' ? 'Download MP4' : 'Download WebM' }).last().click()
  const download = await downloadPromise
  const seconds = (Date.now() - started) / 1000
  const file = `artist-${format}-${download.suggestedFilename()}`
  await download.saveAs(path.join(dir, file))
  // Let the dialog settle before the next export opens it again.
  await page.keyboard.press('Escape')
  return { file, seconds }
}

test.describe('ESCAPEARTIST A/V drift rig', () => {
  test.skip(!ENABLED, 'Opt-in: set AV_DRIFT=1 and AV_DRIFT_SOURCE, and run with --config=playwright.av-drift.config.ts')

  test(`export of ${path.basename(SOURCE) || 'a gapped take'}`, async ({ page, browserName }) => {
    test.slow()
    expect(existsSync(SOURCE), `AV_DRIFT_SOURCE ${SOURCE} does not exist`).toBe(true)

    const formats: ('webm' | 'mp4')[] = ONLY ? [ONLY as 'webm' | 'mp4'] : browserName === 'firefox' ? ['webm'] : ['webm', 'mp4']
    // One directory per browser, and per format when `AV_DRIFT_EXPORT` restricts
    // it, so a single-format rerun never wipes the other format's export.
    const dir = path.join(RESULTS_ROOT, `artist-${browserName}${ONLY ? `-${ONLY}` : ''}`)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })

    // The source, copied in as this arm's raw file so the report reads it beside the exports.
    const rawName = `source-${path.basename(SOURCE)}`
    copyFileSync(SOURCE, path.join(dir, rawName))
    const sourceProbe = probe(SOURCE)
    const sourceVideo = sourceProbe.streams.find((s) => s.codec_type === 'video')
    expect(sourceVideo, 'the source has a video stream').toBeTruthy()
    expect({ width: sourceVideo?.width, height: sourceVideo?.height }).toEqual(SIZE)
    expect(sourceProbe.streams.some((s) => s.codec_type === 'audio'), 'the source has an audio stream').toBe(true)

    // The ESCAPECRAFT arm's measurement, when beside the source: the marker schedule.
    const sourceMeasurementPath = path.join(path.dirname(SOURCE), 'measurement.json')
    const sourceMeasurement = existsSync(sourceMeasurementPath)
      ? (JSON.parse(readFileSync(sourceMeasurementPath, 'utf8')) as Record<string, unknown>)
      : null

    await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
    await waitForAppReady(page, 'artist')
    await setProjectTo720p(page)
    await importMediaAndAddToTimeline(page, SOURCE)

    // Tripwire: one clip, the source's length within a frame, filling the frame.
    const project = await getProject(page)
    expect(project.timeline.clips).toHaveLength(1)
    const [clip] = project.timeline.clips
    expect(Math.abs(clip.duration - sourceProbe.duration), `clip ${clip.duration}s vs source ${sourceProbe.duration}s`).toBeLessThanOrEqual(FRAME_S)
    expect(project.resolution).toEqual(SIZE)

    const files: SavedFile[] = [{ file: rawName, kind: 'raw', row: path.basename(SOURCE), role: 'primary' }]
    const measurement = () => ({
      arm: 'artist',
      mode: 'artist',
      load: 'idle',
      browser: browserName,
      recorder: 'artist-export',
      seconds: clip.duration,
      window: { startPerf: 0, stopPerf: clip.duration * 1000, seconds: clip.duration },
      source: { path: SOURCE, durationSeconds: sourceProbe.duration, arm: sourceMeasurement ? { mode: sourceMeasurement.mode, load: sourceMeasurement.load, recorder: sourceMeasurement.recorder } : null },
      clip,
      projectResolution: project.resolution,
      playbackTimeAvailable: false,
      lostCallbacks: 0,
      nodes: [],
      contexts: [],
      markers: sourceMeasurement?.markers ?? null,
      files,
    })
    const writeMeasurement = () => writeFileSync(path.join(dir, 'measurement.json'), JSON.stringify(measurement(), null, 2))
    writeMeasurement()

    for (const format of formats) {
      const { file, seconds } = await exportOnce(page, format, dir, clip.duration * 10_000 + 300_000)
      // Tripwire: the export's picture is the timeline's length within a frame,
      // at the source's size, and it has sound running to the same end (give or
      // take the audio codec's framing). A WebM's streams carry no duration of
      // their own, so the container's stands in for both.
      const out = probe(path.join(dir, file))
      const video = out.streams.find((s) => s.codec_type === 'video')
      const audio = out.streams.find((s) => s.codec_type === 'audio')
      const videoSeconds = Number(video?.duration ?? out.duration)
      const audioSeconds = Number(audio?.duration ?? out.duration)
      expect({ width: video?.width, height: video?.height }).toEqual(SIZE)
      expect(audio, `${file} has an audio stream`).toBeTruthy()
      expect(Math.abs(videoSeconds - clip.duration), `${file}: video ${videoSeconds}s vs timeline ${clip.duration}s`).toBeLessThanOrEqual(FRAME_S)
      expect(Math.abs(audioSeconds - clip.duration), `${file}: audio ${audioSeconds}s vs timeline ${clip.duration}s`).toBeLessThanOrEqual(FRAME_S + AUDIO_FRAMING_S)
      files.push({ file, kind: `artist-${format}`, row: 'export', role: 'primary', browser: browserName, exportSeconds: seconds })
      writeMeasurement()
    }

    console.log(`av-drift artist-${browserName}: ${files.map((f) => f.file).join(', ')} → ${dir}`)
  })
})
