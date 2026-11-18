import { readFileSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, openExportAdvancedOptions, openExportDialog } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'
import { readWebmLayout } from '../../utils/webmLayout'

/**
 * ESCSUITE-454: an export through the in-page `<video>` path (WebM, GIF, and
 * MP4 in Safari) sometimes wrote the frame from before a seek. Chromium can
 * fire 'seeked' while the frame `drawImage` paints is still the one from
 * before the seek, so an exported frame repeated the one before it, at a cut
 * or anywhere else, now and then for several frames in a row. The exporter
 * now also waits for the frame callback it registers before each seek
 * (`apps/artist/src/core/presentedFrame.ts`, #1069).
 *
 * The source, `fixtures/presented-frame/frame-barcode.webm`, shows each
 * frame's own index as an 8-bit barcode, so a decoded frame names the source
 * frame it came from exactly, whatever the codec noise. The timeline is that
 * source cut into 120 three-frame pieces from scattered places, so the
 * exporter seeks far at every cut and one frame on inside each piece. The
 * exported WebM is decoded frame by frame, and every frame, each cut's first
 * included, must be the source frame the timeline puts there.
 *
 * Measured locally (Chromium, 10 runs in parallel, 2026-11-18): with the wait
 * removed, 10 of 10 runs failed, each with 2 to 20 wrong frames (95 in all,
 * 31 of them a cut's first frame, every one a frame from before its seek);
 * with it, 10 of 10 passed. The race is the engine's, so a run can still miss
 * it: one failure is the bug, one pass is not proof of the fix.
 *
 * Firefox runs it too, and passed 10 of 10 with the wait removed: the race is
 * Chromium's. WebKit's Linux port, which Playwright runs, paints a
 * `<video>` outside the document as black, so the export it would test is
 * black whatever the fix; the case skips where the probe below sees that.
 */

const FIXTURE = resolvePath(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/presented-frame/frame-barcode.webm'
)
/** The export's frame rate (`VIDEO_EXPORT_FRAME_RATE`). */
const FPS = 30
/**
 * The source's. At 50 fps every frame starts on a whole millisecond, all a
 * WebM timecode holds, so no seek lands on a rounded frame start; and export
 * frames, 5/3 of a source frame apart, each show a source frame of their own,
 * so a repeated frame is always visible.
 */
const SOURCE_FPS = 50
/** The source's size, and the project's. */
const WIDTH = 640
const HEIGHT = 360
/** Bits in the barcode: stripe k, left to right, is bit k of the frame's index. */
const BITS = 8
/**
 * Where each piece starts, in source frames: 1 + 97k mod 240, so no piece
 * starts where the one before it ended, and none shows source frame 0, whose
 * barcode (all black) is what an empty frame reads as.
 */
const PIECE_STARTS = Array.from({ length: 120 }, (_, k) => 1 + ((k * 97) % 240))
/** Export frames in each piece. */
const PIECE_FRAMES = 3

interface ClipShape extends Record<string, unknown> {
  id: string
  startTime: number
  endTime: number
  duration: number
  timelinePosition: number
}

interface ProjectShape {
  resolution: { width: number; height: number }
  timeline: { duration: number; clips: ClipShape[] }
}

/** The editor's project, through `GET_STATE`. */
function getProject(page: Page): Promise<ProjectShape> {
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

/**
 * Replace the one imported clip with the pieces of {@link PIECE_STARTS}, end to
 * end from 0, in a project of the source's size, through `LOAD_PROJECT` (see
 * `tests/export/decode-worker.spec.ts`). Returns the source frame each export
 * frame must show.
 */
async function cutIntoPieces(page: Page): Promise<number[]> {
  const project = await getProject(page)
  const [clip] = project.timeline.clips
  const expected: number[] = []
  project.timeline.clips = PIECE_STARTS.map((start, k) => {
    // Export frame j of the piece is source time start + j / FPS. The epsilon
    // keeps one that falls exactly on a source frame's start (every third)
    // from rounding down to the frame before.
    for (let j = 0; j < PIECE_FRAMES; j++) expected.push(start + Math.floor((j * SOURCE_FPS) / FPS + 1e-9))
    return {
      ...clip,
      id: `${clip.id}-piece-${k}`,
      startTime: start / SOURCE_FPS,
      endTime: start / SOURCE_FPS + PIECE_FRAMES / FPS,
      duration: PIECE_FRAMES / FPS,
      timelinePosition: (k * PIECE_FRAMES) / FPS,
    }
  })
  project.timeline.duration = (PIECE_STARTS.length * PIECE_FRAMES) / FPS
  project.resolution = { width: WIDTH, height: HEIGHT }
  await page.evaluate((payload) => window.postMessage({ type: 'LOAD_PROJECT', payload }, '*'), project)
  await expect(page.getByText(new RegExp(`^${PIECE_STARTS.length} clips`)).first()).toBeVisible({ timeout: 15_000 })
  return expected
}

/** Export the timeline as a WebM at project resolution and return its bytes. */
async function exportWebm(page: Page): Promise<Buffer> {
  await page.getByRole('radio', { name: /WebM/ }).check()
  await page.locator('select').filter({ has: page.locator('option[value="480p"]') }).selectOption('project')
  const download = page.waitForEvent('download', { timeout: 120_000 })
  // The Advanced panel's button sits after the primary "Download WebM" in the DOM.
  await page.getByRole('button', { name: 'Download WebM' }).last().click()
  return readFileSync(await (await download).path())
}

/**
 * Decode `bytes` (a WebM) in a `<video>` outside the document, as the exporter
 * holds its sources, and read the barcode of the frame at each of `times`
 * (seconds). Each read waits for the seek's frame callback as well as
 * 'seeked', or the reader itself could read the frame from before the seek
 * (ESCSUITE-437); the callback is registered before the seek, so it cannot
 * miss the frame, and the deadline only keeps a read from hanging.
 */
async function readBarcodes(page: Page, bytes: Buffer, times: number[]): Promise<number[]> {
  return page.evaluate(
    async ({ base64, times, bits }) => {
      const binary = atob(base64)
      const array = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([array], { type: 'video/webm' }))
      const video = document.createElement('video')
      video.muted = true
      // Without 'auto', a detached element in headless Chromium can keep
      // painting its first frame after a seek.
      video.preload = 'auto'
      video.src = url
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve()
        video.onerror = () => reject(new Error('the WebM did not load'))
      })
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      const values: number[] = []
      for (const time of times) {
        const presented = new Promise<void>((resolve) => {
          const fallback = setTimeout(resolve, 2_000)
          video.requestVideoFrameCallback(() => {
            clearTimeout(fallback)
            resolve()
          })
        })
        const seeked = new Promise<void>((resolve) => {
          video.onseeked = () => resolve()
        })
        video.currentTime = time
        await seeked
        await presented
        ctx.drawImage(video, 0, 0)
        // One row across the middle; stripe k's centre holds bit k.
        const row = ctx.getImageData(0, Math.floor(canvas.height / 2), canvas.width, 1).data
        let value = 0
        for (let k = 0; k < bits; k++) {
          const i = Math.floor(((k + 0.5) * canvas.width) / bits) * 4
          const luma = 0.299 * row[i] + 0.587 * row[i + 1] + 0.114 * row[i + 2]
          if (luma > 128) value |= 1 << k
        }
        values.push(value)
      }
      URL.revokeObjectURL(url)
      return values
    },
    { base64: bytes.toString('base64'), times, bits: BITS }
  )
}

test.describe('ESCSUITE-454: a WebM export writes the frame after each seek, not the one before', () => {
  test('every frame of an export cut into 120 pieces, each cut’s first included, is the source frame the timeline puts there', async ({ page }) => {
    test.setTimeout(180_000)
    await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
    await waitForAppReady(page, 'artist')

    // Source frame 51 (1.03 s; 0b00110011) read from the fixture by the same
    // detached-element reader the export is checked with.
    const probe = await readBarcodes(page, readFileSync(FIXTURE), [51.5 / SOURCE_FPS])
    test.skip(
      probe[0] !== 51,
      `This engine paints a <video> outside the document as ${probe[0] === 0 ? 'black' : `source frame ${probe[0]}`} (WebKit's Linux port does), so the in-page export draws no picture to check`
    )

    await importMediaAndAddToTimeline(page, FIXTURE)
    const expected = await cutIntoPieces(page)

    await openExportDialog(page)
    await openExportAdvancedOptions(page)
    test.skip(!(await page.getByRole('radio', { name: /WebM/ }).isEnabled()), 'This browser cannot export WebM')
    const bytes = await exportWebm(page)

    // The frames the file holds, by their place on the timeline.
    const frameMs = 1000 / FPS
    const frames = readWebmLayout(bytes).videoBlocks.map((block) => Math.round(block.time / frameMs))
    const cuts = PIECE_STARTS.map((_, k) => k * PIECE_FRAMES)
    expect(
      cuts.filter((n) => !frames.includes(n)),
      'cuts whose first frame is not in the exported file'
    ).toEqual([])

    // Mid-frame, so a read cannot land on the frame before by rounding.
    const read = await readBarcodes(page, bytes, frames.map((n) => (n + 0.5) / FPS))
    const wrong = frames.flatMap((n, i) => {
      if (read[i] === expected[n]) return []
      const stale = read[i] === expected[n - 1] ? ' (the frame before it)' : ''
      const cut = n % PIECE_FRAMES === 0 ? ', the first after a cut' : ''
      return [`frame ${n}${cut}: source frame ${read[i]}${stale}, want ${expected[n]}`]
    })
    expect(wrong, 'exported frames that are not the source frame the timeline puts there').toEqual([])
  })
})
