// "Remove all" for silences (ESCSUITE-403): cutting stretches of timeline time
// out of a take's rows and closing every gap, as one undo step, with the
// take's parts kept in step.
import { describe, it, expect, beforeEach } from 'vitest'
import { resetStoreForTest, store, video } from '../test/fixtures/projectStore'
import { audioSource } from '../test/renderPreview'
import { normaliseRanges } from './rippleRanges'
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
