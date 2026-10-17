// ESCSUITE-330: an export whose clip's source has no stored bytes fails by name.
//
// Another tab's Clear All deletes the bytes a project in this tab still uses.
// The element loader skipped such a source without a word, the frame loop drew
// nothing for its clip, and the export reported "Export complete!" over black
// frames (ESCSUITE-311 O-U2, reproduced on the production layout). The MP4 load
// loop had the same shape. Now all three exporters refuse with one ExportError
// naming the source and carrying `code: 'SOURCE_MISSING'` — the headless kit
// fails such a job as a permanent input error — and release what they loaded.
//
// This is not a load failure (ESCSUITE-325 / 328): there the bytes exist and the
// browser cannot read them, and WebM and GIF still warn and skip. Here there is
// nothing to try, in any exporter.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportToMP4 } from './exportMP4'
import { exportToWebM } from './exportWebM'
import { exportToGIF } from './exportGIF'
import { ExportError, type ExportResult } from './exportTypes'
import { storeVideo } from './storage'
import { resetMediabunnyDouble } from '../test/doubles/mediabunny'
import {
  installCanvasDouble,
  installOffscreenCanvasDouble,
  uninstallCanvasDouble,
  type OffscreenCanvasDouble,
} from '../test/doubles/canvas'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import {
  VideoFrameDouble,
  installWebCodecsDoubles,
  resetFrameRegistry,
  type WebCodecsDoubles,
} from '../test/doubles/webcodecs'
import { makeClip, makeExportOptions, makeSourceVideo, makeTrack } from '../test/fixtures/clipFixtures'
import type { Clip, ExportOptions, SourceVideo } from '../store/types'

type ExportFormat = ExportOptions['format']

vi.mock('mediabunny', async () => {
  const { createMediabunnyDouble } = await import('../test/doubles/mediabunny')
  return createMediabunnyDouble()
})

vi.mock('./audioMixer', () => ({
  extractAndMixAudio: vi.fn(async () => null),
}))

// jsdom's user agent is not a measured decode-worker engine (ESCSUITE-254).
vi.mock('./workerDecodeEngine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./workerDecodeEngine')>()),
  isMeasuredWorkerDecodeEngine: () => true,
}))

const { gif, worker } = vi.hoisted(() => ({
  gif: { writers: 0, frames: 0 },
  worker: { loaded: [] as string[], terminated: 0 },
}))

vi.mock('./gifEncoder', () => ({
  GIF_MAX_COLORS: 256,
  createGifWriter: () => {
    gif.writers += 1
    return {
      addFrame: () => {
        gif.frames += 1
      },
      bytesWritten: () => gif.frames * 100,
      finish: () => new Uint8Array(gif.frames * 100),
    }
  },
}))

/** A decode worker stand-in that takes every source and answers every frame. */
class AnsweringDecodeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null

  constructor() {
    setTimeout(() => this.reply({ type: 'WORKER_READY' }), 0)
  }

  postMessage(request: { type: string; sourceId: string; timestamp: number; requestId: number }) {
    if (request.type === 'INIT_SOURCE') {
      worker.loaded.push(request.sourceId)
      const info = { sourceId: request.sourceId, duration: 10, width: 640, height: 360, codec: 'avc1.64001f', frameCount: 300, keyframeCount: 10 }
      setTimeout(() => this.reply({ type: 'SOURCE_READY', sourceId: request.sourceId, info }), 0)
    } else if (request.type === 'REQUEST_FRAME') {
      setTimeout(() => {
        const Frame = (globalThis as unknown as { VideoFrame: typeof VideoFrameDouble }).VideoFrame
        const frame = new Frame({ timestamp: request.timestamp * 1e6 })
        this.reply({ type: 'FRAME_READY', requestId: request.requestId, sourceId: request.sourceId, timestamp: request.timestamp, frame })
      }, 0)
    }
  }

  terminate() {
    worker.terminated += 1
  }

  private reply(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data }))
  }
}

type Run = (clips: Clip[], sources: SourceVideo[]) => Promise<ExportResult>

function exporter(fn: typeof exportToMP4, format: ExportFormat): Run {
  return (clips, sources) =>
    fn(clips, sources, makeExportOptions({ format, resolution: 'project' }), vi.fn(), [makeTrack()], undefined, {
      width: 640,
      height: 360,
    })
}

const EXPORTERS: Array<[ExportFormat, Run]> = [
  ['mp4', exporter(exportToMP4, 'mp4')],
  ['webm', exporter(exportToWebM, 'webm')],
  ['gif', exporter(exportToGIF, 'gif')],
]

const CLIP_DURATION = 0.2

/** The refusal's sentence for a source known by `name`. */
const missing = (name: string) =>
  `The media for "${name}" is no longer in storage (it was removed in another window or by Clear All); remove the clip or re-import the file`

function clipOf(sourceVideoId: string, n = 1): Clip {
  return makeClip({
    id: `c${n}`,
    sourceVideoId,
    duration: CLIP_DURATION,
    endTime: CLIP_DURATION,
    timelinePosition: (n - 1) * CLIP_DURATION,
  })
}

function sourceOf(id: string, name: string, extra: Partial<SourceVideo> = {}): SourceVideo {
  return makeSourceVideo({ id, name, width: 640, height: 360, mimeType: 'video/mp4', ...extra })
}

/** Nothing reached an encoder: no video encoder built (MP4, WebM), no GIF writer. */
function nothingEncoded(): boolean {
  return webcodecs.videoEncoders.length === 0 && gif.writers === 0
}

let webcodecs: WebCodecsDoubles
let offscreen: OffscreenCanvasDouble
let media: MediaDoubles
let spies: Array<{ mockRestore: () => void }> = []
/** Restored by hand, not with vi.unstubAllGlobals() (ESCSUITE-119). */
const realWorker = globalThis.Worker

beforeEach(async () => {
  worker.loaded = []
  worker.terminated = 0
  gif.writers = 0
  gif.frames = 0
  globalThis.Worker = AnsweringDecodeWorker as unknown as typeof Worker
  resetMediabunnyDouble()
  resetFrameRegistry()
  installCanvasDouble()
  offscreen = installOffscreenCanvasDouble()
  media = installMediaElementDoubles({ video: { videoWidth: 640, videoHeight: 360 } })
  webcodecs = installWebCodecsDoubles()
  spies = [
    vi.spyOn(console, 'log').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'error').mockImplementation(() => {}),
  ]
  vi.mocked(URL.revokeObjectURL).mockClear()
  await storeVideo('kept', new Blob([new Uint8Array(8)], { type: 'video/mp4' }), sourceOf('kept', 'Kept take'))
  // A row the browser still holds with no bytes in it.
  await storeVideo('husk', undefined as unknown as Blob, sourceOf('husk', 'Husk take'))
})

afterEach(() => {
  globalThis.Worker = realWorker
  webcodecs.uninstall()
  media.uninstall()
  offscreen.uninstall()
  uninstallCanvasDouble()
  resetFrameRegistry()
  for (const s of spies) s.mockRestore()
})

describe.each(EXPORTERS)('a %s export whose clip\'s source has no stored bytes (ESCSUITE-330)', (format, run) => {
  it('fails by the source\'s name with SOURCE_MISSING, encoding nothing', async () => {
    const error = await run([clipOf('gone')], [sourceOf('gone', 'Probe 311 take')]).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ExportError)
    expect((error as ExportError).message).toBe(missing('Probe 311 take'))
    expect((error as ExportError).code).toBe('SOURCE_MISSING')
    // The trail says what happened, as every other refusal's does.
    expect((error as ExportError).exportLog.at(-1)).toMatchObject({ phase: 'error', detail: missing('Probe 311 take') })
    expect(nothingEncoded()).toBe(true)
    expect(media.videos).toHaveLength(0)
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    // The MP4 export's decode worker exists by now, and goes with the refusal.
    expect(worker.terminated).toBe(format === 'mp4' ? 1 : 0)
  })

  it('names the id when the exporter was not handed the source\'s record', async () => {
    const error = await run([clipOf('gone')], []).catch((e: unknown) => e)

    expect((error as ExportError).message).toBe(missing('gone'))
    expect((error as ExportError).code).toBe('SOURCE_MISSING')
  })

  it('refuses a row that exists but holds no bytes the same way', async () => {
    const error = await run([clipOf('husk')], [sourceOf('husk', 'Husk take')]).catch((e: unknown) => e)

    expect((error as ExportError).message).toBe(missing('Husk take'))
    expect((error as ExportError).code).toBe('SOURCE_MISSING')
    expect(nothingEncoded()).toBe(true)
  })

  it('refuses by the second source\'s name, releasing the first source it had loaded', async () => {
    const error = await run(
      [clipOf('kept', 1), clipOf('gone', 2)],
      [sourceOf('kept', 'Kept take'), sourceOf('gone', 'Gone take')]
    ).catch((e: unknown) => e)

    expect((error as ExportError).message).toBe(missing('Gone take'))
    expect((error as ExportError).code).toBe('SOURCE_MISSING')
    expect(nothingEncoded()).toBe(true)
    if (format === 'mp4') {
      // The first source went to the decode worker, which is released once.
      expect(worker.loaded).toEqual(['kept'])
      expect(worker.terminated).toBe(1)
    } else {
      // The first source's element, its object URL revoked once and paused.
      expect(media.videos).toHaveLength(1)
      const src = media.videos[0].src
      expect(vi.mocked(URL.revokeObjectURL).mock.calls.filter(([url]) => url === src)).toHaveLength(1)
      expect(media.videos[0].pause).toHaveBeenCalled()
    }
  })

  it.each([
    ['an audio-only', 'audio' as const],
    ['an image', 'image' as const],
  ])('refuses %s source with no bytes too', async (_label, mediaType) => {
    const error = await run(
      [clipOf('kept', 1), clipOf('gone', 2)],
      [sourceOf('kept', 'Kept take'), sourceOf('gone', 'Gone file', { mediaType })]
    ).catch((e: unknown) => e)

    expect((error as ExportError).message).toBe(missing('Gone file'))
    expect((error as ExportError).code).toBe('SOURCE_MISSING')
  })

  it('completes when the byteless source is in the library but on no clip', async () => {
    const result = await run([clipOf('kept')], [sourceOf('kept', 'Kept take'), sourceOf('gone', 'Gone take')])

    expect(result.blob.size).toBeGreaterThan(0)
  })
})
