// The trim gesture's lifecycle: what it binds, what it writes, what it ripples.
//
// A trim differs from a clip drag in that it commits continuously — every
// mousemove is a store write — so these tests watch `updateClip` rather than a
// preview, and they watch that the origin recorded on mousedown is what the
// arithmetic measures against, not the clip's live values.
//
// The scene is the real store: clip1 on track A, at 2s on the timeline, playing
// the first two seconds of a 30s source. The track container's left edge is at
// client X 100 and the scale is 50px per second, so client X 225 is 2.5s.
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type React from 'react'
import { useTrimDrag, type TrimDragDeps } from './useTrimDrag'
import { useEditorStore } from '../../store/projectStore'
import { addClip, resetStoreForTest, store } from '../../test/fixtures/projectStore'
import { setRect } from '../../test/doubles/layout'

/** The timeline's default scale: one second is 50px at zoom 1. */
const PPS = 50
/** Client X of the track container's left edge — the timeline's t=0. */
const LEFT = 100

let addListener: MockInstance
let removeListener: MockInstance
let containerRef: { current: HTMLDivElement | null }
let trackA: string
let actions: Pick<TrimDragDeps, 'setSelectedClipId' | 'updateClip' | 'shiftClipsAfter'>

beforeEach(() => {
  resetStoreForTest()
  addListener = vi.spyOn(document, 'addEventListener')
  removeListener = vi.spyOn(document, 'removeEventListener')

  trackA = useEditorStore.getState().project.timeline.tracks[0].id
  addClip('clip1', 2, 2, trackA)
  addClip('clip2', 6, 2, trackA)

  const container = document.createElement('div')
  setRect(container, { left: LEFT, top: 0, width: 800, height: 200 })
  document.body.appendChild(container)
  containerRef = { current: container }

  const state = useEditorStore.getState()
  actions = {
    setSelectedClipId: vi.fn(state.setSelectedClipId),
    updateClip: vi.fn(state.updateClip),
    shiftClipsAfter: vi.fn(state.shiftClipsAfter),
  }
})

afterEach(() => {
  addListener.mockRestore()
  removeListener.mockRestore()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

/** The hook's inputs, read fresh from the store on every render. */
const deps = (): TrimDragDeps => {
  const state = useEditorStore.getState()
  return {
    trackContainerRef: containerRef,
    pixelsPerSecond: PPS,
    clips: state.project.timeline.clips,
    sourceVideos: state.sourceVideos,
    tracks: state.project.timeline.tracks,
    activeTool: state.activeTool,
    ...actions,
  }
}

/**
 * Mount the hook the way `Timeline` holds it: subscribed to the clips, so a
 * store write during a gesture re-renders and hands the effect a fresh closure
 * — which is what lets the release read what the moves wrote.
 */
const mountTrim = () =>
  renderHook(() => {
    useEditorStore((state) => state.project.timeline.clips)
    return useTrimDrag(deps())
  })

/** How many mouse listeners the hook currently holds on the document. */
const isMouse = (call: unknown[]) => call[0] === 'mousemove' || call[0] === 'mouseup'
const bound = (): number =>
  addListener.mock.calls.filter(isMouse).length - removeListener.mock.calls.filter(isMouse).length

const theClip = (id: string) =>
  useEditorStore.getState().project.timeline.clips.find((c) => c.id === id)!

/** A mousedown on a trim handle. */
function press(): { event: React.MouseEvent; stopPropagation: MockInstance; preventDefault: MockInstance } {
  const stopPropagation = vi.fn()
  const preventDefault = vi.fn()
  return {
    event: { stopPropagation, preventDefault } as unknown as React.MouseEvent,
    stopPropagation,
    preventDefault,
  }
}

/** Take hold of clip1's `edge` handle and let the effect bind. */
function grabEdge(
  result: { current: ReturnType<typeof useTrimDrag> },
  edge: 'start' | 'end',
  clipId = 'clip1'
) {
  const { event, stopPropagation, preventDefault } = press()
  act(() => {
    result.current.handleTrimMouseDown(event, theClip(clipId), edge)
  })
  return { stopPropagation, preventDefault }
}

/** Move the pointer to a time on the timeline. */
const moveTo = (seconds: number) =>
  act(() => {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: LEFT + seconds * PPS }))
  })

const release = () =>
  act(() => {
    document.dispatchEvent(new MouseEvent('mouseup'))
  })

describe('useTrimDrag starting a trim', () => {
  it('records the clip as it stood when the edge was grabbed', () => {
    const { result } = mountTrim()

    const { stopPropagation, preventDefault } = grabEdge(result, 'start')

    expect(result.current.trimState).toEqual({
      clipId: 'clip1',
      edge: 'start',
      originalStartTime: 0,
      originalEndTime: 2,
      originalTimelinePosition: 2,
    })
    expect(stopPropagation).toHaveBeenCalled()
    expect(preventDefault).toHaveBeenCalled()
  })

  it('selects the clip being trimmed', () => {
    const { result } = mountTrim()

    grabEdge(result, 'end')

    expect(actions.setSelectedClipId).toHaveBeenCalledWith('clip1')
    expect(useEditorStore.getState().selectedClipId).toBe('clip1')
  })

  it('binds the gesture to the document and gives it back on release', () => {
    const { result } = mountTrim()

    grabEdge(result, 'start')
    expect(bound()).toBe(2)

    release()

    expect(bound()).toBe(0)
    expect(result.current.trimState).toBeNull()
  })

  it('gives the listeners back when the timeline unmounts mid-trim', () => {
    const { result, unmount } = mountTrim()
    grabEdge(result, 'start')

    unmount()

    expect(bound()).toBe(0)
  })

  it('refuses to trim a clip on a locked track', () => {
    store().updateTrack(trackA, { locked: true })
    const { result } = mountTrim()

    grabEdge(result, 'start')

    expect(result.current.trimState).toBeNull()
    expect(actions.setSelectedClipId).not.toHaveBeenCalled()
    expect(bound()).toBe(0)
  })
})

describe('useTrimDrag following the pointer', () => {
  it('takes the start edge into the source, moving the clip with it', () => {
    const { result } = mountTrim()
    grabEdge(result, 'start')

    moveTo(2.5)

    expect(actions.updateClip).toHaveBeenCalledWith('clip1', {
      startTime: 0.5,
      timelinePosition: 2.5,
    })
    expect(theClip('clip1').duration).toBe(1.5)
  })

  it('will not take the start edge past the beginning of the source', () => {
    const { result } = mountTrim()
    grabEdge(result, 'start')

    moveTo(1)

    expect(actions.updateClip).toHaveBeenCalledWith('clip1', {
      startTime: 0,
      timelinePosition: 2,
    })
  })

  it('takes the end edge out into the rest of the source', () => {
    const { result } = mountTrim()
    grabEdge(result, 'end')

    moveTo(5)

    expect(actions.updateClip).toHaveBeenCalledWith('clip1', { endTime: 3 })
    expect(theClip('clip1').duration).toBe(3)
  })

  it('measures the start edge from where the gesture began, not from the last frame', () => {
    const { result } = mountTrim()
    grabEdge(result, 'start')

    moveTo(2.5)
    moveTo(2.25)

    expect(actions.updateClip).toHaveBeenLastCalledWith('clip1', {
      startTime: 0.25,
      timelinePosition: 2.25,
    })
  })

  it('writes nothing when the clip has no source to trim against', () => {
    act(() => {
      store().updateClip('clip1', { sourceVideoId: 'gone' })
    })
    const { result } = mountTrim()
    grabEdge(result, 'start')

    moveTo(2.5)

    expect(actions.updateClip).not.toHaveBeenCalled()
  })

  it('writes nothing once the track area has gone', () => {
    const { result } = mountTrim()
    grabEdge(result, 'start')
    containerRef.current = null

    moveTo(2.5)

    expect(actions.updateClip).not.toHaveBeenCalled()
  })

  it('writes nothing when the clip has left the timeline mid-trim', () => {
    const { result } = mountTrim()
    grabEdge(result, 'start')
    act(() => {
      store().removeClipFromTimeline('clip1')
    })

    moveTo(2.5)

    expect(actions.updateClip).not.toHaveBeenCalled()
  })
})

describe('useTrimDrag ripple', () => {
  it('closes the gap behind a shortened clip', () => {
    store().setActiveTool('ripple')
    const { result } = mountTrim()
    grabEdge(result, 'end')
    moveTo(5)

    release()

    // The clip's end moved from 4s to 5s, so everything after 4s follows it.
    expect(actions.shiftClipsAfter).toHaveBeenCalledWith(trackA, 4, 1)
    expect(theClip('clip2').timelinePosition).toBe(7)
  })

  it('shifts nothing when the trim left the clip’s length unchanged', () => {
    store().setActiveTool('ripple')
    const { result } = mountTrim()
    grabEdge(result, 'end')

    release()

    expect(actions.shiftClipsAfter).not.toHaveBeenCalled()
  })

  it('shifts nothing when the clip has left the timeline mid-trim', () => {
    store().setActiveTool('ripple')
    const { result } = mountTrim()
    grabEdge(result, 'end')
    moveTo(5)
    act(() => {
      store().removeClipFromTimeline('clip1')
    })

    release()

    expect(actions.shiftClipsAfter).not.toHaveBeenCalled()
    expect(result.current.trimState).toBeNull()
  })

  it('leaves the clips after a trim alone with any other tool', () => {
    const { result } = mountTrim()
    grabEdge(result, 'end')
    moveTo(5)

    release()

    expect(actions.shiftClipsAfter).not.toHaveBeenCalled()
    expect(theClip('clip2').timelinePosition).toBe(6)
  })
})
