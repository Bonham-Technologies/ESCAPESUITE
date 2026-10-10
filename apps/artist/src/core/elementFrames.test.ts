// The per-frame machinery both element-drawing exporters share (ESCSUITE-34).
//
// `exportWebM.ts` had all of this inline and `exportGIF.ts` needed the same
// thing, so it was lifted here rather than copied. The exporters' own suites
// (`exportWebM.test.ts`, and `exportGIF.test.ts` once it lands) still cover it
// end to end; these cases cover the four exported functions directly, where a
// specific question — "does a source with no bytes get skipped", "is a seek
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
      sourceMapOf([makeSourceVideo({ id: 'v1' })])
    )

    expect([...sources.videoElements.keys()]).toEqual(['v1'])
    expect(sources.imageElements.size).toBe(0)
  })

  it('loads an image source into an <img> element', async () => {
    await store('i1', 'image/png', 'image')
    const sources = await loadElementSources(
      [makeClip({ sourceVideoId: 'i1' })],
      sourceMapOf([makeSourceVideo({ id: 'i1', mediaType: 'image' })])
    )

    expect([...sources.imageElements.keys()]).toEqual(['i1'])
    expect(sources.videoElements.size).toBe(0)
  })

  it('skips an audio-only source: nothing visual is drawn from it', async () => {
    await store('a1', 'audio/webm', 'audio')
    const sources = await loadElementSources(
      [makeClip({ sourceVideoId: 'a1' })],
      sourceMapOf([makeSourceVideo({ id: 'a1', mediaType: 'audio' })])
    )

    expect(sources.videoElements.size).toBe(0)
    expect(sources.imageElements.size).toBe(0)
  })

  it('skips a source with no bytes in storage rather than failing the export', async () => {
    const sources = await loadElementSources(
      [makeClip({ sourceVideoId: 'ghost' })],
      sourceMapOf([makeSourceVideo({ id: 'ghost' })])
    )

    expect(sources.videoElements.size).toBe(0)
  })

  it('ignores an overlay clip, which has no source id at all', async () => {
    const sources = await loadElementSources([makeClip({ sourceVideoId: '' })], new Map())

    expect(sources.videoElements.size).toBe(0)
  })

  it('loads each unique source once however many clips use it', async () => {
    await store('v1')
    const clips: Clip[] = [
      makeClip({ id: 'c1', sourceVideoId: 'v1' }),
      makeClip({ id: 'c2', sourceVideoId: 'v1' }),
    ]
    await loadElementSources(clips, sourceMapOf([makeSourceVideo({ id: 'v1' })]))

    expect(media.videos).toHaveLength(1)
  })

  it('falls back to loading a video that will not load as an image', async () => {
    await store('v1')
    media.script({ video: { fail: true } })

    const sources = await loadElementSources(
      [makeClip({ sourceVideoId: 'v1' })],
      sourceMapOf([makeSourceVideo({ id: 'v1' })])
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
      sourceMapOf([makeSourceVideo({ id: 'v1' })])
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
      sourceMapOf([makeSourceVideo({ id: 'v1' }), makeSourceVideo({ id: 'i1', mediaType: 'image' })])
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
        sourceMapOf([makeSourceVideo({ id: 'v1' }), makeSourceVideo({ id: 'v2' })])
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
      sourceMapOf([makeSourceVideo({ id: 'v1' })])
    )

    const state = rewindElementSources(sources)

    expect(media.seeks).toEqual([0])
    expect(sources.videoElements.get('v1')!.pause).toHaveBeenCalledTimes(1)
    expect(state.get('v1')).toEqual({ playing: false, targetTime: 0 })
  })
})

describe('releaseElementSources', () => {
  it('revokes the object URL behind every element', async () => {
    await store('v1')
    await store('i1', 'image/png', 'image')
    const sources = await loadElementSources(
      [makeClip({ id: 'c1', sourceVideoId: 'v1' }), makeClip({ id: 'c2', sourceVideoId: 'i1' })],
      sourceMapOf([makeSourceVideo({ id: 'v1' }), makeSourceVideo({ id: 'i1', mediaType: 'image' })])
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
    const sources = await loadElementSources(clips, sourceMapOf([makeSourceVideo({ id: 'v1' })]))
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
    const sources = await loadElementSources(clips, sourceMapOf([makeSourceVideo({ id: 'v1' })]))
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
    const sources = await loadElementSources(clips, sourceMapOf([makeSourceVideo({ id: 'v1' })]))
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
    const sources = await loadElementSources(clips, sourceMapOf([makeSourceVideo({ id: 'v1' })]))
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
      sourceMapOf([makeSourceVideo({ id: 'i1', mediaType: 'image' })])
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
    const sources = await loadElementSources(clips, new Map())
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
    const sources = await loadElementSources(clips, sourceMapOf([makeSourceVideo({ id: 'v1' })]))
    const playbackState = rewindElementSources(sources)
    // A video the composer believes is playing: the one state the pause loop
    // acts on, and the only way to reach it from outside the loop.
    playbackState.set('v1', { playing: true, targetTime: 0 })
    const video = sources.videoElements.get('v1')!
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
    expect(playbackState.get('v1')).toEqual({ playing: false, targetTime: 0 })
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
    const sources = await loadElementSources(clips, sourceMapOf([makeSourceVideo({ id: 'v1' })]))
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

      expect(vi.getTimerCount()).toBe(0)
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
    const sources = await loadElementSources(clips, sourceMapOf([makeSourceVideo({ id: 'v1' })]))
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

      expect(vi.getTimerCount()).toBe(0)
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
