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
import { storeVideo } from './storage'
import {
  getLastCanvasContext,
  installCanvasDouble,
  uninstallCanvasDouble,
  type RecordingCanvasRenderingContext2D,
} from '../test/doubles/canvas'
import { installMediaElementDoubles, type MediaDoubles } from '../test/doubles/media'
import { makeClip, makeSourceVideo, makeTrack } from '../test/fixtures/clipFixtures'
import type { Clip, SourceVideo } from '../store/types'

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
