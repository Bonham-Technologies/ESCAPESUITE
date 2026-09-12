import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CDPSession, Download, Page } from '@playwright/test'

/**
 * Benchmark plumbing for `tests/perf/` — the measured windows, the scene they
 * run against, and the JSON the report script merges.
 *
 * Nothing in here touches app code. Everything is measured from outside the
 * page: `addInitScript` wrappers for the counters the platform does not expose,
 * a `PerformanceObserver` for long tasks, and a CDP session for the renderer's
 * own metrics and for forcing a GC before a heap reading.
 *
 * Every measured window is one async function returning its metrics object
 * ({@link measurePlayback}, {@link measureExport}) so a profiler can be wrapped
 * around the call without restructuring the test.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const E2E_ROOT = path.resolve(HERE, '..')

/** Where per-benchmark JSON lands; `scripts/perf-report.mjs` merges the directory. */
export const PERF_RESULTS_DIR = path.join(E2E_ROOT, 'perf-results')

/** The one media file every perf scene is built from (1 s, 64x48, H.264). */
export const PERF_SOURCE_PATH = path.join(E2E_ROOT, 'fixtures/headless/source.mp4')

export const ARTIST_URL = 'http://localhost:5175'

/** Runs per benchmark. Wall-time metrics are reported as the median of these. */
export const PERF_RUNS = 3

/** Total seconds of playback per run; the first second is discarded. */
export const PLAYBACK_SECONDS = 6

/** Warm-up discarded from the front of every playback window. */
export const PLAYBACK_WARMUP_SECONDS = 1

/**
 * Chromium flags every perf run launches with. Recorded here (and in the
 * baseline doc) because the numbers are only comparable between runs that
 * used the same ones.
 *
 * - `--enable-precise-memory-info` — without it `performance.memory` is
 *   bucketed to 100 KB and quantised over time, so a heap delta is noise.
 * - `--disable-gpu` — software rasterisation, which is what a CI runner has
 *   anyway and what `services/headless-artist` renders under. Keeps a local
 *   number comparable to a CI one.
 * - `--autoplay-policy=no-user-gesture-required` — the preview drives
 *   `<video>` elements that were never clicked.
 */
export const PERF_LAUNCH_ARGS = [
  '--enable-precise-memory-info',
  '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required',
]

/** One benchmark's worth of numbers, as written to `perf-results/<name>.json`. */
export interface PerfBenchmark {
  name: string
  runs: number
  [metric: string]: number | string | undefined
}

/** Median of a sample. Even-length samples average the two middle values. */
export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Round to `digits` decimals so the report does not carry float noise. */
export function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** Write one benchmark's JSON where `scripts/perf-report.mjs` will find it. */
export function writePerfResult(result: PerfBenchmark): void {
  mkdirSync(PERF_RESULTS_DIR, { recursive: true })
  writeFileSync(
    path.join(PERF_RESULTS_DIR, `${result.name}.json`),
    JSON.stringify(result, null, 2) + '\n'
  )
}

// ---------------------------------------------------------------------------
// In-page instrumentation
// ---------------------------------------------------------------------------

/** The counter bag the init script installs on `window`. */
interface PerfCounters {
  rafCount: number
  longTasks: { start: number; duration: number }[]
  encodeCount: number
  encodeQueueHighWater: number
}

declare global {
  interface Window {
    __perf: PerfCounters
    __perfReset: () => void
  }
}

/**
 * Install the counters, before any app script runs.
 *
 * Counting *every* rAF callback is deliberate: while the timeline is playing,
 * `usePreviewRenderLoop`'s loop is the only thing scheduling frames, so the
 * count over a playback window is the count of composited preview frames.
 *
 * `VideoEncoder.prototype.encode` is wrapped rather than read from the app's
 * progress payload so the frame count is the encoder's, not the UI's, and so
 * the queue depth can be sampled at exactly the moment a frame is handed over
 * — the high-water mark is what the exporter's backpressure loop reacts to.
 * The MP4 path decodes in a worker but encodes on the main thread, so this
 * patch sees every encoded frame of both formats.
 */
export async function installPerfInstrumentation(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const counters: PerfCounters = {
      rafCount: 0,
      longTasks: [],
      encodeCount: 0,
      encodeQueueHighWater: 0,
    }
    window.__perf = counters
    window.__perfReset = () => {
      counters.rafCount = 0
      counters.longTasks.length = 0
      counters.encodeCount = 0
      counters.encodeQueueHighWater = 0
    }

    const nativeRaf = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (callback: FrameRequestCallback) =>
      nativeRaf((time) => {
        counters.rafCount++
        callback(time)
      })

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          counters.longTasks.push({ start: entry.startTime, duration: entry.duration })
        }
      }).observe({ entryTypes: ['longtask'] })
    } catch {
      // Long-task timing is Chromium-only; the perf project never runs elsewhere,
      // but a missing observer must not take the page down.
    }

    const encoder = (window as unknown as { VideoEncoder?: typeof VideoEncoder }).VideoEncoder
    if (encoder) {
      const nativeEncode = encoder.prototype.encode
      encoder.prototype.encode = function patchedEncode(
        this: VideoEncoder,
        ...args: Parameters<VideoEncoder['encode']>
      ) {
        const result = nativeEncode.apply(this, args)
        counters.encodeCount++
        if (this.encodeQueueSize > counters.encodeQueueHighWater) {
          counters.encodeQueueHighWater = this.encodeQueueSize
        }
        return result
      }
    }
  })
}

/** CDP metrics the benchmarks report, keyed as Chromium names them. */
const CDP_METRICS = ['TaskDuration', 'LayoutCount', 'RecalcStyleCount'] as const
type CdpMetricName = (typeof CDP_METRICS)[number]
type CdpSnapshot = Record<CdpMetricName, number>

/** Read the renderer's cumulative counters. Deltas are what the report shows. */
export async function readCdpMetrics(cdp: CDPSession): Promise<CdpSnapshot> {
  const { metrics } = await cdp.send('Performance.getMetrics')
  const byName = new Map(metrics.map((m) => [m.name, m.value]))
  return {
    TaskDuration: byName.get('TaskDuration') ?? 0,
    LayoutCount: byName.get('LayoutCount') ?? 0,
    RecalcStyleCount: byName.get('RecalcStyleCount') ?? 0,
  }
}

/**
 * Force a collection, then read the JS heap.
 *
 * Without the collect the delta measures "what has not been collected yet",
 * which drifts run to run; with it, a positive delta is retained memory.
 */
export async function readHeapAfterGc(page: Page, cdp: CDPSession): Promise<number> {
  await cdp.send('HeapProfiler.collectGarbage')
  return page.evaluate(() => {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
    return memory?.usedJSHeapSize ?? 0
  })
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

/**
 * Shape of the generated project. Kept loose on purpose — this file builds the
 * JSON the editor's `LOAD_PROJECT` handler accepts, and importing the editor's
 * own types across the workspace boundary would couple the e2e package to it.
 */
interface SceneProject {
  id: string
  name: string
  created: number
  modified: number
  resolution: { width: number; height: number }
  timeline: {
    tracks: unknown[]
    clips: unknown[]
    textOverlays: never[]
    shapeOverlays: never[]
    duration: number
  }
}

/** Media clips in the generated scene, split evenly across the two media tracks. */
const MEDIA_CLIPS = 12
const CLIPS_PER_TRACK = MEDIA_CLIPS / 2
/** Track 1's clips are offset by half a clip so the two tracks composite together. */
const TRACK_1_OFFSET = 0.5
/** The fixture source is exactly one second long, so every clip is one second. */
const CLIP_SECONDS = 1
/** Last clip ends at 5.5 + 1; the whole timeline is 6.5 s, longer than a playback window. */
export const SCENE_DURATION_SECONDS = (CLIPS_PER_TRACK - 1) * CLIP_SECONDS + TRACK_1_OFFSET + CLIP_SECONDS

function track(id: string, name: string, index: number) {
  return { id, name, index, visible: true, locked: false, muted: false, volume: 1, height: 64 }
}

/**
 * Build the 12-clip scene deterministically.
 *
 * Everything varies by clip index and nothing by clock or random source, so two
 * runs composite exactly the same frames:
 *
 * - six clips on `V1`, back to back at 0,1,2,3,4,5 s, full frame;
 * - six clips on `V2`, offset half a second, scaled down to a picture-in-picture
 *   box that walks across the frame and rotates, at 85% opacity — so every frame
 *   in the window composites two decoded sources, not one;
 * - every fourth clip carries a 4 px blur and every fifth a `screen` blend, to
 *   exercise the filter and blend paths;
 * - one 0.5 s `fade` transition, on the third `V1` clip;
 * - one text overlay and one shape overlay, each on its own track, spanning the
 *   whole timeline so they are drawn on every frame.
 */
export function buildPerfScene(sourceVideoId: string): SceneProject {
  const clips: unknown[] = []

  for (let i = 0; i < MEDIA_CLIPS; i++) {
    const onSecondTrack = i >= CLIPS_PER_TRACK
    const slot = i % CLIPS_PER_TRACK
    const position = slot * CLIP_SECONDS + (onSecondTrack ? TRACK_1_OFFSET : 0)

    clips.push({
      id: `perf-clip-${i}`,
      sourceVideoId,
      name: `perf-${i}`,
      startTime: 0,
      endTime: CLIP_SECONDS,
      duration: CLIP_SECONDS,
      trackId: onSecondTrack ? 'perf-track-1' : 'perf-track-0',
      timelinePosition: position,
      blendMode: i % 5 === 4 ? 'screen' : 'normal',
      transform: onSecondTrack
        ? {
            x: 0.2 + slot * 0.1,
            y: 0.3,
            scaleX: 0.35,
            scaleY: 0.35,
            rotation: slot * 3,
            opacity: 0.85,
            scaleLocked: true,
          }
        : { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, scaleLocked: true },
      effects: { blur: i % 4 === 3 ? 4 : 0 },
      transition:
        i === 2 ? { type: 'fade', duration: 0.5 } : { type: 'none', duration: 0.5 },
    })
  }

  clips.push({
    id: 'perf-clip-text',
    sourceVideoId: '',
    name: 'ESCAPE perf',
    startTime: 0,
    endTime: SCENE_DURATION_SECONDS,
    duration: SCENE_DURATION_SECONDS,
    trackId: 'perf-track-text',
    timelinePosition: 0,
    blendMode: 'normal',
    transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, scaleLocked: true },
    effects: { blur: 0 },
    transition: { type: 'none', duration: 0.5 },
    overlayType: 'text',
    textData: {
      text: 'ESCAPE perf',
      x: 0.5,
      y: 0.8,
      fontFamily: 'Arial',
      fontSize: 48,
      fontWeight: 'bold',
      fontStyle: 'normal',
      color: '#ffffff',
      backgroundColor: '#00000080',
      textAlign: 'center',
      rotation: 0,
      scale: 1,
    },
  })

  clips.push({
    id: 'perf-clip-shape',
    sourceVideoId: '',
    name: 'perf shape',
    startTime: 0,
    endTime: SCENE_DURATION_SECONDS,
    duration: SCENE_DURATION_SECONDS,
    trackId: 'perf-track-shape',
    timelinePosition: 0,
    blendMode: 'normal',
    transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, scaleLocked: true },
    effects: { blur: 0 },
    transition: { type: 'none', duration: 0.5 },
    overlayType: 'shape',
    shapeData: {
      type: 'rectangle',
      x: 0.2,
      y: 0.2,
      width: 0.25,
      height: 0.2,
      fillColor: '#1e90ffcc',
      strokeColor: '#ffffff',
      strokeWidth: 4,
      rotation: 12,
      blurAmount: 0,
    },
  })

  return {
    id: 'perf-scene',
    name: 'Perf Scene',
    created: 0,
    modified: 0,
    resolution: { width: 1280, height: 720 },
    timeline: {
      tracks: [
        track('perf-track-0', 'V1', 0),
        track('perf-track-1', 'V2', 1),
        track('perf-track-text', 'Text', 2),
        track('perf-track-shape', 'Shape', 3),
      ],
      clips,
      textOverlays: [],
      shapeOverlays: [],
      duration: SCENE_DURATION_SECONDS,
    },
  }
}

/** Total clips the scene puts on the timeline (12 media + 2 overlays). */
export const SCENE_CLIP_COUNT = MEDIA_CLIPS + 2
/** Tracks the scene puts on the timeline. */
export const SCENE_TRACK_COUNT = 4

/**
 * Open ESCAPEARTIST, import the fixture once, and load the generated scene.
 *
 * The handoff uses the documented integration API rather than any test-only
 * hook, so no app code exists for the benchmarks' sake:
 *
 * 1. the fixture goes in through the media library's own file input, which is
 *    what puts its bytes in IndexedDB and its metadata in the store (clips
 *    address media by source id, so this has to happen for real once);
 * 2. `GET_STATE` reports back the id the import was given;
 * 3. `LOAD_PROJECT` installs a project whose 14 clips all reference that id.
 *
 * Both messages are posted from the page to itself. `initIntegration` only acts
 * on messages whose `event.source` is `window.parent`, and at the top level
 * `window.parent === window`, so a self-post is accepted exactly as a host's
 * would be — and the reply arrives as the `videoeditor:message` CustomEvent
 * `sendMessage` dispatches alongside every outbound post.
 */
export async function loadPerfScene(page: Page): Promise<void> {
  await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
  await page.waitForLoadState('networkidle')

  await page.locator('input[type="file"]').setInputFiles({
    name: 'perf-source.mp4',
    mimeType: 'video/mp4',
    buffer: readFileSync(PERF_SOURCE_PATH),
  })
  await page.getByRole('button', { name: 'Add to timeline' }).waitFor({ timeout: 60_000 })

  const sourceVideoId = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('GET_STATE never answered')), 15_000)
        const onMessage = (event: Event) => {
          const detail = (event as CustomEvent).detail
          if (detail?.type !== 'STATE') return
          clearTimeout(timer)
          window.removeEventListener('videoeditor:message', onMessage)
          const videos = detail.payload?.videos as { id: string }[] | undefined
          if (!videos?.length) {
            reject(new Error('no source video in STATE'))
            return
          }
          resolve(videos[videos.length - 1].id)
        }
        window.addEventListener('videoeditor:message', onMessage)
        window.postMessage({ type: 'GET_STATE' }, '*')
      })
  )

  const project = buildPerfScene(sourceVideoId)
  await page.evaluate(
    (payload) => window.postMessage({ type: 'LOAD_PROJECT', payload }, '*'),
    project as unknown as Record<string, unknown>
  )

  await page
    .getByText(`${SCENE_CLIP_COUNT} clips · ${SCENE_TRACK_COUNT} tracks`)
    .waitFor({ timeout: 15_000 })

  // The preview holds one <video> per source and decodes the first frame of each
  // before it can composite; starting the clock before that turns decode latency
  // into a low frame count.
  await page.waitForTimeout(1500)
}

// ---------------------------------------------------------------------------
// Measured windows
// ---------------------------------------------------------------------------

export interface PlaybackMeasurement {
  renderedFps: number
  longTaskCount: number
  longTaskTotalMs: number
  heapDeltaBytes: number
  taskDurationMs: number
  layoutCount: number
  recalcStyleCount: number
}

/**
 * Play the loaded scene and measure one window.
 *
 * `seconds` is the whole press-play-to-pause span; the first
 * {@link PLAYBACK_WARMUP_SECONDS} of it are discarded, because the first frames
 * after play pay for seeking every source and warming the frame cache. The GC
 * that anchors the heap reading is deliberately taken inside that discarded
 * stretch so its pause never lands in the measured window.
 */
export async function measurePlayback(
  page: Page,
  cdp: CDPSession,
  seconds: number = PLAYBACK_SECONDS
): Promise<PlaybackMeasurement> {
  const windowSeconds = seconds - PLAYBACK_WARMUP_SECONDS

  await page.evaluate(() => window.__perfReset())
  await page.getByTitle('Play (Space)').click()

  await page.waitForTimeout((PLAYBACK_WARMUP_SECONDS * 1000) / 2)
  const heapStart = await readHeapAfterGc(page, cdp)
  await page.waitForTimeout((PLAYBACK_WARMUP_SECONDS * 1000) / 2)

  const cdpStart = await readCdpMetrics(cdp)
  const start = await page.evaluate(() => ({
    raf: window.__perf.rafCount,
    now: performance.now(),
  }))

  await page.waitForTimeout(windowSeconds * 1000)

  const cdpEnd = await readCdpMetrics(cdp)
  const end = await page.evaluate((windowStart: number) => {
    const now = performance.now()
    const inWindow = window.__perf.longTasks.filter((task) => task.start >= windowStart)
    return {
      raf: window.__perf.rafCount,
      now,
      longTaskCount: inWindow.length,
      longTaskTotalMs: inWindow.reduce((total, task) => total + task.duration, 0),
    }
  }, start.now)

  await page.getByTitle('Pause (Space)').click()
  const heapEnd = await readHeapAfterGc(page, cdp)

  const elapsedSeconds = (end.now - start.now) / 1000
  return {
    renderedFps: round((end.raf - start.raf) / elapsedSeconds),
    longTaskCount: end.longTaskCount,
    longTaskTotalMs: round(end.longTaskTotalMs),
    heapDeltaBytes: heapEnd - heapStart,
    taskDurationMs: round((cdpEnd.TaskDuration - cdpStart.TaskDuration) * 1000),
    layoutCount: cdpEnd.LayoutCount - cdpStart.LayoutCount,
    recalcStyleCount: cdpEnd.RecalcStyleCount - cdpStart.RecalcStyleCount,
  }
}

export interface ExportMeasurement {
  wallMs: number
  framesEncoded: number
  framesPerSecond: number
  heapDeltaBytes: number
  encoderQueueHighWater: number
  bytes: number
}

/**
 * Export the loaded scene at 720p and measure one window.
 *
 * Wall time is the span from the click that starts the encode to the browser
 * handing over the finished file — the whole user-visible export, prepare and
 * mux included, not just the frame loop.
 */
export async function measureExport(
  page: Page,
  cdp: CDPSession,
  format: 'mp4' | 'webm'
): Promise<ExportMeasurement> {
  await page.getByRole('button', { name: 'Export video' }).click()
  await page.getByRole('heading', { name: 'Export Video' }).waitFor()

  // Format and resolution live behind a disclosure that starts collapsed on
  // every open; expand it only when it actually is, so a future default of
  // "expanded" does not collapse it here.
  const advanced = page.getByRole('button', { name: 'Advanced options' })
  if ((await advanced.getAttribute('aria-expanded')) !== 'true') {
    await advanced.click()
  }

  await page.getByRole('radio', { name: format === 'mp4' ? /MP4/ : /WebM/ }).check()
  await page
    .locator('select')
    .filter({ has: page.locator('option[value="480p"]') })
    .selectOption('720p')

  await page.evaluate(() => window.__perfReset())
  const heapStart = await readHeapAfterGc(page, cdp)

  const downloadPromise = page.waitForEvent('download', { timeout: 600_000 })
  const startedAt = Date.now()
  await page
    .getByRole('button', { name: format === 'mp4' ? 'Download MP4' : 'Download WebM' })
    .last()
    .click()
  const download: Download = await downloadPromise
  const wallMs = Date.now() - startedAt

  const counters = await page.evaluate(() => ({
    framesEncoded: window.__perf.encodeCount,
    encoderQueueHighWater: window.__perf.encodeQueueHighWater,
  }))
  const heapEnd = await readHeapAfterGc(page, cdp)

  const stream = await download.createReadStream()
  let bytes = 0
  for await (const chunk of stream) bytes += (chunk as Buffer).byteLength
  await download.delete()

  // The dialog closes itself two seconds after it reports `complete`; waiting
  // that out (rather than clicking Close) leaves the next run starting from
  // exactly the state a user's second export would start from.
  await page.getByRole('heading', { name: 'Export Video' }).waitFor({
    state: 'hidden',
    timeout: 30_000,
  })

  return {
    wallMs,
    framesEncoded: counters.framesEncoded,
    framesPerSecond: round(counters.framesEncoded / (wallMs / 1000)),
    heapDeltaBytes: heapEnd - heapStart,
    encoderQueueHighWater: counters.encoderQueueHighWater,
    bytes,
  }
}
