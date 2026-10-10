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
 * Chromium only: Firefox and WebKit are not part of CI's e2e job. Run here
 * once each with the skip lifted (ESCSUITE-254): Firefox 155 decodes in the
 * worker and matches its own <video> export (MAD 0.34 and 0.92 at frames 25
 * and 41), and keeps a rotated source on <video> because its VideoDecoder
 * drops `rotation`; WebKit 26.6 cannot import media under Playwright at all
 * (IndexedDB refuses the Blob), and its worker is refused by
 * `workers/decoderConfig.ts` on a measured colour mismatch.
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
/** 320x180 coded, red left / blue right, display matrix rotating it to 180x320, blue on top. */
const ROTATED_MP4 = resolvePath(FIXTURES, 'rotated.mp4')

const FALLBACK_WARNING = 'falling back to HTMLVideoElement'
const IN_PAGE_NOTICE = 'Decoding in the page; keep this tab in the foreground'

/**
 * Parity tolerance: mean absolute difference per RGB channel, out of 255.
 * Both exports go through the same H.264 encoder at the same settings, so a
 * correctly decoded source differs only by encoder noise; a wrong frame (the
 * colour changes every 8 source frames), a missing one (black) or a flipped
 * one (the luma ramp reverses) differs by tens.
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

/** Open ESCAPEARTIST in `page`, import `file`, put it on the timeline and export it as an MP4. */
async function importAndExportMp4(page: Page, file: string, resolution: 'project' | '480p'): Promise<ExportRun> {
  const logs = await openWithSource(page, file)
  const bytes = await exportMp4FromDialog(page, resolution)
  return { bytes, logs, ...(await readProbes(page)) }
}

/** Run `importAndExportMp4` in a fresh browser context (its own IndexedDB), with the given probes. */
async function exportInFreshContext(browser: Browser, file: string, { resolution, ...probes }: ExportOptions) {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await installProbes(page, probes)
    return await importAndExportMp4(page, file, resolution)
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

interface Region {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * Where the source was drawn: the bounding box of the reference frame's
 * non-black pixels, inset two pixels so the encoder's edge ringing is not
 * counted. The project background is black and the source sits at native
 * size in the middle of it, so a difference taken over the whole frame would
 * be diluted a hundredfold by background both paths draw identically.
 */
function sourceRegion(frame: DecodedFrame): Region {
  let x0 = frame.width
  let y0 = frame.height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const i = (y * frame.width + x) * 4
      if (Math.max(frame.data[i], frame.data[i + 1], frame.data[i + 2]) > 12) {
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      }
    }
  }
  return { x0: x0 + 2, y0: y0 + 2, x1: x1 - 2, y1: y1 - 2 }
}

/** Mean absolute difference per RGB channel (alpha ignored) over `region`, out of 255. */
function meanAbsoluteDifference(a: DecodedFrame, b: DecodedFrame, region: Region): number {
  expect([a.width, a.height]).toEqual([b.width, b.height])
  let sum = 0
  let count = 0
  for (let y = region.y0; y <= region.y1; y++) {
    for (let x = region.x0; x <= region.x1; x++) {
      const i = (y * a.width + x) * 4
      for (let c = 0; c < 3; c++) {
        sum += Math.abs(a.data[i + c] - b.data[i + c])
        count++
      }
    }
  }
  return sum / count
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

function expectWorkerDecoded(run: ExportRun) {
  expect(run.logs.some((line) => line.includes('[MP4 Export] Using WebCodecs'))).toBe(true)
  expect(run.logs.filter((line) => line.includes(FALLBACK_WARNING))).toEqual([])
  expect(run.framesReady).toBeGreaterThan(0)
  expect(run.inPageNoticeSeen).toBe(false)
}

test.describe('MP4 export decodes in the WebCodecs worker (ESCSUITE-254)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'measured in Chromium only; see the file comment')

  test('a real video source is decoded by the worker, with no fallback and no in-page notice', async ({ browser }) => {
    test.setTimeout(180_000)

    const run = await exportInFreshContext(browser, ARTIST_FIXTURE_MP4, { resolution: '480p' })

    expectWorkerDecoded(run)
    expectMp4(run.bytes)
  })

  test('the worker export matches the <video> export frame for frame', async ({ browser, page }) => {
    test.setTimeout(300_000)

    // At the project's own 1920x1080 the 160x120 source is drawn at native
    // size (scale 1 is native pixels), so the compared region is the source's
    // own pixels rather than a downscaled blur of them.
    const withWorker = await exportInFreshContext(browser, SEGMENTS_MP4, { resolution: 'project' })
    const withoutWorker = await exportInFreshContext(browser, SEGMENTS_MP4, {
      resolution: 'project',
      forceNoWorker: true,
    })

    // The two runs took the two paths they were meant to.
    expectWorkerDecoded(withWorker)
    expect(withoutWorker.logs.some((line) => line.includes('[MP4 Export] Using HTMLVideoElement'))).toBe(true)
    expect(withoutWorker.framesReady).toBe(0)
    expect(withoutWorker.inPageNoticeSeen).toBe(true)
    expectMp4(withWorker.bytes)
    expectMp4(withoutWorker.bytes)

    // Mid-timeline frames 25 and 41, each the second frame of an 8-frame
    // colour segment: a source frame two or more early (the edit list
    // ignored) lands in the previous segment. Sampled half a frame in, so the
    // exported file's own frame boundaries cannot decide it.
    await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
    await waitForAppReady(page, 'artist')
    // The 160x120 source sits at native size in the middle of the 1080p frame.
    const centre = { width: 200, height: 160 }
    // Not vacuous: the two sampled frames are in different colour segments,
    // so a reader stuck on one frame (or an export that froze) cannot pass.
    const early = await frameAt(page, withoutWorker.bytes, 25.5 / 30, centre)
    const late = await frameAt(page, withoutWorker.bytes, 41.5 / 30, centre)
    expect(meanAbsoluteDifference(early, late, sourceRegion(early))).toBeGreaterThan(20)
    for (const frameIndex of [25, 41]) {
      const time = (frameIndex + 0.5) / 30
      const a = await frameAt(page, withWorker.bytes, time, centre)
      const b = await frameAt(page, withoutWorker.bytes, time, centre)
      const region = sourceRegion(b)
      // Not vacuous: the 160x120 source, minus the inset, is what is compared.
      expect(region.x1 - region.x0).toBeGreaterThan(150)
      expect(region.y1 - region.y0).toBeGreaterThan(110)
      const mad = meanAbsoluteDifference(a, b, region)
      console.log(
        `[ESCSUITE-254 parity] frame ${frameIndex}: MAD ${mad.toFixed(3)} / 255 over the source's ` +
          `${region.x1 - region.x0 + 1}x${region.y1 - region.y0 + 1} region`
      )
      expect(mad).toBeLessThan(PARITY_TOLERANCE)
    }
  })

  test('a rotated source exports in the orientation its <video> preview shows', async ({ page }) => {
    test.setTimeout(180_000)
    await installProbes(page)
    const logs = await openWithSource(page, ROTATED_MP4)

    // The preview draws a source through a <video> element, which honours
    // the display matrix: the 320x180 red-left/blue-right picture stands up
    // as 180x320, blue on top. That element is the reference here, read the
    // same way as the export below. The preview canvas itself is not sampled:
    // its paused first paint can land before the source's first decoded
    // frame and stay black (about one headless run in three, and every run
    // after a frame step), which would make this pin flaky for a reason that
    // has nothing to do with decoding.
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
