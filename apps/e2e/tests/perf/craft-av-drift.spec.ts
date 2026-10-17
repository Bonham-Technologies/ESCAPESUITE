import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type CDPSession, type Page } from '@playwright/test'
import { CAPTURE_SIZE, CRAFT_URL } from '../../utils/craftPerf'
import { grantMediaPermissions, mockSyntheticMedia, type MarkerState } from '../../utils/media-mocks'
import { expectedCapturePath, resolveCapturePath } from '../../utils/capturePath'
import { installAvDriftInstrumentation, readAvDriftSnapshot, readSpStats, type SpNodeLog } from '../../utils/avDrift'

/**
 * A/V drift rig for ESCAPECRAFT (ESCSUITE-296 / ESCSUITE-297).
 *
 * Not a benchmark and not a regression test: a measurement, run by hand one
 * arm at a time against whatever recorder the tree holds, so it can show the
 * drift on the unfixed recorder first and its absence after the fix. It asserts
 * only that the take it measured is the take it meant to (sources toggled,
 * rows saved, files downloaded). The numbers are read afterwards by
 * `scripts/av-drift-report.mjs`.
 *
 * Opt-in twice over: it runs only under its own config
 * (`playwright.av-drift.config.ts`; `playwright.perf.config.ts` ignores this
 * file and `playwright.config.ts` ignores all of `tests/perf/`) **and** only
 * with `AV_DRIFT=1`, so neither `pnpm test:e2e` nor `pnpm perf` ever starts a
 * three-minute take.
 *
 * One arm per invocation, chosen by environment:
 *
 * | Variable | Values | Default |
 * |---|---|---|
 * | `AV_DRIFT_EXPECT_PATH` | the capture path the arm must have used: `worklet`, `script-processor` or `media-recorder` (tripwire; default follows the arm's recorder) | — |
 * | `AV_DRIFT_MODE` | `screen` (screen + mic → WebCodecs), `pip` (screen + webcam composited → MediaRecorder), `tracks` (screen + webcam + mic as separate tracks → WebCodecs), `mic` (microphone alone → MediaRecorder) | `screen` |
 * | `AV_DRIFT_LOAD` | `idle`, `cpu4` (CDP `Emulation.setCPUThrottlingRate { rate: 4 }`), `jank` (a 60 ms busy loop every 100 ms in the CRAFT page) | `idle` |
 * | `AV_DRIFT_SECONDS` | take length, start click to stop click | `180` |
 *
 * The capture devices are `mockSyntheticMedia(..., { markers: true })`: a white
 * frame and a 1 kHz beep, 100 ms each, every 10 s on one `performance.now()`
 * schedule. The page instruments (`utils/avDrift.ts`) log every
 * `onaudioprocess` dispatch and sample every AudioContext's clock once a second.
 *
 * Output, in `apps/e2e/av-drift-results/<mode>-<load>/` (emptied first):
 * every stored file of the take as the app's own WebM download hands it out
 * (all parts in `tracks`), the MP4 and M4A conversions in `screen` and `pip`
 * (the H4 arm), `measurement.json` (the window, lost callbacks per node, the
 * `playbackTime` semantics per node, the contexts' rates and ε, the marker
 * schedule, the stored records' metadata, the file list) and `sp-log.json`
 * (every logged callback, for re-analysis).
 */

type Mode = 'screen' | 'pip' | 'tracks' | 'mic'
type Load = 'idle' | 'cpu4' | 'jank'

const MODES: readonly Mode[] = ['screen', 'pip', 'tracks', 'mic']
const LOADS: readonly Load[] = ['idle', 'cpu4', 'jank']

function pick<T extends string>(name: string, value: string | undefined, allowed: readonly T[], fallback: T): T {
  const chosen = (value ?? fallback) as T
  if (!allowed.includes(chosen)) {
    throw new Error(`${name}=${value} is not one of ${allowed.join(', ')}`)
  }
  return chosen
}

const ENABLED = process.env.AV_DRIFT === '1'
const MODE = pick('AV_DRIFT_MODE', process.env.AV_DRIFT_MODE, MODES, 'screen')
const LOAD = pick('AV_DRIFT_LOAD', process.env.AV_DRIFT_LOAD, LOADS, 'idle')
const SECONDS = Number(process.env.AV_DRIFT_SECONDS ?? 180)
if (!Number.isFinite(SECONDS) || SECONDS < 15) {
  throw new Error(`AV_DRIFT_SECONDS=${process.env.AV_DRIFT_SECONDS} must be a number of seconds, 15 or more`)
}

/** What each mode records, and how many library rows its take becomes. */
const ARMS: Record<Mode, { webcam: boolean; separateTracks: boolean; screen: boolean; rows: number; recorder: string; conversions: boolean }> = {
  screen: { screen: true, webcam: false, separateTracks: false, rows: 1, recorder: 'webcodecs', conversions: true },
  pip: { screen: true, webcam: true, separateTracks: false, rows: 1, recorder: 'mediarecorder', conversions: true },
  // Screen, webcam and microphone; system audio stays off (the synthetic
  // display stream then carries no audio track), so three parts.
  tracks: { screen: true, webcam: true, separateTracks: true, rows: 3, recorder: 'webcodecs', conversions: false },
  mic: { screen: false, webcam: false, separateTracks: false, rows: 1, recorder: 'mediarecorder', conversions: false },
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RESULTS_DIR = path.resolve(HERE, '../../av-drift-results', `${MODE}-${LOAD}`)

/** The busy loop `jank` injects: 60 ms of main thread out of every 100. */
const JANK_BUSY_MS = 60
const JANK_EVERY_MS = 100

/**
 * Lost callbacks per node inside a `performance.now()` window — the same
 * telescoping sum as the page's `__spLostCallbacks` (see `utils/avDrift.ts`
 * for why it is taken telescoped), plus two cross-checks: the same count from
 * the `performance.now()` span instead of the `playbackTime` span (needs no
 * `playbackTime` at all, but carries dispatch jitter at both ends), and the
 * share of steps that are a whole number of buffers (1.0 when `playbackTime`
 * is the buffer's own time, lower when it is the dispatch time).
 */
function lostPerNode(nodes: SpNodeLog[], from: number, to: number) {
  return nodes.map((node) => {
    const period = node.bufferSize / node.sampleRate
    const inWindow = node.calls.filter(([, at]) => at >= from && at <= to)
    let aligned = 0
    let lateSteps = 0
    let maxStep = 0
    let maxDispatchGapMs = 0
    for (let i = 1; i < inWindow.length; i++) {
      const delta = inWindow[i][0] - inWindow[i - 1][0]
      const steps = Math.round(delta / period)
      if (Math.abs(delta - steps * period) < 0.001) aligned++
      if (steps > 1) lateSteps++
      maxStep = Math.max(maxStep, steps)
      maxDispatchGapMs = Math.max(maxDispatchGapMs, inWindow[i][1] - inWindow[i - 1][1])
    }
    const span = inWindow.length > 1 ? inWindow[inWindow.length - 1][1] - inWindow[0][1] : 0
    const playbackSpan = inWindow.length > 1 ? inWindow[inWindow.length - 1][0] - inWindow[0][0] : 0
    const lost = inWindow.length > 1 ? Math.round(playbackSpan / period) - (inWindow.length - 1) : 0
    return {
      contextIndex: node.contextIndex,
      bufferSize: node.bufferSize,
      sampleRate: node.sampleRate,
      callsInWindow: inWindow.length,
      lostInWindow: lost,
      lostByPerfSpan: inWindow.length > 1 ? Math.round(span / 1000 / period) - (inWindow.length - 1) : 0,
      alignedStepShare: inWindow.length > 1 ? aligned / (inWindow.length - 1) : null,
      stepsAboveOne: lateSteps,
      largestStepInBuffers: maxStep,
      largestDispatchGapMs: maxDispatchGapMs,
      totalCalls: node.calls.length,
    }
  })
}

/** ε in ppm from a least-squares slope of context time on performance time. */
function slopePpm(points: [number, number][]): number | null {
  if (points.length < 3) return null
  const n = points.length
  const mx = points.reduce((s, p) => s + p[0], 0) / n
  const my = points.reduce((s, p) => s + p[1], 0) / n
  let sxx = 0
  let sxy = 0
  for (const [x, y] of points) {
    sxx += (x - mx) ** 2
    sxy += (x - mx) * (y - my)
  }
  return sxx > 0 ? (sxy / sxx - 1) * 1e6 : null
}

async function now(page: Page): Promise<number> {
  return page.evaluate(() => performance.now())
}

async function configureSources(page: Page): Promise<void> {
  const arm = ARMS[MODE]
  const source = (label: string) => page.getByRole('button', { name: label, exact: true })

  await expect(source('Screen')).toBeEnabled({ timeout: 30_000 })
  await expect(source('Screen')).toHaveAttribute('aria-pressed', 'true')
  await expect(source('Microphone')).toBeEnabled({ timeout: 30_000 })
  // The microphone carries the beeps in every arm, and is on by default.
  await expect(source('Microphone')).toHaveAttribute('aria-pressed', 'true')

  if (!arm.screen) {
    await source('Screen').click()
    await expect(source('Screen')).toHaveAttribute('aria-pressed', 'false')
  }
  if (arm.webcam) {
    await expect(source('Webcam')).toBeEnabled({ timeout: 30_000 })
    await source('Webcam').click()
    await expect(source('Webcam')).toHaveAttribute('aria-pressed', 'true')
  }
  if (arm.separateTracks) {
    const separate = page.getByRole('button', { name: 'Record webcam as a separate track' })
    await expect(separate).toBeEnabled({ timeout: 30_000 })
    await separate.click()
    await expect(separate).toHaveAttribute('aria-pressed', 'true')
  }
}

async function applyLoad(page: Page, cdp: CDPSession): Promise<void> {
  if (LOAD === 'cpu4') await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  if (LOAD === 'jank') {
    await page.evaluate(
      ([busy, every]) => {
        ;(window as unknown as { __avJank: ReturnType<typeof setInterval> }).__avJank = setInterval(() => {
          const t = performance.now()
          while (performance.now() - t < busy) {
            // spin
          }
        }, every)
      },
      [JANK_BUSY_MS, JANK_EVERY_MS] as const
    )
  }
}

async function removeLoad(page: Page, cdp: CDPSession): Promise<void> {
  if (LOAD === 'cpu4') await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  if (LOAD === 'jank') {
    await page.evaluate(() => clearInterval((window as unknown as { __avJank: ReturnType<typeof setInterval> }).__avJank))
  }
}

/** The stored records' metadata (never the bytes), newest take only. */
async function readStoredMetadata(page: Page) {
  return page.evaluate(
    () =>
      new Promise<unknown[]>((resolve, reject) => {
        const request = indexedDB.open('video-editor-db')
        request.onerror = () => reject(new Error('could not open video-editor-db'))
        request.onsuccess = () => {
          const getAll = request.result.transaction('videos', 'readonly').objectStore('videos').getAll()
          getAll.onerror = () => reject(new Error('could not read the videos store'))
          getAll.onsuccess = () =>
            resolve(
              (getAll.result as { id: string; blob: Blob; metadata?: Record<string, unknown> }[]).map((r) => ({
                id: r.id,
                bytes: r.blob?.size ?? null,
                type: r.blob?.type ?? null,
                metadata: r.metadata ?? null,
              }))
            )
        }
      })
  )
}

interface SavedFile {
  file: string
  kind: 'raw' | 'mp4' | 'm4a'
  row: string
  /** `primary`, or the companion label the row's name ends with (`webcam`, `microphone`, …). */
  role: string
}

function roleOf(rowName: string): string {
  const companion = /\s—\s(.+)$/.exec(rowName)
  return companion ? companion[1].trim().toLowerCase() : 'primary'
}

async function saveDownload(page: Page, button: ReturnType<Page['getByRole']>, timeoutMs: number): Promise<string> {
  const downloadPromise = page.waitForEvent('download', { timeout: timeoutMs })
  await button.click()
  const download = await downloadPromise
  const name = download.suggestedFilename()
  await download.saveAs(path.join(RESULTS_DIR, name))
  return name
}

test.describe('ESCAPECRAFT A/V drift rig', () => {
  test.skip(!ENABLED, 'Opt-in: set AV_DRIFT=1 and run with --config=playwright.av-drift.config.ts')
  // `AV_DRIFT_SOURCE` selects the ESCAPEARTIST arm (`artist-av-drift.spec.ts`),
  // which reads a take this arm made; it must not start (and wipe) a new one.
  test.skip(!!process.env.AV_DRIFT_SOURCE, 'AV_DRIFT_SOURCE selects the ESCAPEARTIST arm')

  test(`${MODE} take, ${LOAD}, ${SECONDS}s`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Chromium only: CDP throttling and the WebCodecs recorder')
    test.slow()

    const arm = ARMS[MODE]
    rmSync(RESULTS_DIR, { recursive: true, force: true })
    mkdirSync(RESULTS_DIR, { recursive: true })

    // ESCSUITE-320: the recorder names its audio capture path in one console
    // line; the ScriptProcessor instruments cannot see a worklet take.
    const consoleLines: string[] = []
    page.on('console', (message) => consoleLines.push(message.text()))

    await installAvDriftInstrumentation(page)
    await mockSyntheticMedia(page, { ...CAPTURE_SIZE, markers: true })
    await grantMediaPermissions(page)

    await page.goto(CRAFT_URL)
    await page.waitForLoadState('networkidle')
    await configureSources(page)

    const cdp = await page.context().newCDPSession(page)
    const rows = page.getByRole('button', { name: /Open .+ in Editor/ })

    await applyLoad(page, cdp)
    await page.getByRole('button', { name: 'Start recording' }).click()
    await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({ timeout: 60_000 })
    const startPerf = await now(page)

    await page.waitForTimeout(SECONDS * 1000)

    const stopPerf = await now(page)
    await page.getByRole('button', { name: 'Stop recording' }).click()
    await expect(rows).toHaveCount(arm.rows, { timeout: 180_000 + SECONDS * 1000 })
    await removeLoad(page, cdp)

    const snapshot = await readAvDriftSnapshot(page)
    // ESCSUITE-296 review: is `playbackTime` the render position or the
    // dispatch time? Per node, the naive and the fix-rule loss counts and the
    // verdict, computed in the page over the take's window.
    const playbackTimeStats = await readSpStats(page, startPerf, stopPerf)
    const markers = await page.evaluate(() => (window as unknown as { __markers?: MarkerState }).__markers ?? null)
    const stored = await readStoredMetadata(page)

    const nodes = lostPerNode(snapshot.nodes, startPerf, stopPerf)
    const contexts = snapshot.contexts.map((ctx) => {
      const inWindow = ctx.clock.filter((s) => s[0] >= startPerf && s[0] <= stopPerf)
      return {
        index: ctx.index,
        synthetic: ctx.synthetic,
        sampleRate: ctx.sampleRate,
        requestedSampleRate: ctx.requestedSampleRate,
        state: ctx.state,
        baseLatency: ctx.baseLatency,
        outputLatency: ctx.outputLatency,
        samplesInWindow: inWindow.length,
        // currentTime against performance.now() (render-quantum resolution)…
        epsilonPpmCurrentTime: slopePpm(
          inWindow.filter((s) => s[1] > 0).map((s) => [s[0] / 1000, s[1]] as [number, number])
        ),
        // …and the output timestamp's own pair, which is read at one instant.
        epsilonPpmOutputTimestamp: slopePpm(
          inWindow.filter((s) => s[3] > 0).map((s) => [s[3] / 1000, s[2]] as [number, number])
        ),
        clock: ctx.clock,
      }
    })

    const files: SavedFile[] = []
    const capturePath = resolveCapturePath(consoleLines, arm.recorder)
    const measurement = () => ({
      mode: MODE,
      capturePath,
      load: LOAD,
      seconds: SECONDS,
      recorder: arm.recorder,
      window: { startPerf, stopPerf, seconds: (stopPerf - startPerf) / 1000 },
      playbackTimeAvailable: snapshot.playbackTimeAvailable,
      lostCallbacks: nodes.reduce((sum, n) => sum + n.lostInWindow, 0),
      nodes,
      playbackTimeStats,
      contexts,
      markers,
      stored,
      files,
    })
    const writeMeasurement = () =>
      writeFileSync(path.join(RESULTS_DIR, 'measurement.json'), JSON.stringify(measurement(), null, 2))

    writeFileSync(path.join(RESULTS_DIR, 'sp-log.json'), JSON.stringify(snapshot.nodes))
    writeMeasurement()

    // Tripwire (ESCSUITE-320): the take measured the capture path this arm meant
    // to — `AV_DRIFT_EXPECT_PATH` states another expectation (Firefox, a
    // forced ScriptProcessor fallback).
    expect(capturePath, 'the audio capture path the take used').toBe(
      expectedCapturePath(arm.recorder, process.env.AV_DRIFT_EXPECT_PATH)
    )

    // Every stored part, exactly as the app's own WebM download hands it out.
    const rawButtons = page.getByRole('button', { name: /^Download (?!.+ as ).+$/ })
    await expect(rawButtons).toHaveCount(arm.rows)
    for (let i = 0; i < arm.rows; i++) {
      const button = rawButtons.nth(i)
      const row = ((await button.getAttribute('aria-label')) ?? '').replace(/^Download /, '')
      const file = await saveDownload(page, button, 60_000)
      files.push({ file, kind: 'raw', row, role: roleOf(row) })
    }
    writeMeasurement()

    // H4: the two conversions, each bound to the take's own playback length.
    if (arm.conversions) {
      const conversionTimeout = SECONDS * 3000 + 180_000
      const mp4 = page.getByRole('button', { name: /Download .+ as MP4/ })
      await expect(mp4).toBeEnabled()
      files.push({ file: await saveDownload(page, mp4, conversionTimeout), kind: 'mp4', row: 'primary', role: 'primary' })
      writeMeasurement()

      const m4a = page.getByRole('button', { name: /Download .+ as audio \(M4A\)/ })
      await expect(m4a).toBeEnabled({ timeout: 60_000 })
      files.push({ file: await saveDownload(page, m4a, conversionTimeout), kind: 'm4a', row: 'primary', role: 'primary' })
      writeMeasurement()
    }

    console.log(
      `av-drift ${MODE}-${LOAD}: ${measurement().lostCallbacks} lost callbacks over ${((stopPerf - startPerf) / 1000).toFixed(1)}s; ` +
        `files: ${files.map((f) => f.file).join(', ')} → ${RESULTS_DIR}`
    )
  })
})
