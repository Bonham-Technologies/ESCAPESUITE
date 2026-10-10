import { test, expect, type Page, type Browser } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ARTIST_FIXTURE_MP4,
  ARTIST_URL,
  importMediaAndAddToTimeline,
  openExportAdvancedOptions,
  openExportDialog,
} from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-254: the WebCodecs decode worker had never decoded a frame.
 *
 * `decodeWorker.ts` armed mp4box's sample extraction after `appendBuffer()`
 * had already parsed the whole in-memory file, so every source threw
 * "No keyframes found in video", `FrameSourceFactory.createSource` caught it
 * with a `console.warn`, and every MP4 export since the worker shipped decoded
 * in the page — while the log said "Using WebCodecs" and the dialog promised
 * background-tab encoding. Nothing caught it: the "Background Tab Export" case
 * in `errors/export.spec.ts` exports a text-only project (no source, no
 * decode), and the `export-mp4` benchmark counts *encoded* frames, which the
 * fallback produces just the same.
 *
 * These cases export projects with real video sources through the dialog and
 * hold three things:
 *
 * 1. The worker actually decodes — counted on the main thread by wrapping the
 *    `Worker` constructor and tallying the `FRAME_READY` messages it posts
 *    back (no production code exists for the test's sake) — with no
 *    per-source fallback warning and no in-page decoding notice.
 * 2. Parity: the same project exported with the worker forced off (the
 *    `<video>` path, the pre-ESCSUITE-254 behaviour and so the oracle) and on
 *    produces the same picture, frame for frame, within a stated tolerance.
 * 3. Rotation: a source whose `tkhd` display matrix rotates it exports in the
 *    orientation the preview shows.
 *
 * Which engines take the worker at all is decided by an allow-list,
 * `apps/artist/src/core/workerDecodeEngine.ts`: Chromium and Firefox, the two
 * whose worker output was measured against their own <video>. These cases run
 * in Chromium, the one CI runs. Firefox 155 was last run here with the skip
 * lifted for ESCSUITE-265: every parity case matched (MAD 0.000, the
 * full-range source 0.195-0.356), the trimmed clip included, and one case is
 * known to fail there:
 * - the rotated source: Firefox's VideoDecoder drops `rotation`, so the source
 *   is refused to <video> by design and `expectWorkerDecoded` fails.
 * The trimmed clip's earlier failure (the previous colour segment at export
 * frames 25-26, 68.3/255) was the <video> oracle, not the worker: frame 26 was
 * ESCSUITE-263's seek skip, and frame 25 a seek to a frame's exact start, which
 * both engines' <video> resolved to the frame before it on one start in three
 * (ESCSUITE-265; the segment-start frames below are what catch it — with the
 * fix removed, Chromium measured 70.5 at frame 8 and Firefox 66.8 at frame 25
 * of the trimmed clip). WebKit is not on the list
 * (measured 4.46-17.45/255 apart) and cannot import media under Playwright
 * anyway (IndexedDB refuses the Blob). Lifting the skip for another engine is
 * ESCSUITE-262, which has to account for the one known Firefox failure.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolvePath(HERE, '../../fixtures/decode-worker')

/**
 * 2 s, 30 fps, 160x120 H.264 with B-frames and an edit list: a horizontal luma
 * ramp (so a flipped or mis-scaled picture is visible) whose colour changes
 * every 8 frames (so a frame from the wrong part of the timeline is visible).
 * See fixtures/decode-worker/README.md.
 */
const SEGMENTS_MP4 = resolvePath(FIXTURES, 'segments.mp4')
/** The same picture at 640x480, its VUI tagging BT.709 primaries, transfer and matrix. */
const TAGGED_709_480P_MP4 = resolvePath(FIXTURES, 'tagged709-480p.mp4')
/** The same picture at 640x480, signalling full range and no colour description. */
const FULL_RANGE_480P_MP4 = resolvePath(FIXTURES, 'fullrange-480p.mp4')
/**
 * The 160x120 picture with its VUI tagging only the matrix (BT.709; primaries
 * and transfer unspecified). Chromium's <video> draws it with its BT.601 size
 * guess and a config-less VideoDecoder as BT.709: the one shape where giving
 * the guess to a stream that tags *something* changes Chromium's pixels.
 */
const PARTIAL_TAG_MP4 = resolvePath(FIXTURES, 'partial-tag.mp4')
/**
 * `segments.mp4` with a `colr` box saying BT.601 (6/6/6) and BT.709 (1/1/1)
 * respectively, over its untagged bitstream: a description the decoder cannot
 * see, so the worker hands it over. Chromium's <video> follows the box.
 */
const COLR_ONLY_601_MP4 = resolvePath(FIXTURES, 'colr-only-601.mp4')
const COLR_ONLY_709_MP4 = resolvePath(FIXTURES, 'colr-only-709.mp4')
/**
 * 320x180 coded, red left / blue right, display matrix rotating it to 180x320,
 * blue on top. The one display rotation pinned end to end here (270° clockwise
 * in WebCodecs terms, ffmpeg's "90"); the matrix-to-rotation reading of all
 * four is pinned by `apps/artist/src/workers/mp4Demux.test.ts`, and 90° and
 * 180° were each compared against Chromium's <video> once, by hand
 * (ESCSUITE-254 report).
 */
const ROTATED_MP4 = resolvePath(FIXTURES, 'rotated.mp4')

const FALLBACK_WARNING = 'falling back to HTMLVideoElement'
const IN_PAGE_NOTICE = 'Decoding in the page; keep this tab in the foreground'

/**
 * Parity tolerance: mean absolute difference per RGB channel, out of 255.
 * Both exports go through the same H.264 encoder at the same settings, so a
 * correctly decoded source differs only by encoder noise (measured 0.05-0.27
 * in Chromium 153). A wrong frame (the colour changes every 8 source frames),
 * a missing one (black) or a flipped one (the luma ramp reverses) differs by
 * tens. The breakage closest to the bound, and the reason it is 1.5 rather
 * than 4: decoding an untagged SD source as BT.709 where `<video>` assumes
 * BT.601, measured at 3.70 on frame 25 of `segments.mp4`.
 */
const PARITY_TOLERANCE = 1.5

declare global {
  interface Window {
    __decodeWorker: { framesReady: number; workersStarted: number }
    __inPageNoticeSeen: boolean
  }
}

interface ProbeOptions {
  /** Make `new Worker()` throw, so the export takes the `<video>` path. */
  forceNoWorker?: boolean
}

interface ExportOptions extends ProbeOptions {
  resolution: 'project' | '480p'
  /** Trim the clip to start this many seconds into its source, still at the timeline's start. */
  trimStart?: number
}

/**
 * Install the page-side probes before the app loads: a `Worker` wrapper that
 * counts the decode worker's FRAME_READY replies, and a MutationObserver that
 * remembers whether the in-page decoding notice was ever rendered (it is a
 * transient progress line, so absence at the end proves nothing).
 */
async function installProbes(page: Page, { forceNoWorker = false }: ProbeOptions = {}) {
  await page.addInitScript(
    ({ forceNoWorker, notice }) => {
      window.__decodeWorker = { framesReady: 0, workersStarted: 0 }
      window.__inPageNoticeSeen = false
      const RealWorker = window.Worker
      // A subclass rather than a Proxy so `instanceof Worker` and every
      // prototype method behave exactly as before.
      class CountingWorker extends RealWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          if (forceNoWorker) throw new Error('Worker disabled by the ESCSUITE-254 parity test')
          super(url, options)
          window.__decodeWorker.workersStarted++
          this.addEventListener('message', (event: MessageEvent) => {
            if ((event.data as { type?: string } | null)?.type === 'FRAME_READY') {
              window.__decodeWorker.framesReady++
            }
          })
        }
      }
      window.Worker = CountingWorker
      const watch = () => {
        new MutationObserver(() => {
          if (!window.__inPageNoticeSeen && document.body.textContent?.includes(notice)) {
            window.__inPageNoticeSeen = true
          }
        }).observe(document.documentElement, { childList: true, subtree: true, characterData: true })
      }
      if (document.documentElement) watch()
      else document.addEventListener('DOMContentLoaded', watch)
    },
    { forceNoWorker, notice: IN_PAGE_NOTICE }
  )
}

interface ExportRun {
  /** The exported MP4's bytes. */
  bytes: Buffer
  /** Every console message, prefixed with its type. */
  logs: string[]
  framesReady: number
  inPageNoticeSeen: boolean
}

/** Export the open project as an MP4 through the dialog and return the file's bytes. */
async function exportMp4FromDialog(page: Page, resolution: 'project' | '480p'): Promise<Buffer> {
  await openExportDialog(page)
  await openExportAdvancedOptions(page)
  await page.getByRole('radio', { name: /MP4/ }).check()
  await page
    .locator('select')
    .filter({ has: page.locator('option[value="480p"]') })
    .selectOption(resolution)

  const downloadPromise = page.waitForEvent('download', { timeout: 120_000 })
  await page.getByRole('button', { name: 'Download MP4' }).first().click()
  return readFileSync(await (await downloadPromise).path())
}

/** Open ESCAPEARTIST in `page` and put `file` on the timeline, recording every console message. */
async function openWithSource(page: Page, file: string): Promise<string[]> {
  const logs: string[] = []
  page.on('console', (message) => logs.push(`${message.type()}: ${message.text()}`))
  await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
  await waitForAppReady(page, 'artist')
  await importMediaAndAddToTimeline(page, file)
  return logs
}

async function readProbes(page: Page) {
  return page.evaluate(() => ({
    framesReady: window.__decodeWorker.framesReady,
    inPageNoticeSeen: window.__inPageNoticeSeen,
  }))
}

/**
 * Trim the one clip on the timeline to start `seconds` into its source, kept
 * at the timeline's start, through the documented integration API: `GET_STATE`
 * for the project, `LOAD_PROJECT` for the edited one. Both are posted from the
 * page to itself, which `initIntegration` accepts at the top level (see
 * `utils/perf.ts`'s `loadPerfScene`).
 */
async function trimClipStart(page: Page, seconds: number): Promise<void> {
  const project = await getProject(page)
  const [clip] = project.timeline.clips
  const end = clip.startTime + clip.duration
  Object.assign(clip, { startTime: seconds, duration: end - seconds, endTime: end, timelinePosition: 0 })
  project.timeline.duration = end - seconds
  await page.evaluate((payload) => window.postMessage({ type: 'LOAD_PROJECT', payload }, '*'), project)
  await expect.poll(async () => (await getProject(page)).timeline.clips[0].startTime, { timeout: 15_000 }).toBe(seconds)
}

interface ProjectShape {
  timeline: { duration: number; clips: Array<{ startTime: number; duration: number; endTime: number; timelinePosition: number }> }
}

/** The editor's project, through `GET_STATE`. */
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

/** Open ESCAPEARTIST in `page`, import `file`, put it on the timeline and export it as an MP4. */
async function importAndExportMp4(
  page: Page,
  file: string,
  { resolution, trimStart }: Pick<ExportOptions, 'resolution' | 'trimStart'>
): Promise<ExportRun> {
  const logs = await openWithSource(page, file)
  if (trimStart !== undefined) await trimClipStart(page, trimStart)
  const bytes = await exportMp4FromDialog(page, resolution)
  return { bytes, logs, ...(await readProbes(page)) }
}

/** Run `importAndExportMp4` in a fresh browser context (its own IndexedDB), with the given probes. */
async function exportInFreshContext(browser: Browser, file: string, { resolution, trimStart, ...probes }: ExportOptions) {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await installProbes(page, probes)
    return await importAndExportMp4(page, file, { resolution, trimStart })
  } finally {
    await context.close()
  }
}

interface DecodedFrame {
  width: number
  height: number
  /** RGBA, row-major. */
  data: number[]
}

/**
 * Decode `bytes` (an MP4) in a `<video>` in `page`, seek to `time` and return
 * the frame's pixels — or, given `centre`, only a rectangle of that size from
 * the middle of the frame (a 1080p frame is eight million numbers to carry
 * back from the page; the part that holds the source is a few hundred
 * thousand).
 */
async function frameAt(
  page: Page,
  bytes: Buffer,
  time: number,
  centre?: { width: number; height: number }
): Promise<DecodedFrame> {
  return page.evaluate(
    async ({ base64, time, centre }) => {
      const binary = atob(base64)
      const array = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([array], { type: 'video/mp4' }))
      const video = document.createElement('video')
      video.muted = true
      // Without 'auto', a detached element in headless Chromium can keep
      // painting its first frame after a seek.
      video.preload = 'auto'
      video.src = url
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve()
        video.onerror = () => reject(new Error('the exported MP4 did not load'))
      })
      video.currentTime = time
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve()
      })
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(video, 0, 0)
      const width = centre?.width ?? canvas.width
      const height = centre?.height ?? canvas.height
      const x = Math.floor((canvas.width - width) / 2)
      const y = Math.floor((canvas.height - height) / 2)
      const data = Array.from(ctx.getImageData(x, y, width, height).data)
      URL.revokeObjectURL(url)
      return { width, height, data }
    },
    { base64: bytes.toString('base64'), time, centre }
  )
}

interface FrameComparison {
  /** Mean absolute difference per RGB channel over the source's region, out of 255. */
  mad: number
  regionWidth: number
  regionHeight: number
}

/**
 * Decode the MP4s `x` and `y` in two `<video>` elements in `page` and, for
 * each `[timeInX, timeInY]` pair, compare the two frames over the region where
 * `y`'s frame is not black (the source; the project background around it is
 * black in both), inset two pixels so the encoder's edge ringing is not
 * counted. Only a `centre`-sized rectangle from the middle of each frame is
 * read, and the arithmetic stays in the page: a 1080p frame is eight million
 * numbers to carry back. `x` and `y` may be the same file.
 */
async function compareFrames(
  page: Page,
  x: Buffer,
  y: Buffer,
  pairs: Array<[number, number]>,
  centre: { width: number; height: number }
): Promise<FrameComparison[]> {
  return page.evaluate(
    async ({ xBase64, yBase64, pairs, centre }) => {
      const open = async (base64: string) => {
        const binary = atob(base64)
        const array = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i)
        const video = document.createElement('video')
        video.muted = true
        // Without 'auto', a detached element in headless Chromium can keep
        // painting its first frame after a seek.
        video.preload = 'auto'
        video.src = URL.createObjectURL(new Blob([array], { type: 'video/mp4' }))
        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve()
          video.onerror = () => reject(new Error('the exported MP4 did not load'))
        })
        return video
      }
      const read = async (video: HTMLVideoElement, time: number) => {
        video.currentTime = time
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve()
        })
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(video, 0, 0)
        return ctx.getImageData(
          Math.floor((canvas.width - centre.width) / 2),
          Math.floor((canvas.height - centre.height) / 2),
          centre.width,
          centre.height
        ).data
      }
      const xVideo = await open(xBase64)
      const yVideo = await open(yBase64)
      const results = []
      for (const [timeInX, timeInY] of pairs) {
        const a = await read(xVideo, timeInX)
        const b = await read(yVideo, timeInY)
        let x0 = centre.width
        let y0 = centre.height
        let x1 = -1
        let y1 = -1
        for (let row = 0; row < centre.height; row++) {
          for (let col = 0; col < centre.width; col++) {
            const i = (row * centre.width + col) * 4
            if (Math.max(b[i], b[i + 1], b[i + 2]) > 12) {
              x0 = Math.min(x0, col)
              y0 = Math.min(y0, row)
              x1 = Math.max(x1, col)
              y1 = Math.max(y1, row)
            }
          }
        }
        x0 += 2
        y0 += 2
        x1 -= 2
        y1 -= 2
        let sum = 0
        let count = 0
        for (let row = y0; row <= y1; row++) {
          for (let col = x0; col <= x1; col++) {
            const i = (row * centre.width + col) * 4
            for (let c = 0; c < 3; c++) {
              sum += Math.abs(a[i + c] - b[i + c])
              count++
            }
          }
        }
        results.push({ mad: sum / count, regionWidth: x1 - x0 + 1, regionHeight: y1 - y0 + 1 })
      }
      for (const video of [xVideo, yVideo]) URL.revokeObjectURL(video.src)
      return results
    },
    { xBase64: x.toString('base64'), yBase64: y.toString('base64'), pairs, centre }
  )
}

type Colour = 'red' | 'blue' | 'other'

/** Classify the pixel at a fractional position of a frame as clearly red, clearly blue, or neither. */
function colourAt(frame: DecodedFrame, fx: number, fy: number): Colour {
  const x = Math.min(frame.width - 1, Math.floor(frame.width * fx))
  const y = Math.min(frame.height - 1, Math.floor(frame.height * fy))
  const i = (y * frame.width + x) * 4
  const [r, g, b] = [frame.data[i], frame.data[i + 1], frame.data[i + 2]]
  if (r > 150 && g < 100 && b < 100) return 'red'
  if (b > 150 && r < 100 && g < 100) return 'blue'
  return 'other'
}

/** The bytes start with an ISO BMFF `ftyp` box — the download is an MP4, not an empty or HTML file. */
function expectMp4(bytes: Buffer) {
  expect(bytes.byteLength).toBeGreaterThan(1000)
  expect(bytes.subarray(4, 8).toString('latin1')).toBe('ftyp')
}

/** The worker decoded the export: no fallback, no notice, and at least `frames` frames answered by the worker. */
function expectWorkerDecoded(run: ExportRun, frames = 1) {
  expect(run.logs.some((line) => line.includes('[MP4 Export] Using WebCodecs'))).toBe(true)
  expect(run.logs.filter((line) => line.includes(FALLBACK_WARNING))).toEqual([])
  expect(run.framesReady).toBeGreaterThanOrEqual(frames)
  expect(run.inPageNoticeSeen).toBe(false)
}

interface ParityCase {
  name: string
  file: string
  /** The source's own size: drawn at native size in the middle of the 1080p project. */
  width: number
  height: number
  trimStart?: number
  /** Frames of the export the timeline makes, all decoded by the worker for its one clip. */
  exportedFrames: number
  /**
   * Export frames compared: the first (the edit list's first presented
   * frame), two mid-timeline frames that are each the second frame of an
   * 8-frame colour segment (a source frame two or more early, the edit list
   * ignored, lands in the previous segment), and the last (the end-of-stream
   * flush). The middle two are in different segments, which is what proves a
   * reader is not stuck on one frame.
   *
   * Any further frames are the first frame of a colour segment whose start is
   * not a whole number of microseconds (ESCSUITE-265): a reader that lands one
   * microsecond short of a frame's start shows the previous frame, and only at
   * a segment's first frame is that a different colour. Chromium's <video> did
   * so on the starts whose fraction is .67 µs, Firefox's on the .33 ones.
   */
  frames: [number, number, number, number, ...number[]]
}

const PARITY_CASES: ParityCase[] = [
  {
    // Frame 8 starts at 266666.67 µs, frame 16 at 533333.33 µs.
    name: 'an untagged 160x120 source',
    file: SEGMENTS_MP4,
    width: 160,
    height: 120,
    exportedFrames: 60,
    frames: [0, 25, 41, 59, 8, 16],
  },
  {
    name: 'a BT.709-tagged 640x480 source, which must keep its own colours',
    file: TAGGED_709_480P_MP4,
    width: 640,
    height: 480,
    exportedFrames: 60,
    frames: [0, 25, 41, 59],
  },
  {
    name: 'a full-range 640x480 source',
    file: FULL_RANGE_480P_MP4,
    width: 640,
    height: 480,
    exportedFrames: 60,
    frames: [0, 25, 41, 59],
  },
  {
    name: 'a 160x120 source whose VUI tags only its matrix',
    file: PARTIAL_TAG_MP4,
    width: 160,
    height: 120,
    exportedFrames: 60,
    frames: [0, 25, 41, 59],
  },
  {
    name: 'a 160x120 source whose colr box alone says BT.601',
    file: COLR_ONLY_601_MP4,
    width: 160,
    height: 120,
    exportedFrames: 60,
    frames: [0, 25, 41, 59],
  },
  {
    // Under 720 lines, so the size guess would be BT.601: the box is what
    // makes it BT.709.
    name: 'a 160x120 source whose colr box alone says BT.709',
    file: COLR_ONLY_709_MP4,
    width: 160,
    height: 120,
    exportedFrames: 60,
    frames: [0, 25, 41, 59],
  },
  {
    // Starts 15 frames in, so export frames 10, 26 and 44 are source frames
    // 25, 41 and 59, and export frames 17 and 25 are source frames 32
    // (1066666.67 µs) and 40 (1333333.33 µs), the first of their segments.
    name: 'a clip trimmed to start 0.5 s into its source',
    file: SEGMENTS_MP4,
    width: 160,
    height: 120,
    trimStart: 0.5,
    exportedFrames: 45,
    frames: [0, 10, 26, 44, 17, 25],
  },
]

test.describe('MP4 export decodes in the WebCodecs worker (ESCSUITE-254)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'measured in Chromium only; see the file comment')

  test('a real video source is decoded by the worker, with no fallback and no in-page notice', async ({ browser }) => {
    test.setTimeout(180_000)

    const run = await exportInFreshContext(browser, ARTIST_FIXTURE_MP4, { resolution: '480p' })

    expectWorkerDecoded(run)
    expectMp4(run.bytes)
  })

  for (const parity of PARITY_CASES) {
    test(`the worker export matches the <video> export frame for frame: ${parity.name}`, async ({ browser, page }) => {
      test.setTimeout(300_000)

      // At the project's own 1920x1080 the source is drawn at native size
      // (scale 1 is native pixels), so the compared region is the source's
      // own pixels rather than a downscaled blur of them.
      const options = { resolution: 'project' as const, trimStart: parity.trimStart }
      const withWorker = await exportInFreshContext(browser, parity.file, options)
      const withoutWorker = await exportInFreshContext(browser, parity.file, { ...options, forceNoWorker: true })

      // The two runs took the two paths they were meant to.
      expectWorkerDecoded(withWorker, parity.exportedFrames)
      expect(withoutWorker.logs.some((line) => line.includes('[MP4 Export] Using HTMLVideoElement'))).toBe(true)
      expect(withoutWorker.framesReady).toBe(0)
      expect(withoutWorker.inPageNoticeSeen).toBe(true)
      expectMp4(withWorker.bytes)
      expectMp4(withoutWorker.bytes)

      await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
      await waitForAppReady(page, 'artist')
      const centre = { width: parity.width + 40, height: parity.height + 40 }
      // Sampled half a frame in, so the exported file's own frame boundaries
      // cannot decide it.
      const at = (frame: number) => (frame + 0.5) / 30

      // Not vacuous: the two middle frames are in different colour segments,
      // so a reader stuck on one frame (or an export that froze) cannot pass.
      const [segments] = await compareFrames(page, withoutWorker.bytes, withoutWorker.bytes, [[at(parity.frames[1]), at(parity.frames[2])]], centre)
      expect(segments.mad).toBeGreaterThan(20)

      const results = await compareFrames(
        page,
        withWorker.bytes,
        withoutWorker.bytes,
        parity.frames.map((frame) => [at(frame), at(frame)]),
        centre
      )
      results.forEach(({ mad, regionWidth, regionHeight }, index) => {
        console.log(
          `[ESCSUITE-254 parity] ${parity.name}, frame ${parity.frames[index]}: MAD ${mad.toFixed(3)} / 255 ` +
            `over the source's ${regionWidth}x${regionHeight} region`
        )
        // Not vacuous: the source itself, less the inset, is what is compared.
        expect(regionWidth).toBeGreaterThan(parity.width - 10)
        expect(regionHeight).toBeGreaterThan(parity.height - 10)
        expect(mad).toBeLessThan(PARITY_TOLERANCE)
      })
    })
  }

  test('a rotated source exports in the orientation its <video> preview shows', async ({ page }) => {
    test.setTimeout(180_000)
    await installProbes(page)
    const logs = await openWithSource(page, ROTATED_MP4)

    // The preview draws a source through a <video> element, which honours
    // the display matrix: the 320x180 red-left/blue-right picture stands up
    // as 180x320, blue on top. That element is the reference here, read the
    // same way as the export below. The preview canvas itself is not sampled.
    // It was left out because its paused first paint could land before the
    // source's first decoded frame and stay black — fixed and pinned since by
    // ESCSUITE-264 (`tests/escapeartist/preview-first-paint.spec.ts`; the
    // "every run after a frame step" was the one-second step landing on this
    // one-second source's own end, where black is correct). The element stays
    // the reference: it is what the canvas draws from, read without the
    // project's letterbox in the way.
    const shown = await frameAt(page, readFileSync(ROTATED_MP4), 0.5)
    expect([shown.width, shown.height]).toEqual([180, 320])
    const shownOrientation = { top: colourAt(shown, 0.5, 0.25), bottom: colourAt(shown, 0.5, 0.75) }
    expect(shownOrientation).toEqual({ top: 'blue', bottom: 'red' })

    const bytes = await exportMp4FromDialog(page, '480p')

    expectWorkerDecoded({ bytes, logs, ...(await readProbes(page)) })
    expectMp4(bytes)
    // At native size in the 1920x1080 project the source spans y 380..700 —
    // 35% to 65% of the height — so 42% and 58% are well inside each half.
    const exported = await frameAt(page, bytes, 0.5)
    expect({ top: colourAt(exported, 0.5, 0.42), bottom: colourAt(exported, 0.5, 0.58) }).toEqual(shownOrientation)
  })
})
