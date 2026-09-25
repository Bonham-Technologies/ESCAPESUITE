import { expect, type CDPSession, type Download, type Page } from '@playwright/test'
import { grantMediaPermissions, mockSyntheticMedia } from './media-mocks'
import {
  installPerfInstrumentation,
  readCdpTimedMetrics,
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
 * `installPerfInstrumentation`, `withCpuProfile`, `readCdpTimedMetrics`,
 * `readHeapAfterGc`, `round` — is imported, so the two sets of numbers are
 * taken with the same instruments and are comparable.
 *
 * The same discipline applies as over there. Nothing under `apps/craft/src`
 * exists for these benchmarks: a take is driven through the UI exactly as
 * `tests/escapecraft/mp4-download.spec.ts` drives one, and every number comes
 * from outside the page — `addInitScript` wrappers, a `PerformanceObserver`,
 * a CDP session.
 *
 * **Two window brackets here are deliberate twins of ones in `utils/perf.ts`**
 * and must be kept in step with them: {@link measureTake}'s reset / halved
 * warm-up / snapshot-pair / `withCpuProfile` sequence mirrors that file's
 * `measurePlayback`, and {@link measureMp4Conversion}'s download drain mirrors
 * its `measureExport`. They are duplicated rather than shared because factoring
 * them out would mean changing what the existing benchmarks call, and those
 * benchmarks' numbers are not allowed to move for this one's convenience. Where
 * a rule is shared — the long-task start-time attribution, say — the reasoning
 * lives in `measurePlayback` and is referenced from here rather than restated,
 * so there is one copy of it to keep true.
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

/**
 * Seconds of a take the numbers are actually taken over.
 *
 * One constant rather than the subtraction written twice: it is both the
 * divisor behind every per-second figure {@link measureTake} returns and the
 * `windowSeconds` the spec publishes, and the two must not be able to drift.
 */
export const TAKE_WINDOW_SECONDS = TAKE_SECONDS - TAKE_WARMUP_SECONDS

/** The capture size as the report labels it, e.g. `1280x720`. */
export const CAPTURE_SIZE_LABEL = `${CAPTURE_SIZE.width}x${CAPTURE_SIZE.height}`

/** The extra counter bag this module's init script installs on `window`. */
interface CraftPerfCounters {
  videoDraws: number
  /**
   * Frames handed to each `VideoEncoder`, in the order the encoders first
   * encoded one.
   *
   * A separate-tracks take runs two encoders on the main thread and the shared
   * `encodeCount` cannot tell them apart. Attribution is by **instance
   * identity**, not by the frame's size: both synthetic capture devices here
   * are {@link CAPTURE_SIZE}, so `codedWidth` is the same on both pipelines'
   * frames. The screen pipeline is built and started first
   * (`WebCodecsRecorder.initialize`), so index 0 is the screen — and the
   * benchmark's tripwire is what fails if that stops being true.
   */
  encodesByEncoder: number[]
  /**
   * Buffers handed to each `AudioEncoder`, in the order the encoders first
   * encoded one.
   *
   * Attributed by **instance identity**, exactly as the video ones are, and for
   * the same reason: nothing about a buffer says which pipeline it belongs to. A
   * separate-tracks take runs one for the mix on the primary output and one per
   * audio companion, all on the main thread; only the *count* of encoders that
   * encoded anything is read, as a tripwire (see {@link measureTake}).
   */
  audioEncodesByEncoder: number[]
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
 * a capture track, which is the quantity the compositor is judged on.
 *
 * Reading `videoDraws` as "compositor frames" rests on an invariant, and the
 * invariant is conditional rather than absolute. ESCAPECRAFT draws a video into
 * a canvas in five places:
 *
 * - `core/compositor.ts:171`, `:252` and `:281` — the compositor, which is the
 *   one this counter is for;
 * - `core/webcodecs-recorder.ts:480` and `:520` — `startVideoElementCapture`,
 *   the fallback `WebCodecsRecorder` uses when `MediaStreamTrackProcessor` is
 *   unavailable. It draws the preview `<video>` once per captured frame, on the
 *   main thread, **for the whole take**. The bundled Chromium has the track
 *   processor and never takes this path, but a runner that did not would put
 *   real draws inside a screen take's window;
 * - `core/thumbnailGenerator.ts:35`, `:95` and `utils/previewThumbnail.ts:31` —
 *   thumbnailing on Stop, and `core/converter.ts:136` — the MP4 conversion.
 *   Both run outside every measured window here.
 *
 * So the screen arm asserts `videoDraws === 0` and the PiP arm asserts it is
 * even; between them they pin the invariant instead of trusting this comment
 * (see {@link measureTake}).
 *
 * A separate-tracks take draws into the compositor canvas **and** encodes on the
 * main thread, which is why `videoDraws` and `framesEncoded` are both non-zero
 * there and neither is a fallback signal on its own.
 */
export async function installCraftPerfInstrumentation(page: Page): Promise<void> {
  await installPerfInstrumentation(page)

  await page.addInitScript(() => {
    const counters: CraftPerfCounters = {
      videoDraws: 0,
      encodesByEncoder: [],
      audioEncodesByEncoder: [],
    }
    window.__perfCraft = counters

    let encoderIndices = new WeakMap<object, number>()
    // Audio encoders that actually encoded something, attributed the same way
    // the video ones are. A separate-tracks take runs one for the mix on the
    // primary output and one per audio companion, all on the main thread.
    let audioEncoderIndices = new WeakMap<object, number>()

    // Chained, not replaced. Init scripts run in the order they were added, so
    // `installPerfInstrumentation`'s bag and its reset already exist here; a
    // reset that dropped the original would leave a benchmark clearing half
    // its counters and reporting the other half cumulatively.
    const resetShared = window.__perfReset
    window.__perfReset = () => {
      resetShared()
      counters.videoDraws = 0
      counters.encodesByEncoder.length = 0
      // A fresh map with the array: an index kept across a reset would point
      // past the end of it.
      encoderIndices = new WeakMap<object, number>()
      counters.audioEncodesByEncoder.length = 0
      audioEncoderIndices = new WeakMap<object, number>()
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

    const videoEncoder = (window as unknown as { VideoEncoder?: typeof VideoEncoder }).VideoEncoder
    if (videoEncoder) {
      // Chained on top of `installPerfInstrumentation`'s wrapper — init scripts
      // run in the order they were added — so the shared `encodeCount` is
      // unchanged and this only adds the attribution.
      const chainedEncode = videoEncoder.prototype.encode
      videoEncoder.prototype.encode = function attributedEncode(
        this: VideoEncoder,
        ...args: Parameters<VideoEncoder['encode']>
      ) {
        let index = encoderIndices.get(this)
        if (index === undefined) {
          index = counters.encodesByEncoder.length
          encoderIndices.set(this, index)
          counters.encodesByEncoder.push(0)
        }
        counters.encodesByEncoder[index]++
        return chainedEncode.apply(this, args)
      }
    }

    const audioEncoder = (window as unknown as { AudioEncoder?: typeof AudioEncoder }).AudioEncoder
    if (audioEncoder) {
      const nativeAudioEncode = audioEncoder.prototype.encode
      audioEncoder.prototype.encode = function countedAudioEncode(
        this: AudioEncoder,
        ...args: Parameters<AudioEncoder['encode']>
      ) {
        let index = audioEncoderIndices.get(this)
        if (index === undefined) {
          index = counters.audioEncodesByEncoder.length
          audioEncoderIndices.set(this, index)
          counters.audioEncodesByEncoder.push(0)
        }
        counters.audioEncodesByEncoder[index]++
        return nativeAudioEncode.apply(this, args)
      }
    }
  })
}

/**
 * Open ESCAPECRAFT with synthetic capture devices and the sources a benchmark
 * wants switched on.
 *
 * Screen is on by ESCAPECRAFT's own default and the microphone with it, so a
 * screen take needs no clicking at all, a PiP take needs exactly one — the
 * Webcam toggle — and a separate-tracks take needs that one plus the opt-in
 * toggle, which only exists once the webcam is on. Leaving the defaults alone is
 * deliberate: the benchmark should measure the take a user gets, and the live
 * microphone is what keeps the recorders' audio-level rAF loop running, which is
 * a real part of what a take costs the main thread.
 *
 * The wait before the first click is not optional. Capability detection is
 * async and the source toggles stay `disabled` until it answers; a take started
 * before then acquires no stream, and a benchmark would report the cost of
 * recording nothing.
 */
export async function openCraft(
  page: Page,
  options: { webcam: boolean; separateTracks?: boolean }
): Promise<void> {
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

    if (options.separateTracks) {
      // The opt-in mode (ESCSUITE-14): one recorder, two VideoEncoders, two
      // Mediabunny outputs, and the compositor drawing for the preview only.
      // Confirmed rather than assumed — a click that did not land would report
      // a composited PiP take under this benchmark's name.
      const separate = page.getByRole('button', { name: 'Record webcam as a separate track' })
      await expect(separate).toBeEnabled({ timeout: 30_000 })
      await separate.click()
      await expect(separate).toHaveAttribute('aria-pressed', 'true')
    }
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
export async function recordPlainTake(page: Page): Promise<void> {
  const rowsBefore = await recordingRows(page).count()
  await startTake(page)
  await page.waitForTimeout(TAKE_SECONDS * 1000)
  await stopTake(page, rowsBefore + 1)
}

/**
 * Record one separate-tracks take, measuring nothing.
 *
 * The composite MP4 benchmark needs a take with a camera half in it and does
 * not care what making it cost — `craft-separate-tracks-recording` is the arm
 * that measures that. Driven through the same two helpers `measureTake` uses,
 * so the files it converts are the files the recording benchmarks produce.
 *
 * Three rows, not one: the screen, the camera and the microphone, which is what
 * `openCraft(page, { webcam: true, separateTracks: true })` asks for with
 * ESCAPECRAFT's defaults left alone (system audio is off). Waiting for fewer
 * would pass on a transient half-saved library.
 */
export async function recordSeparateTracksTake(page: Page): Promise<void> {
  const rowsBefore = await recordingRows(page).count()
  await startTake(page)
  await page.waitForTimeout(TAKE_SECONDS * 1000)
  await stopTake(page, rowsBefore + 3)
}

/** Size of the newest stored recording, read straight out of IndexedDB. */
async function readNewestRecordingBytes(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('video-editor-db')
        request.onerror = () => reject(new Error('could not open video-editor-db'))
        // `onblocked` cannot be reached from here (nothing upgrades the schema),
        // but the transaction below throws *synchronously* if the store is
        // missing, and a throw inside this callback would leave the promise
        // pending for ever — i.e. a schema change would surface as a Playwright
        // timeout with no message rather than as an error naming the store.
        request.onblocked = () => reject(new Error('video-editor-db is blocked by another connection'))
        request.onsuccess = () => {
          let getAll: IDBRequest<unknown[]>
          try {
            getAll = request.result
              .transaction('videos', 'readonly')
              .objectStore('videos')
              .getAll()
          } catch (error) {
            reject(new Error(`could not open the videos store — ${String(error)}`))
            return
          }
          getAll.onerror = () => reject(new Error('could not read the videos store'))
          getAll.onsuccess = () => {
            const records = getAll.result as {
              blob: Blob
              metadata?: { recordedAt?: number; role?: string }
            }[]
            if (records.length === 0) {
              reject(new Error('no recording was stored'))
              return
            }
            // Newest by the timestamp the recorder wrote, not by store order:
            // `getAll` returns key order and the key is a uuid, which says
            // nothing about when a take was made.
            //
            // A separate-tracks take writes up to four records carrying the
            // identical `recordedAt` — one `now` for the whole take — so the
            // timestamp cannot order them and store order is uuid order, i.e.
            // a coin toss between the parts. The tie is broken towards the
            // **primary**, which is the part with no role or the role
            // 'screen', so `outputBytes` is always the same part of the take
            // and two runs of the benchmark are comparable. Every other arm
            // stores one record per take and never reaches the tie-break.
            const rank = (record: { metadata?: { recordedAt?: number; role?: string } }) => {
              const role = record.metadata?.role
              return [
                record.metadata?.recordedAt ?? 0,
                role === undefined || role === 'screen' ? 1 : 0,
              ] as const
            }
            const newest = records.reduce((newestSoFar, record) => {
              const [time, primary] = rank(record)
              const [bestTime, bestPrimary] = rank(newestSoFar)
              if (time !== bestTime) return time > bestTime ? record : newestSoFar
              return primary >= bestPrimary ? record : newestSoFar
            })
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
  /**
   * `VideoEncoder.encode` calls inside the window. Zero for a PiP take; both
   * pipelines' frames together for a separate-tracks one.
   */
  framesEncoded: number
  /** Encoded frames per second. Reported as 0 for PiP — see {@link measureTake}. */
  framesPerSecond: number
  /**
   * Frames handed to each encoder inside the window, screen first. One entry for
   * a screen take, two for a separate-tracks one, and empty for a MediaRecorder
   * take, which constructs no `VideoEncoder` at all.
   */
  framesEncodedPerEncoder: number[]
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
  /**
   * *All* renderer task time per recorded frame — an upper bound, not the
   * frame's own cost.
   *
   * `taskDurationMs` is everything the main thread did in the window: React,
   * the audio-level rAF loop, the preview `<video>`, and the harness's own
   * 33 ms source painter, as well as the recorder. So this is main-thread
   * milliseconds *per frame recorded*, which is the right thing to compare
   * between two commits and the wrong thing to quote as what a frame costs.
   */
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
 * The three modes are measured with the same instruments but the headline
 * number is not the same quantity, because the pipelines are not the same
 * design:
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
 *   and divided by two.
 *
 * - **separate tracks** (ESCSUITE-14, opt-in) goes through `WebCodecsRecorder`
 *   too, but with **two** encoders on one clock: a `MediaStreamTrackProcessor`
 *   reader per pipeline, both handing frames to `VideoEncoder.encode` on the
 *   main thread, into two Mediabunny outputs. `framesEncoded` is both
 *   pipelines' frames together and `framesEncodedPerEncoder` splits them, screen
 *   first. The `Compositor` still runs — it draws the **preview** the user
 *   watches — but nothing captures its canvas, so `videoDraws` is non-zero here
 *   without being the recording path.
 *
 *   Slice 3 gave the take's sound companions too, so the microphone is written
 *   as its own Opus file beside the mix on the primary: **two** `AudioEncoder`s
 *   on the same main thread, and **three** library rows per take. Neither is
 *   published — the audio encoders are counted only as a tripwire below, and
 *   the row count only so the wait after Stop is for this take's last part
 *   rather than its first.
 *
 *   What licenses the two divisors: `Compositor.drawFrame` draws the screen video and
 *   `drawWebcamOverlay` draws the webcam video, both inside **one synchronous
 *   rAF callback**, so no `page.evaluate` can ever observe a half-drawn frame.
 *   But each draw is guarded on its element's `readyState >= 2`
 *   (`core/compositor.ts:170`, `:175`), so a frame composited while a capture
 *   element has no decoded frame yields **one** draw, or none. The divisor is
 *   therefore exact whenever both tracks are live and silently wrong — it
 *   understates `compositedFps` and overstates `taskMsPerFrame` by the same
 *   factor — whenever one is not. An odd `videoDraws` is the signature of that,
 *   and is asserted against below rather than left to prose.
 *
 * `rafPerSecond` counts *every* animation-frame callback the page runs, which
 * for a take is more than one loop: both recorders drive the audio level
 * monitor from rAF (gated to one store write per 80 ms, but scheduled every
 * frame), and PiP adds the compositor's own loop on top. So ~60/s for a screen
 * take and ~120/s for PiP is the expected shape, not a doubled compositor. A
 * separate-tracks take is ~120/s too — the compositor still runs, for the
 * preview — even though nothing captures its canvas.
 */
export async function measureTake(
  page: Page,
  cdp: CDPSession,
  options: { webcam: boolean; separateTracks?: boolean },
  profileName?: string
): Promise<TakeMeasurement> {
  const rowsBefore = await recordingRows(page).count()
  // A separate-tracks take is one take in several files, so it lands as
  // several library rows (`useRecordingSave` writes every part in one pass).
  // Three here: the screen, the webcam and the microphone — `openCraft`
  // leaves ESCAPECRAFT's defaults alone and the microphone is one of them,
  // while system audio is off. Waiting for fewer would either time out or,
  // worse, pass on a transient half-saved library.
  const rowsPerTake = options.separateTracks ? 3 : 1

  // Reset before the click rather than after, so the encoder queue high-water
  // below covers the take from its very first frame. It is a maximum and not a
  // delta, so unlike every other counter here it cannot be windowed — it
  // therefore includes the warm-up, where a queue is most likely to be deepest.
  await page.evaluate(() => window.__perfReset())
  await startTake(page)

  await page.waitForTimeout((TAKE_WARMUP_SECONDS * 1000) / 2)
  const heapStart = await readHeapAfterGc(page, cdp)
  await page.waitForTimeout((TAKE_WARMUP_SECONDS * 1000) / 2)

  const cdpStart = await readCdpTimedMetrics(cdp)
  const start = await page.evaluate(() => ({
    raf: window.__perf.rafCount,
    encode: window.__perf.encodeCount,
    videoDraws: window.__perfCraft.videoDraws,
    encodesByEncoder: [...window.__perfCraft.encodesByEncoder],
    audioEncodesByEncoder: [...window.__perfCraft.audioEncodesByEncoder],
    now: performance.now(),
  }))

  await withCpuProfile(page, cdp, profileName, () =>
    page.waitForTimeout(TAKE_WINDOW_SECONDS * 1000)
  )

  const cdpEnd = await readCdpTimedMetrics(cdp)
  const end = await page.evaluate((windowStart: number) => {
    // Long tasks are attributed to the window by their START time. The rule and
    // the reasoning behind it are `measurePlayback`'s, in `utils/perf.ts` —
    // stated once, there, so there is one copy of it to keep true.
    const inWindow = window.__perf.longTasks.filter((task) => task.start >= windowStart)
    return {
      raf: window.__perf.rafCount,
      encode: window.__perf.encodeCount,
      videoDraws: window.__perfCraft.videoDraws,
      encodesByEncoder: [...window.__perfCraft.encodesByEncoder],
      audioEncodesByEncoder: [...window.__perfCraft.audioEncodesByEncoder],
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

  await stopTake(page, rowsBefore + rowsPerTake)
  const heapEnd = await readHeapAfterGc(page, cdp)

  const framesEncoded = end.encode - start.encode
  const videoDraws = end.videoDraws - start.videoDraws
  const framesEncodedPerEncoder = end.encodesByEncoder.map(
    (total, index) => total - (start.encodesByEncoder[index] ?? 0)
  )
  // Encoders that encoded at least one buffer inside the window. Local to the
  // tripwire and deliberately not returned: it is an invariant the numbers
  // rest on rather than a number worth publishing, so `perf-report.mjs` and
  // the result schema are untouched.
  const audioEncoders = end.audioEncodesByEncoder.filter(
    (total, index) => total - (start.audioEncodesByEncoder[index] ?? 0) > 0
  ).length

  // Each mode has ways of being wrong that would otherwise look fine: a screen
  // take that quietly fell back to MediaRecorder still produces a file and
  // still shows a row, and a PiP take whose webcam never arrived still records
  // the screen. Both would report plausible numbers for the wrong pipeline,
  // under the name of the right one. So each arm pins what it believes about
  // its own pipeline, in both directions.
  if (options.separateTracks) {
    // This arm's whole claim is "two encoders ran on the main thread and the
    // compositor only drew the preview". Both halves are pinned, because both
    // have a plausible-looking failure: a mode that silently fell back to
    // composited PiP encodes nothing here, and a companion that never started
    // leaves one encoder doing all the work at a respectable rate.
    expect(
      framesEncodedPerEncoder.length,
      `the separate-tracks take ran ${framesEncodedPerEncoder.length} encoder(s), not 2 — the webcam pipeline was not built, or the take fell back to composited PiP`
    ).toBe(2)
    expect(
      Math.min(...framesEncodedPerEncoder),
      `one pipeline encoded nothing (${framesEncodedPerEncoder.join(' / ')}) — a blob with no frames in it is not a track`
    ).toBeGreaterThan(0)
    expect(
      videoDraws,
      'the separate-tracks take did not composite for the preview — the user was watching nothing'
    ).toBeGreaterThan(0)
    // The same /2 divisor as the PiP arm, for the same reason: one screen draw
    // plus one webcam draw per composited preview frame.
    expect(
      videoDraws % 2,
      `the separate-tracks take drew ${videoDraws} videos — an odd count means a capture track was not ready for some frames, so the two-draws-per-composited-frame divisor is wrong`
    ).toBe(0)
    // The audio half of the same claim. A mode that recorded its sound into
    // the mix alone would still run two video encoders, still composite for
    // the preview and still look right in every number above — and would have
    // silently stopped producing the microphone file this arm is meant to
    // cost. Two: the mix on the primary output, and the microphone companion.
    expect(
      audioEncoders,
      `the separate-tracks take ran ${audioEncoders} audio encoder(s), not 2 — the microphone companion was not built, or the mix stopped being written to the primary`
    ).toBe(2)
  } else if (options.webcam) {
    expect(
      videoDraws,
      'the PiP take did not composite — no video was drawn into the compositor canvas'
    ).toBeGreaterThan(0)
    // The /2 divisor made checkable. Both draws happen inside one synchronous
    // rAF callback, so a snapshot can never land between them; each is guarded
    // on its element's `readyState >= 2`, so an odd total means some frame was
    // composited with one capture element not yet decoding. `compositedFps`
    // would then be understated and `taskMsPerFrame` overstated, both silently.
    expect(
      videoDraws % 2,
      `the PiP take drew ${videoDraws} videos — an odd count means a capture track was not ready for some frames, so the two-draws-per-composited-frame divisor is wrong`
    ).toBe(0)
  } else {
    expect(
      framesEncoded,
      'the screen take did not go through WebCodecsRecorder — nothing was encoded on the main thread'
    ).toBeGreaterThan(0)
    // Nothing should draw a video into a canvas during a screen take. If this
    // trips, `WebCodecsRecorder` took its `startVideoElementCapture` fallback
    // (no `MediaStreamTrackProcessor`), which draws the preview <video> once
    // per captured frame on the main thread — a different pipeline, reported
    // under this one's name, with `compositedFps` hard-zeroed and nothing else
    // to say so.
    expect(
      videoDraws,
      'the screen take drew video into a canvas — WebCodecsRecorder is on its startVideoElementCapture fallback, not the MediaStreamTrackProcessor path this benchmark reports'
    ).toBe(0)
  }

  const outputBytes = await readNewestRecordingBytes(page)

  // Two windows, not one, and they are one CDP round trip apart at each end:
  // the frame counts come from the two `page.evaluate` snapshots, the renderer
  // task time from the two `Performance.getMetrics` reads that bracket them.
  // Each is measured against its own clock — `performance.now()` in the page,
  // `Timestamp` from the metrics themselves — and turned into a *rate* before
  // the two are divided, so `taskMsPerFrame` is (task ms per second) / (frames
  // per second) and does not depend on the two brackets being the same length.
  const elapsedSeconds = (end.now - start.now) / 1000
  const taskDurationMs = (cdpEnd.TaskDuration - cdpStart.TaskDuration) * 1000
  const cdpSeconds = cdpEnd.Timestamp - cdpStart.Timestamp
  // Two `drawImage(<video>)` calls per composited frame; see the class comment.
  const compositedFrames = videoDraws / 2
  // A separate-tracks take encodes on the main thread like the screen arm does,
  // so its cost divides by frames encoded (both pipelines' frames) rather than
  // by composited preview frames.
  const framesForCost =
    options.webcam && !options.separateTracks ? compositedFrames : framesEncoded
  const framesPerSecondForCost = framesForCost / elapsedSeconds

  return {
    framesEncoded,
    // A PiP take's frames belong to MediaRecorder's own encoder thread and are
    // not observable from here. Reported as 0 rather than as a real-looking
    // rate derived from the zero encodes the main thread made. A separate-tracks
    // take encodes in the page, so its rate is real and is reported.
    framesPerSecond:
      options.webcam && !options.separateTracks ? 0 : round(framesEncoded / elapsedSeconds),
    framesEncodedPerEncoder,
    videoDraws,
    videoDrawsPerSecond: round(videoDraws / elapsedSeconds),
    // A screen take composites nothing, so there is no frame rate to halve. On a
    // separate-tracks take the compositor is drawing the preview rather than the
    // recording, and the rate it holds is still worth reporting.
    compositedFps: options.webcam ? round(compositedFrames / elapsedSeconds) : 0,
    rafPerSecond: round((end.raf - start.raf) / elapsedSeconds),
    taskDurationMs: round(taskDurationMs),
    // No zero guard: both arms' tripwires above have already established a
    // positive frame count for the mode this divides by.
    // `round(…, 3)` survives only in `perf-report.json` — the report's table
    // renders every millisecond value with `toFixed(2)`. Same as the gesture
    // benchmark's `jsMsPerFrame`; kept in step with it deliberately.
    taskMsPerFrame: round(taskDurationMs / cdpSeconds / framesPerSecondForCost, 3),
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
  /**
   * *All* renderer task time per encoded frame — the number a converter change
   * moves, and an upper bound on what one frame costs rather than the cost
   * itself (see {@link TakeMeasurement.taskMsPerFrame}).
   */
  taskMsPerFrame: number
  heapDeltaBytes: number
  encoderQueueHighWater: number
  /** Size of the MP4 the browser handed over. */
  outputBytes: number
  /**
   * `drawImage(<video>)` calls inside the conversion. One per encoded frame for
   * a plain conversion; **two** for the composite of a separate-tracks take —
   * the screen and then the camera. Nothing else in the page draws a video
   * while a conversion runs (the compositor stops at Stop, and thumbnailing
   * happens before the counters are reset), so this is the converter's own
   * count.
   */
  videoDraws: number
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
 *
 * With `composite: true` the newest take is a separate-tracks one and the
 * conversion re-composites it (ESCSUITE-14 decision 3): the same encode loop
 * with a second `<video>` drawn through `drawOverlay` into the same canvas. The
 * cost difference is one `drawImage` and one clip path per frame, which is what
 * `taskMsPerFrame` between the two arms measures.
 */
export async function measureMp4Conversion(
  page: Page,
  cdp: CDPSession,
  options: {
    /**
     * Whether the newest take is a separate-tracks one, so the conversion is
     * the composite. Turns on the two-draws-per-frame tripwire below; the plain
     * arm's assertions are untouched by it.
     */
    composite?: boolean
    profileName?: string
  } = {}
): Promise<Mp4ConversionMeasurement> {
  // The newest recording is the first row — the library sorts newest first —
  // and it is the one every run of this benchmark converts.
  const mp4Button = page.getByRole('button', { name: /Download .+ as MP4/ }).first()
  await expect(mp4Button).toBeEnabled({ timeout: 30_000 })

  await page.evaluate(() => window.__perfReset())
  const heapStart = await readHeapAfterGc(page, cdp)
  const cdpStart = await readCdpTimedMetrics(cdp)

  const startedAt = Date.now()
  const download: Download = await withCpuProfile(page, cdp, options.profileName, async () => {
    const downloadPromise = page.waitForEvent('download', { timeout: 600_000 })
    await mp4Button.click()
    return downloadPromise
  })
  const wallMs = Date.now() - startedAt

  const cdpEnd = await readCdpTimedMetrics(cdp)
  const counters = await page.evaluate(() => ({
    framesEncoded: window.__perf.encodeCount,
    encoderQueueHighWater: window.__perf.encodeQueueHighWater,
    videoDraws: window.__perfCraft.videoDraws,
  }))
  const heapEnd = await readHeapAfterGc(page, cdp)

  // The twin of `measureExport`'s drain in `utils/perf.ts`; keep the two in
  // step. Deleted rather than kept: three runs of three benchmarks would
  // otherwise leave nine multi-megabyte files in Playwright's download
  // directory, and the only thing the file is read for is its size.
  const stream = await download.createReadStream()
  let outputBytes = 0
  for await (const chunk of stream) outputBytes += (chunk as Buffer).byteLength
  await download.delete()

  // A conversion that produced no frames produced no video, whatever the file
  // says. `convertToMP4` resolves rather than rejects once past its capture
  // phase, so an empty result is a real possible outcome and not a hypothetical.
  expect(
    counters.framesEncoded,
    'the conversion encoded no frames — there is nothing in the MP4 to have measured'
  ).toBeGreaterThan(0)

  if (options.composite) {
    // Exact, and the whole reason this arm exists: a composite frame is the
    // screen drawn once and the camera drawn once. Anything else means either
    // the overlay was never drawn — in which case this is a plain conversion
    // reported under the composite's name — or the screen was passed over
    // twice, which at this capture size is the most expensive thing the loop
    // could do twice.
    expect(
      counters.videoDraws,
      'the composite did not draw exactly two videos per encoded frame'
    ).toBe(counters.framesEncoded * 2)
  }

  // Back to idle before the next run starts: the row's progress bar gone and
  // its button live again. One conversion runs at a time, so starting the next
  // click before this is true would click a disabled button.
  await expect(page.getByRole('progressbar', { name: /Converting .+ to MP4/ })).toHaveCount(0, {
    timeout: 30_000,
  })
  await expect(mp4Button).toBeEnabled({ timeout: 30_000 })

  // Rates before the division, as in `measureTake`: the renderer task time is
  // bracketed by the two `Performance.getMetrics` reads and the frame count by
  // the click-to-download span, which are not the same window. Dividing task ms
  // per second by frames per second makes the ratio independent of that.
  const taskDurationMs = (cdpEnd.TaskDuration - cdpStart.TaskDuration) * 1000
  const cdpSeconds = cdpEnd.Timestamp - cdpStart.Timestamp
  const framesPerSecond = counters.framesEncoded / (wallMs / 1000)

  return {
    wallMs,
    framesEncoded: counters.framesEncoded,
    framesPerSecond: round(framesPerSecond),
    taskDurationMs: round(taskDurationMs),
    taskMsPerFrame: round(taskDurationMs / cdpSeconds / framesPerSecond, 3),
    heapDeltaBytes: heapEnd - heapStart,
    encoderQueueHighWater: counters.encoderQueueHighWater,
    outputBytes,
    videoDraws: counters.videoDraws,
  }
}
