import { readFileSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, openExportAdvancedOptions, openExportDialog } from '../../utils/artist'
import { cutIntoPieces, exportWebmAtProjectResolution, readBarcodes, wrongFrames } from '../../utils/frameBarcode'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-495: an export of a 30 fps WebM (ESCAPECRAFT records them)
 * repeated the source frame before every third one. A WebM timecode holds
 * whole milliseconds, so a 30 fps frame that starts at k + 2/30 s (66.67 ms on)
 * is stored at 67 ms, a third of a millisecond late. The `<video>` exporters
 * seek to `elementSeekTarget(time)`, which was only 0.1 ms past the requested
 * frame start (ESCSUITE-265), so the seek landed before the stored start and
 * the element showed the frame before. The bias is now a whole millisecond
 * (`apps/artist/src/core/elementSeek.ts`), past any rounding to a millisecond.
 *
 * The source, `fixtures/presented-frame/frame-barcode-30fps.webm`, shows each
 * frame's own index as an 8-bit barcode, as ESCSUITE-454's does, but at
 * 30 fps: frames 2, 5, 8, … are stored a third of a millisecond after their
 * nominal start. The timeline cuts it into 60 three-frame pieces from scattered
 * places. A third of them start on a source frame's start, so every export
 * frame of those is a request on a frame start, one in three of them on a
 * late-stored one; the others start half a frame and nine tenths of a frame
 * in, so their requests sit inside a frame, the last 3.3 ms before the next
 * one, and must not be pushed into it by the bias.
 *
 * Measured locally (Chromium headless shell, 2026-11-20): with the 0.1 ms
 * bias, 3 of 3 runs failed with the same 18 wrong frames: 18 of the 20
 * late-stored source frames in the pieces that start on a frame start, each
 * shown as the frame before it; nothing else was wrong. With the 1 ms bias, 4 of 4 runs passed.
 * Unlike ESCSUITE-454's race, the failure is deterministic.
 *
 * WebKit's Linux port paints a `<video>` outside the document as black, so the
 * case skips there where the probe sees that, as ESCSUITE-454's does.
 */

const FIXTURE = resolvePath(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/presented-frame/frame-barcode-30fps.webm'
)
/** The export's frame rate (`VIDEO_EXPORT_FRAME_RATE`). */
const FPS = 30
/** The source's: the rate ESCAPECRAFT records at. */
const SOURCE_FPS = 30
/** The source's size, and the project's. */
const WIDTH = 640
const HEIGHT = 360
/** Export frames in each piece. */
const PIECE_FRAMES = 3
/**
 * Where each piece starts, in source frames: 1 + 53k mod 145, so no piece
 * starts where the one before it ended, none runs past the source's 150
 * frames, and none shows source frame 0, whose barcode (all black) is what an
 * empty frame reads as.
 */
const PIECE_STARTS = Array.from({ length: 60 }, (_, k) => 1 + ((k * 53) % 145))
/**
 * How far into its first source frame each piece starts, as a fraction of a
 * frame: on the frame's start, half way in, and nine tenths in.
 */
const PHASES = [0, 0.5, 0.9]

const pieces = PIECE_STARTS.map((start, k) => ({
  startTime: (start + PHASES[k % PHASES.length]) / SOURCE_FPS,
  duration: PIECE_FRAMES / FPS,
  timelinePosition: (k * PIECE_FRAMES) / FPS,
}))
/**
 * The source frame each export frame must show: export frame j of a piece is
 * source frame start + j, whatever its phase, since source and export share a
 * rate and no phase reaches the next frame.
 */
const EXPECTED = PIECE_STARTS.flatMap((start) => Array.from({ length: PIECE_FRAMES }, (_, j) => start + j))

test.describe('ESCSUITE-495: a WebM export of a 30 fps source shows the frame the timeline puts there, though its timecodes are rounded to milliseconds', () => {
  test('every frame of a 30 fps source cut into 60 pieces, on and off frame starts, is the source frame the timeline puts there', async ({ page, browserName }) => {
    test.setTimeout(180_000)
    await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
    await waitForAppReady(page, 'artist')

    // Source frame 51 (1.7 s; 0b00110011) read from the fixture by the same
    // detached-element reader the export is checked with.
    const probe = await readBarcodes(page, readFileSync(FIXTURE), [51.5 / SOURCE_FPS])
    test.skip(
      browserName === 'webkit' && probe[0] !== 51,
      `This engine paints a <video> outside the document as ${probe[0] === 0 ? 'black' : `source frame ${probe[0]}`} (WebKit's Linux port does), so the in-page export draws no picture to check`
    )
    expect(probe[0], 'source frame 51 read from the fixture by the detached-element reader').toBe(51)

    await importMediaAndAddToTimeline(page, FIXTURE)
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
    // before by the same rounding. A frame missing from the file reads as the
    // one before it, so it fails here too.
    const read = await readBarcodes(page, bytes, EXPECTED.map((_, n) => (n + 0.5) / FPS))
    const wrong = wrongFrames(read, EXPECTED, PIECE_FRAMES)
    expect(wrong, 'exported frames that are not the source frame the timeline puts there').toEqual([])
  })
})
