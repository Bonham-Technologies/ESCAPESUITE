import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'
import { exportButtonName } from './artist'

/**
 * Helpers for the frame-barcode export specs (ESCSUITE-454, ESCSUITE-495,
 * ESCSUITE-505).
 *
 * Their sources, under `fixtures/presented-frame/`, show each frame's own
 * index as an 8-bit barcode: eight full-height stripes, stripe k from the left
 * white when bit k of the index is set. A frame read back from anything made
 * from one names the source frame it came from exactly, whatever the codec
 * noise.
 */

/** Bits in the barcode: stripe k, left to right, is bit k of the frame's index. */
export const BARCODE_BITS = 8

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
 * One piece of the source on the timeline: its in point, length and place, in
 * seconds, and its speed (1 when left out, ESCSUITE-471). `duration` is the
 * piece's length on the timeline; it covers `duration * speed` of the source.
 */
export interface Piece {
  startTime: number
  duration: number
  timelinePosition: number
  speed?: number
}

/**
 * Replace the one imported clip with `pieces` of it, in a project of
 * `width` x `height`, through `LOAD_PROJECT` (see
 * `tests/export/decode-worker.spec.ts`), on a timeline `duration` seconds
 * long. The caller computes every time, so the float values are the ones the
 * spec's expectations were computed from.
 */
export async function cutIntoPieces(
  page: Page,
  pieces: readonly Piece[],
  { width, height, duration }: { width: number; height: number; duration: number }
): Promise<void> {
  const project = await getProject(page)
  const [clip] = project.timeline.clips
  project.timeline.clips = pieces.map(({ startTime, duration, timelinePosition, speed }, k) => ({
    ...clip,
    id: `${clip.id}-piece-${k}`,
    startTime,
    endTime: startTime + duration * (speed ?? 1),
    duration,
    timelinePosition,
    ...(speed === undefined ? {} : { speed }),
  }))
  project.timeline.duration = duration
  project.resolution = { width, height }
  await page.evaluate((payload) => window.postMessage({ type: 'LOAD_PROJECT', payload }, '*'), project)
  await expect(page.getByText(new RegExp(`^${pieces.length} clips`)).first()).toBeVisible({ timeout: 15_000 })
}

/**
 * Export the timeline as a WebM at project resolution, from the export
 * dialog's Advanced panel, and return its bytes.
 */
export async function exportWebmAtProjectResolution(page: Page): Promise<Buffer> {
  await page.getByRole('radio', { name: /WebM/ }).check()
  await page.locator('select').filter({ has: page.locator('option[value="480p"]') }).selectOption('project')
  const download = page.waitForEvent('download', { timeout: 120_000 })
  // The Advanced panel's button sits after the primary "Download WebM" in the DOM.
  await page.getByRole('button', { name: exportButtonName('webm') }).last().click()
  return readFileSync(await (await download).path())
}

/**
 * Decode `bytes` (a WebM) in a `<video>` outside the document, as the exporter
 * holds its sources, and read the barcode of the frame at each of `times`
 * (seconds). Each read waits for the seek's frame callback as well as
 * 'seeked', or the reader itself could read the frame from before the seek
 * (ESCSUITE-437); the callback is registered before the seek, so it cannot
 * miss the frame, and the deadline only keeps a read from hanging. Read
 * mid-frame: a time on a frame's start can land on the frame before it.
 */
export async function readBarcodes(page: Page, bytes: Buffer, times: number[]): Promise<number[]> {
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
    { base64: bytes.toString('base64'), times, bits: BARCODE_BITS }
  )
}

/**
 * The export frames whose barcode is not the source frame `expected` puts
 * there, one line each; `pieceFrames` export frames make one piece.
 */
export function wrongFrames(read: readonly number[], expected: readonly number[], pieceFrames: number): string[] {
  return expected.flatMap((want, n) => {
    if (read[n] === want) return []
    const stale = read[n] === expected[n - 1] ? ' (the frame before it)' : ''
    const cut = n % pieceFrames === 0 ? ', the first after a cut' : ''
    return [`frame ${n}${cut}: source frame ${read[n]}${stale}, want ${want}`]
  })
}
