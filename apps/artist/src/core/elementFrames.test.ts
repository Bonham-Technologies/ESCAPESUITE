// The per-frame machinery both element-drawing exporters share (ESCSUITE-34).
//
// `exportWebM.ts` had all of this inline and `exportGIF.ts` needed the same
// thing, so it was lifted here rather than copied. The exporters' own suites
// (`exportWebM.test.ts`, and `exportGIF.test.ts` once it lands) still cover it
// end to end; these cases cover the four exported functions directly, where a
// specific question — "does a source with no bytes refuse by name", "is a seek
// inside half a frame of the target skipped" — is cheaper to ask than through a
// whole export.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createFrameComposer,
  loadElementSources,
  releaseElementSources,
  rewindElementSources,
} from './elementFrames'
import { elementSeekTarget } from './elementSeek'
import { SEEK_IN_FLIGHT_GRACE_MS, SourceNotSeekableError, WEDGED_SEEK_FRAMES } from './seekWedge'
import { ExportError, type ExportLogEntry } from './exportTypes'
import { getVideoBlob, storeVideo } from './storage'
import {
  getLastCanvasContext,
  installCanvasDouble,
  uninstallCanvasDouble,
  type RecordingCanvasRenderingContext2D,
} from '../test/doubles/canvas'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import { makeClip, makeSourceVideo, makeTrack } from '../test/fixtures/clipFixtures'
import type { Clip, SourceVideo } from '../store/types'

// Real storage — fake-indexeddb, the same bytes `store()` writes — with
// `getVideoBlob` wrapped so one case can make a single read fail. That is the
// only way to reach `loadElementSources`' own ownership guard: once both media
// branches warn and skip, a failed read is the one thing left inside its loop
// that can reject (ESCSUITE-156).
vi.mock('./storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./storage')>()
  return { ...actual, getVideoBlob: vi.fn(actual.getVideoBlob) }
})

const realGetVideoBlob = (await vi.importActual<typeof import('./storage')>('./storage'))
  .getVideoBlob

/**
 * A counted `requestAnimationFrame`, with the queue a browser would drain on
 * its next frame. `flush()` runs every callback still pending, so a poll that
 * re-queues itself is visible as a rising `requests`, and one that has been
 * cancelled is visible as a `requests` that stops moving.
 */
function installCountedRaf() {
  const pending = new Map<number, FrameRequestCallback>()
  const cancels: number[] = []
  const realRequest = globalThis.requestAnimationFrame
  const realCancel = globalThis.cancelAnimationFrame
  let nextHandle = 1
  let requests = 0

  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    requests += 1
    const handle = nextHandle++
    pending.set(handle, cb)
    return handle
  }) as typeof globalThis.requestAnimationFrame
  globalThis.cancelAnimationFrame = ((handle: number) => {
    cancels.push(handle)
    pending.delete(handle)
  }) as typeof globalThis.cancelAnimationFrame

  return {
    get requests() {
      return requests
    },
    cancels,
    flush() {
      const due = [...pending.values()]
      pending.clear()
      for (const cb of due) cb(0)
    },
    uninstall() {
      globalThis.requestAnimationFrame = realRequest
      globalThis.cancelAnimationFrame = realCancel
    },
  }
}

let media: MediaDoubles
let warns: ReturnType<typeof vi.spyOn>

const PROJECT = { width: 640, height: 360 }

beforeEach(() => {
  installCanvasDouble()
  media = installMediaElementDoubles({ video: { videoWidth: 640, videoHeight: 360 } })
  warns = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  media.uninstall()
  uninstallCanvasDouble()
  warns.mockRestore()
})

async function store(id: string, mimeType = 'video/webm', mediaType?: SourceVideo['mediaType']) {
  await storeVideo(
    id,
    new Blob([new Uint8Array(8)], { type: mimeType }),
    makeSourceVideo({ id, mediaType })
  )
}

function sourceMapOf(sources: SourceVideo[]): Map<string, SourceVideo> {
  return new Map(sources.map((s) => [s.id, s]))
}

/** A canvas plus its recording context, the way the exporters build one. */
function outputCanvas(): { canvas: HTMLCanvasElement; ctx: RecordingCanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = PROJECT.width
  canvas.height = PROJECT.height
  canvas.getContext('2d', { alpha: false })
  return { canvas, ctx: getLastCanvasContext() as RecordingCanvasRenderingContext2D }
}

describe('loadElementSources', () => {
  it('loads a video source into a <video> element', async () => {
    await store('v1')
    const sources = await loadElementSources(
      [makeClip({ sourceVideoId: 'v1' })],
      sourceMapOf([makeSourceVideo({ id: 'v1' })]),
      []
    )

    expect([...sources.videoElements.keys()]).toEqual(['v1'])
    expect(sources.imageElements.size).toBe(0)
  })

  it('loads an image source into an <img> element', async () => {
    await store('i1', 'image/png', 'image')
    const sources = await loadElementSources(
      [makeClip({ sourceVideoId: 'i1' })],
      sourceMapOf([makeSourceVideo({ id: 'i1', mediaType: 'image' })]),
      []
    )

    expect([...sources.imageElements.keys()]).toEqual(['i1'])
    expect(sources.videoElements.size).toBe(0)
  })

  it('skips an audio-only source: nothing visual is drawn from it', async () => {
    await store('a1', 'audio/webm', 'audio')
    const sources = await loadElementSources(
      [makeClip({ sourceVideoId: 'a1' })],
      sourceMapOf([makeSourceVideo({ id: 'a1', mediaType: 'audio' })]),
      []
    )

    expect(sources.videoElements.size).toBe(0)
    expect(sources.imageElements.size).toBe(0)
  })

  // ESCSUITE-330: a source with no bytes in storage — another tab's Clear All
  // deleted them — used to be skipped here without a word, and the export drew
  // nothing for its clip and reported "Export complete!". It refuses by name now,
  // and the loader frees what it had loaded before it, by the same ownership rule
  // a failed read follows below. (A load *failure* — bytes the browser cannot
  // read — still warns and skips; there is nothing to try here.)
  it('refuses a source with no bytes in storage by name, releasing what it loaded before it', async () => {
    await store('v1')
    vi.mocked(URL.revokeObjectURL).mockClear()
    const exportLog: ExportLogEntry[] = []

    const error = await loadElementSources(
      [makeClip({ id: 'c1', sourceVideoId: 'v1' }), makeClip({ id: 'c2', sourceVideoId: 'ghost' })],
      sourceMapOf([makeSourceVideo({ id: 'v1' }), makeSourceVideo({ id: 'ghost', name: 'Ghost take' })]),
      exportLog
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ExportError)
    expect((error as ExportError).code).toBe('SOURCE_MISSING')
    expect((error as ExportError).message).toContain('"Ghost take" is no longer in storage')
    expect((error as ExportError).exportLog).toBe(exportLog)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(media.videos[0].src)
  })

  it('ignores an overlay clip, which has no source id at all', async () => {
    const sources = await loadElementSources([makeClip({ sourceVideoId: '' })], new Map(), [])

    expect(sources.videoElements.size).toBe(0)
  })

  it('loads each unique source once however many clips use it', async () => {
    await store('v1')
    const clips: Clip[] = [
      makeClip({ id: 'c1', sourceVideoId: 'v1' }),
      makeClip({ id: 'c2', sourceVideoId: 'v1' }),
    ]
    await loadElementSources(clips, sourceMapOf([makeSourceVideo({ id: 'v1' })]), [])

    expect(media.videos).toHaveLength(1)
  })

  it('falls back to loading a video that will not load as an image', async () => {
    await store('v1')
    media.script({ video: { fail: true } })

    const sources = await loadElementSources(
      [makeClip({ sourceVideoId: 'v1' })],
      sourceMapOf([makeSourceVideo({ id: 'v1' })]),
      []
    )

    expect(sources.videoElements.size).toBe(0)
    expect(sources.imageElements.size).toBe(1)
    expect(warns).toHaveBeenCalled()
  })

  it('gives up on media that loads as neither video nor image', async () => {
    await store('v1')
    media.script({ video: { fail: true }, image: { fail: true } })

    const sources = await loadElementSources(
      [makeClip({ sourceVideoId: 'v1' })],
      sourceMapOf([makeSourceVideo({ id: 'v1' })]),
      []
    )

    expect(sources.videoElements.size).toBe(0)
    expect(sources.imageElements.size).toBe(0)
    expect(warns).toHaveBeenCalledWith('Failed to load media v1')
  })

  // ESCSUITE-156. The video branch degrades — video, then image, then a warning
  // — and the image branch used to have no fallback at all: one corrupt PNG
  // rejected the whole load and took every element already loaded with it.
  it('warns and skips an image that will not decode, keeping the sources around it', async () => {
    await store('v1')
    await store('i1', 'image/png', 'image')
    media.script({ image: { fail: true } })

    const sources = await loadElementSources(
      [makeClip({ id: 'c1', sourceVideoId: 'v1' }), makeClip({ id: 'c2', sourceVideoId: 'i1' })],
      sourceMapOf([makeSourceVideo({ id: 'v1' }), makeSourceVideo({ id: 'i1', mediaType: 'image' })]),
      []
    )

    expect([...sources.videoElements.keys()]).toEqual(['v1'])
    expect(sources.imageElements.size).toBe(0)
    expect(warns).toHaveBeenCalledWith('Failed to load media i1')
    // The video is the caller's to draw from and to free: a skipped image must
    // not take the elements loaded before it with it.
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(sources.videoElements.get('v1')!.src)
  })

  it('releases what it has already loaded when a read fails partway through', async () => {
    await store('v1')
    await store('v2')
    vi.mocked(getVideoBlob)
      .mockImplementationOnce(realGetVideoBlob)
      .mockImplementationOnce(async () => {
        throw new Error('IndexedDB read failed')
      })
    vi.mocked(URL.revokeObjectURL).mockClear()

    await expect(
      loadElementSources(
        [makeClip({ id: 'c1', sourceVideoId: 'v1' }), makeClip({ id: 'c2', sourceVideoId: 'v2' })],
        sourceMapOf([makeSourceVideo({ id: 'v1' }), makeSourceVideo({ id: 'v2' })]),
        []
      )
    ).rejects.toThrow('IndexedDB read failed')

    // v1's <video> never reaches a caller, so there is nobody else who could
    // free it: the loader owns what it has loaded until it returns.
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })
})

describe('rewindElementSources', () => {
  it('pauses and rewinds every loaded video, once', async () => {
    await store('v1')
    const sources = await loadElementSources(
      [makeClip({ sourceVideoId: 'v1' })],
      sourceMapOf([makeSourceVideo({ id: 'v1' })]),
      []
    )

    const state = rewindElementSources(sources)

    expect(media.seeks).toEqual([0])
    expect(sources.videoElements.get('v1')!.pause).toHaveBeenCalledTimes(1)
    expect(state.get(sources.videoElements.get('v1')!)).toEqual({ playing: false, targetTime: 0 })
  })
})

describe('releaseElementSources', () => {
  it('revokes the object URL behind every element', async () => {
    await store('v1')
    await store('i1', 'image/png', 'image')
    const sources = await loadElementSources(
      [makeClip({ id: 'c1', sourceVideoId: 'v1' }), makeClip({ id: 'c2', sourceVideoId: 'i1' })],
      sourceMapOf([makeSourceVideo({ id: 'v1' }), makeSourceVideo({ id: 'i1', mediaType: 'image' })]),
      []
    )
    vi.mocked(URL.revokeObjectURL).mockClear()

    releaseElementSources(sources)

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  })
})

describe('createFrameComposer', () => {
  it('opens the frame by clearing the whole raster to black', async () => {
    await store('v1')
    const clips = [makeClip({ sourceVideoId: 'v1', duration: 1, endTime: 1 })]
    const sources = await loadElementSources(clips, sourceMapOf([makeSourceVideo({ id: 'v1' })]), [])
    const playbackState = rewindElementSources(sources)
    const { canvas, ctx } = outputCanvas()

    const composeFrame = createFrameComposer({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      canvas,
      clips,
      tracks: [makeTrack()],
      sources,
      playbackState,
      projectSize: PROJECT,
      outputSize: PROJECT,
      drawOptions: { filterScale: 1 },
      frameRate: 30,
    })

    await composeFrame(0)

    expect(ctx.argsFor('fillRect')).toEqual([[0, 0, PROJECT.width, PROJECT.height]])
    expect(ctx.stateFor('fillRect')[0].fillStyle).toBe('#000000')
    expect(ctx.argsFor('drawImage')).toHaveLength(1)

    // "Opens" is the load-bearing word, and it is an ordering claim: the frame
    // transform, then the full-raster fill, then anything drawn into it.
    // Nothing else pins it — `exportWebM.perf.test.ts`'s `splitFrames` buckets
    // on the transform-and-fill pair *wherever* it falls, so moving
    // `openOutputFrame` to the end of the frame leaves all of its medians (and
    // its frame count) unmoved. A GIF frame read back with `ctx.getImageData`
    // after a late clear would be black, so this is the assertion that keeps
    // the composer honest for every element-drawing pipeline.
    const order = ctx.calls.map((c) => c.method)
    expect(order.indexOf('setTransform')).toBeLessThan(order.indexOf('fillRect'))
    expect(order.indexOf('fillRect')).toBeLessThan(order.indexOf('drawImage'))
  })

  it('skips a seek that is already within half an output frame of the target', async () => {
    await store('v1')
    const clips = [makeClip({ sourceVideoId: 'v1', duration: 1, endTime: 1 })]
    const sources = await loadElementSources(clips, sourceMapOf([makeSourceVideo({ id: 'v1' })]), [])
    const playbackState = rewindElementSources(sources)
    const { canvas, ctx } = outputCanvas()
    const composeFrame = createFrameComposer({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      canvas,
      clips,
      tracks: [makeTrack()],
      sources,
      playbackState,
      projectSize: PROJECT,
      outputSize: PROJECT,
      drawOptions: { filterScale: 1 },
      frameRate: 10,
    })
    const seeksBefore = media.seeks.length

    // The element sits at 0 after the rewind. At 10 fps the tolerance is
    // 0.4 / 10 = 40 ms, so a frame at t = 0.02 reuses the position it has and a
    // frame at t = 0.1 does not.
    await composeFrame(0.02)
    expect(media.seeks).toHaveLength(seeksBefore)

    await composeFrame(0.1)
    expect(media.seeks).toHaveLength(seeksBefore + 1)
  })

  // ESCSUITE-265: a frame-aligned request lands on a source frame's start,
  // which both measured engines resolve to the frame before it on a third of
  // the starts; the seek goes a little past it instead (`elementSeek.ts`).
  it('seeks to just past the requested time, so a frame start shows its own frame', async () => {
    await store('v1')
    const clips = [makeClip({ sourceVideoId: 'v1', startTime: 0.5, duration: 1, endTime: 1.5 })]
    const sources = await loadElementSources(clips, sourceMapOf([makeSourceVideo({ id: 'v1' })]), [])
    const playbackState = rewindElementSources(sources)
    const { canvas, ctx } = outputCanvas()
    const composeFrame = createFrameComposer({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      canvas,
      clips,
      tracks: [makeTrack()],
      sources,
      playbackState,
      projectSize: PROJECT,
      outputSize: PROJECT,
      drawOptions: { filterScale: 1 },
      frameRate: 30,
    })
    const seeksBefore = media.seeks.length

    await composeFrame(1 / 30)
    await composeFrame(2 / 30)

    expect(media.seeks.slice(seeksBefore)).toEqual([0.5 + 1 / 30, 0.5 + 2 / 30].map(elementSeekTarget))
  })

  it('waits for a video with no frame data yet, then draws nothing for it', async () => {
    await store('v1')
    media.script({ video: { readyState: 1 } })
    const clips = [makeClip({ sourceVideoId: 'v1', duration: 1, endTime: 1 })]
    const sources = await loadElementSources(clips, sourceMapOf([makeSourceVideo({ id: 'v1' })]), [])
    const playbackState = rewindElementSources(sources)
    const { canvas, ctx } = outputCanvas()
    const composeFrame = createFrameComposer({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      canvas,
      clips,
      tracks: [makeTrack()],
      sources,
      playbackState,
      projectSize: PROJECT,
      outputSize: PROJECT,
      drawOptions: { filterScale: 1 },
      frameRate: 30,
    })

    await composeFrame(0.5)

    // The raster is still opened and cleared — a frame is always produced —
    // but a `<video>` below HAVE_CURRENT_DATA is not drawn from.
    expect(ctx.argsFor('fillRect')).toEqual([[0, 0, PROJECT.width, PROJECT.height]])
    expect(ctx.argsFor('drawImage')).toHaveLength(0)
  })

  it('draws an image source when the clip has no video element', async () => {
    await store('i1', 'image/png', 'image')
    const clips = [makeClip({ sourceVideoId: 'i1', duration: 1, endTime: 1 })]
    const sources = await loadElementSources(
      clips,
      sourceMapOf([makeSourceVideo({ id: 'i1', mediaType: 'image' })]),
      []
    )
    const playbackState = rewindElementSources(sources)
    const { canvas, ctx } = outputCanvas()
    const composeFrame = createFrameComposer({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      canvas,
      clips,
      tracks: [makeTrack()],
      sources,
      playbackState,
      projectSize: PROJECT,
      outputSize: PROJECT,
      drawOptions: { filterScale: 1 },
      frameRate: 30,
    })

    await composeFrame(0)

    expect(ctx.argsFor('drawImage')).toHaveLength(1)
    expect(media.seeks).toHaveLength(0)
  })

  it('draws an overlay clip, which needs no element at all', async () => {
    const clips = [
      makeClip({
        id: 'text1',
        sourceVideoId: '',
        overlayType: 'text',
        duration: 1,
        endTime: 1,
        textData: {
          text: 'Hi',
          x: 0.5,
          y: 0.5,
          fontFamily: 'Arial',
          fontSize: 40,
          fontWeight: 'normal',
          fontStyle: 'normal',
          color: '#ffffff',
          backgroundColor: '#00000000',
          textAlign: 'center',
        },
      }),
    ]
    const sources = await loadElementSources(clips, new Map(), [])
    const playbackState = rewindElementSources(sources)
    const { canvas, ctx } = outputCanvas()
    const composeFrame = createFrameComposer({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      canvas,
      clips,
      tracks: [makeTrack()],
      sources,
      playbackState,
      projectSize: PROJECT,
      outputSize: PROJECT,
      drawOptions: { filterScale: 1 },
      frameRate: 30,
    })

    await composeFrame(0)

    expect(ctx.argsFor('fillText')).toHaveLength(1)
    expect(ctx.argsFor('drawImage')).toHaveLength(0)
  })

  it('pauses a video whose clip has gone out of range', async () => {
    await store('v1')
    const clips = [makeClip({ sourceVideoId: 'v1', duration: 1, endTime: 1 })]
    const sources = await loadElementSources(clips, sourceMapOf([makeSourceVideo({ id: 'v1' })]), [])
    const playbackState = rewindElementSources(sources)
    // A video the composer believes is playing: the one state the pause loop
    // acts on, and the only way to reach it from outside the loop.
    const video = sources.videoElements.get('v1')!
    playbackState.set(video, { playing: true, targetTime: 0 })
    vi.mocked(video.pause).mockClear()
    const { canvas, ctx } = outputCanvas()
    const composeFrame = createFrameComposer({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      canvas,
      clips,
      tracks: [makeTrack()],
      sources,
      playbackState,
      projectSize: PROJECT,
      outputSize: PROJECT,
      drawOptions: { filterScale: 1 },
      frameRate: 30,
    })

    // t = 5 is past the clip's one second, so nothing is active and the
    // element it was drawing from is paused.
    await composeFrame(5)

    expect(video.pause).toHaveBeenCalledTimes(1)
    expect(playbackState.get(video)).toEqual({ playing: false, targetTime: 0 })
    expect(ctx.argsFor('drawImage')).toHaveLength(0)
  })
})

// ESCSUITE-156. A `<video>` below HAVE_CURRENT_DATA is waited for two ways at
// once: a `requestAnimationFrame` poll on `readyState`, and a 300 ms
// `setTimeout` that gives up. Whichever settles the wait has to stop the other
// — the poll used to keep re-queueing itself after the fallback had already
// resolved, so a source that never becomes ready cost an animation frame per
// frame for the life of the page, long after the export that started it.
describe('createFrameComposer readiness wait', () => {
  /** The composer over one not-yet-ready source, positioned so no frame seeks. */
  async function composerOverUnreadyVideo() {
    await store('v1')
    media.script({ video: { readyState: 1 } })
    const clips = [makeClip({ sourceVideoId: 'v1', duration: 1, endTime: 1 })]
    const sources = await loadElementSources(clips, sourceMapOf([makeSourceVideo({ id: 'v1' })]), [])
    const playbackState = rewindElementSources(sources)
    const { canvas, ctx } = outputCanvas()
    const composeFrame = createFrameComposer({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      canvas,
      clips,
      tracks: [makeTrack()],
      sources,
      playbackState,
      projectSize: PROJECT,
      outputSize: PROJECT,
      drawOptions: { filterScale: 1 },
      frameRate: 30,
    })
    return { composeFrame, sources }
  }

  it('stops polling once the 300 ms fallback has resolved the wait', async () => {
    const { composeFrame } = await composerOverUnreadyVideo()
    // Only the timeout is faked: the rAF poll is this test's own stub and the
    // doubles fire their events in microtasks.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const raf = installCountedRaf()

    try {
      // The element sits at 0 after the rewind, so frame 0 needs no seek and
      // the readiness wait is the only thing the frame is parked on.
      const frame = composeFrame(0)
      expect(raf.requests).toBe(1)

      // Two frames of a browser that still has no picture: the poll re-queues.
      raf.flush()
      raf.flush()
      expect(raf.requests).toBe(3)

      vi.advanceTimersByTime(300)
      await frame

      // Nothing is left queued, and the handle outstanding when the fallback
      // fired was cancelled rather than left to run.
      expect(raf.cancels).toEqual([3])
      raf.flush()
      expect(raf.requests).toBe(3)
    } finally {
      raf.uninstall()
      vi.useRealTimers()
    }
  })

  it('clears the 300 ms fallback when the frame data arrives first', async () => {
    const { composeFrame, sources } = await composerOverUnreadyVideo()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const raf = installCountedRaf()

    try {
      const frame = composeFrame(0)
      expect(vi.getTimerCount()).toBe(1)

      // The picture lands before the next animation frame.
      ;(sources.videoElements.get('v1') as unknown as { readyState: number }).readyState = 2
      raf.flush()
      await frame

        expect(raf.requests).toBe(1)
    } finally {
      raf.uninstall()
      vi.useRealTimers()
    }
  })
})

// ESCSUITE-159. The seek wait is the readiness wait's one-shot twin: a 'seeked'
// listener racing a 500 ms fallback, with neither side cancelling the other. A
// seek that lands left the timer pending for half a second, to resolve a promise
// that was already settled; a fallback that won left a `{ once: true }` listener
// on an element whose object URL the export is about to revoke.
describe('createFrameComposer seek wait', () => {
  /** A composer over one ready source, so the seek is the only thing a frame waits on. */
  async function composerOverReadyVideo() {
    await store('v1')
    const clips = [makeClip({ sourceVideoId: 'v1', duration: 1, endTime: 1 })]
    const sources = await loadElementSources(clips, sourceMapOf([makeSourceVideo({ id: 'v1' })]), [])
    const playbackState = rewindElementSources(sources)
    const { canvas, ctx } = outputCanvas()
    const composeFrame = createFrameComposer({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      canvas,
      clips,
      tracks: [makeTrack()],
      sources,
      playbackState,
      projectSize: PROJECT,
      outputSize: PROJECT,
      drawOptions: { filterScale: 1 },
      frameRate: 30,
    })
    return { composeFrame, video: sources.videoElements.get('v1')! }
  }

  it('clears the 500 ms fallback once the seek lands', async () => {
    const { composeFrame } = await composerOverReadyVideo()
    // Only the timeout is faked: the doubles dispatch 'seeked' in a microtask.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    try {
      // The element sits at 0 after the rewind, so a frame half a second in
      // really does seek.
      const frame = composeFrame(0.5)
      expect(vi.getTimerCount()).toBe(1)

      await frame

      } finally {
      vi.useRealTimers()
    }
  })

  it('removes the seeked listener when the 500 ms fallback wins', async () => {
    media.script({ video: { stallSeek: true } })
    const { composeFrame, video } = await composerOverReadyVideo()
    const added = vi.spyOn(video, 'addEventListener')
    const removed = vi.spyOn(video, 'removeEventListener')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    try {
      const frame = composeFrame(0.5)
      const seekListener = added.mock.calls.find(([type]) => type === 'seeked')?.[1]
      expect(seekListener).toBeTypeOf('function')

      vi.advanceTimersByTime(500)
      await frame

      // The element is about to have its object URL revoked; the listener that
      // can no longer settle anything must not still be on it.
      expect(removed).toHaveBeenCalledWith('seeked', seekListener)
    } finally {
      vi.useRealTimers()
      added.mockRestore()
      removed.mockRestore()
    }
  })
})

// ESCSUITE-316 (U-2) / ESCSUITE-325: `loadVideoElement` (exportTypes.ts) used to
// wait for `loadeddata` / `error` with no deadline, so a source the browser
// neither decodes nor rejects hung every WebM and GIF export before its first
// frame. It now shares the import probe's 15 s deadline (ESCSUITE-249) and the
// loader skips the source with its existing warning.
describe('loadElementSources with a <video> that never loads (ESCSUITE-316, 325)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function load(sources: SourceVideo[], ids: string[]) {
    return loadElementSources(
      ids.map((id) => makeClip({ sourceVideoId: id })),
      sourceMapOf(sources),
      []
    )
  }

  it('skips the silent source within 15 s with one warning, torn down', async () => {
    await store('v1')
    media.script({ video: { silent: true } })
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    let sources: Awaited<ReturnType<typeof loadElementSources>> | undefined
    void load([], ['v1']).then((s) => (sources = s))
    await vi.advanceTimersByTimeAsync(14_999)
    expect(sources).toBeUndefined()
    await vi.advanceTimersByTimeAsync(2)
    expect(sources).toBeDefined()
    expect(sources!.videoElements.size).toBe(0)
    const video = media.videos[0]
    expect(video.onloadeddata).toBeNull()
    expect(video.onerror).toBeNull()
    expect(video.getAttribute('src')).toBeNull()
    expect(video.load).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledTimes(1)
    const messages = warn.mock.calls.map((c) => String(c[0]))
    expect(messages.filter((m) => m.startsWith('Failed to load video v1'))).toHaveLength(1)
    expect(String(warn.mock.calls[0][1])).toContain(
      'Could not read v1 \u2014 the browser did not report its metadata within 15 s'
    )
  })

  it('names the source by its SourceVideo name when the map has it', async () => {
    await store('v1')
    media.script({ video: { silent: true } })
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    void load([makeSourceVideo({ id: 'v1', name: 'interview.webm' })], ['v1'])
    await vi.advanceTimersByTimeAsync(15_001)
    expect(String(warn.mock.calls[0][1])).toContain('Could not read interview.webm')
  })

  it('keeps a source that loads at 14.9 s and clears the timer', async () => {
    await store('v1')
    media.script({ video: { silent: true } })
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    let sources: Awaited<ReturnType<typeof loadElementSources>> | undefined
    void load([makeSourceVideo({ id: 'v1' })], ['v1']).then((s) => (sources = s))
    await vi.advanceTimersByTimeAsync(14_900)
    const before = clear.mock.calls.length
    media.videos[0].dispatchEvent(new Event('loadeddata'))
    await vi.advanceTimersByTimeAsync(0)
    expect(sources!.videoElements.has('v1')).toBe(true)
    expect(clear.mock.calls.length - before).toBe(1)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(warn).not.toHaveBeenCalled()
    expect(media.videos[0].load).not.toHaveBeenCalled()
    clear.mockRestore()
  })

  it('rejects at once on an error event, clearing the timer', async () => {
    await store('v1')
    media.script({ video: { fail: true } })
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    const sources = await load([makeSourceVideo({ id: 'v1' })], ['v1'])
    expect(sources.videoElements.size).toBe(0)
    // The video's deadline and, since ESCSUITE-328, the image fallback's own:
    // each load clears its one timer when it settles.
    expect(clear).toHaveBeenCalledTimes(2)
    clear.mockRestore()
  })

  it('still loads the other sources when one is silent', async () => {
    await store('v1')
    await store('v2')
    vi.useFakeTimers()
    media.script({ video: { silent: true, fail: false } })
    let sources: Awaited<ReturnType<typeof loadElementSources>> | undefined
    void load([makeSourceVideo({ id: 'v1' }), makeSourceVideo({ id: 'v2' })], ['v1', 'v2']).then(
      (s) => (sources = s)
    )
    await vi.advanceTimersByTimeAsync(15_001)
    // v1 timed out; v2 is now loading — let it answer.
    await vi.advanceTimersByTimeAsync(100)
    media.videos[1].dispatchEvent(new Event('loadeddata'))
    await vi.advanceTimersByTimeAsync(0)
    expect(sources!.videoElements.has('v2')).toBe(true)
    expect(sources!.videoElements.has('v1')).toBe(false)
  })
})

// ESCSUITE-313. Two clips of one source live in the same frame — a clip split
// and crossfaded into a later part of itself, or the same recording duplicated
// on a track above as a zoom or picture-in-picture — used to share the one
// `<video>` the loader made for that source: the second seek landed on it and
// both clips drew the last seek's moment. A source now has one element per
// simultaneously live clip, grown on demand over the same object URL.
describe('createFrameComposer with two live clips of one source', () => {
  const TWO_TRACKS = [makeTrack({ id: 'tA', index: 0 }), makeTrack({ id: 'tB', index: 1 })]

  /** Clip A shows the source from 0 s; clip B, on the track above, the same source from 10 s. */
  function zoomedPair(): Clip[] {
    return [
      makeClip({ id: 'A', sourceVideoId: 'v1', trackId: 'tA', startTime: 0, endTime: 1, duration: 1 }),
      makeClip({ id: 'B', sourceVideoId: 'v1', trackId: 'tB', startTime: 10, endTime: 11, duration: 1 }),
    ]
  }

  async function composerFor(clips: Clip[], tracks = TWO_TRACKS) {
    const sources = await loadElementSources(clips, sourceMapOf([makeSourceVideo({ id: 'v1', duration: 20 })]), [])
    const playbackState = rewindElementSources(sources)
    const { canvas, ctx } = outputCanvas()
    const composeFrame = createFrameComposer({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      canvas,
      clips,
      tracks,
      sources,
      playbackState,
      projectSize: PROJECT,
      outputSize: PROJECT,
      drawOptions: { filterScale: 1 },
      frameRate: 30,
    })
    return { composeFrame, sources, playbackState, ctx }
  }

  /** Where each drawn `<video>` sat, in draw order, read once the frame is complete. */
  function drawnAt(ctx: RecordingCanvasRenderingContext2D): number[] {
    return ctx
      .argsFor('drawImage')
      .map((args) => args[0])
      .filter((el): el is HTMLVideoElement => el instanceof HTMLVideoElement)
      .map((video) => video.currentTime)
  }

  it('draws each clip from its own element at its own source time, over one object URL', async () => {
    await store('v1')
    const urlsBefore = vi.mocked(URL.createObjectURL).mock.calls.length
    const { composeFrame, ctx } = await composerFor(zoomedPair())

    await composeFrame(0)

    expect(drawnAt(ctx)).toEqual([expect.closeTo(0, 2), expect.closeTo(10, 2)])
    expect(media.videos).toHaveLength(2)
    expect(vi.mocked(URL.createObjectURL).mock.calls.length - urlsBefore).toBe(1)
    // Both elements play the same bytes: the second is a second reader of the
    // one URL, not a second copy of the file.
    expect(media.videos[1].src).toBe(media.videos[0].src)
  })

  it('draws a split clip crossfading into its own later part from two moments', async () => {
    await store('v1')
    // Split at 1 s, with a jump cut: the second piece starts 5 s into the
    // source, and the first fades into it over its last half second.
    const split = [
      makeClip({
        id: 'A', sourceVideoId: 'v1', trackId: 'tA', startTime: 0, endTime: 1, duration: 1,
        transition: { type: 'fade', duration: 0.5 },
      }),
      makeClip({ id: 'B', sourceVideoId: 'v1', trackId: 'tA', startTime: 5, endTime: 6, duration: 1, timelinePosition: 1 }),
    ]
    const { composeFrame, ctx } = await composerFor(split, [makeTrack({ id: 'tA', index: 0 })])

    await composeFrame(0.75)

    // Outgoing first, then incoming: the outgoing side at its own 0.75 s, the
    // incoming side held on its first frame at 5 s until the cut.
    expect(drawnAt(ctx)).toEqual([expect.closeTo(0.75, 2), expect.closeTo(5, 2)])
  })

  it('keeps a source with one live clip on one element', async () => {
    await store('v1')
    const clips = zoomedPair()
    clips[1] = { ...clips[1], timelinePosition: 5 }
    const { composeFrame, ctx } = await composerFor(clips)

    await composeFrame(0)
    await composeFrame(0.5)

    expect(media.videos).toHaveLength(1)
    expect(ctx.argsFor('drawImage')).toHaveLength(2)
  })

  it('creates the second element once and reuses it on every later frame', async () => {
    await store('v1')
    const urlsBefore = vi.mocked(URL.createObjectURL).mock.calls.length
    const { composeFrame, ctx } = await composerFor(zoomedPair())

    await composeFrame(0)
    await composeFrame(1 / 30)
    await composeFrame(2 / 30)

    expect(media.videos).toHaveLength(2)
    expect(vi.mocked(URL.createObjectURL).mock.calls.length - urlsBefore).toBe(1)
    expect(drawnAt(ctx).slice(-2)).toEqual([expect.closeTo(2 / 30, 2), expect.closeTo(10 + 2 / 30, 2)])
  })

  it('pauses the second element once its clip has gone out of range', async () => {
    await store('v1')
    const clips = zoomedPair()
    clips[1] = { ...clips[1], duration: 0.5, endTime: 10.5 }
    const { composeFrame, playbackState } = await composerFor(clips)
    await composeFrame(0)
    const second = media.videos[1]
    playbackState.set(second, { playing: true, targetTime: 10 })
    vi.mocked(second.pause).mockClear()

    // B has ended; A is still live on the first element.
    await composeFrame(0.75)

    expect(second.pause).toHaveBeenCalledTimes(1)
    expect(playbackState.get(second)).toEqual({ playing: false, targetTime: 10 })
  })

  it('rewinds and releases every element, revoking the shared URL once', async () => {
    await store('v1')
    const { composeFrame, sources } = await composerFor(zoomedPair())
    await composeFrame(0)
    const [first, second] = media.videos
    const seeksBefore = media.seeks.length

    const state = rewindElementSources(sources)

    expect(media.seeks.slice(seeksBefore)).toEqual([0, 0])
    expect(state.get(first)).toEqual({ playing: false, targetTime: 0 })
    expect(state.get(second)).toEqual({ playing: false, targetTime: 0 })

    vi.mocked(URL.revokeObjectURL).mockClear()
    vi.mocked(first.pause).mockClear()
    vi.mocked(second.pause).mockClear()
    releaseElementSources(sources)

    expect(first.pause).toHaveBeenCalledTimes(1)
    expect(second.pause).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('skips the clip whose element will not load, once, and still draws the other', async () => {
    await store('v1')
    const { composeFrame, sources, ctx } = await composerFor(zoomedPair())
    media.script({ video: { fail: true } })

    await composeFrame(0)
    expect(ctx.argsFor('drawImage').map((args) => args[0])).toEqual([media.videos[0]])
    await composeFrame(1 / 30)

    // A, from the source's own element, each frame; B nowhere.
    expect(ctx.argsFor('drawImage').map((args) => args[0])).toEqual([media.videos[0], media.videos[0]])
    // Not retried every frame: one failed element, one warning.
    expect(media.videos).toHaveLength(2)
    expect(warns.mock.calls.filter((call: unknown[]) => String(call[0]).includes('second element'))).toHaveLength(1)

    // The failed slot is held as `null`, and the release walks past it: the one
    // loaded element is paused once and the source's one URL revoked once.
    for (const video of media.videos) vi.mocked(video.pause).mockClear()
    vi.mocked(URL.revokeObjectURL).mockClear()
    expect(() => releaseElementSources(sources)).not.toThrow()
    expect(media.videos[0].pause).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('gives three live clips of one source three elements over one URL, and makes none on the next frame', async () => {
    await store('v1')
    const urlsBefore = vi.mocked(URL.createObjectURL).mock.calls.length
    const clips = [
      ...zoomedPair(),
      makeClip({ id: 'C', sourceVideoId: 'v1', trackId: 'tC', startTime: 5, endTime: 6, duration: 1 }),
    ]
    const { composeFrame, sources, ctx } = await composerFor(clips, [
      ...TWO_TRACKS,
      makeTrack({ id: 'tC', index: 2 }),
    ])

    await composeFrame(0)
    expect(drawnAt(ctx)).toEqual([expect.closeTo(0, 2), expect.closeTo(10, 2), expect.closeTo(5, 2)])
    expect(new Set(ctx.argsFor('drawImage').map((args) => args[0])).size).toBe(3)
    expect(media.videos).toHaveLength(3)
    expect(vi.mocked(URL.createObjectURL).mock.calls.length - urlsBefore).toBe(1)

    await composeFrame(1 / 30)
    expect(media.videos).toHaveLength(3)

    for (const video of media.videos) vi.mocked(video.pause).mockClear()
    vi.mocked(URL.revokeObjectURL).mockClear()
    releaseElementSources(sources)
    for (const video of media.videos) expect(video.pause).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('draws two clips of one image from the one image', async () => {
    await store('i1', 'image/png', 'image')
    const clips = zoomedPair().map((c) => ({ ...c, sourceVideoId: 'i1' }))
    const sources = await loadElementSources(clips, sourceMapOf([makeSourceVideo({ id: 'i1', mediaType: 'image' })]), [])
    const playbackState = rewindElementSources(sources)
    const { canvas, ctx } = outputCanvas()
    const composeFrame = createFrameComposer({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      canvas,
      clips,
      tracks: TWO_TRACKS,
      sources,
      playbackState,
      projectSize: PROJECT,
      outputSize: PROJECT,
      drawOptions: { filterScale: 1 },
      frameRate: 30,
    })

    await composeFrame(0)

    expect(ctx.argsFor('drawImage')).toHaveLength(2)
    expect(media.videos).toHaveLength(0)
  })
})


// ESCSUITE-305. Firefox will not seek a Cues-less WebM into a Cluster that does
// not start with a key frame: 'seeked' never fires, `seeking` stays true and
// `readyState` stays at HAVE_METADATA for good. Each frame then sat out the
// 500 ms seek fallback and the 300 ms readiness fallback, the `readyState >= 2`
// gate skipped the draw, and the export finished "complete" with a black
// picture. Three consecutive seeks of one element that end that way now fail
// the export by name; one that merely runs slow does not.
describe('createFrameComposer seek wedge', () => {
  /** A composer over `clips`, drawing from the sources named in `sources`. */
  async function composerOver(clips: Clip[], sourceMap: Map<string, SourceVideo>) {
    const sources = await loadElementSources(clips, sourceMap, [])
    const playbackState = rewindElementSources(sources)
    const { canvas, ctx } = outputCanvas()
    const composeFrame = createFrameComposer({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      canvas,
      clips,
      tracks: [makeTrack()],
      sources,
      playbackState,
      projectSize: PROJECT,
      outputSize: PROJECT,
      drawOptions: { filterScale: 1 },
      frameRate: 30,
    })
    return { composeFrame, ctx, sources }
  }

  /** Compose frame `index` at 30 fps, sitting out every fallback the frame waits on. */
  async function frame(composeFrame: (t: number) => Promise<void>, index: number): Promise<void> {
    const pending = composeFrame(index / 30)
    // Settle the rejection's handling before advancing, so a throw is observed
    // as the frame's own result rather than as an unhandled rejection.
    pending.catch(() => {})
    await vi.advanceTimersByTimeAsync(800 + SEEK_IN_FLIGHT_GRACE_MS)
    return pending
  }

  let raf: ReturnType<typeof installCountedRaf>

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    // The readiness poll is this stub's: it never answers, so the 300 ms
    // fallback is what settles a wait for frame data that never arrives.
    raf = installCountedRaf()
  })

  afterEach(() => {
    raf.uninstall()
    vi.useRealTimers()
  })

  const oneClip = () => [makeClip({ sourceVideoId: 'v1', duration: 1, endTime: 1 })]

  it('fails by name on the third consecutive seek that never completes', async () => {
    await store('v1')
    // Every seek but the rewind's to 0 wedges, the way Firefox's did past 1.07 s.
    media.script({ video: { wedgeSeekAt: (t) => t > 0.02 } })
    const { composeFrame, ctx } = await composerOver(
      oneClip(),
      sourceMapOf([makeSourceVideo({ id: 'v1', name: 'recording_2026-10-17.webm' })])
    )

    await frame(composeFrame, 0) // no seek: the rewind left it at 0
    await frame(composeFrame, 1) // wedged #1
    await frame(composeFrame, 2) // wedged #2
    const thrown = await frame(composeFrame, 3).then(
      () => null,
      (error: unknown) => error
    )

    expect(thrown).toBeInstanceOf(SourceNotSeekableError)
    expect(thrown).toMatchObject({
      code: 'SOURCE_NOT_SEEKABLE',
      message:
        'This browser cannot read "recording_2026-10-17.webm" frame by frame (its seeks never completed). Re-save the recording in ESCAPECRAFT, or export in Chrome or Edge.',
    })
    // Frame 0 was drawn; the two wedged frames before the throw were not.
    expect(ctx.argsFor('drawImage')).toHaveLength(1)
    expect(WEDGED_SEEK_FRAMES).toBe(3)
  })

  it('names the source by its id when the export was not handed its record', async () => {
    await store('v1')
    media.script({ video: { wedgeSeekAt: (t) => t > 0.02 } })
    const { composeFrame } = await composerOver(oneClip(), new Map())

    await frame(composeFrame, 1)
    await frame(composeFrame, 2)

    await expect(frame(composeFrame, 3)).rejects.toThrow('This browser cannot read "v1" frame by frame')
  })

  it('starts the count again after a seek that completes', async () => {
    await store('v1')
    // Frames 1, 2, 4 and 5 wedge; frame 3 lands. Never three in a row.
    const wedged = new Set([1, 2, 4, 5].map((i) => elementSeekTarget(i / 30)))
    media.script({ video: { wedgeSeekAt: (t) => wedged.has(t) } })
    const { composeFrame, ctx } = await composerOver(oneClip(), sourceMapOf([makeSourceVideo({ id: 'v1' })]))

    for (let i = 0; i < 6; i++) await frame(composeFrame, i)

    // Frames 0 and 3 had a picture to draw.
    expect(ctx.argsFor('drawImage')).toHaveLength(2)
  })

  // Review round 1, MINOR 3: an incoming transition clip is held at its first
  // frame until the outgoing clip ends, so after one seek its element is asked
  // for the same time every frame and no further seek is issued. A seek that
  // never completed is still outstanding on those frames: they count, rather
  // than resetting the run and finishing black.
  it('fails by name on a source held at one time whose one seek never completed', async () => {
    await store('v1')
    await store('v2')
    const held = elementSeekTarget(0.25)
    media.script({ video: { wedgeSeekAt: (t) => t === held } })
    const clips = [
      makeClip({ id: 'a', sourceVideoId: 'v1', duration: 1, endTime: 1, transition: { type: 'fade', duration: 0.5 } }),
      makeClip({ id: 'b', sourceVideoId: 'v2', startTime: 0.25, duration: 1, endTime: 1.25, timelinePosition: 1 }),
    ]
    const { composeFrame } = await composerOver(
      clips,
      sourceMapOf([makeSourceVideo({ id: 'v1' }), makeSourceVideo({ id: 'v2', name: 'incoming.webm' })])
    )

    await frame(composeFrame, 15) // the incoming clip's one seek, to 0.25: wedged
    await frame(composeFrame, 16) // held at 0.25: no seek, still seeking
    await expect(frame(composeFrame, 17)).rejects.toThrow('This browser cannot read "incoming.webm" frame by frame')
  })

  // Re-review round 1, F1: a healthy element on a slow machine whose every
  // seek lands at ~900 ms — after both fallbacks, so each frame ends still
  // seeking — but lands before the next frame begins. The earlier seek landed,
  // so the next frame starts the count again: it is never refused.
  it('never refuses a source whose every seek lands late, between frames', async () => {
    await store('v1')
    media.script({ video: { seekLandsAfterMs: 900 } })
    const clips = [makeClip({ sourceVideoId: 'v1', duration: 1, endTime: 1 })]
    const { composeFrame } = await composerOver(clips, sourceMapOf([makeSourceVideo({ id: 'v1' })]))

    for (let i = 1; i <= 10; i++) {
      const pending = composeFrame(i / 30)
      pending.catch(() => {})
      // 800 ms for the frame's own waits, then the seek lands before the next.
      await vi.advanceTimersByTimeAsync(1_000)
      await pending
    }
  })

  // ESCSUITE-370: the case above with the frames back to back, as the export
  // loop runs them. A seek that outlasts the frame's 800 ms of waits is still
  // in flight when the next frame starts, and that frame's own seek aborted it
  // (the HTML seek algorithm: only the last seek lands), so on a machine whose
  // seeks briefly ran past 800 ms nothing ever landed and the third frame
  // refused a healthy source — the journey's "cannot read … frame by frame"
  // on a loaded CI runner. A frame now lets the seek in flight land first.
  it('never refuses a healthy source whose seeks outlast the waits, frames back to back', async () => {
    await store('v1')
    media.script({ video: { seekLandsAfterMs: 1_200 } })
    const { composeFrame, ctx } = await composerOver(oneClip(), sourceMapOf([makeSourceVideo({ id: 'v1' })]))

    for (let i = 1; i <= 6; i++) {
      let settled = false
      const pending = composeFrame(i / 30).finally(() => {
        settled = true
      })
      pending.catch(() => {})
      // No gap between frames: the next one starts the moment this one ends.
      while (!settled) await vi.advanceTimersByTimeAsync(10)
      await pending
    }

    // Every frame after the first had the previous frame's seek landed to draw.
    expect(ctx.argsFor('drawImage').length).toBeGreaterThanOrEqual(5)
  })

  it('does not count a seek that runs slow but settles (`seeking` false)', async () => {
    await store('v1')
    // No 'seeked' and no frame data in time, but the element is not stuck seeking.
    media.script({ video: { stallSeek: true, readyState: 1 } })
    const { composeFrame } = await composerOver(oneClip(), sourceMapOf([makeSourceVideo({ id: 'v1' })]))

    for (let i = 0; i < 5; i++) await frame(composeFrame, i)
  })

  it('does not count a seek still in flight over a frame it can already draw', async () => {
    await store('v1')
    media.script({ video: { stallSeek: true } })
    const { composeFrame, ctx, sources } = await composerOver(
      oneClip(),
      sourceMapOf([makeSourceVideo({ id: 'v1' })])
    )
    Object.defineProperty(sources.videoElements.get('v1')!, 'seeking', { value: true, configurable: true })

    for (let i = 0; i < 5; i++) await frame(composeFrame, i)

    expect(ctx.argsFor('drawImage')).toHaveLength(5)
  })
})
