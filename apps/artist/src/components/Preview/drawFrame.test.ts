// `drawPreviewFrame`, driven directly: everything it reads is a parameter, so a
// recording context and a scene are all a case needs. (Its per-frame cost is
// pinned separately, through the mounted preview, in `drawFrame.perf.test.ts`.)
import { describe, it, expect } from 'vitest'
import { drawPreviewFrame, type PreviewFrameScene } from './drawFrame'
import { createRecordingContext, type RecordingCanvasRenderingContext2D } from '../../test/doubles/canvas'
import { makeClip, makeTrack } from '../../test/fixtures/clipFixtures'
import { DEFAULT_TEXT_OVERLAY_DATA } from '../../store/types'
import { captionStyleFor } from '../../core/captions'
import { assignElementSlots } from '../../core/elementSlots'
import { getClipsAtTime } from '../../store/projectStore'
import { getActiveTransition } from './transitions'

/**
 * Each live clip's slot at `time`, as the render loop would hand them to the
 * frame on a first assignment — which the stateless rule gives exactly.
 */
function slotsAt(time: number, scene: PreviewFrameScene): Map<string, number> {
  const slots = new Map<string, number>()
  assignElementSlots(
    getClipsAtTime(scene.clips, scene.tracks, time),
    getActiveTransition(scene.clips, scene.tracks, time),
    slots
  )
  return slots
}

/** One frame at `time`, onto a fresh 640x360 recording context; the texts it drew. */
function textsDrawnAt(time: number, scene: PreviewFrameScene): string[] {
  const ctx: RecordingCanvasRenderingContext2D = createRecordingContext()
  ctx.canvas.width = 640
  ctx.canvas.height = 360
  drawPreviewFrame(
    ctx as unknown as CanvasRenderingContext2D,
    ctx.canvas,
    time,
    scene,
    { videoElements: new Map(), slots: slotsAt(time, scene), imageElements: new Map(), blurScratch: { current: null } }
  )
  return ctx.argsFor('fillText').map((args) => args[0] as string)
}

// ESCSUITE-293: a caption is an ordinary text clip on the `kind: 'captions'`
// track, drawn by the same text renderer as a title — so the preview shows it
// while its cue is up, and not before or after. No renderer change was needed.
describe('drawPreviewFrame — a caption (ESCSUITE-293)', () => {
  const scene: PreviewFrameScene = {
    projectSize: { width: 640, height: 360 },
    clips: [
      makeClip({
        id: 'caption',
        sourceVideoId: '',
        trackId: 'captions',
        overlayType: 'text',
        textData: { ...DEFAULT_TEXT_OVERLAY_DATA, ...captionStyleFor({ width: 640, height: 360 }), text: 'On screen' },
        timelinePosition: 1,
        duration: 2,
        endTime: 2,
      }),
    ],
    tracks: [makeTrack(), makeTrack({ id: 'captions', name: 'Captions', index: 1, kind: 'captions' })],
    sourceVideos: [],
    editingTextClipId: null,
  }

  it('is drawn while its cue is up', () => {
    expect(textsDrawnAt(1, scene)).toEqual(['On screen'])
    expect(textsDrawnAt(2.9, scene)).toEqual(['On screen'])
  })

  it('is not drawn before its cue or once it has ended', () => {
    expect(textsDrawnAt(0.9, scene)).toEqual([])
    expect(textsDrawnAt(3, scene)).toEqual([])
  })
})

// ESCSUITE-313: two clips of one source in one frame draw from two elements —
// the k-th live clip of a source from that source's k-th element, which
// `usePreviewMedia` keeps in `extraVideoElements` (slot 1 onwards).
describe('drawPreviewFrame — two clips of one source (ESCSUITE-313)', () => {
  // Told apart by `slot`, so `toEqual` cannot pass on two lookalike elements.
  const fakeVideo = (slot: number) =>
    ({ slot, readyState: 4, videoWidth: 640, videoHeight: 360 }) as unknown as HTMLVideoElement

  function drawnFrom(
    time: number,
    scene: PreviewFrameScene,
    videoElements: Map<string, HTMLVideoElement>,
    extraVideoElements?: Map<string, HTMLVideoElement[]>,
    slots?: Map<string, number>
  ): unknown[] {
    const ctx: RecordingCanvasRenderingContext2D = createRecordingContext()
    ctx.canvas.width = 640
    ctx.canvas.height = 360
    drawPreviewFrame(ctx as unknown as CanvasRenderingContext2D, ctx.canvas, time, scene, {
      videoElements,
      extraVideoElements,
      slots: slots ?? slotsAt(time, scene),
      imageElements: new Map(),
      blurScratch: { current: null },
    })
    return ctx.argsFor('drawImage').map((args) => args[0])
  }

  const zoomedScene: PreviewFrameScene = {
    projectSize: { width: 640, height: 360 },
    clips: [
      makeClip({ id: 'A', sourceVideoId: 'v1', trackId: 'tA', duration: 2, endTime: 2 }),
      makeClip({ id: 'B', sourceVideoId: 'v1', trackId: 'tB', startTime: 10, duration: 2, endTime: 12 }),
    ],
    tracks: [makeTrack({ id: 'tA', index: 0 }), makeTrack({ id: 'tB', index: 1 })],
    sourceVideos: [],
    editingTextClipId: null,
  }

  it('draws the lower clip from the first element and the upper from the second', () => {
    const first = fakeVideo(0)
    const second = fakeVideo(1)

    expect(drawnFrom(1, zoomedScene, new Map([['v1', first]]), new Map([['v1', [second]]]))).toEqual([
      first,
      second,
    ])
  })

  // ESCSUITE-323: the render loop's own assignment, when it hands one in, is
  // the one the frame draws by — here the upper clip kept the source's own
  // element while the lower one started on the second.
  it('draws each clip from the element the slots it is handed name', () => {
    const first = fakeVideo(0)
    const second = fakeVideo(1)
    const slots = new Map([['A', 1], ['B', 0]])

    expect(drawnFrom(1, zoomedScene, new Map([['v1', first]]), new Map([['v1', [second]]]), slots)).toEqual([
      second,
      first,
    ])
  })

  it('draws nothing for a clip whose element does not exist yet', () => {
    const first = fakeVideo(0)

    expect(drawnFrom(1, zoomedScene, new Map([['v1', first]]))).toEqual([first])
  })

  it('draws a split clip crossfading into itself from two elements', () => {
    const first = fakeVideo(0)
    const second = fakeVideo(1)
    const scene: PreviewFrameScene = {
      ...zoomedScene,
      clips: [
        makeClip({ id: 'A', sourceVideoId: 'v1', duration: 2, endTime: 2, transition: { type: 'fade', duration: 0.5 } }),
        makeClip({ id: 'B', sourceVideoId: 'v1', startTime: 5, duration: 2, endTime: 7, timelinePosition: 2 }),
      ],
      tracks: [makeTrack()],
    }

    expect(drawnFrom(1.75, scene, new Map([['v1', first]]), new Map([['v1', [second]]]))).toEqual([
      first,
      second,
    ])
  })
})
