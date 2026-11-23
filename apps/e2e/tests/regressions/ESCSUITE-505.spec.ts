import { readFileSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, openExportAdvancedOptions, openExportDialog } from '../../utils/artist'
import { cutIntoPieces, exportWebmAtProjectResolution, readBarcodes, wrongFrames } from '../../utils/frameBarcode'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-505: a WebM export of a slowed clip repeated source frames. The
 * `<video>` exporters skipped a seek when the request was within 0.4 of an
 * *output* frame of where the element sat, whatever the clip's speed. A
 * slowed clip's requests are closer together in source time than an output
 * frame (1/120 s apart at 0.25x in a 30 fps export), so a request just past a
 * source frame's start, from an element sitting just before it, was skipped
 * and the element showed the frame before. The seek is now skipped only when
 * the element already shows the source frame the seek would, at the source's
 * own rate (`elementShowsFrameFor`, `apps/artist/src/core/elementSeek.ts`).
 *
 * The source, `fixtures/presented-frame/frame-barcode.webm`, is ESCSUITE-454's
 * 50 fps barcode: each frame shows its own index. Its rate is measured at
 * import (ESCSUITE-276), so the export decides at 50 fps. The timeline holds
 * four one-second pieces of it: two at 0.25x and two at 0.4x, one of each
 * starting on a source frame's start and one half way into a frame, so the
 * requests fall at many places inside the source's frames. None falls in the
 * millisecond before a frame's start but off it (the nearest is 1.67 ms), so
 * the frame each must show is not moved by the seek bias (ESCSUITE-495).
 *
 * Measured locally (Chromium headless shell 159, 2026-11-23): with the old
 * window, 3 of 3 runs failed with the same 30 wrong frames, each the source
 * frame before the one the timeline puts there; with the fix, 3 of 3 runs
 * passed. Like ESCSUITE-495's, the failure is deterministic.
 *
 * WebKit's Linux port paints a `<video>` outside the document as black, so the
 * case skips there where the probe sees that, as ESCSUITE-454's does.
 */

const FIXTURE = resolvePath(dirname(fileURLToPath(import.meta.url)), '../../fixtures/presented-frame/frame-barcode.webm')
/** The export's frame rate (`VIDEO_EXPORT_FRAME_RATE`). */
const FPS = 30
/** The source's. */
const SOURCE_FPS = 50
/** The source's size, and the project's. */
const WIDTH = 640
const HEIGHT = 360
/** Export frames in each piece: one second of timeline. */
const PIECE_FRAMES = 30
/**
 * Each piece's in point, in source frames, and speed. The half-frame in
 * points put each piece's requests at other places inside the source's frames
 * than its whole-frame twin's. None reaches source frame 0 (all black, what an
 * empty frame reads as) or past the source's 250 frames.
 */
const PIECES = [
  { start: 10, speed: 0.25 },
  { start: 60.5, speed: 0.25 },
  { start: 110, speed: 0.4 },
  { start: 160.5, speed: 0.4 },
]

const pieces = PIECES.map(({ start, speed }, k) => ({
  startTime: start / SOURCE_FPS,
  duration: PIECE_FRAMES / FPS,
  timelinePosition: (k * PIECE_FRAMES) / FPS,
  speed,
}))
/**
 * The source frame each export frame must show: the one its source time falls
 * in. Export frame j of a piece asks for `startTime + (j / FPS) * speed`; the
 * twentieth of a frame added (1 ms, the seek bias) only keeps a request on a
 * frame's start from reading as the frame before through float rounding.
 */
const EXPECTED = pieces.flatMap(({ startTime, speed }) =>
  Array.from({ length: PIECE_FRAMES }, (_, j) => Math.floor((startTime + (j / FPS) * speed) * SOURCE_FPS + 0.05))
)

test.describe('ESCSUITE-505: a WebM export of a slowed clip shows every source frame the timeline puts there', () => {
  test('every frame of 0.25x and 0.4x pieces of a 50 fps source is the source frame the timeline puts there', async ({ page, browserName }) => {
    test.setTimeout(180_000)
    await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
    await waitForAppReady(page, 'artist')

    // Source frame 51 (1.02 s; 0b00110011) read from the fixture by the same
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
      duration: (PIECES.length * PIECE_FRAMES) / FPS,
    })

    await openExportDialog(page)
    await openExportAdvancedOptions(page)
    test.skip(!(await page.getByRole('radio', { name: /WebM/ }).isEnabled()), 'This browser cannot export WebM')
    const bytes = await exportWebmAtProjectResolution(page)

    // Every export frame, read mid-frame so a read cannot land on the frame
    // before by rounding. A frame missing from the file reads as the one before
    // it, so it fails here too.
    const read = await readBarcodes(page, bytes, EXPECTED.map((_, n) => (n + 0.5) / FPS))
    const wrong = wrongFrames(read, EXPECTED, PIECE_FRAMES)
    expect(wrong, 'exported frames that are not the source frame the timeline puts there').toEqual([])
  })
})
