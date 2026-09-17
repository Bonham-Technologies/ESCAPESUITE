import { expect, type CDPSession, type Download, type Page } from '@playwright/test'
import { grantMediaPermissions, mockSyntheticMedia } from './media-mocks'
import {
  installPerfInstrumentation,
  readCdpMetrics,
  readHeapAfterGc,
  round,
  withCpuProfile,
} from './perf'

/**
 * Benchmark plumbing for ESCAPECRAFT's half of `tests/perf/`.
 *
 * Separate from `utils/perf.ts` rather than bolted onto it: that file is the
 * ESCAPEARTIST scene and the windows measured over it, it is already over a
 * thousand lines, and nothing here shares a scene with it. What is shared —
 * `installPerfInstrumentation`, `withCpuProfile`, `readCdpMetrics`,
 * `readHeapAfterGc`, `round` — is imported, so the two sets of numbers are
 * taken with the same instruments and are comparable.
 *
 * The same discipline applies as over there. Nothing under `apps/craft/src`
 * exists for these benchmarks: a take is driven through the UI exactly as
 * `tests/escapecraft/mp4-download.spec.ts` drives one, and every number comes
 * from outside the page — `addInitScript` wrappers, a `PerformanceObserver`,
 * a CDP session.
 */

/** ESCAPECRAFT's dev server, started by `playwright.perf.config.ts`. */
export const CRAFT_URL = 'http://localhost:5174'

/**
 * Seconds a benchmarked take records for, start click to stop click.
 *
 * The same six seconds a playback window uses (`PLAYBACK_SECONDS`), for the
 * same reason: long enough that the per-second figures are not dominated by
 * the first frames, short enough that three runs of three benchmarks stay
 * inside a `pnpm perf` a person will actually wait for.
 */
export const TAKE_SECONDS = 6

/**
 * Warm-up discarded from the front of every take window.
 *
 * A take's first frames pay for opening the encoder, sizing the canvas and
 * getting the first decoded frame out of the capture track; charging those to
 * a steady-state frame rate would report a recorder that never reaches the
 * rate it in fact holds. The forced GC that anchors the heap reading is taken
 * inside this stretch so its pause never lands in the measured window — the
 * same arrangement as `measurePlayback`.
 */
export const TAKE_WARMUP_SECONDS = 1

/**
 * Capture size the synthetic devices report.
 *
 * 720p rather than `mockSyntheticMedia`'s 640x360 default, so the encode is a
 * real one: at 640x360 a frame is a fifth of the pixels and the benchmark
 * would mostly be reporting the cost of the harness around it. It is also the
 * size the compositor caps itself at (`Compositor`'s `maxDim = 1280`), so the
 * PiP arm composites at exactly its own ceiling rather than being scaled down
 * before anything is measured.
 */
export const CAPTURE_SIZE = { width: 1280, height: 720 } as const

/** The capture size as the report labels it, e.g. `1280x720`. */
export const CAPTURE_SIZE_LABEL = `${CAPTURE_SIZE.width}x${CAPTURE_SIZE.height}`

/** The extra counter bag this module's init script installs on `window`. */
interface CraftPerfCounters {
  videoDraws: number
}

declare global {
  interface Window {
    __perfCraft: CraftPerfCounters
  }
}

/**
 * Install the shared counters, plus the one ESCAPECRAFT needs that they do not
 * provide.
 *
 * A PiP take never touches `VideoEncoder`: `recorder-factory.ts` forces
 * MediaRecorder for PiP, which encodes off the main thread, so the shared
 * `encode` wrapper counts zero and there is nothing to divide a per-frame cost
 * by. What the main thread does pay for is the `Compositor`'s render loop —
 * one `drawImage(screenVideo)` plus one `drawImage(webcamVideo)` into the
 * capture canvas per composited frame — so that is what gets counted.
 *
 * The filter is `args[0] instanceof HTMLVideoElement`. Counting every
 * `drawImage` would also sweep in any image or canvas blit the page makes;
 * counting only the video ones makes `videoDraws` a count of frames drawn from
 * a capture track, which is the quantity the compositor is judged on. During a
 * take nothing else in ESCAPECRAFT draws a video into a canvas — the two other
 * call sites are `thumbnailGenerator.ts` and `converter.ts`, and both run after
 * a take has been stopped, outside every measured window.
 */
export async function installCraftPerfInstrumentation(page: Page): Promise<void> {
  await installPerfInstrumentation(page)

  await page.addInitScript(() => {
    const counters: CraftPerfCounters = { videoDraws: 0 }
    window.__perfCraft = counters

    // Chained, not replaced. Init scripts run in the order they were added, so
    // `installPerfInstrumentation`'s bag and its reset already exist here; a
    // reset that dropped the original would leave a benchmark clearing half
    // its counters and reporting the other half cumulatively.
    const resetShared = window.__perfReset
    window.__perfReset = () => {
      resetShared()
      counters.videoDraws = 0
    }

    // `drawImage` is overloaded three ways (3, 5 and 9 arguments), which no
    // single typed signature covers; the wrapper forwards whatever it was
    // given untouched and only reads argument 0.
    const context2d = CanvasRenderingContext2D.prototype as unknown as {
      drawImage: (...args: unknown[]) => void
    }
    const nativeDrawImage = context2d.drawImage
    context2d.drawImage = function patchedDrawImage(
      this: CanvasRenderingContext2D,
      ...args: unknown[]
    ) {
      if (args[0] instanceof HTMLVideoElement) counters.videoDraws++
      return nativeDrawImage.apply(this, args)
    }
  })
}

/**
 * Open ESCAPECRAFT with synthetic capture devices and the sources a benchmark
 * wants switched on.
 *
 * Screen is on by ESCAPECRAFT's own default and the microphone with it, so a
 * screen take needs no clicking at all and a PiP take needs exactly one — the
 * Webcam toggle. Leaving the defaults alone is deliberate: the benchmark should
 * measure the take a user gets, and the live microphone is what keeps the
 * recorders' audio-level rAF loop running, which is a real part of what a take
 * costs the main thread.
 *
 * The wait before the first click is not optional. Capability detection is
 * async and the source toggles stay `disabled` until it answers; a take started
 * before then acquires no stream, and a benchmark would report the cost of
 * recording nothing.
 */
export async function openCraft(page: Page, options: { webcam: boolean }): Promise<void> {
  await mockSyntheticMedia(page, CAPTURE_SIZE)
  await grantMediaPermissions(page)

  await page.goto(CRAFT_URL)
  await page.waitForLoadState('networkidle')

  const screenToggle = page.getByRole('button', { name: 'Screen', exact: true })
  await expect(screenToggle).toBeEnabled({ timeout: 30_000 })
  await expect(screenToggle).toHaveAttribute('aria-pressed', 'true')

  if (options.webcam) {
    const webcamToggle = page.getByRole('button', { name: 'Webcam', exact: true })
    await expect(webcamToggle).toBeEnabled({ timeout: 30_000 })
    await webcamToggle.click()
    // Screen *and* webcam is what makes the take PiP, and PiP is what routes it
    // through the compositor and MediaRecorder. Confirmed rather than assumed:
    // a click that did not land would silently downgrade the benchmark to a
    // second screen take reported under the PiP name.
    await expect(webcamToggle).toHaveAttribute('aria-pressed', 'true')
  }
}

/** Buttons offering to hand a stored recording to the editor — one per row. */
function recordingRows(page: Page) {
  return page.getByRole('button', { name: /Open .+ in Editor/ })
}

/**
 * Click Start and wait until the take is actually recording.
 *
 * "Pause recording" replacing "Start recording" is the app's own statement that
 * capture is running. It is also what absorbs the countdown — three seconds by
 * `defaultConfig` — without the benchmark having to know how long that is.
 */
async function startTake(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible({
    timeout: 30_000,
  })
}

/**
 * Click Stop and wait until the take has been written to IndexedDB.
 *
 * `expectedRows` is how many recordings the library should hold once this take
 * lands, so the wait is for *this* take's row rather than for any row — after
 * the second run there are two, and a plain "a row is visible" check would pass
 * on the previous one before the current take had finished saving.
 */
async function stopTake(page: Page, expectedRows: number): Promise<void> {
  await page.getByRole('button', { name: 'Stop recording' }).click()
  await expect(recordingRows(page)).toHaveCount(expectedRows, { timeout: 60_000 })
}

/**
 * Record one plain take, measuring nothing.
 *
 * The MP4 conversion benchmark needs a recording to convert and does not care
 * what making it cost. Driven through the same two helpers `measureTake` uses,
 * so the file it converts is the same file the recording benchmarks produce.
 */
export async function recordPlainTake(page: Page, seconds: number = TAKE_SECONDS): Promise<void> {
  const rowsBefore = await recordingRows(page).count()
  await startTake(page)
  await page.waitForTimeout(seconds * 1000)
  await stopTake(page, rowsBefore + 1)
}

/** Size of the newest stored recording, read straight out of IndexedDB. */
async function readNewestRecordingBytes(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('video-editor-db')
        request.onerror = () => reject(new Error('could not open video-editor-db'))
        request.onsuccess = () => {
          const getAll = request.result
            .transaction('videos', 'readonly')
            .objectStore('videos')
            .getAll()
          getAll.onerror = () => reject(new Error('could not read the videos store'))
          getAll.onsuccess = () => {
            const records = getAll.result as {
              blob: Blob
              metadata?: { recordedAt?: number }
            }[]
            if (records.length === 0) {
              reject(new Error('no recording was stored'))
              return
            }
            // Newest by the timestamp the recorder wrote, not by store order:
            // `getAll` returns key order and the key is a uuid, which says
            // nothing about when a take was made.
            const newest = records.reduce((newestSoFar, record) =>
              (record.metadata?.recordedAt ?? 0) >= (newestSoFar.metadata?.recordedAt ?? 0)
                ? record
                : newestSoFar
            )
            // `blob.size` only — reading the bytes back would base64 a
            // multi-megabyte file through the CDP connection for a number the
            // Blob already knows.
            resolve(newest.blob.size)
          }
        }
      })
  )
}

export interface TakeMeasurement {
  /** `VideoEncoder.encode` calls inside the window. Zero for a PiP take. */
  framesEncoded: number
  /** Encoded frames per second. Reported as 0 for PiP — see {@link measureTake}. */
  framesPerSecond: number
  /** `drawImage(<video>)` calls inside the window. Zero for a screen take. */
  videoDraws: number
  /** Video draws per second. */
  videoDrawsPerSecond: number
  /** Composited frames per second. Reported as 0 for screen — see {@link measureTake}. */
  compositedFps: number
  /** Animation-frame callbacks per second, across every loop the page runs. */
  rafPerSecond: number
  /** Renderer task time inside the window. */
  taskDurationMs: number
  /** Renderer task time per recorded frame — what one frame costs the main thread. */
  taskMsPerFrame: number
  layoutCount: number
  recalcStyleCount: number
  longTaskCount: number
  longTaskTotalMs: number
  heapDeltaBytes: number
  /** Deepest the encoder's queue got. Zero for PiP, which never encodes here. */
  encoderQueueHighWater: number
  /** Size of the WebM the take wrote to IndexedDB. */
  outputBytes: number
}

/**
 * Record one take and measure a window inside it.
 *
 * With a `profileName`, the window is recorded as
 * `perf-results/<profileName>.cpuprofile` (see `withCpuProfile`); the
 * measurement it returns is then profiler-skewed and should be discarded.
 *
 * The two modes are measured with the same instruments but the headline number
 * is not the same quantity, because the two recorders are not the same design:
 *
 * - **screen** goes through `WebCodecsRecorder`. A `MediaStreamTrackProcessor`
 *   reader hands every captured `VideoFrame` to `VideoEncoder.encode` **on the
 *   main thread**, so `framesEncoded` is the take's frame count and
 *   `taskDurationMs / framesEncoded` is what encoding one frame costs. Nothing
 *   composites, so `compositedFps` is reported as 0 rather than as a
 *   meaningless fraction of zero draws.
 * - **PiP** goes through the `Compositor` into **MediaRecorder**, which encodes
 *   off the main thread. `framesEncoded` is 0 by construction and is reported
 *   as such; the main thread's work is the compositor's, counted as video draws
 *   and divided by two — `drawFrame` draws the screen video and
 *   `drawWebcamOverlay` draws the webcam video, so a composited frame is
 *   exactly two `drawImage(<video>)` calls (`core/compositor.ts`).
 *
 * `rafPerSecond` counts *every* animation-frame callback the page runs, which
 * for a take is more than one loop: both recorders drive the audio level
 * monitor from rAF (gated to one store write per 80 ms, but scheduled every
 * frame), and PiP adds the compositor's own loop on top. So ~60/s for a screen
 * take and ~120/s for PiP is the expected shape, not a doubled compositor.
 */
export async function measureTake(
  page: Page,
  cdp: CDPSession,
  options: { webcam: boolean },
  profileName?: string
): Promise<TakeMeasurement> {
  const windowSeconds = TAKE_SECONDS - TAKE_WARMUP_SECONDS
  const rowsBefore = await recordingRows(page).count()

  // Reset before the click rather than after, so the encoder queue high-water
  // below covers the take from its very first frame. It is a maximum and not a
  // delta, so unlike every other counter here it cannot be windowed — it
  // therefore includes the warm-up, where a queue is most likely to be deepest.
  await page.evaluate(() => window.__perfReset())
  await startTake(page)

  await page.waitForTimeout((TAKE_WARMUP_SECONDS * 1000) / 2)
  const heapStart = await readHeapAfterGc(page, cdp)
  await page.waitForTimeout((TAKE_WARMUP_SECONDS * 1000) / 2)

  const cdpStart = await readCdpMetrics(cdp)
  const start = await page.evaluate(() => ({
    raf: window.__perf.rafCount,
    encode: window.__perf.encodeCount,
    videoDraws: window.__perfCraft.videoDraws,
    now: performance.now(),
  }))

  await withCpuProfile(page, cdp, profileName, () => page.waitForTimeout(windowSeconds * 1000))

  const cdpEnd = await readCdpMetrics(cdp)
  const end = await page.evaluate((windowStart: number) => {
    // Long tasks are attributed to the window by their START time, so a task
    // straddling the window's opening is excluded whole and one straddling its
    // close is included whole. The same rule, for the same reason, as
    // `measurePlayback` in `utils/perf.ts` — a long task is one unit of jank
    // and splitting its duration across a boundary would report two shorter
    // stalls that nobody experienced.
    const inWindow = window.__perf.longTasks.filter((task) => task.start >= windowStart)
    return {
      raf: window.__perf.rafCount,
      encode: window.__perf.encodeCount,
      videoDraws: window.__perfCraft.videoDraws,
      encoderQueueHighWater: window.__perf.encodeQueueHighWater,
      now: performance.now(),
      longTaskCount: inWindow.length,
      longTaskTotalMs: inWindow.reduce((total, task) => total + task.duration, 0),
    }
  }, start.now)

  // Still recording, therefore the whole window was recording. If the take had
  // died — a capture track ending, a storage refusal, an encoder error — the
  // app would have left the recording state and every rate above would be an
  // average over a stretch that was not capturing. A quietly wrong number is
  // worse than a failed benchmark; this is the tripwire that says so out loud.
  // Same principle as `measurePlayback`'s still-playing check.
  await expect(
    page.getByRole('button', { name: 'Pause recording' }),
    'the take stopped before the measured window closed — nothing was being recorded for part of it'
  ).toBeVisible({ timeout: 1000 })

  await stopTake(page, rowsBefore + 1)
  const heapEnd = await readHeapAfterGc(page, cdp)

  const framesEncoded = end.encode - start.encode
  const videoDraws = end.videoDraws - start.videoDraws

  // Each mode has one way of being wrong that would otherwise look fine: a
  // screen take that quietly fell back to MediaRecorder still produces a file
  // and still shows a row, and a PiP take whose webcam never arrived still
  // records the screen. Both would report plausible numbers for the wrong
  // pipeline, under the name of the right one.
  if (options.webcam) {
    expect(
      videoDraws,
      'the PiP take did not composite — no video was drawn into the compositor canvas'
    ).toBeGreaterThan(0)
  } else {
    expect(
      framesEncoded,
      'the screen take did not go through WebCodecsRecorder — nothing was encoded on the main thread'
    ).toBeGreaterThan(0)
  }

  const outputBytes = await readNewestRecordingBytes(page)

  const elapsedSeconds = (end.now - start.now) / 1000
  const taskDurationMs = (cdpEnd.TaskDuration - cdpStart.TaskDuration) * 1000
  // Two `drawImage(<video>)` calls per composited frame; see the class comment.
  const compositedFrames = videoDraws / 2
  const framesForCost = options.webcam ? compositedFrames : framesEncoded

  return {
    framesEncoded,
    // A PiP take's frames belong to MediaRecorder's own encoder thread and are
    // not observable from here. Reported as 0 rather than as a real-looking
    // rate derived from the zero encodes the main thread made.
    framesPerSecond: options.webcam ? 0 : round(framesEncoded / elapsedSeconds),
    videoDraws,
    videoDrawsPerSecond: round(videoDraws / elapsedSeconds),
    // A screen take composites nothing, so there is no frame rate to halve.
    compositedFps: options.webcam ? round(compositedFrames / elapsedSeconds) : 0,
    rafPerSecond: round((end.raf - start.raf) / elapsedSeconds),
    taskDurationMs: round(taskDurationMs),
    taskMsPerFrame: framesForCost > 0 ? round(taskDurationMs / framesForCost, 3) : 0,
    layoutCount: cdpEnd.LayoutCount - cdpStart.LayoutCount,
    recalcStyleCount: cdpEnd.RecalcStyleCount - cdpStart.RecalcStyleCount,
    longTaskCount: end.longTaskCount,
    longTaskTotalMs: round(end.longTaskTotalMs),
    heapDeltaBytes: heapEnd - heapStart,
    encoderQueueHighWater: end.encoderQueueHighWater,
    outputBytes,
  }
}

export interface Mp4ConversionMeasurement {
  /** Click to file: the whole user-visible conversion, prepare and mux included. */
  wallMs: number
  framesEncoded: number
  framesPerSecond: number
  taskDurationMs: number
  /** Renderer task time per encoded frame — the number a converter change moves. */
  taskMsPerFrame: number
  heapDeltaBytes: number
  encoderQueueHighWater: number
  /** Size of the MP4 the browser handed over. */
  outputBytes: number
}

/**
 * Convert the newest recording to MP4 and measure it.
 *
 * With a `profileName`, the click-to-file span is recorded as
 * `perf-results/<profileName>.cpuprofile` (see `withCpuProfile`); the
 * measurement it returns is then profiler-skewed and should be discarded.
 *
 * `convertToMP4` (`apps/craft/src/core/converter.ts`) plays the stored WebM in
 * an offscreen `<video>` and captures each frame from a
 * `requestVideoFrameCallback`, so the conversion runs at **playback speed by
 * design**: `wallMs` has a floor of roughly the take's own length, whatever the
 * machine. That makes wall time a poor regression signal on its own —
 * `taskMsPerFrame` is what a change to the converter actually moves, and
 * `framesPerSecond` says whether the page is keeping up with the playback it is
 * bound to rather than falling behind it.
 *
 * A precondition, not a step: the page must already hold a recording (see
 * {@link recordPlainTake}), and the caller must have established that this
 * browser can encode H.264 (`canConvertToMp4`).
 */
export async function measureMp4Conversion(
  page: Page,
  cdp: CDPSession,
  profileName?: string
): Promise<Mp4ConversionMeasurement> {
  // The newest recording is the first row — the library sorts newest first —
  // and it is the one every run of this benchmark converts.
  const mp4Button = page.getByRole('button', { name: /Download .+ as MP4/ }).first()
  await expect(mp4Button).toBeEnabled({ timeout: 30_000 })

  await page.evaluate(() => window.__perfReset())
  const heapStart = await readHeapAfterGc(page, cdp)
  const cdpStart = await readCdpMetrics(cdp)

  const startedAt = Date.now()
  const download: Download = await withCpuProfile(page, cdp, profileName, async () => {
    const downloadPromise = page.waitForEvent('download', { timeout: 600_000 })
    await mp4Button.click()
    return downloadPromise
  })
  const wallMs = Date.now() - startedAt

  const cdpEnd = await readCdpMetrics(cdp)
  const counters = await page.evaluate(() => ({
    framesEncoded: window.__perf.encodeCount,
    encoderQueueHighWater: window.__perf.encodeQueueHighWater,
  }))
  const heapEnd = await readHeapAfterGc(page, cdp)

  const stream = await download.createReadStream()
  let outputBytes = 0
  for await (const chunk of stream) outputBytes += (chunk as Buffer).byteLength
  // Deleted rather than kept: three runs of three benchmarks would otherwise
  // leave nine multi-megabyte files in Playwright's download directory, and the
  // only thing the file is read for is its size.
  await download.delete()

  // A conversion that produced no frames produced no video, whatever the file
  // says. `convertToMP4` resolves rather than rejects once past its capture
  // phase, so an empty result is a real possible outcome and not a hypothetical.
  expect(
    counters.framesEncoded,
    'the conversion encoded no frames — there is nothing in the MP4 to have measured'
  ).toBeGreaterThan(0)

  // Back to idle before the next run starts: the row's progress bar gone and
  // its button live again. One conversion runs at a time, so starting the next
  // click before this is true would click a disabled button.
  await expect(page.getByRole('progressbar', { name: /Converting .+ to MP4/ })).toHaveCount(0, {
    timeout: 30_000,
  })
  await expect(mp4Button).toBeEnabled({ timeout: 30_000 })

  const taskDurationMs = (cdpEnd.TaskDuration - cdpStart.TaskDuration) * 1000

  return {
    wallMs,
    framesEncoded: counters.framesEncoded,
    framesPerSecond: round(counters.framesEncoded / (wallMs / 1000)),
    taskDurationMs: round(taskDurationMs),
    taskMsPerFrame: round(taskDurationMs / counters.framesEncoded, 3),
    heapDeltaBytes: heapEnd - heapStart,
    encoderQueueHighWater: counters.encoderQueueHighWater,
    outputBytes,
  }
}
