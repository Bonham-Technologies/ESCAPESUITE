import { readFile } from 'node:fs/promises'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { storedRecordingBytes } from '../../utils/craftTakes'
import { grantMediaPermissions, mockSyntheticMedia } from '../../utils/media-mocks'
import { captureConsole, recordPipTake } from '../../utils/seekable'
import { readWebmLayout } from '../../utils/webmLayout'

/**
 * ESCSUITE-507: Firefox showed Chromium's MediaRecorder VP9 takes with shifted
 * colours (the drawn (228,61,99) as (226,31,97), up to 35/255 off).
 *
 * The trigger is the **alpha layer**, nothing else. Firefox decodes a VP9 (or
 * VP8) frame that carries an alpha layer through its own libvpx decoder on
 * every platform (its FFmpeg, Windows and macOS decoders refuse alpha) and
 * converts it to RGB on the CPU with libyuv's `I420AlphaToARGB`, which is
 * limited-range BT.601 whatever the file says. The same file with its alpha
 * BlockAdditions removed reads as drawn; full range, the Colour element and the
 * frame size change nothing (`seek-index-repair-at-import.md`, "Colour after
 * repair").
 *
 * Chromium's MediaRecorder writes an alpha layer whenever the canvas it records
 * has an alpha channel, opaque pixels or not. ESCAPECRAFT's compositor canvas
 * was such a canvas, so every composited-PiP take recorded in Chromium carried
 * one, and previewed (and exported) with shifted colours in Firefox. The
 * compositor now asks for an opaque context; the take carries no alpha layer.
 *
 * - A composited-PiP take recorded in ESCAPECRAFT has no video frame with
 *   BlockAdditions. Chromium only (a PiP take needs camera permission, which
 *   only Chromium can be granted headlessly). It fails before the fix: every
 *   frame of the take carried an alpha layer.
 * - The shape the take now has, a Chromium MediaRecorder recording of an opaque
 *   canvas (`fixtures/mediarecorder-colour/chromium-159-vp9-opaque.webm`), reads
 *   as drawn in this browser's `<video>`, Firefox included. The alpha recording
 *   beside it is read too: it must read as drawn in Chromium, and in other
 *   browsers its reading is an annotation, since only Firefox can fix Firefox.
 *
 * Runs in Chromium on every PR and in Firefox in the Nightly.
 */

const FIXTURES = resolvePath(dirname(fileURLToPath(import.meta.url)), '../../fixtures/mediarecorder-colour')
/** Chromium 159's MediaRecorder over a canvas with an alpha channel: every frame carries an alpha layer. */
const ALPHA_TAKE = resolvePath(FIXTURES, 'chromium-159-vp9.webm')
/** The same patches, recorded by Chromium 159's MediaRecorder over an opaque (`alpha: false`) canvas. */
const OPAQUE_TAKE = resolvePath(FIXTURES, 'chromium-159-vp9-opaque.webm')

const CRAFT_URL = 'http://localhost:5174'

/** The patches the fixtures were drawn with, left to right and top to bottom, in a 4x2 grid. */
const PATCHES: Array<[number, number, number]> = [
  [228, 61, 99],
  [40, 180, 80],
  [50, 90, 200],
  [220, 200, 40],
  [150, 60, 180],
  [40, 190, 200],
  [128, 128, 128],
  [200, 120, 60],
]
type Rgb = [number, number, number]

/** The patches as a plain `<video>` over `bytes` shows its first frame, drawn onto a canvas. */
async function plainVideoPatches(page: Page, bytes: Uint8Array): Promise<Rgb[]> {
  return page.evaluate(async (base64) => {
    const binary = atob(base64)
    const data = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i)
    const video = document.createElement('video')
    video.muted = true
    video.src = URL.createObjectURL(new Blob([data], { type: 'video/webm' }))
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error(`<video> could not load the file: ${video.error?.message}`))
    })
    const width = video.videoWidth
    const height = video.videoHeight
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    // Chromium can report a frame at 'loadeddata' and still draw nothing; a
    // moment of playback makes it present one (the patches never change).
    for (let attempt = 0; ; attempt++) {
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(video, 0, 0, width, height)
      if (ctx.getImageData(Math.round(width * 0.625), Math.round(height * 0.75), 1, 1).data[0] > 40) break
      if (attempt === 30) throw new Error('The <video> never showed a picture')
      if (attempt === 3) {
        await video.play()
        await new Promise((resolve) => setTimeout(resolve, 200))
        video.pause()
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    URL.revokeObjectURL(video.src)
    return Array.from({ length: 8 }, (_, i) => {
      const x = Math.round((((i % 4) + 0.5) / 4) * width)
      const y = Math.round(((Math.floor(i / 4) + 0.5) / 2) * height)
      const { data: px } = ctx.getImageData(x - 10, y - 10, 21, 21)
      const sum = [0, 0, 0]
      for (let k = 0; k < px.length; k += 4) for (let c = 0; c < 3; c++) sum[c] += px[k + c]
      return sum.map((s) => s / (px.length / 4)) as Rgb
    })
  }, Buffer.from(bytes).toString('base64'))
}

/** The largest channel difference from the drawn RGB. */
function maxOff(reading: Rgb[]): number {
  return Math.max(...reading.flatMap((rgb, i) => rgb.map((v, c) => Math.abs(v - PATCHES[i][c]))))
}

function describe(reading: Rgb[]): string {
  return `${maxOff(reading).toFixed(1)}/255 at most off the drawn RGB; ${reading.map((rgb) => `(${rgb.map(Math.round).join(',')})`).join(' ')}`
}

test.describe('ESCSUITE-507: a Chromium take carries no alpha layer, which Firefox reads with the wrong colours', () => {
  test.skip(({ browserName }) => browserName === 'webkit', "Playwright's WebKit plays no VP9 WebM (ESCSUITE-258)")

  test('a composited-PiP take recorded in ESCAPECRAFT has no alpha layer', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Only Chromium can be granted camera permission headlessly, which a PiP take needs')
    test.setTimeout(120_000)
    const consoleLog = captureConsole(page)
    await mockSyntheticMedia(page)
    await grantMediaPermissions(page)
    await recordPipTake(page, CRAFT_URL)
    // The compositor's canvas reaches the file only on the MediaRecorder path.
    expect(consoleLog.matching(/Using MediaRecorder-based recorder \(PiP mode\)/)).not.toEqual([])

    const layout = readWebmLayout(await storedRecordingBytes(page))
    expect(layout.videoCodec, "Chromium's MediaRecorder records VP9").toBe('V_VP9')
    expect(layout.videoBlocks.length, 'the take has video frames').toBeGreaterThan(0)
    const withAlpha = layout.videoBlocks.filter((block) => block.alpha)
    test.info().annotations.push({
      type: 'take',
      description: `${layout.videoBlocks.length} video frames, ${withAlpha.length} with an alpha layer`,
    })
    expect(withAlpha.length, 'video frames carrying an alpha layer (BlockAdditions)').toBe(0)
  })

  test("Chromium's opaque-canvas VP9 recording reads as drawn in this browser", async ({ page, browserName }) => {
    await page.setContent('<!doctype html><title>ESCSUITE-507</title>')
    const opaque = new Uint8Array(await readFile(OPAQUE_TAKE))
    const alpha = new Uint8Array(await readFile(ALPHA_TAKE))
    expect(readWebmLayout(opaque).videoBlocks.some((block) => block.alpha), 'the opaque fixture has no alpha layer').toBe(false)
    expect(readWebmLayout(alpha).videoBlocks.every((block) => block.alpha), 'the alpha fixture has one on every frame').toBe(true)

    const opaqueReading = await plainVideoPatches(page, opaque)
    const alphaReading = await plainVideoPatches(page, alpha)
    test.info().annotations.push(
      { type: 'opaque-canvas recording', description: describe(opaqueReading) },
      // Firefox 159: 35/255 at most, (226,31,97) for (228,61,99): limited-range BT.601.
      { type: 'alpha-layer recording', description: describe(alphaReading) }
    )
    expect(maxOff(opaqueReading), 'the opaque-canvas recording against the drawn RGB').toBeLessThanOrEqual(3)
    if (browserName === 'chromium') {
      expect(maxOff(alphaReading), 'Chromium reads the alpha-layer recording as drawn too').toBeLessThanOrEqual(3)
    }
  })
})
