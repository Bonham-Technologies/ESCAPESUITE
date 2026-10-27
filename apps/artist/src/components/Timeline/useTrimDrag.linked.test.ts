// A ripple trim keeps a take's rows in step (ESCSUITE-360).
//
// ESCSUITE-355 linked a separate-tracks take's parts, so a split, a delete, a
// ripple delete and a drag act on all of them. A ripple trim did not: it
// trimmed the one clip and shifted the later clips on its own row only, so
// ripple-trimming the screen pulled the later screen pieces left while the
// microphone row stayed put, and the speech slid off the picture.
//
// The scene is the real store and the real hook: a 10 s two-part take (screen
// and microphone) cut at 3 and 6. The track container's left edge is at client
// X 100 and the scale is 50px per second, as in `useTrimDrag.test.ts`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type React from 'react'
import { useTrimDrag, type TrimDragDeps } from './useTrimDrag'
import { useEditorStore } from '../../store/projectStore'
import { resetStoreForTest, store, video } from '../../test/fixtures/projectStore'
import { audioSource } from '../../test/renderPreview'
import { setRect } from '../../test/doubles/layout'
import type { Clip, SourceVideo } from '../../store/types'

const PPS = 50
const LEFT = 100

let containerRef: { current: HTMLDivElement | null }

beforeEach(() => {
  resetStoreForTest()
  store().addSourceVideo(audioSource)
  const container = document.createElement('div')
  setRect(container, { left: LEFT, top: 0, width: 800, height: 200 })
  document.body.appendChild(container)
  containerRef = { current: container }
})

afterEach(() => {
  document.body.innerHTML = ''
})

/** Each clip on a row as `[timelinePosition, startTime, endTime]`, in time order. */
function row(trackId: string): number[][] {
  return clipsOn(trackId).map((c) => [c.timelinePosition, c.startTime, c.endTime])
}

function clipsOn(trackId: string): Clip[] {
  return store()
    .project.timeline.clips.filter((c) => c.trackId === trackId)
    .sort((a, b) => a.timelinePosition - b.timelinePosition)
}

/** A 10 s two-part take placed at 0 and cut at 3 and 6. */
function cutTake(micSource: SourceVideo = audioSource) {
  store().placeTakeOnTimeline([
    { sourceVideoId: video.id, name: 'screen', duration: 10, startOffset: 0, width: 1920, height: 1080 },
    { sourceVideoId: micSource.id, name: 'mic', duration: 10, startOffset: 0, width: 0, height: 0, mediaType: 'audio' },
  ])
  const clips = store().project.timeline.clips
  const screenRow = clips.find((c) => c.name === 'screen')!.trackId
  const micRow = clips.find((c) => c.name === 'mic')!.trackId
  store().splitClip(clipsOn(screenRow)[0].id, 3)
  store().splitClip(clipsOn(screenRow)[1].id, 3)
  return { screenRow, micRow, pieces: clipsOn(screenRow) }
}

const deps = (): TrimDragDeps => {
  const state = useEditorStore.getState()
  return {
    trackContainerRef: containerRef,
    pixelsPerSecond: PPS,
    clips: state.project.timeline.clips,
    sourceVideos: state.sourceVideos,
    tracks: state.project.timeline.tracks,
    activeTool: state.activeTool,
    setSelectedClipId: state.setSelectedClipId,
    trimClip: state.trimClip,
    shiftClipsAfter: state.shiftClipsAfter,
  }
}

const mountTrim = () =>
  renderHook(() => {
    useEditorStore((state) => state.project.timeline.clips)
    return useTrimDrag(deps())
  })

/** Grab `clip`'s edge, run the pointer through `times`, let go. */
function trim(clip: Clip, edge: 'start' | 'end', times: number[], altKey = false) {
  const { result } = mountTrim()
  const event = { stopPropagation: () => {}, preventDefault: () => {}, altKey } as unknown as React.MouseEvent
  act(() => {
    result.current.handleTrimMouseDown(event, clip, edge)
  })
  for (const seconds of times) {
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: LEFT + seconds * PPS, altKey }))
    })
  }
  act(() => {
    document.dispatchEvent(new MouseEvent('mouseup', { altKey }))
  })
}

const past = () => useEditorStore.getState().history.past.length

describe('ripple-trimming a linked clip (ESCSUITE-360)', () => {
  it('trims every linked clip and closes the gap on every row', () => {
    const { screenRow, micRow, pieces } = cutTake()
    store().setActiveTool('ripple')

    trim(pieces[1], 'end', [5.5, 5])

    expect(row(screenRow)).toEqual([[0, 0, 3], [3, 3, 5], [5, 6, 10]])
    expect(row(micRow)).toEqual([[0, 0, 3], [3, 3, 5], [5, 6, 10]])
  })

  it('is one undo step', () => {
    const { screenRow, micRow, pieces } = cutTake()
    store().setActiveTool('ripple')
    const before = past()

    trim(pieces[1], 'end', [5.5, 5])

    expect(past() - before).toBe(1)
    store().undo()
    expect(row(screenRow)).toEqual([[0, 0, 3], [3, 3, 6], [6, 6, 10]])
    expect(row(micRow)).toEqual([[0, 0, 3], [3, 3, 6], [6, 6, 10]])
  })

  it('trims a linked clip at the same edge for a start trim', () => {
    const { screenRow, micRow, pieces } = cutTake()
    store().setActiveTool('ripple')

    trim(pieces[1], 'start', [3.5])

    expect(row(screenRow)).toEqual([[0, 0, 3], [3.5, 3.5, 6], [6, 6, 10]])
    expect(row(micRow)).toEqual([[0, 0, 3], [3.5, 3.5, 6], [6, 6, 10]])
  })

  it('stops every linked clip where the first of them runs out of source', () => {
    // The mic's source is only 10 s long, so its last piece cannot follow the
    // screen past 10: both stop there, in step.
    const shortMic: SourceVideo = { ...audioSource, id: 'mic10', duration: 10 }
    store().addSourceVideo(shortMic)
    const { screenRow, micRow, pieces } = cutTake(shortMic)
    store().setActiveTool('ripple')

    trim(pieces[2], 'end', [12])

    expect(row(screenRow)).toEqual([[0, 0, 3], [3, 3, 6], [6, 6, 10]])
    expect(row(micRow)).toEqual([[0, 0, 3], [3, 3, 6], [6, 6, 10]])
  })

  it('with Alt held, ripple-trims only the clip grabbed', () => {
    const { screenRow, micRow, pieces } = cutTake()
    store().setActiveTool('ripple')

    trim(pieces[1], 'end', [5.5, 5], true)

    expect(row(screenRow)).toEqual([[0, 0, 3], [3, 3, 5], [5, 6, 10]])
    expect(row(micRow)).toEqual([[0, 0, 3], [3, 3, 6], [6, 6, 10]])
  })

  it('with a linked clip on a locked track, changes nothing', () => {
    // As a ripple delete: closing the gap on one row only would put the later
    // pieces out of step.
    const { screenRow, micRow, pieces } = cutTake()
    store().updateTrack(micRow, { locked: true })
    store().setActiveTool('ripple')
    const before = past()

    trim(pieces[1], 'end', [5.5, 5])

    expect(row(screenRow)).toEqual([[0, 0, 3], [3, 3, 6], [6, 6, 10]])
    expect(row(micRow)).toEqual([[0, 0, 3], [3, 3, 6], [6, 6, 10]])
    expect(past()).toBe(before)
  })

  it('a plain trim stays per clip', () => {
    const { screenRow, micRow, pieces } = cutTake()

    trim(pieces[1], 'end', [5.5, 5])

    expect(row(screenRow)).toEqual([[0, 0, 3], [3, 3, 5], [6, 6, 10]])
    expect(row(micRow)).toEqual([[0, 0, 3], [3, 3, 6], [6, 6, 10]])
  })
})
