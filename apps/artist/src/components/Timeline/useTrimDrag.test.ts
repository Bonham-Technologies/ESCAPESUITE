// The trim gesture's lifecycle: what it binds, what it writes, what it ripples.
//
// A trim differs from a clip drag in that it commits continuously — every
// mousemove is a store write — so these tests watch `updateClip` rather than a
// preview, and they watch that the origin recorded on mousedown is what the
// arithmetic measures against, not the clip's live values.
//
// The trailing `skipHistory` those argument assertions carry is ESCSUITE-77's:
// the gesture's first write pushes the undo entry (`false`) and every write
// after it skips (`true`), so a whole trim is one undo step. The last describe
// block below is the rule itself.
//
// The scene is the real store: clip1 on track A, at 2s on the timeline, playing
// the first two seconds of a 30s source. The track container's left edge is at
// client X 100 and the scale is 50px per second, so client X 225 is 2.5s.
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type React from 'react'
import { useTrimDrag, type TrimDragDeps } from './useTrimDrag'
import { useEditorStore } from '../../store/projectStore'
import { addClip, resetStoreForTest, store, video } from '../../test/fixtures/projectStore'
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
      origin: { startTime: 0, endTime: 2, timelinePosition: 2 },
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
    }, false)
    expect(theClip('clip1').duration).toBe(1.5)
  })

  it('will not take the start edge past the beginning of the source', () => {
    const { result } = mountTrim()
    grabEdge(result, 'start')

    moveTo(1)

    expect(actions.updateClip).toHaveBeenCalledWith('clip1', {
      startTime: 0,
      timelinePosition: 2,
    }, false)
  })

  it('takes the end edge out into the rest of the source', () => {
    const { result } = mountTrim()
    grabEdge(result, 'end')

    moveTo(5)

    expect(actions.updateClip).toHaveBeenCalledWith('clip1', { endTime: 3 }, false)
    expect(theClip('clip1').duration).toBe(3)
  })

  it('measures the start edge from where the gesture began, not from the last frame', () => {
    const { result } = mountTrim()
    grabEdge(result, 'start')

    moveTo(2.5)
    moveTo(2.25)

    // The second write of the gesture, so it skips history — the first one
    // pushed the entry the whole trim undoes to.
    expect(actions.updateClip).toHaveBeenLastCalledWith('clip1', {
      startTime: 0.25,
      timelinePosition: 2.25,
    }, true)
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
  it('pushes the clips after a lengthened clip out of its way', () => {
    store().setActiveTool('ripple')
    const { result } = mountTrim()
    grabEdge(result, 'end')
    moveTo(5)

    release()

    // The clip's end moved from 4s to 5s, so everything after 4s follows it.
    // `true`: the shift is part of the trim that produced it, whose first
    // mousemove already pushed the entry both halves undo to (ESCSUITE-77).
    expect(actions.shiftClipsAfter).toHaveBeenCalledWith(trackA, 4, 1, true)
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

describe('useTrimDrag and the undo stack', () => {
  /** How many undo entries the stack holds right now. */
  const past = () => useEditorStore.getState().history.past.length

  it('records one entry for a whole trim, not one per mousemove', () => {
    const { result } = mountTrim()
    grabEdge(result, 'end')
    const before = past()

    for (const seconds of [4.2, 4.4, 4.6, 4.8, 5]) moveTo(seconds)
    release()

    // The trim really ran, all five moves of it — otherwise "one entry" would
    // pass by writing nothing at all.
    expect(actions.updateClip).toHaveBeenCalledTimes(5)
    expect(theClip('clip1').endTime).toBe(3)
    expect(past() - before).toBe(1)
  })

  it('pushes on the first write of the gesture and skips every one after it', () => {
    const { result } = mountTrim()
    grabEdge(result, 'end')

    moveTo(4.5)
    moveTo(5)

    expect(actions.updateClip).toHaveBeenNthCalledWith(1, 'clip1', { endTime: 2.5 }, false)
    expect(actions.updateClip).toHaveBeenNthCalledWith(2, 'clip1', { endTime: 3 }, true)
  })

  it('undoes the whole trim, back to the in and out points it started at', () => {
    const { result } = mountTrim()
    grabEdge(result, 'start')

    moveTo(2.5)
    moveTo(3)
    release()
    expect(theClip('clip1')).toMatchObject({ startTime: 1, timelinePosition: 3 })

    store().undo()

    // The entry was captured before the first write, so one undo lands on the
    // clip as it was grabbed and not on the last frame the drag passed through.
    expect(theClip('clip1')).toMatchObject({ startTime: 0, endTime: 2, timelinePosition: 2 })
  })

  it('records two entries for two separate trims', () => {
    const { result } = mountTrim()
    const before = past()

    grabEdge(result, 'end')
    for (const seconds of [4.2, 4.4, 4.5]) moveTo(seconds)
    release()
    grabEdge(result, 'end')
    for (const seconds of [4.7, 4.9, 5]) moveTo(seconds)
    release()

    expect(theClip('clip1').endTime).toBe(3)
    expect(past() - before).toBe(2)
  })

  it('records one entry for a ripple trim, the downstream shift included', () => {
    store().setActiveTool('ripple')
    const { result } = mountTrim()
    grabEdge(result, 'end')
    const before = past()

    for (const seconds of [4.2, 4.4, 4.6, 4.8, 5]) moveTo(seconds)
    release()

    // Both halves of the gesture really happened: the clip grew and the clip
    // behind it moved out of the way.
    expect(theClip('clip1').endTime).toBe(3)
    expect(theClip('clip2').timelinePosition).toBe(7)
    expect(past() - before).toBe(1)

    store().undo()

    // One Ctrl+Z, and neither half is left behind. The release's
    // `shiftClipsAfter` used to push an entry of its own, so the first undo slid
    // the downstream clips back and left the clip trimmed — a state the user had
    // never seen.
    expect(theClip('clip1')).toMatchObject({ endTime: 2, timelinePosition: 2 })
    expect(theClip('clip2').timelinePosition).toBe(6)
  })

  it('hands the first-write slot on when the opening move is refused', () => {
    // An image clip's end trim is refused below MIN_CLIP_DURATION, so the first
    // move of this gesture writes nothing at all. The flag is decided where the
    // write happens rather than at the move that asks for one, so the write that
    // does land is still the gesture's first and still pushes — a trim whose
    // opening move was rejected must stay undoable.
    store().addSourceVideo({ ...video, id: 'still', mediaType: 'image' })
    store().updateClip('clip1', { sourceVideoId: 'still' })
    const { result } = mountTrim()
    grabEdge(result, 'end')
    const before = past()

    moveTo(2.05)
    moveTo(5)
    release()

    expect(actions.updateClip).toHaveBeenCalledTimes(1)
    expect(actions.updateClip).toHaveBeenCalledWith('clip1', { duration: 3, endTime: 3 }, false)
    expect(past() - before).toBe(1)
  })
})
