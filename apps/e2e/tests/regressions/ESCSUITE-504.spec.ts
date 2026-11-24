import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Browser, type Page } from '@playwright/test'
import { ARTIST_URL, importMediaAndAddToTimeline } from '../../utils/artist'
import { waitForAppReady } from '../../utils/ready'
import { readWebmLayout, type WebmLayout } from '../../utils/webmLayout'
import { readVp9KeyFrameHeader } from '../../utils/vp9Header'

/**
 * ESCSUITE-504: does an imported, seek-repaired MediaRecorder WebM preview
 * with a colour shift since Mediabunny 1.66?
 *
 * ARTIST remuxes a Cues-less WebM at import to give it a seek index
 * (`seek-index-repair-at-import.md`). Up to Mediabunny 1.65 the remux's muxer
 * rewrote VP9 key frame headers' `color_space` (`fixVP9ColorSpace`); 1.66
 * copies packets exactly. ESCSUITE-485 answered from the code only; this
 * measures it in both browsers.
 *
 * The ticket asked about a Firefox VP9 recording, but Firefox's MediaRecorder
 * records no VP9: Firefox 159 answers `isTypeSupported('video/webm;codecs=vp9')`
 * false and its constructor throws NotSupportedError, so it records VP8. A
 * Firefox VP9 WebM comes only from WebCodecs (a CRAFT take, an ARTIST export),
 * which Mediabunny writes with Cues and the import never repairs. So the cases
 * are the MediaRecorder files there are, each imported in the browser running
 * the test:
 *
 * - Firefox 159's recording (VP8, no Cues), committed under
 *   `fixtures/mediarecorder-colour`, so Chromium reads Firefox's file too;
 * - Chromium 159's VP9 recording, committed beside it, with its Cues emptied
 *   in place. Chromium's MediaRecorder writes a Cues index the import honours,
 *   so as made it is never repaired; emptied, it is the shape the repair was
 *   written for (`webm-duration-fix` left an empty Cues on CRAFT's takes);
 * - a fresh recording by this browser's own MediaRecorder (VP9 where it
 *   records VP9, so a Firefox that gains it is measured on its next run), its
 *   Cues emptied when it has any.
 *
 * Each recording is of eight colour patches drawn on a 640x360 canvas
 * (`canvas.captureStream()`). The patches are read four ways against the RGB
 * that was drawn:
 *
 * - a plain `<video>` over the file as imported (before repair);
 * - a plain `<video>` over the bytes ARTIST stored (after repair);
 * - ARTIST's preview canvas after import (after repair);
 * - ARTIST's preview canvas over the file before repair: the stored row's
 *   bytes are put back to the original and the session restored, which
 *   `getVideoBlob` serves as they are (an empty or absent Cues has nothing to
 *   drop).
 *
 * What it holds: the import repaired the file (its stored bytes differ), kept
 * every video packet byte for byte and the Colour element's matrix, and gave
 * it Cues; and the `<video>` and the preview after repair read the same
 * colours as before it (within 2/255). The colours against the drawn RGB, and
 * which coding each reading fits (full-range BT.709 read as limited-range
 * BT.601, say), are annotations: those belong to the recording browser's
 * encoder and the reading browser's decoder, not to the repair, and
 * `seek-index-repair-at-import.md` records them.
 *
 * Runs in Chromium on every PR and in Firefox in the Nightly (and in
 * `e2e-cross-browser` when this spec changes).
 */

const FIXTURES = resolvePath(dirname(fileURLToPath(import.meta.url)), '../../fixtures/mediarecorder-colour')
/** Firefox 159's MediaRecorder: VP8, no Cues, no Colour element (fixtures/mediarecorder-colour/README.md). */
const FIREFOX_TAKE = resolvePath(FIXTURES, 'firefox-159-vp8.webm')
/** Chromium 159's MediaRecorder: VP9, BT.709 full range in its key frame header and Colour element, with Cues. */
const CHROMIUM_TAKE = resolvePath(FIXTURES, 'chromium-159-vp9.webm')

const WIDTH = 640
const HEIGHT = 360
const COLS = 4
const ROWS = 2
/** Mid-saturation colours, where BT.601 and BT.709 disagree most without clipping; (228,61,99) is ESCSUITE-284's. */
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
const RECORD_MS = 3_000
const CS_NAMES = ['unknown', 'BT.601', 'BT.709', 'SMPTE 170M', 'SMPTE 240M', 'BT.2020', 'reserved', 'RGB']

type Rgb = [number, number, number]

/** Each patch's centre, as a fraction of the frame. */
const CENTRES = PATCHES.map((_, i) => [((i % COLS) + 0.5) / COLS, (Math.floor(i / COLS) + 0.5) / ROWS] as const)

interface Recording {
  bytes: Uint8Array
  mimeType: string
}

/** Record the patches with this browser's MediaRecorder, in the first of `types` it supports; null when none. */
async function recordPatches(page: Page, types: string[]): Promise<Recording | null> {
  const made = await page.evaluate(
    async ({ types, patches, width, height, cols, rows, ms }) => {
      const type = types.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t))
      if (!type) return null
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      const draw = () =>
        patches.forEach(([r, g, b], i) => {
          ctx.fillStyle = `rgb(${r},${g},${b})`
          ctx.fillRect(((i % cols) * width) / cols, (Math.floor(i / cols) * height) / rows, width / cols, height / rows)
        })
      draw()
      const stream = canvas.captureStream(30)
      const recorder = new MediaRecorder(stream, { mimeType: type })
      const chunks: Blob[] = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      const stopped = new Promise((resolve) => (recorder.onstop = resolve))
      // A canvas stream sends a frame only when the canvas is painted.
      const painter = setInterval(draw, 33)
      recorder.start()
      await new Promise((resolve) => setTimeout(resolve, ms))
      recorder.stop()
      await stopped
      clearInterval(painter)
      stream.getTracks().forEach((track) => track.stop())
      const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      return { base64: btoa(binary), mimeType: recorder.mimeType }
    },
    { types, patches: PATCHES, width: WIDTH, height: HEIGHT, cols: COLS, rows: ROWS, ms: RECORD_MS }
  )
  return made === null ? null : { bytes: new Uint8Array(Buffer.from(made.base64, 'base64')), mimeType: made.mimeType }
}

/** The patches as a plain `<video>` over `bytes` shows its first frame, drawn onto a canvas. */
async function plainVideoPatches(page: Page, bytes: Uint8Array): Promise<Rgb[]> {
  return page.evaluate(
    async ({ base64, centres, width, height }) => {
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
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      // Chromium can report a frame at 'loadeddata' and still draw nothing; a
      // moment of playback makes it present one (the patches never change).
      const [gx, gy] = centres[6]
      for (let attempt = 0; ; attempt++) {
        ctx.clearRect(0, 0, width, height)
        ctx.drawImage(video, 0, 0, width, height)
        if (ctx.getImageData(Math.round(gx * width), Math.round(gy * height), 1, 1).data[0] > 40) break
        if (attempt === 30) throw new Error('The <video> never showed a picture')
        if (attempt === 3) {
          await video.play()
          await new Promise((resolve) => setTimeout(resolve, 200))
          video.pause()
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      URL.revokeObjectURL(video.src)
      return centres.map(([fx, fy]) => {
        const { data: px } = ctx.getImageData(Math.round(fx * width) - 10, Math.round(fy * height) - 10, 21, 21)
        const sum = [0, 0, 0]
        for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += px[i + c]
        return sum.map((s) => s / (px.length / 4)) as [number, number, number]
      })
    },
    { base64: Buffer.from(bytes).toString('base64'), centres: CENTRES, width: WIDTH, height: HEIGHT }
  )
}

/**
 * The patches as ARTIST's preview canvas shows them, once it shows a picture
 * that has stopped changing. The default 1080p project draws the 640x360 clip
 * at its own size in the middle of the frame, so the patches are found inside
 * the picture's bounds on the canvas (every patch has a channel above 100; the
 * rest of the frame is black). "Go to start" repaints the paused frame should
 * the first paint have landed before the `<video>` had one (ESCSUITE-264).
 */
async function previewPatches(page: Page): Promise<Rgb[]> {
  const canvas = page.locator('canvas:not([class*="waveform"])').first()
  await expect(canvas).toBeAttached({ timeout: 15_000 })
  const read = () =>
    canvas.evaluate((element, centres) => {
      const preview = element as HTMLCanvasElement
      const ctx = preview.getContext('2d')!
      const { data: all } = ctx.getImageData(0, 0, preview.width, preview.height)
      let [left, top, right, bottom] = [preview.width, preview.height, -1, -1]
      for (let y = 0; y < preview.height; y++) {
        for (let x = 0; x < preview.width; x++) {
          const i = (y * preview.width + x) * 4
          if (Math.max(all[i], all[i + 1], all[i + 2]) <= 40) continue
          left = Math.min(left, x)
          right = Math.max(right, x)
          top = Math.min(top, y)
          bottom = Math.max(bottom, y)
        }
      }
      if (right - left < 32 || bottom - top < 18) return null
      const width = right - left + 1
      const height = bottom - top + 1
      const half = Math.max(1, Math.floor(width / 32))
      return centres.map(([fx, fy]) => {
        const x = left + Math.round(fx * width)
        const y = top + Math.round(fy * height)
        const { data: px } = ctx.getImageData(x - half, y - half, 2 * half + 1, 2 * half + 1)
        const sum = [0, 0, 0]
        for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += px[i + c]
        return sum.map((s) => s / (px.length / 4)) as [number, number, number]
      })
    }, CENTRES)
  let last: Rgb[] | null = null
  let repaintedAt = 0
  await expect
    .poll(
      async () => {
        const now = await read()
        if (!now && Date.now() - repaintedAt > 2_000) {
          repaintedAt = Date.now()
          await page.getByTitle('Go to start (Home)').click()
        }
        const settled = now !== null && last !== null && maxDiff(now, last) <= 0.5
        last = now
        return settled
      },
      { message: 'the preview shows the patches', timeout: 20_000, intervals: [250] }
    )
    .toBe(true)
  return last!
}

/** The bytes in the one row of ARTIST's `videos` store. */
async function storedVideoBytes(page: Page): Promise<Uint8Array> {
  const base64 = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open('video-editor-db')
        request.onerror = () => reject(new Error('open failed'))
        request.onsuccess = () => {
          const all = request.result.transaction('videos', 'readonly').objectStore('videos').getAll()
          all.onerror = () => reject(new Error('read failed'))
          all.onsuccess = async () => {
            const rows = all.result as Array<{ blob?: Blob; bytes?: ArrayBuffer }>
            if (rows.length !== 1) return reject(new Error(`Expected one stored video, found ${rows.length}`))
            const row = rows[0]
            const bytes = new Uint8Array(row.blob ? await row.blob.arrayBuffer() : row.bytes!)
            request.result.close()
            let binary = ''
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
            resolve(btoa(binary))
          }
        }
      })
  )
  return new Uint8Array(Buffer.from(base64, 'base64'))
}

/** Put `bytes` in the one stored row, in the shape the row already has, keeping its metadata. */
async function replaceStoredVideo(page: Page, bytes: Uint8Array): Promise<void> {
  await page.evaluate(
    (base64) =>
      new Promise<void>((resolve, reject) => {
        const binary = atob(base64)
        const data = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i)
        const request = indexedDB.open('video-editor-db')
        request.onerror = () => reject(new Error('open failed'))
        request.onsuccess = () => {
          const db = request.result
          const store = db.transaction('videos', 'readwrite').objectStore('videos')
          const all = store.getAll()
          all.onerror = () => reject(new Error('read failed'))
          all.onsuccess = () => {
            const [row] = all.result as Array<{ id: string; metadata: unknown; blob?: Blob; bytes?: ArrayBuffer }>
            store.put(
              row.blob
                ? { id: row.id, metadata: row.metadata, blob: new Blob([data], { type: 'video/webm' }) }
                : { id: row.id, metadata: row.metadata, bytes: data.buffer, type: 'video/webm' }
            )
            store.transaction.oncomplete = () => {
              db.close()
              resolve()
            }
          }
        }
      }),
    Buffer.from(bytes).toString('base64')
  )
}

/** Wait until ARTIST has saved a session the next load will offer to restore. */
async function waitForSavedSession(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const request = indexedDB.open('video-editor-db')
              request.onsuccess = () => {
                const db = request.result
                const keys = db.transaction('settings', 'readonly').objectStore('settings').getAllKeys()
                keys.onsuccess = () => {
                  db.close()
                  resolve((keys.result as string[]).filter((k) => String(k).startsWith('session')).length)
                }
              }
            })
        ),
      { timeout: 15_000 }
    )
    .toBeGreaterThan(0)
}

interface Readings {
  plainBefore: Rgb[]
  plainAfter: Rgb[]
  previewAfter: Rgb[]
  previewBefore: Rgb[]
  repaired: Uint8Array
}

/** Import `raw` into ARTIST in a fresh context of `browser` and read the patches every way. */
async function measureInArtist(browser: Browser, raw: Uint8Array): Promise<Readings> {
  // A wide window, so the preview canvas, and the clip on it, are larger.
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  try {
    return await measureInPage(await context.newPage(), raw)
  } finally {
    await context.close()
  }
}

async function measureInPage(page: Page, raw: Uint8Array): Promise<Readings> {
  // Not `?suppressRestore=1`: that also stops the session save the restore below needs. The context is fresh.
  await page.goto(ARTIST_URL)
  await waitForAppReady(page, 'artist')
  const plainBefore = await plainVideoPatches(page, raw)
  await importMediaAndAddToTimeline(page, { name: 'recording.webm', mimeType: 'video/webm', buffer: Buffer.from(raw) })
  const previewAfter = await previewPatches(page)
  const repaired = await storedVideoBytes(page)
  expect(Buffer.from(repaired).equals(Buffer.from(raw)), 'the import repaired the recording (its stored bytes differ)').toBe(false)
  const plainAfter = await plainVideoPatches(page, repaired)

  await waitForSavedSession(page)
  await replaceStoredVideo(page, raw)
  await page.goto(ARTIST_URL)
  await waitForAppReady(page, 'artist')
  await page.getByRole('button', { name: 'Restore Session' }).click()
  await expect(page.getByText(/^1 clip/).first()).toBeVisible({ timeout: 15_000 })
  const previewBefore = await previewPatches(page)
  expect(Buffer.from(await storedVideoBytes(page)).equals(Buffer.from(raw)), 'the restored row holds the recording as made').toBe(true)
  return { plainBefore, plainAfter, previewAfter, previewBefore, repaired }
}

/** The largest channel difference between two readings of the patches. */
function maxDiff(a: Rgb[], b: Rgb[]): number {
  return Math.max(...a.flatMap((rgb, i) => rgb.map((v, c) => Math.abs(v - b[i][c]))))
}

function meanDiff(a: Rgb[], b: Rgb[]): number {
  const all = a.flatMap((rgb, i) => rgb.map((v, c) => Math.abs(v - b[i][c])))
  return all.reduce((s, v) => s + v, 0) / all.length
}

/** Kr, Kb of each matrix. */
const MATRICES = { 'BT.601': [0.299, 0.114], 'BT.709': [0.2126, 0.0722] } as const
type Matrix = keyof typeof MATRICES
interface Coding {
  matrix: Matrix
  full: boolean
}

/** `rgb` converted to YUV as `encode` says and back as `decode` says: what a mislabelled, or misread, file shows. */
function misread(rgb: Rgb, encode: Coding, decode: Coding): Rgb {
  const [er, eb] = MATRICES[encode.matrix]
  const [r, g, b] = rgb.map((v) => v / 255)
  const y = er * r + (1 - er - eb) * g + eb * b
  const cb = (b - y) / (2 * (1 - eb))
  const cr = (r - y) / (2 * (1 - er))
  // Into 8-bit code values at the encoder's range, and back out at the decoder's.
  const [Y, U, V] = encode.full ? [255 * y, 128 + 255 * cb, 128 + 255 * cr] : [16 + 219 * y, 128 + 224 * cb, 128 + 224 * cr]
  const [y2, cb2, cr2] = decode.full
    ? [Y / 255, (U - 128) / 255, (V - 128) / 255]
    : [(Y - 16) / 219, (U - 128) / 224, (V - 128) / 224]
  const [dr, db] = MATRICES[decode.matrix]
  const red = y2 + 2 * (1 - dr) * cr2
  const blue = y2 + 2 * (1 - db) * cb2
  const green = (y2 - dr * red - db * blue) / (1 - dr - db)
  return [red, green, blue].map((v) => Math.min(255, Math.max(0, 255 * v))) as Rgb
}

const CODINGS: Coding[] = (['BT.601', 'BT.709'] as const).flatMap((matrix) => [false, true].map((full) => ({ matrix, full })))
const codingName = ({ matrix, full }: Coding) => `${matrix} ${full ? 'full' : 'limited'} range`

/** The drawn patches as each pair of encode and decode would show them; every pair that agrees is "as drawn". */
const MODELS: Record<string, Rgb[]> = {
  'as drawn': PATCHES,
  ...Object.fromEntries(
    CODINGS.flatMap((encode) =>
      CODINGS.filter((decode) => decode !== encode).map((decode) => [
        `${codingName(encode)} read as ${codingName(decode)}`,
        PATCHES.map((p) => misread(p, encode, decode)),
      ])
    )
  ),
}

/** Mean / max off the drawn RGB, and the model the reading fits best. */
function describe(reading: Rgb[]): string {
  const fits = Object.entries(MODELS).map(([name, model]) => ({ name, mean: meanDiff(reading, model) }))
  const best = fits.reduce((a, b) => (b.mean < a.mean ? b : a))
  const patches = reading.map((rgb) => `(${rgb.map((v) => Math.round(v)).join(',')})`).join(' ')
  return `${meanDiff(reading, PATCHES).toFixed(2)} / ${maxDiff(reading, PATCHES).toFixed(1)} off the drawn RGB; fits "${best.name}" (${best.mean.toFixed(2)}); ${patches}`
}

function describeLayout(layout: WebmLayout): string {
  const key = layout.videoBlocks.find((block) => block.key)
  let header = ''
  if (layout.videoCodec === 'V_VP9') {
    const vp9 = key ? readVp9KeyFrameHeader(key.data) : null
    header = vp9
      ? `, first key frame color_space ${vp9.colorSpace} (${CS_NAMES[vp9.colorSpace]}), profile ${vp9.profile}`
      : ', no VP9 key frame header'
  }
  return `${layout.videoCodec}, ${layout.videoBlocks.length} video blocks, ${layout.cues.length} cues${header}, Colour MatrixCoefficients ${layout.videoMatrixCoefficients ?? 'absent'}`
}

function annotate(type: string, description: string): void {
  test.info().annotations.push({ type, description })
}

/**
 * `bytes` with its Cues element emptied in place: an empty Cues (`1c53bb6b 80`)
 * and an EBML Void over the rest of its length, so every other byte and every
 * SeekHead position stay where they were. The bytes as they are without one.
 */
function withEmptyCues(bytes: Uint8Array): Uint8Array {
  const cues = readWebmLayout(bytes).cuesElement
  if (!cues) return bytes
  const voidLength = cues.end - cues.start - 5
  expect(voidLength, 'room for an EBML Void after an empty Cues').toBeGreaterThanOrEqual(9)
  const out = new Uint8Array(bytes)
  out.set([0x1c, 0x53, 0xbb, 0x6b, 0x80], cues.start)
  // Void (0xec) with an eight-byte size, then zeros.
  const payload = voidLength - 9
  out.set([0xec, 0x01, 0, 0, 0, Math.floor(payload / 2 ** 24) & 0xff, (payload >> 16) & 0xff, (payload >> 8) & 0xff, payload & 0xff], cues.start + 5)
  out.fill(0, cues.start + 14, cues.end)
  return out
}

/** The repair kept every packet and added Cues, and every reading after it matches the one before. */
function checkRepair(label: string, raw: WebmLayout, readings: Readings): void {
  const layout = readWebmLayout(readings.repaired)
  annotate(`${label}: repaired file`, `${readings.repaired.length} bytes; ${describeLayout(layout)}`)
  expect(layout.cues.length, `${label}: the repaired file has Cues`).toBeGreaterThan(0)
  expect(layout.videoBlocks.length, `${label}: the repair kept every video packet`).toBe(raw.videoBlocks.length)
  const changed = layout.videoBlocks.filter((block, i) => !Buffer.from(block.data).equals(Buffer.from(raw.videoBlocks[i].data)))
  expect(changed.map((block) => block.time), `${label}: video packets the repair changed`).toEqual([])
  expect(layout.videoMatrixCoefficients, `${label}: the Colour element's matrix`).toBe(raw.videoMatrixCoefficients)

  annotate(`${label}: <video>, before repair`, describe(readings.plainBefore))
  annotate(`${label}: <video>, after repair`, describe(readings.plainAfter))
  annotate(`${label}: ARTIST preview, before repair`, describe(readings.previewBefore))
  annotate(`${label}: ARTIST preview, after repair`, describe(readings.previewAfter))
  expect(maxDiff(readings.previewAfter, readings.previewBefore), `${label}: preview after repair against before`).toBeLessThanOrEqual(2)
  expect(maxDiff(readings.plainAfter, readings.plainBefore), `${label}: <video> after repair against before`).toBeLessThanOrEqual(2)
}

test.describe('ESCSUITE-504: a seek-repaired MediaRecorder WebM previews with the colours it had before repair', () => {
  test.skip(({ browserName }) => browserName === 'webkit', "Playwright's WebKit cannot import media (ESCSUITE-258)")

  test("Firefox 159's MediaRecorder recording (VP8)", async ({ browser }) => {
    test.setTimeout(120_000)
    const bytes = new Uint8Array(await readFile(FIREFOX_TAKE))
    const raw = readWebmLayout(bytes)
    annotate('file', describeLayout(raw))
    checkRepair('Firefox recording', raw, await measureInArtist(browser, bytes))
  })

  test("Chromium 159's MediaRecorder recording (VP9), Cues emptied", async ({ browser }) => {
    test.setTimeout(120_000)
    const bytes = withEmptyCues(new Uint8Array(await readFile(CHROMIUM_TAKE)))
    const raw = readWebmLayout(bytes)
    annotate('file', describeLayout(raw))
    checkRepair('Chromium recording', raw, await measureInArtist(browser, bytes))
  })

  test("a fresh recording by this browser's MediaRecorder", async ({ browser, page, browserName }) => {
    test.setTimeout(120_000)
    await page.goto(`${ARTIST_URL}/?suppressRestore=1`)
    const vp9 = await page.evaluate(() => MediaRecorder.isTypeSupported('video/webm;codecs=vp9'))
    annotate('MediaRecorder supports video/webm;codecs=vp9', String(vp9))
    if (browserName === 'chromium') expect(vp9, "Chromium's MediaRecorder records VP9").toBe(true)
    // VP9 where the browser records it; Firefox 159's MediaRecorder records VP8 only.
    const take = await recordPatches(page, ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'])
    expect(take, 'this browser\'s MediaRecorder records a WebM').not.toBeNull()
    await page.close()
    const path = test.info().outputPath('recording.webm')
    await writeFile(path, take!.bytes)
    await test.info().attach('recording as made', { path, contentType: 'video/webm' })
    annotate('recording as made', `${take!.mimeType}, ${take!.bytes.length} bytes; ${describeLayout(readWebmLayout(take!.bytes))}`)

    const bytes = withEmptyCues(take!.bytes)
    const raw = readWebmLayout(bytes)
    checkRepair('fresh recording', raw, await measureInArtist(browser, bytes))
  })
})
