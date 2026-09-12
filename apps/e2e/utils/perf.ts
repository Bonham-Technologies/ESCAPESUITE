import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type CDPSession, type Download, type Page } from '@playwright/test'
import { ARTIST_URL, openExportAdvancedOptions, openExportDialog } from './artist'

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
// CPU profiling (opt-in)
// ---------------------------------------------------------------------------

/**
 * Whether this run should also record CPU profiles (`PERF_PROFILE=1`).
 *
 * Off by default, and deliberately so: the sampler perturbs exactly the timing
 * the benchmarks exist to report. A profiled run is therefore an *extra* run
 * whose measurement is thrown away — the medians in `perf-report.json` are
 * always taken from unprofiled windows.
 */
export const PERF_PROFILE = process.env.PERF_PROFILE === '1'

/**
 * Sampling interval in microseconds. 100 µs (10 kHz) rather than the 1 ms
 * default: a preview frame at 50 fps is 20 ms of wall time spread over a dozen
 * short calls, and at 1 ms a function costing 0.5 ms per frame can miss the
 * sampler entirely.
 */
const PROFILE_SAMPLING_INTERVAL_US = 100

/**
 * The source maps a profile needs to name real files, as written beside it.
 *
 * Keyed by the served module URL — the same string `callFrame.url` carries —
 * and holding only what a lookup needs. `sourcesContent` is dropped: it is the
 * bulk of a Vite dev map and `profile-top.mjs` never reads it.
 */
export interface ProfileSourceMaps {
  [servedUrl: string]: { sources: string[]; sourceRoot?: string; mappings: string }
}

/**
 * Collect the source maps for every app module the profile sampled.
 *
 * Without this the tables report *served* line numbers. Vite's dev server hands
 * the browser an esbuild-transformed module, so `canvasRenderer.ts:238` in a raw
 * profile is line 238 of the transformed text and has nothing to do with line
 * 238 of the file on disk — which makes every citation in a hotspot report
 * quietly wrong.
 *
 * Vite appends an inline base64 `sourceMappingURL` to each module it serves, so
 * the map is already in the page's reach: fetch the module from inside the page
 * (same origin, and it is the exact text the profiler's line numbers refer to),
 * hand the base64 back and decode it here. Done after `Profiler.stop`, so the
 * fetches cannot land inside a measured window.
 */
async function captureSourceMaps(
  page: Page,
  profile: { nodes?: { callFrame: { url?: string } }[] }
): Promise<ProfileSourceMaps> {
  const urls = new Set<string>()
  for (const node of profile.nodes ?? []) {
    const url = node.callFrame?.url
    if (url && url.includes('/src/')) urls.add(url)
  }

  const maps: ProfileSourceMaps = {}
  for (const url of urls) {
    const base64 = await page.evaluate(async (target: string) => {
      try {
        const response = await fetch(target)
        if (!response.ok) return null
        const text = await response.text()
        const match = /[#@]\s*sourceMappingURL=data:application\/json[^,]*base64,([A-Za-z0-9+/=]+)/.exec(
          text
        )
        return match ? match[1] : null
      } catch {
        return null
      }
    }, url)
    if (!base64) continue

    try {
      // Decoded here rather than with the page's `atob`, which returns latin-1
      // and would mangle any non-ASCII in the map.
      const parsed = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))
      if (typeof parsed?.mappings !== 'string' || !Array.isArray(parsed?.sources)) continue
      maps[url] = {
        sources: parsed.sources,
        ...(parsed.sourceRoot ? { sourceRoot: parsed.sourceRoot } : {}),
        mappings: parsed.mappings,
      }
    } catch {
      // A module without a usable map simply has none; the report falls back to
      // the served location and says so.
    }
  }

  return maps
}

/**
 * Run `body` with the renderer's sampling profiler on, writing the raw
 * `.cpuprofile` to `perf-results/<name>.cpuprofile` and the source maps its
 * frames need to `perf-results/<name>.maps.json`.
 *
 * The profile file is the profiler's own JSON — `{nodes, startTime, endTime,
 * samples, timeDeltas}` — exactly what `Profiler.stop` returns, so it opens in
 * Chrome DevTools' Performance panel as-is and `scripts/profile-top.mjs` reads
 * it without a parser of our own. The map file is ours, and is what lets that
 * script report locations in the `.ts` files rather than in Vite's transformed
 * output (see {@link captureSourceMaps}).
 *
 * This is the page's main thread only. The MP4 export decodes in a Web Worker,
 * which has its own isolate and does not appear here; what it costs shows up
 * only as main-thread idle while it works.
 *
 * With no `name`, `body` runs untouched and the profiler is never enabled — so
 * every call site can pass a name conditionally instead of branching.
 */
export async function withCpuProfile<T>(
  page: Page,
  cdp: CDPSession,
  name: string | undefined,
  body: () => Promise<T>
): Promise<T> {
  if (!name) return body()

  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: PROFILE_SAMPLING_INTERVAL_US })
  await cdp.send('Profiler.start')
  try {
    return await body()
  } finally {
    // Nothing in here may mask a failure from `body`, and the profiler must end
    // up disabled even if stopping or writing throws — hence the nested
    // `finally` around `Profiler.disable` rather than a single flat block.
    try {
      try {
        const { profile } = await cdp.send('Profiler.stop')
        mkdirSync(PERF_RESULTS_DIR, { recursive: true })
        writeFileSync(path.join(PERF_RESULTS_DIR, `${name}.cpuprofile`), JSON.stringify(profile))
        const maps = await captureSourceMaps(page, profile)
        writeFileSync(path.join(PERF_RESULTS_DIR, `${name}.maps.json`), JSON.stringify(maps))
      } finally {
        await cdp.send('Profiler.disable')
      }
    } catch (error) {
      console.warn(`perf: could not write ${name}.cpuprofile —`, error)
    }
  }
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

/** Project canvas the scene renders at; also how the preview canvas is located. */
export const SCENE_RESOLUTION = { width: 1280, height: 720 } as const

/** Media clips in the generated scene, split evenly across the two media tracks. */
const MEDIA_CLIPS = 12
const CLIPS_PER_TRACK = MEDIA_CLIPS / 2
/**
 * Seconds each clip occupies on the timeline.
 *
 * There is one fixture and it is one second long, so a longer timeline has to
 * come from longer clips rather than more media. Two seconds per clip puts the
 * scene at 13 s — comfortably longer than a playback press — and the second
 * second of each clip holds the source's last frame (a seek past a video's
 * duration clamps to its end), which composites and encodes exactly like any
 * other frame. That is the point: the benchmark is measuring the compositor and
 * the encoder, not the decoder's ability to find novel frames.
 */
const CLIP_SECONDS = 2
/** Track 1's clips are offset by half a clip so the two tracks composite together. */
const TRACK_1_OFFSET = CLIP_SECONDS / 2

/**
 * Scale that makes a `V1` clip fill the canvas width.
 *
 * Scale 1 means *native pixel size* in this editor, not fill-canvas (a deliberate
 * product decision). The fixture is 64x48, so a clip at scale 1 draws a 64x48
 * patch into a 1280x720 canvas — 0.3% of it. A benchmark built that way reports
 * the cost of compositing almost nothing, which is the opposite of the point.
 * 1280/64 = 20 puts a clip across the full canvas width (and 960 of its 720
 * height, so it is cropped top and bottom — real full-frame drawing work).
 */
const FULL_FRAME_SCALE = SCENE_RESOLUTION.width / 64

/** Picture-in-picture clips on `V2`, at roughly a third of the frame width. */
const PIP_SCALE = FULL_FRAME_SCALE / 3
/**
 * V1 runs 0,2,4,6,8,10 and ends at 12; V2 is offset a second and ends at 13.
 *
 * The headroom matters. A playback window is a press of Play plus a fixed wall
 * of waits, two forced GCs and several CDP round trips; if the timeline ran out
 * first the transport would stop itself, and the run would either fail on the
 * Pause click or quietly report a frame rate averaged over a stretch that was
 * not playing. 13 s against a ~6 s press leaves better than 2x.
 */
export const SCENE_DURATION_SECONDS =
  (CLIPS_PER_TRACK - 1) * CLIP_SECONDS + TRACK_1_OFFSET + CLIP_SECONDS

function track(id: string, name: string, index: number) {
  return { id, name, index, visible: true, locked: false, muted: false, volume: 1, height: 64 }
}

/**
 * Build the 12-clip scene deterministically.
 *
 * Everything varies by clip index and nothing by clock or random source, so two
 * runs composite exactly the same frames:
 *
 * - six two-second clips on `V1`, back to back at 0,2,4,6,8,10 s, scaled to fill
 *   the canvas (see FULL_FRAME_SCALE — scale 1 here means native 64x48 pixels,
 *   which would composite nothing worth measuring);
 * - six on `V2`, offset a second, at a third of that scale as a picture-in-picture
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
            scaleX: PIP_SCALE,
            scaleY: PIP_SCALE,
            rotation: slot * 3,
            opacity: 0.85,
            scaleLocked: true,
          }
        : {
            x: 0.5,
            y: 0.5,
            scaleX: FULL_FRAME_SCALE,
            scaleY: FULL_FRAME_SCALE,
            rotation: 0,
            opacity: 1,
            scaleLocked: true,
          },
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
    resolution: { ...SCENE_RESOLUTION },
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

  // The preview cannot composite a frame until its media has decoded one, and
  // starting the clock before then turns decode latency into a low frame count.
  // Wait for the condition, not a fixed delay: a slow machine then waits longer
  // and a fast one does not wait at all.
  //
  // The obvious probe — `<video>.readyState` — is unavailable: `usePreviewMedia`
  // builds its elements with `document.createElement` and never attaches them,
  // so `document.querySelectorAll('video')` returns nothing. The canvas is the
  // observable surface, so sample that instead.
  //
  // Redness, not mere non-blackness, is the test. The overlays (a blue rectangle
  // and white text) are drawn whether or not a single video frame has decoded,
  // so "not all black" would pass on an empty preview. The fixture is a solid
  // red frame (see fixtures/headless/make-fixture.md) filling a full-frame V1
  // clip: FULL_FRAME_SCALE sizes the 4:3 source to the canvas *width*, so it
  // covers the 16:9 frame edge to edge and is cropped top and bottom rather
  // than letterboxed. Red should therefore be most of the frame — the overlays
  // and the PiP box take a slice — and a quarter of the pixels is a deliberately
  // slack threshold for "real decoded video is on screen".
  await page.waitForFunction(
    ([width, height]) => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        `canvas[width="${width}"][height="${height}"]`
      )
      if (!canvas) return false

      const probe = document.createElement('canvas')
      probe.width = 64
      probe.height = 36
      const context = probe.getContext('2d')
      if (!context) return false
      context.drawImage(canvas, 0, 0, probe.width, probe.height)

      const { data } = context.getImageData(0, 0, probe.width, probe.height)
      let red = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 100 && data[i + 1] < 80 && data[i + 2] < 80) red++
      }
      return red / (probe.width * probe.height) > 0.25
    },
    [SCENE_RESOLUTION.width, SCENE_RESOLUTION.height] as const,
    { timeout: 30_000 }
  )
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
 * With a `profileName`, the window is recorded as
 * `perf-results/<profileName>.cpuprofile` (see {@link withCpuProfile}); the
 * measurement it returns is then profiler-skewed and should be discarded.
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
  seconds: number = PLAYBACK_SECONDS,
  profileName?: string
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

  await withCpuProfile(page, cdp, profileName, () =>
    page.waitForTimeout(windowSeconds * 1000)
  )

  const cdpEnd = await readCdpMetrics(cdp)
  const end = await page.evaluate((windowStart: number) => {
    const now = performance.now()
    // Long tasks are attributed to the window by their START time, so a task
    // straddling the window's opening is excluded whole and one straddling its
    // close is included whole. That is the honest choice for a "what happened
    // while playing" figure — a long task is one unit of jank and splitting its
    // duration across a boundary would report two shorter stalls that nobody
    // experienced — but it does mean the total can exceed the window's own
    // length by up to one task, and that a single task spanning the entire
    // window would be counted as zero.
    const inWindow = window.__perf.longTasks.filter((task) => task.start >= windowStart)
    return {
      raf: window.__perf.rafCount,
      now,
      longTaskCount: inWindow.length,
      longTaskTotalMs: inWindow.reduce((total, task) => total + task.duration, 0),
    }
  }, start.now)

  // Still playing, therefore the whole window was playing. If the timeline had
  // run out the transport would have stopped itself and the frame rate above
  // would be an average over a stretch that was partly paused — a quietly wrong
  // number, which is worse than a failed benchmark. The scene is built with more
  // than 2x headroom (see SCENE_DURATION_SECONDS); this is the tripwire that
  // says so out loud if that ever stops being true.
  const pause = page.getByTitle('Pause (Space)')
  await expect(
    pause,
    'playback stopped before the measured window closed — the scene is too short for this window'
  ).toBeVisible({ timeout: 1000 })
  await pause.click()
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
 * With a `profileName`, the click-to-file span is recorded as
 * `perf-results/<profileName>.cpuprofile` (see {@link withCpuProfile}); the
 * measurement it returns is then profiler-skewed and should be discarded.
 *
 * Wall time is the span from the click that starts the encode to the browser
 * handing over the finished file — the whole user-visible export, prepare and
 * mux included, not just the frame loop.
 */
export async function measureExport(
  page: Page,
  cdp: CDPSession,
  format: 'mp4' | 'webm',
  profileName?: string
): Promise<ExportMeasurement> {
  // The same helpers the ESCAPEARTIST specs drive the dialog with — the
  // benchmark measures the export a test would trigger, not a private
  // approximation of it. Both are idempotent, which is what lets this run three
  // times in a row against a dialog that stays mounted between opens.
  await openExportDialog(page)
  await openExportAdvancedOptions(page)

  await page.getByRole('radio', { name: format === 'mp4' ? /MP4/ : /WebM/ }).check()
  await page
    .locator('select')
    .filter({ has: page.locator('option[value="480p"]') })
    .selectOption('720p')

  await page.evaluate(() => window.__perfReset())
  const heapStart = await readHeapAfterGc(page, cdp)

  const startedAt = Date.now()
  const download: Download = await withCpuProfile(page, cdp, profileName, async () => {
    const downloadPromise = page.waitForEvent('download', { timeout: 600_000 })
    await page
      .getByRole('button', { name: format === 'mp4' ? 'Download MP4' : 'Download WebM' })
      .last()
      .click()
    return downloadPromise
  })
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
