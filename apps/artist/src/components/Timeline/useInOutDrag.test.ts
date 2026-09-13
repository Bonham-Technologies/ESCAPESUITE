// The in/out marker drags: one pair of listeners serving two handles.
//
// What matters here is which of the two points a gesture writes — the effect
// asks the flags, not the pointer, so grabbing the out handle must never move
// the in point — and that a release clears both, so the next mousemove writes
// nothing at all.
//
// The track container's left edge is at client X 100 and the scale is 50px per
// second, so client X 225 is 2.5s. The ruler stands 40px further right, which
// is how a fallback to it is told apart from a measurement against the track.
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type React from 'react'
import { useInOutDrag, type InOutDragDeps } from './useInOutDrag'
import { useEditorStore } from '../../store/projectStore'
import { resetStoreForTest } from '../../test/fixtures/projectStore'
import { setRect } from '../../test/doubles/layout'

/** The timeline's default scale: one second is 50px at zoom 1. */
const PPS = 50
/** Client X of the track container's left edge — the timeline's t=0. */
const LEFT = 100
/** Client X of the ruler's left edge: t=0 is 40px (0.8s) further right. */
const RULER_LEFT = 140
/** How long the scene is; both points are clamped to it. */
const DURATION = 10

let addListener: MockInstance
let removeListener: MockInstance
let containerRef: { current: HTMLDivElement | null }
let rulerRef: { current: HTMLDivElement | null }
let setInPoint: MockInstance
let setOutPoint: MockInstance

beforeEach(() => {
  resetStoreForTest()
  addListener = vi.spyOn(document, 'addEventListener')
  removeListener = vi.spyOn(document, 'removeEventListener')

  const container = document.createElement('div')
  setRect(container, { left: LEFT, top: 0, width: 800, height: 200 })
  const ruler = document.createElement('div')
  setRect(ruler, { left: RULER_LEFT, top: 0, width: 800, height: 24 })
  document.body.append(container, ruler)
  containerRef = { current: container }
  rulerRef = { current: ruler }

  const state = useEditorStore.getState()
  setInPoint = vi.fn(state.setInPoint)
  setOutPoint = vi.fn(state.setOutPoint)
})

afterEach(() => {
  addListener.mockRestore()
  removeListener.mockRestore()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

const deps = (): InOutDragDeps => ({
  trackContainerRef: containerRef,
  rulerRef,
  pixelsPerSecond: PPS,
  timelineDuration: DURATION,
  setInPoint: setInPoint as unknown as (time: number) => void,
  setOutPoint: setOutPoint as unknown as (time: number) => void,
})

const mountDrag = () => renderHook(() => useInOutDrag(deps()))

/** How many mouse listeners the hook currently holds on the document. */
const isMouse = (call: unknown[]) => call[0] === 'mousemove' || call[0] === 'mouseup'
const bound = (): number =>
  addListener.mock.calls.filter(isMouse).length - removeListener.mock.calls.filter(isMouse).length

/** A mousedown on one of the two handles. */
function grab(
  result: { current: ReturnType<typeof useInOutDrag> },
  handle: 'in' | 'out'
): MockInstance {
  const stopPropagation = vi.fn()
  const event = { stopPropagation } as unknown as React.MouseEvent
  act(() => {
    if (handle === 'in') result.current.handleInPointMouseDown(event)
    else result.current.handleOutPointMouseDown(event)
  })
  return stopPropagation
}

/** Move the pointer to a time on the timeline, as the track container measures it. */
const moveTo = (seconds: number) =>
  act(() => {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: LEFT + seconds * PPS }))
  })

const release = () =>
  act(() => {
    document.dispatchEvent(new MouseEvent('mouseup'))
  })

const points = () => {
  const state = useEditorStore.getState()
  return { inPoint: state.inPoint, outPoint: state.outPoint }
}

describe('useInOutDrag starting a drag', () => {
  it('binds nothing until a handle is grabbed', () => {
    mountDrag()

    expect(bound()).toBe(0)
  })

  it('takes hold of the document for the in handle, and keeps the click off the ruler', () => {
    const { result } = mountDrag()

    const stopPropagation = grab(result, 'in')

    expect(stopPropagation).toHaveBeenCalled()
    expect(bound()).toBe(2)
  })

  it('takes hold of the document for the out handle', () => {
    const { result } = mountDrag()

    const stopPropagation = grab(result, 'out')

    expect(stopPropagation).toHaveBeenCalled()
    expect(bound()).toBe(2)
  })

  it('gives the listeners back on release', () => {
    const { result } = mountDrag()
    grab(result, 'in')

    release()

    expect(bound()).toBe(0)
  })

  it('gives the listeners back when the timeline unmounts mid-drag', () => {
    const { result, unmount } = mountDrag()
    grab(result, 'out')

    unmount()

    expect(bound()).toBe(0)
  })
})

describe('useInOutDrag following the pointer', () => {
  it('writes the in point, and only the in point', () => {
    const { result } = mountDrag()
    grab(result, 'in')

    moveTo(2.5)

    expect(setInPoint).toHaveBeenCalledWith(2.5)
    expect(setOutPoint).not.toHaveBeenCalled()
    expect(points()).toEqual({ inPoint: 2.5, outPoint: null })
  })

  it('writes the out point, and only the out point', () => {
    const { result } = mountDrag()
    grab(result, 'out')

    moveTo(7)

    expect(setOutPoint).toHaveBeenCalledWith(7)
    expect(setInPoint).not.toHaveBeenCalled()
    expect(points()).toEqual({ inPoint: null, outPoint: 7 })
  })

  it('accounts for what is scrolled out of view to the left', () => {
    containerRef.current!.scrollLeft = 100 // two seconds
    const { result } = mountDrag()
    grab(result, 'in')

    moveTo(2.5)

    expect(setInPoint).toHaveBeenCalledWith(4.5)
  })

  it('clamps a marker to the timeline at both ends', () => {
    const { result } = mountDrag()
    grab(result, 'in')

    moveTo(-4)
    expect(setInPoint).toHaveBeenLastCalledWith(0)

    moveTo(DURATION + 4)
    expect(setInPoint).toHaveBeenLastCalledWith(DURATION)
  })

  it('measures against the ruler when there is no track area', () => {
    containerRef.current = null
    const { result } = mountDrag()
    grab(result, 'in')

    // Client X 225 is 2.5s from the track container's edge, but the ruler
    // starts 40px later, so the same pointer is 0.8s earlier on it.
    moveTo(2.5)

    expect(setInPoint).toHaveBeenCalledWith(1.7)
  })

  it('writes nothing when neither the track area nor the ruler is there', () => {
    const { result } = mountDrag()
    grab(result, 'in')
    containerRef.current = null
    rulerRef.current = null

    moveTo(2.5)

    expect(setInPoint).not.toHaveBeenCalled()
  })

  it('writes nothing for a pointer that moves with no handle held', () => {
    mountDrag()

    moveTo(2.5)

    expect(setInPoint).not.toHaveBeenCalled()
    expect(setOutPoint).not.toHaveBeenCalled()
  })

  it('stops writing once the pointer has come up', () => {
    const { result } = mountDrag()
    grab(result, 'out')
    moveTo(7)

    release()
    moveTo(3)

    expect(setOutPoint).toHaveBeenCalledTimes(1)
    expect(points().outPoint).toBe(7)
  })
})
