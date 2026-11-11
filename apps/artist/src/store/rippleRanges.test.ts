// "Remove all" for silences (ESCSUITE-403): cutting stretches of timeline time
// out of a take's rows and closing every gap, as one undo step, with the
// take's parts kept in step.
import { describe, it, expect, beforeEach } from 'vitest'
import { resetStoreForTest, store, video } from '../test/fixtures/projectStore'
import { audioSource } from '../test/renderPreview'
import { captionStyleFor } from '../core/captions'
import { cutEditorBlock, normaliseRanges } from './rippleRanges'
import { scrubRemovedSources } from './storeHistory'
import { useEditorStore } from './projectStore'
import type { Clip } from './types'

/** Each clip on a row as `[timelinePosition, startTime, endTime]`, in time order. */
function row(trackId: string): number[][] {
  return store()
    .project.timeline.clips.filter((c) => c.trackId === trackId)
    .sort((a, b) => a.timelinePosition - b.timelinePosition)
    .map((c) => [c.timelinePosition, c.startTime, c.endTime].map((n) => Math.round(n * 1e6) / 1e6))
}

function clipsOn(trackId: string): Clip[] {
  return store()
    .project.timeline.clips.filter((c) => c.trackId === trackId)
    .sort((a, b) => a.timelinePosition - b.timelinePosition)
}

/** A 10 s two-part take — screen and microphone — placed at 0, the mic `micOffset` s late. */
function placeTake(micOffset = 0) {
  store().placeTakeOnTimeline([
    { sourceVideoId: video.id, name: 'screen', duration: 10, startOffset: 0, width: 1920, height: 1080 },
    { sourceVideoId: audioSource.id, name: 'mic', duration: 10 - micOffset, startOffset: micOffset, width: 0, height: 0, mediaType: 'audio' },
  ])
  const clips = store().project.timeline.clips
  const screen = clips.find((c) => c.name === 'screen')!
  const mic = clips.find((c) => c.name === 'mic')!
  return { screen, mic, screenRow: screen.trackId, micRow: mic.trackId }
}

beforeEach(() => {
  resetStoreForTest()
  store().addSourceVideo(audioSource)
})

describe('removeTimeRanges', () => {
  it('cuts every range out of the take and closes the gaps on both rows', () => {
    const { screen, screenRow, micRow } = placeTake()
    expect(store().removeTimeRanges(screen.id, [{ start: 2, end: 3 }, { start: 6, end: 7.5 }])).toBe(true)
    const expected = [[0, 0, 2], [2, 3, 6], [5, 7.5, 10]]
    expect(row(screenRow)).toEqual(expected)
    expect(row(micRow)).toEqual(expected)
    expect(store().project.timeline.duration).toBeCloseTo(10 - 2.5, 9)
  })

  it('cuts a part captured late at its own offset into itself', () => {
    const { mic, screenRow, micRow } = placeTake(0.5)
    store().removeTimeRanges(mic.id, [{ start: 2, end: 3 }])
    expect(row(screenRow)).toEqual([[0, 0, 2], [2, 3, 10]])
    // The mic starts at 0.5 s, so 2–3 s on the timeline is 1.5–2.5 s of it.
    expect(row(micRow)).toEqual([[0.5, 0, 1.5], [2, 2.5, 9.5]])
  })

  it('moves a part lying wholly after a cut by the time cut before it', () => {
    const { screen, micRow } = placeTake(4)
    store().removeTimeRanges(screen.id, [{ start: 1, end: 2 }])
    expect(row(micRow)).toEqual([[3, 0, 6]])
  })

  it('moves a row the target\'s own group never reaches, when a later piece links to it', () => {
    // Split at the mic's own start: the screen's left piece links to nothing,
    // the mic and the screen's right piece share the right-hand group.
    const { screen, screenRow, micRow } = placeTake(1)
    store().splitClip(screen.id, 1)
    const [left] = clipsOn(screenRow)
    expect(clipsOn(micRow)[0].linkGroupId).toBe(clipsOn(screenRow)[1].linkGroupId)
    store().removeTimeRanges(left.id, [{ start: 0.25, end: 0.75 }])
    expect(row(screenRow)).toEqual([[0, 0, 0.25], [0.25, 0.75, 1], [0.5, 1, 10]])
    expect(row(micRow)).toEqual([[0.5, 0, 9]])
  })

  it('is one undo step that restores everything it cut', () => {
    const { screen } = placeTake()
    const before = JSON.stringify(store().project)
    const depth = store().history.past.length
    store().removeTimeRanges(screen.id, [{ start: 1, end: 2 }, { start: 4, end: 5 }, { start: 8, end: 9 }])
    expect(store().history.past.length).toBe(depth + 1)
    store().undo()
    expect(JSON.stringify(store().project)).toBe(before)
  })

  it('keeps each slot between two cuts a segment of its own', () => {
    const { screen, screenRow, micRow } = placeTake()
    store().removeTimeRanges(screen.id, [{ start: 2, end: 3 }, { start: 6, end: 7 }])
    const screens = clipsOn(screenRow)
    const mics = clipsOn(micRow)
    // The first slot keeps the take's group, the next ones get one each.
    expect(screens[0].linkGroupId).toBe(screen.linkGroupId)
    for (let i = 0; i < 3; i++) expect(mics[i].linkGroupId).toBe(screens[i].linkGroupId)
    expect(new Set(screens.map((c) => c.linkGroupId)).size).toBe(3)
  })

  it('keeps the first piece the clip it was, so the selection survives', () => {
    const { screen } = placeTake()
    store().setSelectedClipId(screen.id)
    store().removeTimeRanges(screen.id, [{ start: 2, end: 3 }])
    expect(store().selectedClipId).toBe(screen.id)
    expect(store().project.timeline.clips.find((c) => c.id === screen.id)!.endTime).toBe(2)
  })

  it('drops a clip that lies wholly inside a cut', () => {
    const { screen, screenRow, micRow } = placeTake()
    store().splitClip(screen.id, 4, true)
    store().splitClip(clipsOn(screenRow)[1].id, 1, true)
    // Screen pieces 0–4, 4–5, 5–10, all in the take's group; cut 3.5–5.5.
    expect(store().removeTimeRanges(clipsOn(screenRow)[0].id, [{ start: 3.5, end: 5.5 }])).toBe(true)
    expect(row(screenRow)).toEqual([[0, 0, 3.5], [3.5, 5.5, 10]])
    expect(row(micRow)).toEqual([[0, 0, 3.5], [3.5, 5.5, 10]])
  })

  it('leaves every other row where it was', () => {
    const { screen } = placeTake()
    store().addClipToTimeline(
      { id: 'music', sourceVideoId: audioSource.id, name: 'music', startTime: 0, endTime: 8, duration: 8 },
      undefined,
      1
    )
    const music = store().project.timeline.clips.find((c) => c.id === 'music')!
    store().removeTimeRanges(screen.id, [{ start: 2, end: 3 }])
    expect(store().project.timeline.clips.find((c) => c.id === 'music')).toEqual(music)
  })

  it('cuts and shifts an unlinked clip on one of the take\'s rows with it', () => {
    const { screen, screenRow } = placeTake()
    store().addClipToTimeline(
      { id: 'tail', sourceVideoId: video.id, name: 'tail', startTime: 0, endTime: 5, duration: 5 },
      screenRow,
      12
    )
    store().removeTimeRanges(screen.id, [{ start: 2, end: 3 }])
    expect(row(screenRow)).toEqual([[0, 0, 2], [2, 3, 10], [11, 0, 5]])
  })

  it('gives a cut image its 0 / duration pair, as a split does', () => {
    store().addSourceVideo({ ...video, id: 'still', name: 'still.png', mediaType: 'image', duration: 5 })
    store().addClipToTimeline({ id: 'img', sourceVideoId: 'still', name: 'img', startTime: 0, endTime: 5, duration: 5 }, undefined, 0)
    store().removeTimeRanges('img', [{ start: 1, end: 2 }])
    const pieces = store().project.timeline.clips.sort((a, b) => a.timelinePosition - b.timelinePosition)
    expect(pieces.map((c) => [c.timelinePosition, c.startTime, c.endTime])).toEqual([[0, 0, 1], [1, 0, 3]])
  })

  it('cuts one unlinked clip on its own', () => {
    store().addClipToTimeline({ id: 'solo', sourceVideoId: audioSource.id, name: 'solo', startTime: 1, endTime: 9, duration: 8 }, undefined, 0)
    expect(store().removeTimeRanges('solo', [{ start: 2, end: 4 }])).toBe(true)
    const [first, second] = store().project.timeline.clips.sort((a, b) => a.timelinePosition - b.timelinePosition)
    expect([first.timelinePosition, first.startTime, first.endTime]).toEqual([0, 1, 3])
    expect([second.timelinePosition, second.startTime, second.endTime]).toEqual([2, 5, 9])
    expect(first.linkGroupId).toBeUndefined()
    expect(second.linkGroupId).toBeUndefined()
  })

  it('trims the clip\'s animation to each piece', () => {
    const { screen, screenRow } = placeTake()
    store().updateClipAnimation(screen.id, {
      in: { type: 'fade', duration: 1, easing: 'linear' },
      out: { type: 'fade', duration: 1, easing: 'linear' },
      keyframes: { opacity: [{ time: 0, value: 0, easing: 'linear' }, { time: 10, value: 1, easing: 'linear' }] },
    })
    store().removeTimeRanges(screen.id, [{ start: 5, end: 6 }])
    const [left, right] = clipsOn(screenRow)
    expect(left.animation!.out.type).toBe('none')
    expect(right.animation!.in.type).toBe('none')
    expect(right.animation!.keyframes.opacity![0]).toMatchObject({ time: 0, value: 0.6 })
  })

  it('refuses whole when a part is on a locked track, and records no step', () => {
    const { screen, micRow } = placeTake()
    store().updateTrack(micRow, { locked: true })
    const before = JSON.stringify(store().project)
    const depth = store().history.past.length
    expect(store().removeTimeRanges(screen.id, [{ start: 2, end: 3 }])).toBe(false)
    expect(JSON.stringify(store().project)).toBe(before)
    expect(store().history.past.length).toBe(depth)
  })

  it('does nothing for no ranges, no clip, or ranges outside the timeline', () => {
    const { screen } = placeTake()
    const depth = store().history.past.length
    expect(store().removeTimeRanges(screen.id, [])).toBe(false)
    expect(store().removeTimeRanges('missing', [{ start: 1, end: 2 }])).toBe(false)
    expect(store().removeTimeRanges(screen.id, [{ start: 2, end: 2 }])).toBe(false)
    expect(store().history.past.length).toBe(depth)
  })
})

describe('removeTimeRanges, moving everything after each cut (ESCSUITE-434)', () => {
  const span = (id: string) => {
    const c = store().project.timeline.clips.find((x) => x.id === id)!
    return [c.timelinePosition, c.startTime, c.endTime].map((n) => Math.round(n * 1e6) / 1e6)
  }

  it('moves a clip on another row by the time cut before it, and shortens one a cut crosses', () => {
    const { screen } = placeTake()
    store().addClipToTimeline({ id: 'after', sourceVideoId: audioSource.id, name: 'after', startTime: 0, endTime: 2, duration: 2 }, undefined, 7)
    store().addClipToTimeline({ id: 'across', sourceVideoId: audioSource.id, name: 'across', startTime: 1, endTime: 9, duration: 8 }, undefined, 1)
    expect(store().removeTimeRanges(screen.id, [{ start: 2, end: 3 }, { start: 6, end: 6.5 }], true)).toBe(true)
    expect(span('after')).toEqual([5.5, 0, 2])
    // One clip still, 1.5 s shorter, off its out point.
    expect(span('across')).toEqual([1, 1, 7.5])
    expect(store().project.timeline.clips.filter((c) => c.name === 'across')).toHaveLength(1)
  })

  it('shortens an overlay a cut crosses rather than splitting it, and drops one wholly inside a cut', () => {
    const { screen } = placeTake()
    const text = store().addTextOverlayClip({ text: 'Title' }, undefined, 1, 4)!
    const blur = store().addShapeOverlayClip({ type: 'blur' }, undefined, 2.2, 0.5)!
    const after = store().addShapeOverlayClip({ type: 'rectangle' }, undefined, 6, 2)!
    store().removeTimeRanges(screen.id, [{ start: 2, end: 3 }], true)
    expect(span(text.id)).toEqual([1, 0, 3])
    expect(store().project.timeline.clips.find((c) => c.id === blur.id)).toBeUndefined()
    expect(span(after.id)).toEqual([5, 0, 2])
  })

  it('moves the caption track\'s cues', () => {
    const { screen } = placeTake()
    const { trackId } = store().addCaptionCues([{ start: 1, end: 2.5, text: 'One' }, { start: 4, end: 5, text: 'Two' }], captionStyleFor({ width: 1920, height: 1080 }))!
    store().removeTimeRanges(screen.id, [{ start: 2, end: 3 }], true)
    expect(row(trackId)).toEqual([[1, 0, 1], [3, 0, 1]])
  })

  it('keeps a shortened overlay\'s keyframes on what is left of it', () => {
    const { screen } = placeTake()
    const text = store().addTextOverlayClip({ text: 'Title' }, undefined, 1, 4)!
    store().updateClipAnimation(text.id, {
      in: { type: 'fade', duration: 2, easing: 'linear' },
      out: { type: 'none', duration: 0.5, easing: 'linear' },
      keyframes: { opacity: [{ time: 0, value: 0, easing: 'linear' }, { time: 1.5, value: 0.5, easing: 'linear' }, { time: 3, value: 1, easing: 'linear' }] },
    })
    store().removeTimeRanges(screen.id, [{ start: 2, end: 3 }], true)
    const animation = store().project.timeline.clips.find((c) => c.id === text.id)!.animation!
    // 1.5 s sat inside the cut and goes with it; 3 s is now 2 s into the clip.
    expect(animation.keyframes.opacity!.map((k) => [k.time, k.value])).toEqual([[0, 0], [2, 1]])
    expect(animation.in.duration).toBeLessThanOrEqual(3)
  })

  it('moves the markers and in/out points, one inside a cut to where it closes', () => {
    const { screen } = placeTake()
    store().addMarker(1, 'before')
    store().addMarker(2.5, 'inside')
    store().addMarker(8, 'after')
    store().setInPoint(2.5)
    store().setOutPoint(9)
    store().removeTimeRanges(screen.id, [{ start: 2, end: 3 }, { start: 6, end: 7 }], true)
    expect(store().markers.map((m) => [m.label, m.time])).toEqual([['before', 1], ['inside', 2], ['after', 6]])
    expect([store().inPoint, store().outPoint]).toEqual([2, 7])
  })

  it('leaves a locked row where it is, and still refuses when the take\'s own row is locked', () => {
    const { screen, micRow } = placeTake()
    store().addClipToTimeline({ id: 'kept', sourceVideoId: audioSource.id, name: 'kept', startTime: 0, endTime: 2, duration: 2 }, undefined, 5)
    const keptRow = store().project.timeline.clips.find((c) => c.id === 'kept')!.trackId
    store().updateTrack(keptRow, { locked: true })
    expect(store().removeTimeRanges(screen.id, [{ start: 2, end: 3 }], true)).toBe(true)
    expect(span('kept')).toEqual([5, 0, 2])

    store().undo()
    store().updateTrack(micRow, { locked: true })
    expect(store().removeTimeRanges(screen.id, [{ start: 2, end: 3 }], true)).toBe(false)
  })

  it('is one undo step for the clips, the markers and the points, and redo moves them again', () => {
    const { screen } = placeTake()
    const blur = store().addShapeOverlayClip({ type: 'blur' }, undefined, 5, 2)!
    store().addMarker(6, 'm')
    store().setOutPoint(8)
    const before = JSON.stringify(store().project)
    const depth = store().history.past.length
    store().removeTimeRanges(screen.id, [{ start: 2, end: 3 }], true)
    expect(store().history.past.length).toBe(depth + 1)
    const after = JSON.stringify(store().project)

    store().undo()
    expect(JSON.stringify(store().project)).toBe(before)
    expect(store().markers[0].time).toBe(6)
    expect(store().outPoint).toBe(8)
    store().redo()
    expect(JSON.stringify(store().project)).toBe(after)
    expect(span(blur.id)).toEqual([4, 0, 2])
    expect(store().markers[0].time).toBe(5)
    expect(store().outPoint).toBe(7)
  })

  it('leaves the markers alone when undoing any other edit', () => {
    const { screen } = placeTake()
    store().splitClip(screen.id, 4)
    store().addMarker(6, 'added after the split')
    store().undo()
    expect(store().markers).toHaveLength(1)
  })

  it('with the box off, moves no other row, marker or point', () => {
    const { screen } = placeTake()
    const blur = store().addShapeOverlayClip({ type: 'blur' }, undefined, 5, 2)!
    store().addMarker(6, 'm')
    store().setInPoint(4)
    store().removeTimeRanges(screen.id, [{ start: 2, end: 3 }])
    expect(span(blur.id)).toEqual([5, 0, 2])
    expect(store().markers[0].time).toBe(6)
    expect(store().inPoint).toBe(4)
    expect(store().history.past[store().history.past.length - 1].editor).toBeUndefined()
  })

  it('cutEditorBlock answers null when nothing moves', () => {
    expect(cutEditorBlock({ inPoint: 1, outPoint: null, markers: [{ id: 'a', time: 0.5, label: '', color: '#fff' }] }, [{ start: 2, end: 3 }])).toBeNull()
    expect(cutEditorBlock({ inPoint: null, outPoint: 4, markers: [] }, [{ start: 2, end: 3 }])).toEqual({ inPoint: null, outPoint: 3, markers: [] })
  })

  it('drops an in/out range a cut swallows whole rather than closing it up to nothing', () => {
    // An empty range is one a saved block cannot hold: restoring it would drop the markers too.
    expect(cutEditorBlock({ inPoint: 2.2, outPoint: 2.8, markers: [] }, [{ start: 2, end: 3 }])).toEqual({ inPoint: null, outPoint: null, markers: [] })
    const { screen } = placeTake()
    store().setInPoint(2.2)
    store().setOutPoint(2.8)
    store().removeTimeRanges(screen.id, [{ start: 2, end: 3 }], true)
    expect([store().inPoint, store().outPoint]).toEqual([null, null])
    store().undo()
    expect([store().inPoint, store().outPoint]).toEqual([2.2, 2.8])
  })

  it('leaves a linked pair together when one of its rows is locked', () => {
    const { screen } = placeTake()
    store().addClipToTimeline({ id: 'b-roll', sourceVideoId: video.id, name: 'b-roll', startTime: 0, endTime: 2, duration: 2 }, undefined, 5)
    store().addClipToTimeline({ id: 'b-sound', sourceVideoId: audioSource.id, name: 'b-sound', startTime: 0, endTime: 2, duration: 2 }, undefined, 5)
    useEditorStore.setState((state) => ({
      project: {
        ...state.project,
        timeline: {
          ...state.project.timeline,
          clips: state.project.timeline.clips.map((c) => (c.id === 'b-roll' || c.id === 'b-sound' ? { ...c, linkGroupId: 'pair' } : c)),
        },
      },
    }))
    const soundRow = store().project.timeline.clips.find((c) => c.id === 'b-sound')!.trackId
    expect(store().project.timeline.clips.find((c) => c.id === 'b-roll')!.trackId).not.toBe(soundRow)
    store().updateTrack(soundRow, { locked: true })
    expect(store().removeTimeRanges(screen.id, [{ start: 2, end: 3 }], true)).toBe(true)
    // Moving the picture without its locked sound would put the pair out of step.
    expect(span('b-roll')).toEqual([5, 0, 2])
    expect(span('b-sound')).toEqual([5, 0, 2])
  })

  it('moves a linked pair on other rows as one, so its parts stay in step', () => {
    const { screen } = placeTake()
    store().addClipToTimeline({ id: 'b-roll', sourceVideoId: video.id, name: 'b-roll', startTime: 0, endTime: 10, duration: 10 }, undefined, 0)
    store().addClipToTimeline({ id: 'b-sound', sourceVideoId: audioSource.id, name: 'b-sound', startTime: 0, endTime: 9.4, duration: 9.4 }, undefined, 0.6)
    useEditorStore.setState((state) => ({
      project: {
        ...state.project,
        timeline: {
          ...state.project.timeline,
          clips: state.project.timeline.clips.map((c) => (c.id === 'b-roll' || c.id === 'b-sound' ? { ...c, linkGroupId: 'pair' } : c)),
        },
      },
    }))
    expect(store().removeTimeRanges(screen.id, [{ start: 0.2, end: 0.5 }], true)).toBe(true)
    // The cut lies before the sound starts but inside the pair: both keep their
    // place and offset (source time 0 at 0 s and 0.6 s), and end where 10 s now lands.
    expect(span('b-roll')).toEqual([0, 0, 9.7])
    expect(span('b-sound')).toEqual([0.6, 0, 9.1])
  })

  it('keeps a marker added after the cut when the cut is undone, and one added after the undo when it is redone', () => {
    const { screen } = placeTake()
    store().addMarker(6, 'before the cut')
    store().removeTimeRanges(screen.id, [{ start: 2, end: 3 }], true)
    store().addMarker(8, 'after the cut')
    store().undo()
    expect(store().markers.map((m) => [m.label, m.time])).toEqual([['before the cut', 6], ['after the cut', 8]])
    store().addMarker(1, 'after the undo')
    store().redo()
    expect(store().markers.map((m) => [m.label, m.time])).toEqual([['after the undo', 1], ['before the cut', 5], ['after the cut', 8]])
  })

  it('keeps the markers and points on the entry when a storage clear scrubs it', () => {
    const { screen } = placeTake()
    store().addClipToTimeline({ id: 'gone', sourceVideoId: audioSource.id, name: 'gone', startTime: 0, endTime: 1, duration: 1 }, undefined, 12)
    store().addMarker(6)
    store().removeTimeRanges(screen.id, [{ start: 2, end: 3 }], true)
    const entry = store().history.past[store().history.past.length - 1]
    const [scrubbed] = scrubRemovedSources({ past: [entry], future: [] }, [audioSource.id]).past
    expect(scrubbed).not.toBe(entry)
    expect(scrubbed.editor).toEqual(entry.editor)
  })
})

describe('normaliseRanges', () => {
  it('sorts, joins overlapping ranges and drops empty ones', () => {
    expect(
      normaliseRanges([{ start: 5, end: 6 }, { start: 1, end: 3 }, { start: 2, end: 4 }, { start: 7, end: 7 }, { start: 9, end: 8 }])
    ).toEqual([{ start: 1, end: 4 }, { start: 5, end: 6 }])
  })

  it('clamps a range that starts before 0', () => {
    expect(normaliseRanges([{ start: -1, end: 1 }])).toEqual([{ start: 0, end: 1 }])
  })
})
