import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { ARTIST_URL, openExportDialog, seedTextClip } from '../../utils/artist'
import { recordATake } from '../../utils/craft'
import { storedRecordingBytes } from '../../utils/craftTakes'
import { grantMediaPermissions, mockSyntheticMedia } from '../../utils/media-mocks'
import { waitForAppReady } from '../../utils/ready'
import { readWebmLayout, type WebmLayout } from '../../utils/webmLayout'
import { VP9_COLOR_SPACE, VP9_COLOR_SPACE_FOR_MATROSKA_MATRIX, readVp9KeyFrameHeader } from '../../utils/vp9Header'

/**
 * ESCSUITE-485: the VP9 key frame `color_space` rewrite, in a real browser.
 *
 * Firefox's WebCodecs VP9 encoder (155) leaves every key frame header's
 * `color_space` at 0, "unknown", and reports the matrix only in
 * `decoderConfig.colorSpace`. Firefox's `<video>` and ffmpeg read the header;
 * Chromium's reads the WebM Colour element. Mediabunny's muxer copied the
 * report into the header up to 1.65 (`fixVP9ColorSpace`); 1.66 dropped that,
 * and the apps now do it before a packet reaches the muxer
 * (`packages/shared/src/utils/vp9ColourSpace.ts`, run by ARTIST's
 * `core/vpxColorLabel.ts` and CRAFT's `core/webcodecs-recorder.ts`). ARTIST's
 * correction of Firefox's mislabelled report (ESCSUITE-284) reaches Firefox's
 * `<video>` only through it.
 *
 * Unit tests over synthetic header bytes were the only proof. A real encoder
 * emitting a header the rewrite does not expect (profile 1 or 3, a
 * superframe) would leave it "unknown" and bring Firefox's colour shift back
 * with nothing going red. So each case makes a real VP9 WebM — an ARTIST
 * export, a CRAFT WebCodecs take — reads every key frame's uncompressed header
 * with a parser written from the bitstream spec (`utils/vp9Header.ts`), and
 * holds:
 *
 * - each key frame's `color_space` is the matrix the file should carry:
 *   BT.709 (2) in Chromium; for an ARTIST export in Firefox, the SMPTE 170M
 *   (3) ESCSUITE-284 relabels Firefox's report to; otherwise the encoder's own
 *   report, recorded by wrapping `VideoEncoder`;
 * - and it agrees with the Colour element's MatrixCoefficients, so Firefox's
 *   `<video>` and Chromium's read the same matrix.
 *
 * Chromium 153's encoder writes `color_space` 2 itself (measured 2026-11-20:
 * a bare 160x120 key frame starts 82 49 83 42 50), so there the rewrite has
 * nothing to do and the plain cases pass without it. Each case therefore also
 * runs with the wrapper clearing every VP9 key frame header's `color_space` to
 * "unknown" before the app sees the chunk, which is what Firefox's encoder
 * hands over: that variant fails in Chromium, on every PR, when the rewrite
 * stops working (with both call sites disabled, ARTIST and CRAFT alike: "the
 * first key frame's color_space is unknown, want BT.709").
 *
 * A CRAFT take in Firefox is held to Firefox's own report, as CRAFT relabels
 * nothing; ESCSUITE-284's measurement says that report is BT.709 over BT.601
 * pixels for a canvas-built frame, which CRAFT's Firefox capture path is. The
 * case notes it when it sees that report.
 *
 * Runs in every project. CI's gating job runs Chromium only; the Nightly's
 * Firefox project picks this spec up like every other under `tests/`
 * (`pnpm test:e2e:browsers`). A browser without a VP9 encoder skips, saying so.
 */

const CRAFT_URL = 'http://localhost:5174'
const CS_NAMES = ['unknown', 'BT.601', 'BT.709', 'SMPTE 170M', 'SMPTE 240M', 'BT.2020', 'reserved', 'RGB']

interface EncoderReport {
  codec: string
  colorSpace: { primaries: string | null; transfer: string | null; matrix: string | null; fullRange: boolean | null } | null
}

/**
 * Wrap `VideoEncoder` before the app loads. It records what each encoder
 * reports in its first decoder configuration (`window.__encoderReports`).
 * With `forceUnknown`, it also sets every key frame header's `color_space` to
 * 0, "unknown", before the app sees the chunk — what Firefox's encoder writes
 * and Chromium's wrote before https://crbug.com/1377842, while Chromium 153's
 * writes the matrix itself — and counts the frames it changed
 * (`window.__forcedUnknown`). Otherwise every chunk and its metadata reach the
 * app untouched.
 */
async function wrapVideoEncoder(page: Page, forceUnknown: boolean): Promise<void> {
  await page.addInitScript((force) => {
    const reports: EncoderReport[] = []
    const probe = window as unknown as { __encoderReports: EncoderReport[]; __forcedUnknown: number }
    probe.__encoderReports = reports
    probe.__forcedUnknown = 0
    const Native = globalThis.VideoEncoder
    if (!Native) return

    /** `data` with its key frame header's color_space cleared to 0; false when there is none to clear. */
    const clearColourSpace = (data: Uint8Array): boolean => {
      const bits = (at: number, count: number) => {
        let value = 0
        for (let i = at; i < at + count; i++) value = (value << 1) | ((data[i >> 3] >> (7 - (i & 7))) & 1)
        return value
      }
      if (data.length < 5 || bits(0, 2) !== 2) return false
      const profile = bits(2, 1) | (bits(3, 1) << 1)
      let at = profile === 3 ? 5 : 4
      if (bits(at, 2) !== 0) return false // show_existing_frame, frame_type
      at += 4
      if (bits(at, 24) !== 0x498342) return false
      at += 24 + (profile >= 2 ? 1 : 0)
      const colourSpace = bits(at, 3)
      // 7 (RGB) changes the layout of the bits after it.
      if (colourSpace === 0 || colourSpace === 7) return false
      for (let i = at; i < at + 3; i++) data[i >> 3] &= ~(1 << (7 - (i & 7)))
      return true
    }

    globalThis.VideoEncoder = class extends Native {
      constructor(init: VideoEncoderInit) {
        let reported = false
        let codec = ''
        super({
          ...init,
          output: (chunk, meta) => {
            const config = meta?.decoderConfig
            if (config && !reported) {
              reported = true
              const cs = config.colorSpace
              reports.push({
                codec: config.codec,
                colorSpace: cs
                  ? {
                      primaries: cs.primaries ?? null,
                      transfer: cs.transfer ?? null,
                      matrix: cs.matrix ?? null,
                      fullRange: cs.fullRange ?? null,
                    }
                  : null,
              })
            }
            if (force && chunk.type === 'key' && codec.startsWith('vp09')) {
              const data = new Uint8Array(chunk.byteLength)
              chunk.copyTo(data)
              if (clearColourSpace(data)) {
                probe.__forcedUnknown += 1
                chunk = new EncodedVideoChunk({
                  type: chunk.type,
                  timestamp: chunk.timestamp,
                  duration: chunk.duration ?? undefined,
                  data,
                })
              }
            }
            return init.output(chunk, meta)
          },
        })
        this.configure = (config: VideoEncoderConfig) => {
          codec = config.codec
          return Native.prototype.configure.call(this, config)
        }
      }
    }
  }, forceUnknown)
}

async function vp9Report(page: Page): Promise<EncoderReport> {
  const reports = await page.evaluate(() => (window as unknown as { __encoderReports: EncoderReport[] }).__encoderReports)
  const vp9 = reports.filter((r) => r.codec.startsWith('vp09'))
  expect(vp9, 'VP9 encoder reports').toHaveLength(1)
  return vp9[0]
}

/** Firefox 155's report for a canvas-built frame, which ARTIST relabels to BT.601 (`relabelFirefoxVpxMeta`). */
function isFirefoxMislabel(report: EncoderReport): boolean {
  const cs = report.colorSpace
  return cs?.primaries === 'bt709' && cs.transfer === 'bt709' && cs.matrix === 'bt709' && cs.fullRange === false
}

/**
 * Every key frame's `color_space` is `expected`, and the Colour element's
 * matrix says the same.
 */
function expectKeyFrameColourSpace(layout: WebmLayout, expected: number): void {
  expect(layout.videoCodec).toBe('V_VP9')
  const keys = layout.videoBlocks.filter((block) => block.key)
  expect(keys.length, 'key frames').toBeGreaterThan(0)
  const headers = keys.map((block) => readVp9KeyFrameHeader(block.data))
  test.info().annotations.push({
    type: 'VP9 key frames',
    description: `${keys.length}, profile ${headers[0]?.profile}, first color_space ${headers[0]?.colorSpace}; Colour MatrixCoefficients ${layout.videoMatrixCoefficients}`,
  })

  const first = headers[0]
  expect(first, 'the first key frame is a shown key frame').not.toBeNull()
  expect(
    first!.colorSpace,
    `the first key frame's color_space is ${CS_NAMES[first!.colorSpace]}, want ${CS_NAMES[expected]}`
  ).toBe(expected)

  const wrong = headers.flatMap((header, i) =>
    header?.colorSpace === expected
      ? []
      : [`key frame at ${keys[i].time} ms: ${header ? CS_NAMES[header.colorSpace] : 'not a shown key frame'}`]
  )
  expect(wrong, `key frames whose color_space is not ${CS_NAMES[expected]}`).toEqual([])

  expect(
    VP9_COLOR_SPACE_FOR_MATROSKA_MATRIX[layout.videoMatrixCoefficients ?? -1],
    'the Colour element names the same matrix as the key frame headers'
  ).toBe(expected)
}

/** The code the encoder's matrix maps to, or a skip when VP9 has none for it (the rewrite then leaves the header alone). */
function codeForReport(report: EncoderReport): number {
  const matrix = report.colorSpace?.matrix ?? null
  const code = matrix === null ? undefined : VP9_COLOR_SPACE[matrix]
  test.skip(code === undefined, `The encoder reported matrix ${matrix}, which VP9's header has no code for`)
  return code!
}

/** Cases in each browser: the encoder's own header, and one it left "unknown". */
const VARIANTS = [
  { title: '', forceUnknown: false },
  { title: ', its encoder\'s key frames saying "unknown"', forceUnknown: true },
]

/**
 * How many key frames the wrapper forced to "unknown". Chromium's encoder
 * writes the matrix, so there it must have forced some, or a pass would prove
 * nothing; Firefox's already writes "unknown" and leaves nothing to force.
 */
async function expectForced(page: Page, forceUnknown: boolean, browserName: string): Promise<void> {
  if (!forceUnknown) return
  const forced = await page.evaluate(() => (window as unknown as { __forcedUnknown: number }).__forcedUnknown)
  test.info().annotations.push({ type: 'key frames forced to "unknown"', description: String(forced) })
  if (browserName === 'chromium') expect(forced, 'key frames forced to "unknown"').toBeGreaterThan(0)
}

test.describe('ESCSUITE-485: VP9 key frame headers carry the colour matrix', () => {
  for (const { title, forceUnknown } of VARIANTS) {
    test(`an ARTIST WebM export${title}`, async ({ page, browserName }) => {
      test.setTimeout(120_000)
      await wrapVideoEncoder(page, forceUnknown)
      await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
      await waitForAppReady(page, 'artist')
      await seedTextClip(page)
      await openExportDialog(page)

      const downloadWebM = page.getByRole('button', { name: 'Download WebM' }).first()
      test.skip(!(await downloadWebM.isEnabled()), 'This browser cannot export WebM')
      const download = page.waitForEvent('download', { timeout: 90_000 })
      await downloadWebM.click()
      const layout = readWebmLayout(new Uint8Array(readFileSync(await (await download).path())))
      test.skip(layout.videoCodec === 'V_VP8', 'This browser has no VP9 encoder: the export fell back to VP8, whose header has no color_space')
      await expectForced(page, forceUnknown, browserName)

      const report = await vp9Report(page)
      test.info().annotations.push({ type: 'VP9 encoder report', description: JSON.stringify(report.colorSpace) })
      let expected: number
      if (browserName === 'chromium') {
        expected = VP9_COLOR_SPACE.bt709
      } else if (browserName === 'firefox' && isFirefoxMislabel(report)) {
        // ESCSUITE-284: Firefox converted with BT.601 and said BT.709; ARTIST relabels it.
        expected = VP9_COLOR_SPACE.smpte170m
      } else {
        expected = codeForReport(report)
      }
      expectKeyFrameColourSpace(layout, expected)
    })

    test(`a CRAFT WebCodecs take${title}`, async ({ page, browserName }) => {
      test.skip(
        browserName === 'webkit',
        'WebKit cannot store a Blob in IndexedDB in Playwright (UnknownError: Error preparing Blob/File data to be stored in object store)'
      )
      test.setTimeout(120_000)
      const lines: string[] = []
      page.on('console', (message) => lines.push(message.text()))
      await mockSyntheticMedia(page)
      await grantMediaPermissions(page)
      await wrapVideoEncoder(page, forceUnknown)
      await page.goto(CRAFT_URL)
      await waitForAppReady(page, 'craft')

      const vp9 = await page.evaluate(async () => {
        if (typeof VideoEncoder === 'undefined') return false
        try {
          return (await VideoEncoder.isConfigSupported({ codec: 'vp09.00.10.08', width: 640, height: 480 })).supported === true
        } catch {
          return false
        }
      })
      test.skip(!vp9, 'This browser has no VP9 encoder, which the CRAFT WebCodecs recorder needs')

      await recordATake(page)
      const webCodecs = lines.some((line) => line.startsWith('Using WebCodecs-based recorder'))
      if (browserName === 'chromium') expect(webCodecs, 'Chromium records with the WebCodecs recorder').toBe(true)
      test.skip(!webCodecs, 'CRAFT recorded with MediaRecorder here, whose WebM the browser writes itself')

      const layout = readWebmLayout(await storedRecordingBytes(page))
      await expectForced(page, forceUnknown, browserName)
      const report = await vp9Report(page)
      test.info().annotations.push({ type: 'VP9 encoder report', description: JSON.stringify(report.colorSpace) })
      // CRAFT relabels nothing: the header carries the encoder's own report.
      if (browserName === 'firefox' && isFirefoxMislabel(report)) {
        test.info().annotations.push({
          type: 'note',
          description: "Firefox's BT.709 report, which ESCSUITE-284 measured over BT.601 pixels: CRAFT keeps it",
        })
      }
      const expected = codeForReport(report)
      if (browserName === 'chromium') expect(expected, 'Chromium reports BT.709').toBe(VP9_COLOR_SPACE.bt709)
      expectKeyFrameColourSpace(layout, expected)
    })
  }
})
