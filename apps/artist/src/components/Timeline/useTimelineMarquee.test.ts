// The rubber band: when it appears, what it sweeps up, and what it leaves behind.
//
// The gesture is deliberately ambiguous until the pointer has travelled, so
// these tests drive both endings — a press that becomes a rectangle and selects,
// and a press that stays a click and selects nothing while telling `Timeline`'s
// click handler to carry on.
//
// The scene is the real store, with a track container at client (100, 0) that is
// 800x200 and two 60px track rows stacked inside it: track A across the top, B
// below. At 50px per second, client X 150 is 1s and client X 300 is 4s. Track A
// holds clip1 (1s-3s) and clip4 (4s-6s); track B holds clip2 (1s-3s); clip3 sits
// far down the timeline at 10s, where no marquee here reaches it.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock, type MockInstance } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type React from 'react'
import { useTimelineMarquee, type TimelineMarqueeDeps } from './useTimelineMarquee'
import { useEditorStore } from '../../store/projectStore'
import { addClip, resetStoreForTest, store } from '../../test/fixtures/projectStore'
import { setRect } from '../../test/doubles/layout'
import type { DragState } from './types'

/** The timeline's default scale: one second is 50px at zoom 1. */
const PPS = 50
/** Client X of the track container's left edge — the timeline's t=0. */
const LEFT = 100

let addListener: MockInstance
let removeListener: MockInstance
let container: HTMLDivElement
let containerRef: { current: HTMLDivElement | null }
let marqueeJustFinished: { current: boolean }
let selectClipsInRange: Mock<(clipIds: string[]) => void>
let trackA: string
let trackB: string
let isDraggingPlayhead: boolean
let dragState: DragState | null

beforeEach(() => {
  resetStoreForTest()
  addListener = vi.spyOn(document, 'addEventListener')
  removeListener = vi.spyOn(document, 'removeEventListener')

  trackA = useEditorStore.getState().project.timeline.tracks[0].id
  trackB = store().addTrack('Track 2').id
  addClip('clip1', 1, 2, trackA)
  addClip('clip2', 1, 2, trackB)
  addClip('clip3', 10, 2, trackA)
  addClip('clip4', 4, 2, trackA)

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

  marqueeJustFinished = { current: false }
  selectClipsInRange = vi.fn(useEditorStore.getState().selectClipsInRange)
  isDraggingPlayhead = false
  dragState = null
})

afterEach(() => {
  addListener.mockRestore()
  removeListener.mockRestore()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

/** The hook's inputs, read fresh from the store on every render. */
const deps = (): TimelineMarqueeDeps => {
  const state = useEditorStore.getState()
  return {
    trackContainerRef: containerRef,
    pixelsPerSecond: PPS,
    clips: state.project.timeline.clips,
    selectedClipIds: state.selectedClipIds,
    selectClipsInRange,
    isDraggingPlayhead,
    dragState,
    marqueeJustFinished,
  }
}

/**
 * Mount the hook the way `Timeline` holds it: subscribed to the clips, so a
 * store write during a gesture re-renders and hands the effect a fresh closure.
 */
const mountMarquee = () =>
  renderHook(() => {
    useEditorStore((state) => state.project.timeline.clips)
    return useTimelineMarquee(deps())
  })

/** How many mouse listeners the hook currently holds on the document. */
const isMouse = (call: unknown[]) => call[0] === 'mousemove' || call[0] === 'mouseup'
const bound = (): number =>
  addListener.mock.calls.filter(isMouse).length - removeListener.mock.calls.filter(isMouse).length

/** An element inside the track container, for a mousedown to land on. */
function targetIn(attribute?: string): HTMLDivElement {
  const el = document.createElement('div')
  if (attribute) el.setAttribute(attribute, 'yes')
  container.appendChild(el)
  return el
}

function press(clientX: number, clientY: number, target: HTMLElement): React.MouseEvent {
  return {
    clientX,
    clientY,
    target,
    currentTarget: container,
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
  } as unknown as React.MouseEvent
}

/** Press on empty track space at (150, 10) — container-relative (50, 10). */
function startMarquee(result: { current: ReturnType<typeof useTimelineMarquee> }) {
  const target = targetIn()
  act(() => {
    result.current.handleTrackMouseDown(press(150, 10, target))
  })
}

const move = (clientX: number, clientY: number) =>
  act(() => {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY }))
  })

const release = (init: MouseEventInit = {}) =>
  act(() => {
    document.dispatchEvent(new MouseEvent('mouseup', init))
  })

describe('useTimelineMarquee starting', () => {
  it('records the press without drawing a rectangle yet', () => {
    const { result } = mountMarquee()

    startMarquee(result)

    expect(result.current.marquee).toEqual({ start: { x: 50, y: 10 }, current: null, active: false })
    expect(bound()).toBe(2)
  })

  it.each([
    ['a clip', 'data-clip-id'],
    ['the playhead', 'data-playhead'],
  ])('refuses to start on %s', (_name, attribute) => {
    const { result } = mountMarquee()
    const target = targetIn(attribute)

    act(() => {
      result.current.handleTrackMouseDown(press(150, 10, target))
    })

    expect(result.current.marquee.start).toBeNull()
    expect(bound()).toBe(0)
  })

  it('refuses to start while the playhead is being dragged', () => {
    isDraggingPlayhead = true
    const { result } = mountMarquee()

    startMarquee(result)

    expect(result.current.marquee.start).toBeNull()
  })

  it('refuses to start while a clip is being dragged', () => {
    dragState = {
      clipId: 'clip1',
      originalTrackId: trackA,
      originalPosition: 1,
      currentTrackId: trackA,
      currentPosition: 1,
      snappedPosition: null,
      offsetX: 0,
    }
    const { result } = mountMarquee()

    startMarquee(result)

    expect(result.current.marquee.start).toBeNull()
  })

  it('refuses to start with no track area mounted', () => {
    containerRef = { current: null }
    const { result } = mountMarquee()
    const target = targetIn()

    act(() => {
      result.current.handleTrackMouseDown(press(150, 10, target))
    })

    expect(result.current.marquee.start).toBeNull()
  })
})

describe('useTimelineMarquee drawing', () => {
  it('stays a click until the pointer has travelled far enough', () => {
    const { result } = mountMarquee()
    startMarquee(result)

    move(153, 12)

    expect(result.current.marquee.current).toBeNull()
    expect(result.current.marquee.active).toBe(false)
  })

  it('becomes a rectangle once the pointer clears the threshold', () => {
    const { result } = mountMarquee()
    startMarquee(result)

    move(300, 30)

    expect(result.current.marquee.current).toEqual({ x: 200, y: 30 })
    expect(result.current.marquee.active).toBe(true)
  })

  it('ignores a move once the track area has gone', () => {
    const { result } = mountMarquee()
    startMarquee(result)
    containerRef.current = null

    move(300, 30)

    expect(result.current.marquee.active).toBe(false)
  })
})

describe('useTimelineMarquee selecting', () => {
  it('selects the clips the rectangle covers, on the rows it spans', () => {
    const { result } = mountMarquee()
    startMarquee(result)
    move(300, 30)

    release()

    expect(selectClipsInRange).toHaveBeenCalledWith(['clip1'])
    expect(useEditorStore.getState().selectedClipIds).toEqual(new Set(['clip1']))
    expect(marqueeJustFinished.current).toBe(true)
    expect(result.current.marquee).toEqual({ start: null, current: null, active: false })
    expect(bound()).toBe(0)
  })

  it('reaches on to a second row when the rectangle is tall enough', () => {
    const { result } = mountMarquee()
    startMarquee(result)

    move(300, 100)
    release()

    expect(selectClipsInRange).toHaveBeenCalledWith(['clip1', 'clip2'])
  })

  it('counts what is scrolled out of view to the left', () => {
    container.scrollLeft = 100
    const { result } = mountMarquee()
    startMarquee(result)

    move(300, 30)
    release()

    // 50px-200px of a container scrolled 100px right is 3s-6s: clip4, not clip1.
    expect(selectClipsInRange).toHaveBeenCalledWith(['clip4'])
  })

  it('adds to the existing selection on ctrl/cmd-release', () => {
    store().selectClipsInRange(['clip3'])
    const { result } = mountMarquee()
    startMarquee(result)

    move(300, 30)
    release({ ctrlKey: true })

    expect(selectClipsInRange).toHaveBeenLastCalledWith(['clip3', 'clip1'])
  })

  it('selects nothing when the press never became a rectangle', () => {
    const { result } = mountMarquee()
    startMarquee(result)

    release()

    expect(selectClipsInRange).not.toHaveBeenCalled()
    expect(marqueeJustFinished.current).toBe(false)
    expect(result.current.marquee.start).toBeNull()
    expect(bound()).toBe(0)
  })

  it('gives the listeners back when the timeline unmounts mid-marquee', () => {
    const { result, unmount } = mountMarquee()
    startMarquee(result)
    move(300, 30)

    unmount()

    expect(bound()).toBe(0)
  })

  // ESCSUITE-168 (U1): a release outside the track container fires no click on
  // it, so `useTimelineSeek`'s handler — the only thing that used to clear the
  // flag — never runs for this gesture. Left set, it would swallow the user's
  // next, unrelated click on bare track. The fix consumes the very next click
  // anywhere, the moment it happens, rather than waiting for one that lands on
  // the container. (jsdom cannot synthesise a click from a mouseup the way a
  // real browser would, so this releases on `document` and never dispatches a
  // click on the container at all — as close as a unit test gets to "the
  // release landed outside it" (ESCSUITE-168 review, NIT 7).)
  it('clears the flag on the next click anywhere, not only on one that lands on the track container', () => {
    const { result } = mountMarquee()
    startMarquee(result)
    move(300, 30)

    release()
    expect(marqueeJustFinished.current).toBe(true)

    document.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(marqueeJustFinished.current).toBe(false)
  })

  // ESCSUITE-168 review, MINOR 3: the one-shot `click` listener armed above has
  // no cleanup of its own. If the timeline unmounts between the release and
  // the next click (a project load that empties it, an undo back past "no
  // clips"), the listener used to outlive the component and later write into
  // an orphaned ref.
  it('gives back the pending one-shot click listener if the timeline unmounts before the next click', () => {
    const { result, unmount } = mountMarquee()
    startMarquee(result)
    move(300, 30)
    release()
    expect(marqueeJustFinished.current).toBe(true)

    unmount()

    expect(removeListener.mock.calls.some((call) => call[0] === 'click')).toBe(true)
  })

  // The other arm of that same cleanup: a timeline that unmounts with nothing
  // armed (no marquee ever completed) asks for no removal at all — every other
  // unmount case in this file is exactly that, so this just names it.
  it('asks for no click-listener removal when nothing was ever armed', () => {
    const { unmount } = mountMarquee()

    unmount()

    expect(removeListener.mock.calls.some((call) => call[0] === 'click')).toBe(false)
  })

  // ESCSUITE-168 review, NIT 7: the one-shot listener closes the common case,
  // but a gesture whose terminal click never fires at all — its mousedown
  // target removed from the tree before the mouseup, which a real browser then
  // dispatches no click for — would still leave the flag set, and the user's
  // next real click would still be swallowed, since `handleTrackClick` reads
  // the flag before the (never-fired) one-shot could clear it. By the time
  // another mousedown starts a new gesture, this gesture's own click has
  // either already fired or never will, so it is always safe to clear a
  // leftover flag there too.
  it('clears a leftover flag at the start of the next gesture, in case the previous terminal click never fired', () => {
    const { result } = mountMarquee()
    // Simulates the residual: a flag left set with no click ever following it.
    marqueeJustFinished.current = true

    startMarquee(result)

    expect(marqueeJustFinished.current).toBe(false)
  })
})
