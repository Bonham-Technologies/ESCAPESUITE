// Putting a handed-over take on the timeline (ESCSUITE-14, decision 7).
//
// The store's other clip actions are one clip at a time; this one is a whole
// take — several clips on several tracks, in one undo step, at the end of
// whatever the timeline already holds.
import { describe, it, expect, beforeEach } from 'vitest'
import { store, resetStoreForTest, video } from '../../test/fixtures/projectStore'
import {
  maskForPlacement,
  overlayPlacementToTransform,
  strokeForPlacement,
} from '../../utils/overlayPlacement'
import { DEFAULT_TRANSFORM } from '../types'
import type { Clip, TakeClipPart } from '../types'

const screenPart: TakeClipPart = {
  sourceVideoId: 'screen-part',
  name: 'Recording 1/1/2026',
  duration: 6,
  startOffset: 0,
  width: 1920,
  height: 1080,
}

const webcamPart: TakeClipPart = {
  sourceVideoId: 'webcam-part',
  name: 'Recording 1/1/2026 — webcam',
  duration: 6,
  startOffset: 0.5,
  width: 1280,
  height: 720,
  overlayPlacement: { position: 'bottom-right', size: 0.2, shape: 'circle' },
}

/**
 * The microphone half of a separate-tracks take (ESCSUITE-14 slice 3).
 *
 * `width: 0, height: 0` is what ESCAPECRAFT stores for a part with no picture,
 * and `mediaType: 'audio'` is what says so — the dimensions are a consequence,
 * not the signal (ESCSUITE-71).
 */
const micPart: TakeClipPart = {
  sourceVideoId: 'mic-part',
  name: 'Recording 1/1/2026 — microphone',
  duration: 6,
  startOffset: 0,
  width: 0,
  height: 0,
  mediaType: 'audio',
}

/** The clips on the timeline, in the order they were placed. */
const placedClips = (): Clip[] => store().project.timeline.clips

/** The track a clip sits on. */
const trackOf = (clip: Clip) =>
  store().project.timeline.tracks.find((track) => track.id === clip.trackId)!

beforeEach(() => {
  resetStoreForTest()
  store().clearHistory()
})

describe('placeTakeOnTimeline', () => {
  it('places a single-part take exactly as dropping it from the library would', () => {
    // The media library calls addClipToTimeline; a handoff must not produce a
    // subtly different clip. Everything but the generated id and the track is
    // compared, so a future change to either path fails here.
    store().addClipToTimeline({
      id: 'from-library',
      sourceVideoId: video.id,
      name: video.name,
      startTime: 0,
      endTime: 10,
      duration: 10,
    })
    const dropped = placedClips()[0]

    resetStoreForTest()
    store().clearHistory()
    store().placeTakeOnTimeline([
      { sourceVideoId: video.id, name: video.name, duration: 10, startOffset: 0, width: 1920, height: 1080 },
    ])
    const placed = placedClips()[0]

    expect({ ...placed, id: dropped.id, trackId: dropped.trackId }).toEqual(dropped)
  })

  it('puts the webcam part on a track above the primary, at its start offset', () => {
    store().placeTakeOnTimeline([screenPart, webcamPart])

    const [screen, webcam] = placedClips()
    expect(screen.timelinePosition).toBe(0)
    expect(webcam.timelinePosition).toBe(0.5)
    // Higher index is higher in the stack (Timeline sorts descending), so this
    // is what "the webcam over the screen" means in the model.
    expect(trackOf(webcam).index).toBeGreaterThan(trackOf(screen).index)
    expect(store().project.timeline.duration).toBe(6.5)
  })

  it('seeds the webcam clip transform from the take overlay placement', () => {
    store().placeTakeOnTimeline([screenPart, webcamPart])

    const webcam = placedClips()[1]
    expect(webcam.transform).toEqual(
      overlayPlacementToTransform(
        webcamPart.overlayPlacement!,
        store().project.resolution,
        { width: webcamPart.width, height: webcamPart.height }
      )
    )
    // The primary is not an overlay: it fills the frame the way any imported
    // clip does.
    expect(placedClips()[0].transform.x).toBe(0.5)
    expect(placedClips()[0].transform.scaleX).toBe(1)
  })

  it('gives the webcam clip the mask and stroke it was recorded with', () => {
    store().placeTakeOnTimeline([screenPart, webcamPart])

    const webcam = placedClips()[1]
    // ESCSUITE-65: the handoff now carries the shape *and* the border, not just
    // the corner and the size. The screen recording is 1920x1080 and the project
    // is 1920x1080, so the frame the camera sat in a corner of is the canvas.
    expect(webcam.mask).toEqual(
      maskForPlacement(webcamPart.overlayPlacement!, store().project.resolution, {
        width: webcamPart.width,
        height: webcamPart.height,
      })
    )
    expect(webcam.stroke).toEqual(
      strokeForPlacement(store().project.resolution, store().project.resolution)
    )
    expect(webcam.mask).toEqual({ kind: 'circle' })
    // 3/1280 of a 1920-wide canvas is 4.5 px, which is craft's 3 px scaled the
    // way craft itself scales it: a 1920-wide capture is previewed at the 1280
    // cap, so the border the user saw was 3/1280 of the picture.
    expect(webcam.stroke).toEqual({ color: 'rgba(255, 255, 255, 0.8)', width: 3 / 1280 })
  })

  it('weighs the border against the screen recording, not the canvas', () => {
    // The same question the transform's frame settles, asked of the border.
    // A 1280-wide capture was previewed *uncapped*, so craft drew a flat 3 px on
    // it; ARTIST draws that picture at native size in a 1920-wide canvas, so the
    // stored fraction has to be 3/1920. Handing `strokeForPlacement` the project
    // resolution instead of the frame would store 3/1280 here and draw a 4.5 px
    // border on a recording whose border was 3 px.
    const smallScreen: TakeClipPart = { ...screenPart, width: 1280, height: 720 }

    store().placeTakeOnTimeline([smallScreen, webcamPart])

    expect(placedClips()[1].stroke).toEqual({
      color: 'rgba(255, 255, 255, 0.8)',
      width: 3 / 1920,
    })
    expect(placedClips()[1].stroke).toEqual(
      strokeForPlacement({ width: 1280, height: 720 }, store().project.resolution)
    )
  })

  it('gives every other part neither', () => {
    store().placeTakeOnTimeline([screenPart, webcamPart, micPart])

    // The mask travels with the placement, which `app/takeImport.ts` puts on the
    // camera part alone — so the screen recording is an ordinary rectangular
    // clip and the microphone, which is never drawn, carries nothing derived
    // from a picture at all (ESCSUITE-71's rule, restated for two more fields).
    expect(placedClips()[0].mask).toBeUndefined()
    expect(placedClips()[0].stroke).toBeUndefined()
    expect(placedClips()[2].mask).toBeUndefined()
    expect(placedClips()[2].stroke).toBeUndefined()
    // And the keys are *absent*, not present holding `undefined` — which is the
    // half `toBeUndefined` cannot tell apart and `toEqual` ignores outright. It
    // is the conditional spread in `clipSlice.ts` that makes it true, and the
    // reason it has to be true is the first case in this file: 'places a
    // single-part take exactly as dropping it from the library would' compares
    // the whole clip object against `addClipToTimeline`'s with `toEqual`, so two
    // undefined keys would leak past it unnoticed.
    expect('mask' in placedClips()[0]).toBe(false)
    expect('stroke' in placedClips()[0]).toBe(false)
    expect('mask' in placedClips()[2]).toBe(false)
    expect('stroke' in placedClips()[2]).toBe(false)
  })

  it('never masks an audio part, even one carrying a placement', () => {
    const misfiled: TakeClipPart = { ...micPart, overlayPlacement: webcamPart.overlayPlacement }

    store().placeTakeOnTimeline([screenPart, misfiled])

    // Same question as the transform's, and the same answer: having no picture
    // wins over carrying a placement. IndexedDB is not type-checked.
    expect(placedClips()[1].mask).toBeUndefined()
    expect(placedClips()[1].stroke).toBeUndefined()
  })

  it('measures the webcam corner from the primary drawn rectangle, not the canvas', () => {
    // The primary is placed at native pixels centred on the canvas (scale 1 =
    // native, `core/canvasRenderer.ts`), so a 1280x720 screen recording in a
    // 1920x1080 project is drawn in a rectangle inset (1920-1280)/2 = 320
    // across and (1080-720)/2 = 180 down. The camera sat in a corner of *that*
    // rectangle while recording, so that is the frame the placement converts
    // against — measuring from the canvas would drop the camera over the middle
    // of the picture the user actually recorded.
    const smallScreen: TakeClipPart = { ...screenPart, width: 1280, height: 720 }

    store().placeTakeOnTimeline([smallScreen, webcamPart])

    const webcam = placedClips()[1]
    // 1280 x 0.2 = 256 wide at the compositor's own 20px inset, centred at
    // 320 + 1280 - 20 - 128 = 1452 across and 180 + 720 - 20 - 72 = 808 down.
    expect(webcam.transform.x).toBeCloseTo(1452 / 1920, 10)
    expect(webcam.transform.y).toBeCloseTo(808 / 1080, 10)
    expect(webcam.transform.scaleX).toBeCloseTo(0.2, 10)
    expect(webcam.transform).toEqual(
      overlayPlacementToTransform(
        webcamPart.overlayPlacement!,
        store().project.resolution,
        { width: webcamPart.width, height: webcamPart.height },
        { left: 320, top: 180, width: 1280, height: 720 }
      )
    )
  })

  it('falls back to the whole canvas when the primary has no dimensions', () => {
    // Nothing ESCAPECRAFT writes, but IndexedDB is not type-checked: with no
    // rectangle to measure from, the canvas is the only frame there is.
    const sizeless: TakeClipPart = { ...screenPart, width: 0, height: 0 }

    store().placeTakeOnTimeline([sizeless, webcamPart])

    expect(placedClips()[1].transform).toEqual(
      overlayPlacementToTransform(
        webcamPart.overlayPlacement!,
        store().project.resolution,
        { width: webcamPart.width, height: webcamPart.height }
      )
    )
  })

  // ESCSUITE-71. An audio part has no picture, and every consequence of that
  // used to be an accident: it arrives 0x0, which happened to miss the frame
  // rectangle and happened to fall through to the default transform. Both are
  // now decisions, and `mediaType` is what states them.
  it('gives an audio part the default transform and nothing derived from a picture', () => {
    store().placeTakeOnTimeline([screenPart, webcamPart, micPart])

    // `previewGeometry` answers no bounds for an audio clip and the renderers
    // never draw one, so this transform is never read — but `Clip.transform` is
    // a required field, so the clip carries the whole default rather than
    // nothing.
    expect(placedClips()[2].transform).toEqual({ ...DEFAULT_TRANSFORM })
  })

  it('never gives an audio part a picture transform, even one carrying a placement', () => {
    // Nothing ESCAPECRAFT writes: the placement is stored on the primary and
    // `takeImport` carries it onto the webcam part alone. IndexedDB is not
    // type-checked, though, and the question this settles is which of the two
    // fields decides — the placement or the part having no picture at all.
    const misfiled: TakeClipPart = { ...micPart, overlayPlacement: webcamPart.overlayPlacement }

    store().placeTakeOnTimeline([screenPart, misfiled])

    expect(placedClips()[1].transform).toEqual({ ...DEFAULT_TRANSFORM })
  })

  it('measures the webcam corner from the take picture, not from a part that has none', () => {
    // `takeImport` hands the primary over first, and the frame is the primary's
    // drawn rectangle. Deriving it from `parts[0]` made that contract
    // load-bearing in a second place: a take whose parts arrived in any other
    // order would measure the camera's corner against a 0x0 audio part — which
    // silently means "the whole canvas" and puts the camera in the wrong place
    // on every take whose capture is smaller than the project.
    const smallScreen: TakeClipPart = { ...screenPart, width: 1280, height: 720 }

    store().placeTakeOnTimeline([micPart, smallScreen, webcamPart])

    const webcam = placedClips()[2]
    expect(webcam.transform).toEqual(
      overlayPlacementToTransform(
        webcamPart.overlayPlacement!,
        store().project.resolution,
        { width: webcamPart.width, height: webcamPart.height },
        { left: 320, top: 180, width: 1280, height: 720 }
      )
    )
  })

  it('places a take with no picture in it at all', () => {
    // The action assumes nothing about what a take contains: with no part that
    // has a frame there is no rectangle to measure, and the clips are placed
    // regardless.
    store().placeTakeOnTimeline([micPart, { ...micPart, sourceVideoId: 'system-part' }])

    expect(placedClips()).toHaveLength(2)
    expect(placedClips().map((clip) => clip.transform)).toEqual([
      { ...DEFAULT_TRANSFORM },
      { ...DEFAULT_TRANSFORM },
    ])
  })

  it('gives every part its own track, in the order it was handed them', () => {
    store().placeTakeOnTimeline([screenPart, webcamPart, micPart])

    const tracks = placedClips().map((clip) => trackOf(clip).index)
    expect(new Set(tracks).size).toBe(3)
    expect(tracks[0]).toBeLessThan(tracks[1])
    expect(tracks[1]).toBeLessThan(tracks[2])
  })

  it('appends to the end of a timeline that already holds work', () => {
    store().addClipToTimeline(
      { id: 'existing', sourceVideoId: video.id, name: 'existing', startTime: 0, endTime: 4, duration: 4 },
      undefined,
      2
    )
    store().clearHistory()

    store().placeTakeOnTimeline([screenPart, webcamPart])

    // A handoff into a session that already holds work must not land on top of
    // it: the take starts where the timeline ends (2 + 4 = 6).
    const [, screen, webcam] = placedClips()
    expect(screen.timelinePosition).toBe(6)
    expect(webcam.timelinePosition).toBe(6.5)
  })

  it('is one undo step for the whole take, and undo leaves the media alone', () => {
    const before = store().history.past.length
    const tracksBefore = store().project.timeline.tracks.length

    store().placeTakeOnTimeline([screenPart, webcamPart])

    expect(store().history.past).toHaveLength(before + 1)
    expect(placedClips()).toHaveLength(2)
    expect(store().project.timeline.tracks.length).toBeGreaterThan(tracksBefore)

    store().undo()

    // One Ctrl+Z takes the whole take off the timeline — not one part of it —
    // and the parts stay in the media library, exactly as undoing a drag from
    // the library does.
    expect(placedClips()).toHaveLength(0)
    expect(store().sourceVideos.map((v) => v.id)).toContain(video.id)
    // A take brings tracks as well as clips, so undoing it must take those back
    // too. Asserting only the clips would stay green under a refactor that
    // created the companion tracks outside the action's one `set` — which would
    // leave an orphan empty track behind on every undone handoff.
    expect(store().project.timeline.tracks).toHaveLength(tracksBefore)

    // And it is one *redo* step as well: the whole take comes back, tracks
    // included, rather than being half-restored.
    expect(store().history.future).toHaveLength(1)
    store().redo()
    expect(placedClips()).toHaveLength(2)
    expect(store().project.timeline.tracks).toHaveLength(tracksBefore + 1)
  })

  it('does nothing at all when there is nothing to place', () => {
    const before = store().history.past.length

    store().placeTakeOnTimeline([])

    // A take whose every part was missing still reaches here; it must not
    // record an undo step that undoes nothing, or add an empty track.
    expect(placedClips()).toHaveLength(0)
    expect(store().project.timeline.tracks).toHaveLength(1)
    expect(store().history.past).toHaveLength(before)
  })
})
