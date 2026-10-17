// ESCSUITE-328: every load failure of the MP4 export's media fails the export
// by name. ESCSUITE-325 named the 15 s silence of a `<video>` fallback but left
// an immediate `error` event to a warn-and-retry-as-image that dropped the clip
// from the file without a word; and the image load itself had no deadline.
// Now an `error` and a deadline end the export the same way — one ExportError
// naming the source — and a `<video>` that fails is never retried as an image.
// WebM and GIF keep the oracle's warn-and-skip rule (elementFrames.imageDeadline.test.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportToMP4, ExportError } from './exportMP4'
import type { ExportResult } from './exportTypes'
import { extractAndMixAudio } from './audioMixer'
import { storeVideo } from './storage'
import { resetMediabunnyDouble } from '../test/doubles/mediabunny'
import {
  getLastCanvasContext,
  installCanvasDouble,
  installOffscreenCanvasDouble,
  uninstallCanvasDouble,
  type OffscreenCanvasDouble,
  type RecordingCanvasRenderingContext2D,
} from '../test/doubles/canvas'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import { installWebCodecsDoubles, type WebCodecsDoubles } from '../test/doubles/webcodecs'
import { makeClip, makeExportOptions, makeSourceVideo, makeTrack } from '../test/fixtures/clipFixtures'
import type { Clip, SourceVideo } from '../store/types'

vi.mock('mediabunny', async () => {
  const { createMediabunnyDouble } = await import('../test/doubles/mediabunny')
  return createMediabunnyDouble()
})

vi.mock('./audioMixer', () => ({
  extractAndMixAudio: vi.fn(async () => null),
}))

const mixAudio = vi.mocked(extractAndMixAudio)
const CLIP_DURATION = 0.2

let media: MediaDoubles
let webcodecs: WebCodecsDoubles
let offscreen: OffscreenCanvasDouble
let spies: Array<{ mockRestore: () => void }> = []

async function storeSource(id: string, type: string): Promise<void> {
  await storeVideo(id, new Blob([new Uint8Array(8)], { type }), makeSourceVideo({ id }))
}

function clipOf(id: string, n = 1): Clip {
  return makeClip({ id: `c${n}`, sourceVideoId: id, duration: CLIP_DURATION, endTime: CLIP_DURATION })
}

function run(id: string, mediaType: SourceVideo['mediaType']): Promise<ExportResult> {
  return exportToMP4(
    [clipOf(id)],
    [makeSourceVideo({ id, name: id, mediaType, width: 640, height: 360 })],
    makeExportOptions({}),
    vi.fn(),
    [makeTrack()]
  )
}

/** Start `start`, then let `ms` of fake time pass; the settled outcome is read from the returned box. */
async function runFor(start: () => Promise<ExportResult>, ms: number) {
  const box: { error?: unknown; result?: ExportResult } = {}
  void start().then(
    (r) => (box.result = r),
    (e) => (box.error = e)
  )
  await vi.advanceTimersByTimeAsync(ms)
  return box
}

beforeEach(() => {
  resetMediabunnyDouble()
  mixAudio.mockReset()
  mixAudio.mockResolvedValue(null)
  installCanvasDouble()
  offscreen = installOffscreenCanvasDouble()
  media = installMediaElementDoubles({ video: { videoWidth: 640, videoHeight: 360 } })
  webcodecs = installWebCodecsDoubles()
  spies = [
    vi.spyOn(console, 'log').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'error').mockImplementation(() => {}),
  ]
})

afterEach(() => {
  vi.useRealTimers()
  webcodecs.uninstall()
  media.uninstall()
  offscreen.uninstall()
  uninstallCanvasDouble()
  for (const s of spies) s.mockRestore()
})

describe('a <video> fallback that fires error (ESCSUITE-328)', () => {
  it('fails the export by name, tears the element down, and never retries it as an image', async () => {
    await storeSource('video1', 'video/webm')
    media.script({ video: { fail: true } })
    const revoke = vi.spyOn(URL, 'revokeObjectURL')

    const error = await run('video1', 'video').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ExportError)
    expect((error as ExportError).message).toBe('Could not read video1 — the browser could not decode it')
    expect(media.images).toHaveLength(0)
    expect(webcodecs.videoEncoders).toHaveLength(0)
    expect(revoke).toHaveBeenCalledTimes(1)
    expect(media.videos[0].onloadeddata).toBeNull()
    expect(media.videos[0].onerror).toBeNull()
  })

  it('names the id when the clip\'s source is missing from the sources list', async () => {
    await storeSource('video1', 'video/webm')
    media.script({ video: { fail: true } })

    const error = await exportToMP4(
      [clipOf('video1')],
      [],
      makeExportOptions({}),
      vi.fn(),
      [makeTrack()]
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ExportError)
    expect((error as ExportError).message).toBe('Could not read video1 \u2014 the browser could not decode it')
  })

  it('releases an already-loaded image source when a later video fires error', async () => {
    await storeSource('image1', 'image/png')
    await storeSource('video1', 'video/webm')
    media.script({ video: { fail: true } })
    const revoke = vi.spyOn(URL, 'revokeObjectURL')

    const error = await exportToMP4(
      [clipOf('image1', 1), clipOf('video1', 2)],
      [
        makeSourceVideo({ id: 'image1', name: 'image1', mediaType: 'image' }),
        makeSourceVideo({ id: 'video1', name: 'video1', mediaType: 'video', width: 640, height: 360 }),
      ],
      makeExportOptions({}),
      vi.fn(),
      [makeTrack()]
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ExportError)
    expect((error as ExportError).message).toContain('Could not read video1')
    expect(media.images).toHaveLength(1)
    expect(revoke.mock.calls.filter((c) => c[0] === media.images[0].src)).toHaveLength(1)
    expect(webcodecs.videoEncoders).toHaveLength(0)
  })

  it('keeps the ESCSUITE-325 sentence for a silence', async () => {
    await storeSource('video1', 'video/webm')
    media.script({ video: { silent: true } })
    vi.useFakeTimers()

    const box = await runFor(() => run('video1', 'video'), 15_100)

    expect((box.error as ExportError).message).toBe(
      'Could not read video1 — the browser did not report its metadata within 15 s'
    )
    expect(media.images).toHaveLength(0)
  })
})

describe('an image source (ESCSUITE-328)', () => {
  it('still exports a genuine image that loads', async () => {
    await storeSource('image1', 'image/png')

    await run('image1', 'image')

    const ctx = getLastCanvasContext() as RecordingCanvasRenderingContext2D
    expect(ctx.argsFor('drawImage')[0][0]).toBe(media.images[0])
  })

  it('fails the export by name when it never settles, 15 s in, the image torn down', async () => {
    await storeSource('image1', 'image/png')
    media.script({ image: { silent: true } })
    vi.useFakeTimers()
    const removeSrc = vi.spyOn(HTMLImageElement.prototype, 'removeAttribute')

    const box = await runFor(() => run('image1', 'image'), 14_999)
    expect(box.error).toBeUndefined()
    await vi.advanceTimersByTimeAsync(2)

    expect(box.error).toBeInstanceOf(ExportError)
    expect((box.error as ExportError).message).toBe(
      'Could not read image1 — the browser did not report its metadata within 15 s'
    )
    expect(media.images[0].onload).toBeNull()
    expect(removeSrc).toHaveBeenCalledWith('src')
    expect(webcodecs.videoEncoders).toHaveLength(0)
  })

  it('fails the export by name when it fires error', async () => {
    await storeSource('image1', 'image/png')
    media.script({ image: { fail: true } })

    const error = await run('image1', 'image').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ExportError)
    expect((error as ExportError).message).toBe('Could not read image1 — the browser could not decode it')
    expect(webcodecs.videoEncoders).toHaveLength(0)
  })

  it('succeeds when the image loads at 14.9 s, the timer cleared', async () => {
    await storeSource('image1', 'image/png')
    media.script({ image: { silent: true } })
    vi.useFakeTimers()
    const set = vi.spyOn(globalThis, 'setTimeout')
    const clear = vi.spyOn(globalThis, 'clearTimeout')

    const box = await runFor(() => run('image1', 'image'), 14_900)
    const deadline = set.mock.results[set.mock.calls.findIndex((c) => c[1] === 15_000)].value
    media.images[0].dispatchEvent(new Event('load'))
    for (let i = 0; i < 20 && !box.result && !box.error; i++) await vi.advanceTimersByTimeAsync(5_000)

    expect(box.error).toBeUndefined()
    expect(box.result).toBeDefined()
    expect(clear.mock.calls.filter((c) => c[0] === deadline)).toHaveLength(1)
  })
})
