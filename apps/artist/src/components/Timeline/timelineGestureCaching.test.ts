// What the three churning gestures cache, and what makes them look again.
//
// `useClipDrag`, `useTrimDrag` and `useTimelineMarquee` measure the track area
// once, on the mousedown, and read nothing from layout per pointer frame
// (`timelineGestures.perf.test.ts` counts that). The risk that buys is
// staleness: a mid-gesture scroll or a resize moves the container out from
// under a measurement the gesture is still using, and a clip lands on the wrong
// track. These tests drive exactly that.
//
// They also cover the other edge the single-listener rewrite created: the
// mouseup ends the gesture, but the effect that unbinds the pair only runs
// after the render that ends it — so a mousemove delivered in the same batch
// still reaches a handler whose gesture is already over, and has to do nothing.
// `useClipDrag.test.ts` already pins that for the drag; this file pins it for
// the trim and the marquee.
//
// The scene is the real store, laid out the way `useClipDrag.test.ts` lays it
// out: a container whose left edge is at client X 100, 50px per second, and two
// 60px track rows stacked inside it.
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type React from 'react'
import { useClipDrag, type ClipDragDeps } from './useClipDrag'
import { useTimelineMarquee, type TimelineMarqueeDeps } from './useTimelineMarquee'
import { useTrimDrag, type TrimDragDeps } from './useTrimDrag'
import { useEditorStore } from '../../store/projectStore'
import { addClip, resetStoreForTest, store } from '../../test/fixtures/projectStore'
import { setRect } from '../../test/doubles/layout'

/** The timeline's default scale: one second is 50px at zoom 1. */
const PPS = 50
/** Client X of the track container's left edge — the timeline's t=0. */
const LEFT = 100
const ROW_HEIGHT = 60

let container: HTMLDivElement
let containerRef: { current: HTMLDivElement | null }
let trackA: string
let trackB: string
let addListener: MockInstance
let removeListener: MockInstance
let addWindowListener: MockInstance
let removeWindowListener: MockInstance

/**
 * How many invalidation listeners are still out there.
 *
 * `timelineGestures.perf.test.ts`'s conservation law filters to
 * `mousemove`/`mouseup`, so it says nothing about the `scroll` and `resize`
 * pair the track-area cache adds. This closes that gap at the gesture level:
 * `useTrackAreaCache.test.ts` proves the cache balances its own listeners, and
 * this proves a real drag drives it to zero.
 */
function invalidationListeners(): { scroll: number; resize: number } {
  const count = (spy: MockInstance, type: string) =>
    spy.mock.calls.filter((call) => call[0] === type).length
  return {
    scroll: count(addListener, 'scroll') - count(removeListener, 'scroll'),
    resize: count(addWindowListener, 'resize') - count(removeWindowListener, 'resize'),
  }
}

/**
 * Put the container's top edge at `top` on screen, with its two rows stacked
 * below it. Re-run mid-gesture, this is a page scroll or a panel resize: the
 * rows are somewhere else now, and anything holding the old numbers is wrong.
 */
function layOut(top: number): void {
  setRect(container, { left: LEFT, top, width: 800, height: ROW_HEIGHT * 2 })
  const rows = [...container.querySelectorAll('[data-track-id]')]
  rows.forEach((row, i) => {
    setRect(row, { left: LEFT, top: top + i * ROW_HEIGHT, width: 800, height: ROW_HEIGHT })
  })
}

beforeEach(() => {
  addListener = vi.spyOn(document, 'addEventListener')
  removeListener = vi.spyOn(document, 'removeEventListener')
  addWindowListener = vi.spyOn(window, 'addEventListener')
  removeWindowListener = vi.spyOn(window, 'removeEventListener')

  resetStoreForTest()
  trackA = useEditorStore.getState().project.timeline.tracks[0].id
  trackB = store().addTrack('Track 2').id
  addClip('clip1', 2, 2, trackA)

  container = document.createElement('div')
  for (const id of [trackA, trackB]) {
    const row = document.createElement('div')
    row.setAttribute('data-track-id', id)
    container.appendChild(row)
  }
  document.body.appendChild(container)
  layOut(0)
  containerRef = { current: container }
})

afterEach(() => {
  addListener.mockRestore()
  removeListener.mockRestore()
  addWindowListener.mockRestore()
  removeWindowListener.mockRestore()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

const move = (clientX: number, clientY = 10) =>
  act(() => {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY }))
  })

const release = () =>
  act(() => {
    document.dispatchEvent(new MouseEvent('mouseup'))
  })

/** A synthetic React mouse event on `element`, at a client point. */
function press(element: HTMLElement, clientX: number, clientY: number): React.MouseEvent {
  return {
    clientX,
    clientY,
    ctrlKey: false,
    metaKey: false,
    currentTarget: element,
    target: element,
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
  } as unknown as React.MouseEvent
}

const theClip = (id: string) =>
  useEditorStore.getState().project.timeline.clips.find((c) => c.id === id)!

/** A stand-in for the clip element the gesture starts on, with a real box. */
function clipElement(timelinePosition: number, duration: number): HTMLDivElement {
  const el = document.createElement('div')
  setRect(el, {
    left: LEFT + timelinePosition * PPS,
    top: 0,
    width: duration * PPS,
    height: ROW_HEIGHT,
  })
  return el
}

describe('a clip drag that is scrolled out from under', () => {
  const deps = (): ClipDragDeps => {
    const state = useEditorStore.getState()
    return {
      trackContainerRef: containerRef,
      pixelsPerSecond: PPS,
      clips: state.project.timeline.clips,
      tracks: state.project.timeline.tracks,
      snapEnabled: false,
      snapThreshold: state.snapThreshold,
      selectedClipIds: state.selectedClipIds,
      activeTool: state.activeTool,
      setSelectedClipId: state.setSelectedClipId,
      toggleClipSelection: state.toggleClipSelection,
      moveSelectedClips: state.moveSelectedClips,
      setClipTimelinePosition: state.setClipTimelinePosition,
      moveClipToTrack: state.moveClipToTrack,
      splitClip: state.splitClip,
    }
  }

  const grab = () => {
    const hook = renderHook(() => {
      useEditorStore((state) => state.project.timeline.clips)
      return useClipDrag(deps())
    })
    act(() => {
      hook.result.current.handleClipMouseDown(
        press(clipElement(2, 2), LEFT + 2 * PPS, 10),
        theClip('clip1')
      )
    })
    return hook
  }

  it('drops the clip on the row the pointer is really over after a scroll', () => {
    const { result } = grab()

    // Before the scroll, client Y 10 is over track A's row (0–60).
    move(LEFT + 2 * PPS, 10)
    expect(result.current.dragState?.currentTrackId).toBe(trackA)

    // The panel scrolls 100px: the rows are now at −100 and −40, so client Y 10
    // is over track B. `scroll` does not bubble, so only a capture-phase
    // listener hears this one.
    layOut(-100)
    act(() => {
      container.dispatchEvent(new Event('scroll'))
    })
    move(LEFT + 2 * PPS, 10)

    expect(result.current.dragState?.currentTrackId).toBe(trackB)

    release()

    expect(theClip('clip1').trackId).toBe(trackB)
  })

  it('leaves no invalidation listener behind when the drag is released', () => {
    const { result } = grab()
    move(LEFT + 3 * PPS, 10)
    expect(invalidationListeners()).toEqual({ scroll: 1, resize: 1 })

    release()

    expect(result.current.dragState).toBeNull()
    expect(invalidationListeners()).toEqual({ scroll: 0, resize: 0 })
  })

  it('leaves no invalidation listener behind when the timeline unmounts mid-drag', () => {
    const { unmount } = grab()
    move(LEFT + 3 * PPS, 10)
    expect(invalidationListeners()).toEqual({ scroll: 1, resize: 1 })

    unmount()

    expect(invalidationListeners()).toEqual({ scroll: 0, resize: 0 })
  })

  it('follows the pointer in time after a resize moves the left edge', () => {
    const { result } = grab()

    move(LEFT + 4 * PPS, 10)
    expect(result.current.dragState?.currentPosition).toBe(4)

    // The timeline panel is 50px narrower on the left, so the same client X is
    // one second further into the timeline.
    setRect(container, { left: LEFT - 50, top: 0, width: 850, height: ROW_HEIGHT * 2 })
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    move(LEFT + 4 * PPS, 10)

    expect(result.current.dragState?.currentPosition).toBe(5)
  })
})

describe('a trim whose last move lands after the release', () => {
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
      updateClip: state.updateClip,
      shiftClipsAfter: state.shiftClipsAfter,
    }
  }

  it('writes nothing for a move batched with the mouseup', () => {
    // Spied *before* the render: `deps()` reads `updateClip` off the store on
    // every render, so a spy installed after the mousedown would never be the
    // function the handler holds and the assertion below would pass whatever
    // the handler did.
    const updateClip = vi.spyOn(useEditorStore.getState(), 'updateClip')
    const { result } = renderHook(() => {
      useEditorStore((state) => state.project.timeline.clips)
      return useTrimDrag(deps())
    })
    act(() => {
      result.current.handleTrimMouseDown(
        press(clipElement(2, 2), LEFT + 4 * PPS, 10),
        theClip('clip1'),
        'end'
      )
    })

    // One ordinary move first, so the spy is proved to be the function the
    // handler actually calls — otherwise "not called again" below would be
    // satisfied by a spy nothing was ever wired to.
    move(LEFT + 5 * PPS)
    expect(updateClip).toHaveBeenCalledTimes(1)
    expect(theClip('clip1').duration).toBe(3)

    // Both events go through one `act()` so they land in one batch, which is
    // what leaves the listeners bound for the move that follows the release.
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: LEFT + 6 * PPS }))
    })

    expect(updateClip).toHaveBeenCalledTimes(1)
    expect(result.current.trimState).toBeNull()
    expect(theClip('clip1').duration).toBe(3)
  })
})

describe('a marquee whose last move lands after the release', () => {
  const deps = (): TimelineMarqueeDeps => {
    const state = useEditorStore.getState()
    return {
      trackContainerRef: containerRef,
      pixelsPerSecond: PPS,
      clips: state.project.timeline.clips,
      selectedClipIds: state.selectedClipIds,
      selectClipsInRange: state.selectClipsInRange,
      isDraggingPlayhead: false,
      dragState: null,
      marqueeJustFinished: { current: false },
    }
  }

  it('does not redraw a rectangle the mouseup has already put away', () => {
    const { result } = renderHook(() => {
      useEditorStore((state) => state.selectedClipIds)
      return useTimelineMarquee(deps())
    })
    act(() => {
      result.current.handleTrackMouseDown(press(container, LEFT + 50, 10))
    })

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: LEFT + 300, clientY: 30 }))
    })

    expect(result.current.marquee).toEqual({ start: null, current: null, active: false })
  })
})
