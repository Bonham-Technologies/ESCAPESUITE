import { readFileSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, openExportAdvancedOptions, openExportDialog } from '../../utils/artist'
import { cutIntoPieces, exportWebmAtProjectResolution, readBarcodes, wrongFrames } from '../../utils/frameBarcode'
import { waitForAppReady } from '../../utils/ready'

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
 * black whatever the fix; the case skips in WebKit where the probe below sees
 * that. In any other engine a failed probe fails the case rather than
 * skipping it, so a probe that misreads cannot hide the check.
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
/**
 * Where each piece starts, in source frames: 1 + 97k mod 240, so no piece
 * starts where the one before it ended, and none shows source frame 0, whose
 * barcode (all black) is what an empty frame reads as.
 */
const PIECE_STARTS = Array.from({ length: 120 }, (_, k) => 1 + ((k * 97) % 240))
/** Export frames in each piece. */
const PIECE_FRAMES = 3

/**
 * The source frame each export frame must show. Export frame j of a piece is
 * source time start + j / FPS; the epsilon keeps one that falls exactly on a
 * source frame's start (every third) from rounding down to the frame before.
 */
const EXPECTED = PIECE_STARTS.flatMap((start) =>
  Array.from({ length: PIECE_FRAMES }, (_, j) => start + Math.floor((j * SOURCE_FPS) / FPS + 1e-9))
)

test.describe('ESCSUITE-454: a WebM export writes the frame after each seek, not the one before', () => {
  test('every frame of an export cut into 120 pieces, each cut’s first included, is the source frame the timeline puts there', async ({ page, browserName }) => {
    test.setTimeout(180_000)
    await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
    await waitForAppReady(page, 'artist')

    // Source frame 51 (1.03 s; 0b00110011) read from the fixture by the same
    // detached-element reader the export is checked with.
    const probe = await readBarcodes(page, readFileSync(FIXTURE), [51.5 / SOURCE_FPS])
    test.skip(
      browserName === 'webkit' && probe[0] !== 51,
      `This engine paints a <video> outside the document as ${probe[0] === 0 ? 'black' : `source frame ${probe[0]}`} (WebKit's Linux port does), so the in-page export draws no picture to check`
    )
    expect(probe[0], 'source frame 51 read from the fixture by the detached-element reader').toBe(51)

    await importMediaAndAddToTimeline(page, FIXTURE)
    const pieces = PIECE_STARTS.map((start, k) => ({
      startTime: start / SOURCE_FPS,
      duration: PIECE_FRAMES / FPS,
      timelinePosition: (k * PIECE_FRAMES) / FPS,
    }))
    await cutIntoPieces(page, pieces, {
      width: WIDTH,
      height: HEIGHT,
      duration: (PIECE_STARTS.length * PIECE_FRAMES) / FPS,
    })

    await openExportDialog(page)
    await openExportAdvancedOptions(page)
    test.skip(!(await page.getByRole('radio', { name: /WebM/ }).isEnabled()), 'This browser cannot export WebM')
    const bytes = await exportWebmAtProjectResolution(page)

    // Every export frame, read mid-frame so a read cannot land on the frame
    // before by rounding. A frame missing from the file reads as the one
    // before it, so it fails here too.
    const read = await readBarcodes(page, bytes, EXPECTED.map((_, n) => (n + 0.5) / FPS))
    const wrong = wrongFrames(read, EXPECTED, PIECE_FRAMES)
    expect(wrong, 'exported frames that are not the source frame the timeline puts there').toEqual([])
  })
})
