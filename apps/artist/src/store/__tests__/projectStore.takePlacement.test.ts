// Putting a handed-over take on the timeline (ESCSUITE-14, decision 7).
//
// The store's other clip actions are one clip at a time; this one is a whole
// take — several clips on several tracks, in one undo step, at the end of
// whatever the timeline already holds.
import { describe, it, expect, beforeEach } from 'vitest'
import { store, resetStoreForTest, video } from '../../test/fixtures/projectStore'
import { overlayPlacementToTransform } from '../../utils/overlayPlacement'
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

  it('gives every part its own track, in the order it was handed them', () => {
    const micPart: TakeClipPart = {
      sourceVideoId: 'mic-part',
      name: 'Recording — microphone',
      duration: 6,
      startOffset: 0,
      width: 0,
      height: 0,
    }
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

    store().placeTakeOnTimeline([screenPart, webcamPart])

    expect(store().history.past).toHaveLength(before + 1)
    expect(placedClips()).toHaveLength(2)

    store().undo()

    // One Ctrl+Z takes the whole take off the timeline — not one part of it —
    // and the parts stay in the media library, exactly as undoing a drag from
    // the library does.
    expect(placedClips()).toHaveLength(0)
    expect(store().sourceVideos.map((v) => v.id)).toContain(video.id)
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
