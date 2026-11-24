import { readFileSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline, openExportAdvancedOptions, openExportDialog } from '../../utils/artist'
import { cutIntoPieces, exportMp4AtProjectResolution, readBarcodes, wrongFrames } from '../../utils/frameBarcode'
import { waitForAppReady } from '../../utils/ready'

/**
 * ESCSUITE-508: an in-page MP4 export of a slowed clip repeated source frames
 * when the source's frame rate was never measured. Only Chromium measures a
 * rate at import (ESCSUITE-276, ESCSUITE-327); Firefox and Safari store an
 * assumed 30 fps. `HTMLVideoFrameSource.getFrame()` — every MP4 export of a
 * WebM source, every Safari MP4 export, Firefox's fallback — skipped a seek
 * when the request was within half a frame of where the element sat and on
 * the same frame of that placeholder 30 fps grid. A slowed clip of a 50 fps
 * file asks for times closer together than a 30 fps frame, so a request on
 * the next 50 fps frame was skipped and the element showed the frame before.
 * ESCSUITE-505 fixed the WebM and GIF exporters the same way; this is the MP4
 * path's half: a rate nobody measured is not judged on a grid at all, and a
 * seek is skipped only when the element already sits at the request
 * (`elementSitsAt`, `apps/artist/src/core/elementSeek.ts`).
 *
 * The source is ESCSUITE-454's 50 fps barcode (`frame-barcode.webm`): each
 * frame shows its own index. A WebM source never goes to the decode worker,
 * so the MP4 export decodes it on the `<video>` path in every browser. The
 * timeline is ESCSUITE-505's: four one-second pieces, two at 0.25x and two at
 * 0.4x, one of each starting on a source frame's start and one half way into
 * a frame. In Chromium the rate is measured at import, so the case passed
 * there before the fix too; the failure it pins is Firefox's and Safari's.
 *
 * Measured locally (Firefox 159, 2026-11-24): on `main`, 3 of 3 runs failed
 * with the same 32 wrong frames, each the source frame before the one the
 * timeline puts there or a repeat of it; with the fix, 3 of 3 runs passed.
 * Chromium passed both before and after. Like ESCSUITE-505's, the failure is
 * deterministic.
 *
 * WebKit's Linux port paints a `<video>` outside the document as black, so the
 * case skips there where the probe sees that, as ESCSUITE-505's does. A browser
 * with no H.264 encoder cannot export MP4, so the case skips there too.
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
/** Each piece's in point, in source frames, and speed: ESCSUITE-505's. */
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
 * in. The twentieth of a frame added only keeps a request on a frame's start
 * from reading as the frame before through float rounding.
 */
const EXPECTED = pieces.flatMap(({ startTime, speed }) =>
  Array.from({ length: PIECE_FRAMES }, (_, j) => Math.floor((startTime + (j / FPS) * speed) * SOURCE_FPS + 0.05))
)

test.describe('ESCSUITE-508: an in-page MP4 export of a slowed clip shows every source frame the timeline puts there', () => {
  test('every frame of 0.25x and 0.4x pieces of a 50 fps source is the source frame the timeline puts there', async ({ page, browserName }) => {
    test.setTimeout(180_000)
    await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
    await waitForAppReady(page, 'artist')

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
    test.skip(!(await page.getByRole('radio', { name: /MP4/ }).isEnabled()), 'This browser cannot export MP4')
    const bytes = await exportMp4AtProjectResolution(page)

    // Every export frame, read mid-frame so a read cannot land on the frame
    // before by rounding. A frame missing from the file reads as the one before
    // it, so it fails here too.
    const read = await readBarcodes(page, bytes, EXPECTED.map((_, n) => (n + 0.5) / FPS), 'video/mp4')
    const wrong = wrongFrames(read, EXPECTED, PIECE_FRAMES)
    expect(wrong, 'exported frames that are not the source frame the timeline puts there').toEqual([])
  })
})
