// The clip drag's own lifecycle: what it binds, what it previews, what it commits.
//
// The component tests already drive this gesture through the rendered timeline.
// These watch the hook directly instead — the document listeners a drag needs
// (the pointer leaves the clip almost immediately) and has to give back, and the
// arithmetic of a preview position, which never reaches the store at all.
//
// The scene is the real store: a 60px-tall track A holding clip1 at 2s-4s and
// clip2 at 6s-8s, a track B below it, and a track container whose left edge is
// at client X 100. At 50px per second that makes the timeline's t=0 client X
// 100, so a pointer at 320 is over 4.4s. The store's actions are passed in
// through spies that call straight through, so every assertion can be made
// twice: the call the hook made, and what the store did with it.
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type React from 'react'
import { useClipDrag, type ClipDragDeps } from './useClipDrag'
import { useEditorStore } from '../../store/projectStore'
import { addClip, resetStoreForTest, store } from '../../test/fixtures/projectStore'
import { setRect } from '../../test/doubles/layout'

/** The timeline's default scale: one second is 50px at zoom 1. */
const PPS = 50
/** Client X of the track container's left edge — the timeline's t=0. */
const LEFT = 100
/** Where the pointer grabbed clip1, measured from the clip's own left edge. */
const GRAB = 20

let addListener: MockInstance
let removeListener: MockInstance
let container: HTMLDivElement
let containerRef: { current: HTMLDivElement | null }
let trackA: string
let trackB: string
let actions: Pick<
  ClipDragDeps,
  | 'setSelectedClipId'
  | 'toggleClipSelection'
  | 'moveSelectedClips'
  | 'setClipTimelinePosition'
  | 'moveClipToTrack'
  | 'splitClip'
>

beforeEach(() => {
  resetStoreForTest()
  addListener = vi.spyOn(document, 'addEventListener')
  removeListener = vi.spyOn(document, 'removeEventListener')

  trackA = useEditorStore.getState().project.timeline.tracks[0].id
  trackB = store().addTrack('Track 2').id
  addClip('clip1', 2, 2, trackA)
  addClip('clip2', 6, 2, trackA)

  container = document.createElement('div')
  setRect(container, { left: LEFT, top: 0, width: 800, height: 200 })
  for (const [id, top] of [[trackA, 0], [trackB, 60]] as const) {
    const row = document.createElement('div')
    row.setAttribute('data-track-id', id)
    setRect(row, { left: LEFT, top, width: 800, height: 60 })
    container.appendChild(row)
  }
  document.body.appendChild(container)
  containerRef = { current: container }

  const state = useEditorStore.getState()
  actions = {
    setSelectedClipId: vi.fn(state.setSelectedClipId),
    toggleClipSelection: vi.fn(state.toggleClipSelection),
    moveSelectedClips: vi.fn(state.moveSelectedClips),
    setClipTimelinePosition: vi.fn(state.setClipTimelinePosition),
    moveClipToTrack: vi.fn(state.moveClipToTrack),
    splitClip: vi.fn(state.splitClip),
  }
})

afterEach(() => {
  addListener.mockRestore()
  removeListener.mockRestore()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

/** The hook's inputs, read fresh from the store on every render. */
const deps = (): ClipDragDeps => {
  const state = useEditorStore.getState()
  return {
    trackContainerRef: containerRef,
    pixelsPerSecond: PPS,
    clips: state.project.timeline.clips,
    tracks: state.project.timeline.tracks,
    snapEnabled: state.snapEnabled,
    snapThreshold: state.snapThreshold,
    selectedClipIds: state.selectedClipIds,
    activeTool: state.activeTool,
    ...actions,
  }
}

/**
 * Mount the hook the way `Timeline` holds it: subscribed to the clips, so a
 * store write during a gesture re-renders and hands the effect a fresh closure
 * — which is what lets the release read what the moves wrote.
 */
const mountDrag = () =>
  renderHook(() => {
    useEditorStore((state) => state.project.timeline.clips)
    return useClipDrag(deps())
  })

/** How many mouse listeners the hook currently holds on the document. */
const isMouse = (call: unknown[]) => call[0] === 'mousemove' || call[0] === 'mouseup'
const bound = (): number =>
  addListener.mock.calls.filter(isMouse).length - removeListener.mock.calls.filter(isMouse).length

/** A stand-in for the clip element the gesture starts on, with a real box. */
function clipElement(timelinePosition: number, duration: number): HTMLDivElement {
  const el = document.createElement('div')
  setRect(el, {
    left: LEFT + timelinePosition * PPS,
    top: 0,
    width: duration * PPS,
    height: 60,
  })
  return el
}

/** A mousedown on a clip, at a client X. */
function press(el: HTMLElement, clientX: number, init: object = {}): React.MouseEvent {
  return {
    clientX,
    clientY: 10,
    ctrlKey: false,
    metaKey: false,
    currentTarget: el,
    target: el,
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
    ...init,
  } as unknown as React.MouseEvent
}

const move = (clientX: number, clientY = 10) =>
  act(() => {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY }))
  })

const release = (init: MouseEventInit = {}) =>
  act(() => {
    document.dispatchEvent(new MouseEvent('mouseup', init))
  })

/** Client X for a pointer that would put clip1's start at `seconds`. */
const pointerFor = (seconds: number) => LEFT + seconds * PPS + GRAB

/** Grab clip1 at `GRAB` px from its left edge and let the effect bind. */
function grabClip1(result: { current: ReturnType<typeof useClipDrag> }, init: object = {}) {
  const el = clipElement(2, 2)
  act(() => {
    result.current.handleClipMouseDown(press(el, LEFT + 2 * PPS + GRAB, init), theClip('clip1'))
  })
}

const theClip = (id: string) =>
  useEditorStore.getState().project.timeline.clips.find((c) => c.id === id)!

describe('useClipDrag starting a drag', () => {
  it('records where the pointer took hold of the clip', () => {
    const { result } = mountDrag()

    grabClip1(result)

    expect(result.current.dragState).toEqual({
      clipId: 'clip1',
      originalTrackId: trackA,
      originalPosition: 2,
      currentTrackId: trackA,
      currentPosition: 2,
      snappedPosition: null,
      offsetX: GRAB,
    })
  })

  it('binds the gesture to the document and gives it back on release', () => {
    const { result } = mountDrag()

    grabClip1(result)
    expect(bound()).toBe(2)

    release()

    expect(bound()).toBe(0)
    expect(result.current.dragState).toBeNull()
  })

  it('gives the listeners back when the timeline unmounts mid-drag', () => {
    const { result, unmount } = mountDrag()
    grabClip1(result)

    unmount()

    expect(bound()).toBe(0)
  })

  it('selects the clip it picked up', () => {
    const { result } = mountDrag()

    grabClip1(result)

    expect(actions.setSelectedClipId).toHaveBeenCalledWith('clip1')
    expect(useEditorStore.getState().selectedClipId).toBe('clip1')
  })

  it('leaves an existing multi-selection alone so the whole group can move', () => {
    store().selectClipsInRange(['clip1', 'clip2'])
    const { result } = mountDrag()

    grabClip1(result)

    expect(actions.setSelectedClipId).not.toHaveBeenCalled()
    expect(result.current.dragState?.clipId).toBe('clip1')
  })

  it('refuses to drag a clip on a locked track, having selected it', () => {
    store().updateTrack(trackA, { locked: true })
    const { result } = mountDrag()

    grabClip1(result)

    expect(actions.setSelectedClipId).toHaveBeenCalledWith('clip1')
    expect(result.current.dragState).toBeNull()
    expect(bound()).toBe(0)
  })

  it.each([
    ['ctrl', { ctrlKey: true }],
    ['cmd', { metaKey: true }],
  ])('toggles the selection instead of dragging on %s-click', (_name, modifier) => {
    const { result } = mountDrag()

    grabClip1(result, modifier)

    expect(actions.toggleClipSelection).toHaveBeenCalledWith('clip1')
    expect(actions.setSelectedClipId).not.toHaveBeenCalled()
    expect(result.current.dragState).toBeNull()
    expect(bound()).toBe(0)
  })
})

describe('useClipDrag razor tool', () => {
  beforeEach(() => {
    store().setActiveTool('razor')
  })

  it('splits the clip where it was clicked instead of dragging it', () => {
    const { result } = mountDrag()
    const el = clipElement(2, 2)

    // Client X 250 is 3s, one second into a clip that starts at 2s.
    act(() => {
      result.current.handleClipMouseDown(press(el, LEFT + 3 * PPS), theClip('clip1'))
    })

    expect(actions.splitClip).toHaveBeenCalledWith('clip1', 1)
    expect(useEditorStore.getState().project.timeline.clips).toHaveLength(3)
    expect(result.current.dragState).toBeNull()
    expect(bound()).toBe(0)
  })

  it('refuses a cut that would leave a sliver at the edge', () => {
    const { result } = mountDrag()
    const el = clipElement(2, 2)

    act(() => {
      result.current.handleClipMouseDown(press(el, LEFT + 2.05 * PPS), theClip('clip1'))
    })

    expect(actions.splitClip).not.toHaveBeenCalled()
  })

  it('refuses a cut on a locked track', () => {
    store().updateTrack(trackA, { locked: true })
    const { result } = mountDrag()
    const el = clipElement(2, 2)

    act(() => {
      result.current.handleClipMouseDown(press(el, LEFT + 3 * PPS), theClip('clip1'))
    })

    expect(actions.splitClip).not.toHaveBeenCalled()
  })

  it('refuses a cut with no track area mounted', () => {
    containerRef = { current: null }
    const { result } = mountDrag()
    const el = clipElement(2, 2)

    act(() => {
      result.current.handleClipMouseDown(press(el, LEFT + 3 * PPS), theClip('clip1'))
    })

    expect(actions.splitClip).not.toHaveBeenCalled()
  })
})

describe('useClipDrag following the pointer', () => {
  it('puts the clip where the pointer is, minus the grab offset', () => {
    store().setSnapEnabled(false)
    const { result } = mountDrag()
    grabClip1(result)

    move(pointerFor(4.4))

    expect(result.current.dragState?.currentPosition).toBe(4.4)
    expect(result.current.dragState?.snappedPosition).toBeNull()
  })

  it('never drags a clip back past the start of the timeline', () => {
    store().setSnapEnabled(false)
    const { result } = mountDrag()
    grabClip1(result)

    move(pointerFor(-1))

    expect(result.current.dragState?.currentPosition).toBe(0)
  })

  it('snaps the clip’s start to a neighbouring edge', () => {
    const { result } = mountDrag()
    grabClip1(result)

    // 5.9s is within the 10px (0.2s) threshold of clip2's start at 6s.
    move(pointerFor(5.9))

    expect(result.current.dragState?.currentPosition).toBe(6)
    expect(result.current.dragState?.snappedPosition).toBe(6)
  })

  it('snaps the clip’s end to a neighbouring edge', () => {
    const { result } = mountDrag()
    grabClip1(result)

    // 4.1s puts the 2s clip's end at 6.1s — within the threshold of clip2's start.
    move(pointerFor(4.1))

    expect(result.current.dragState?.currentPosition).toBe(4)
    expect(result.current.dragState?.snappedPosition).toBe(6)
  })

  it('leaves the position alone when no edge is within the threshold', () => {
    const { result } = mountDrag()
    grabClip1(result)

    move(pointerFor(4.4))

    expect(result.current.dragState?.currentPosition).toBe(4.4)
    expect(result.current.dragState?.snappedPosition).toBeNull()
  })

  it('does not snap to a clip that has left the timeline mid-drag', () => {
    const { result } = mountDrag()
    grabClip1(result)
    act(() => {
      store().removeClipFromTimeline('clip1')
    })

    move(pointerFor(5.9))

    expect(result.current.dragState?.currentPosition).toBe(5.9)
    expect(result.current.dragState?.snappedPosition).toBeNull()
  })

  it('takes the clip to the track row under the pointer', () => {
    const { result } = mountDrag()
    grabClip1(result)

    move(pointerFor(2), 80)

    expect(result.current.dragState?.currentTrackId).toBe(trackB)
  })

  it('keeps the current track when the pointer is past the last row', () => {
    const { result } = mountDrag()
    grabClip1(result)

    move(pointerFor(2), 180)

    expect(result.current.dragState?.currentTrackId).toBe(trackA)
  })

  it('ignores a move once the track area has gone', () => {
    const { result } = mountDrag()
    grabClip1(result)
    containerRef.current = null

    move(pointerFor(4.4))

    expect(result.current.dragState?.currentPosition).toBe(2)
  })

  // The release clears the drag state, but the effect that unbinds the listeners
  // only runs after the render that clears it — so a mousemove delivered in the
  // same batch still reaches the old handler. Its update has to be a no-op, not a
  // resurrection of the finished drag: hence `setDragState(prev => prev ? … : null)`
  // rather than a plain object. Both events go through one `act()` so they land in
  // one batch, which is what makes `prev` null by the time the updater runs.
  it('does not revive a finished drag when a move lands in the same batch as the release', () => {
    const { result } = mountDrag()
    grabClip1(result)

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: pointerFor(6), clientY: 10 }))
    })

    expect(result.current.dragState).toBeNull()
    expect(bound()).toBe(0)
    expect(theClip('clip1').timelinePosition).toBe(2)
  })
})

describe('useClipDrag committing', () => {
  it('writes the position the drag ended on', () => {
    store().setSnapEnabled(false)
    const { result } = mountDrag()
    grabClip1(result)
    move(pointerFor(4))

    release()

    expect(actions.setClipTimelinePosition).toHaveBeenCalledWith('clip1', 4)
    expect(theClip('clip1').timelinePosition).toBe(4)
    expect(actions.moveClipToTrack).not.toHaveBeenCalled()
  })

  it('moves the clip to the row it was dropped on, without moving it in time', () => {
    const { result } = mountDrag()
    grabClip1(result)
    move(pointerFor(2), 80)

    release()

    expect(actions.moveClipToTrack).toHaveBeenCalledWith('clip1', trackB)
    expect(theClip('clip1').trackId).toBe(trackB)
    expect(actions.setClipTimelinePosition).not.toHaveBeenCalled()
  })

  it('refuses a drop that would land on top of a neighbour', () => {
    store().setSnapEnabled(false)
    const { result } = mountDrag()
    grabClip1(result)
    move(pointerFor(7))

    release()

    expect(actions.setClipTimelinePosition).not.toHaveBeenCalled()
    expect(actions.moveClipToTrack).not.toHaveBeenCalled()
    expect(theClip('clip1').timelinePosition).toBe(2)
  })

  it('moves the whole selection when the dragged clip is part of one', () => {
    store().setSnapEnabled(false)
    store().selectClipsInRange(['clip1', 'clip2'])
    const { result } = mountDrag()
    grabClip1(result)
    move(pointerFor(4))

    release()

    expect(actions.moveSelectedClips).toHaveBeenCalledWith(2, 0)
    expect(actions.setClipTimelinePosition).not.toHaveBeenCalled()
    expect(theClip('clip1').timelinePosition).toBe(4)
    expect(theClip('clip2').timelinePosition).toBe(8)
  })

  it('commits nothing when the pointer never moved', () => {
    const { result } = mountDrag()
    grabClip1(result)

    release()

    expect(actions.setClipTimelinePosition).not.toHaveBeenCalled()
    expect(actions.moveClipToTrack).not.toHaveBeenCalled()
    expect(actions.moveSelectedClips).not.toHaveBeenCalled()
  })

  it('commits nothing when the clip has left the timeline mid-drag', () => {
    const { result } = mountDrag()
    grabClip1(result)
    move(pointerFor(4))
    act(() => {
      store().removeClipFromTimeline('clip1')
    })

    release()

    expect(actions.setClipTimelinePosition).not.toHaveBeenCalled()
    expect(result.current.dragState).toBeNull()
    expect(bound()).toBe(0)
  })
})
