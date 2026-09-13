// The playhead scrub's lifecycle: what it binds, what it writes, when it stops.
//
// A scrub has no preview and nothing to commit — the store's `currentTime` is
// the thing being dragged — so these tests watch `setCurrentTime` and the
// document listeners, and they watch that `isDraggingPlayhead` goes back down
// on release, because the marquee and the track click both refuse to act while
// it is up.
//
// The track container's left edge is at client X 100 and the scale is 50px per
// second, so client X 225 is 2.5s. The timeline is 10s long.
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type React from 'react'
import { usePlayheadDrag, type PlayheadDragDeps } from './usePlayheadDrag'
import { useEditorStore } from '../../store/projectStore'
import { resetStoreForTest } from '../../test/fixtures/projectStore'
import { setRect } from '../../test/doubles/layout'

/** The timeline's default scale: one second is 50px at zoom 1. */
const PPS = 50
/** Client X of the track container's left edge — the timeline's t=0. */
const LEFT = 100
/** How long the scene is; the scrub is clamped to it. */
const DURATION = 10

let addListener: MockInstance
let removeListener: MockInstance
let containerRef: { current: HTMLDivElement | null }
let setCurrentTime: MockInstance

beforeEach(() => {
  resetStoreForTest()
  addListener = vi.spyOn(document, 'addEventListener')
  removeListener = vi.spyOn(document, 'removeEventListener')

  const container = document.createElement('div')
  setRect(container, { left: LEFT, top: 0, width: 800, height: 200 })
  document.body.appendChild(container)
  containerRef = { current: container }

  setCurrentTime = vi.fn(useEditorStore.getState().setCurrentTime)
})

afterEach(() => {
  addListener.mockRestore()
  removeListener.mockRestore()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

const deps = (): PlayheadDragDeps => ({
  trackContainerRef: containerRef,
  pixelsPerSecond: PPS,
  timelineDuration: DURATION,
  setCurrentTime: setCurrentTime as unknown as (time: number) => void,
})

const mountScrub = () => renderHook(() => usePlayheadDrag(deps()))

/** How many mouse listeners the hook currently holds on the document. */
const isMouse = (call: unknown[]) => call[0] === 'mousemove' || call[0] === 'mouseup'
const bound = (): number =>
  addListener.mock.calls.filter(isMouse).length - removeListener.mock.calls.filter(isMouse).length

/** A mousedown on the playhead handle. */
function grab(result: { current: ReturnType<typeof usePlayheadDrag> }): MockInstance {
  const stopPropagation = vi.fn()
  act(() => {
    result.current.handlePlayheadMouseDown({ stopPropagation } as unknown as React.MouseEvent)
  })
  return stopPropagation
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

const currentTime = () => useEditorStore.getState().currentTime

describe('usePlayheadDrag starting a scrub', () => {
  it('binds nothing until the playhead is grabbed', () => {
    const { result } = mountScrub()

    expect(result.current.isDraggingPlayhead).toBe(false)
    expect(bound()).toBe(0)
  })

  it('takes hold of the document and keeps the click off the track below', () => {
    const { result } = mountScrub()

    const stopPropagation = grab(result)

    expect(result.current.isDraggingPlayhead).toBe(true)
    expect(stopPropagation).toHaveBeenCalled()
    expect(bound()).toBe(2)
  })

  it('gives the listeners back on release, and lowers the flag', () => {
    const { result } = mountScrub()
    grab(result)

    release()

    expect(result.current.isDraggingPlayhead).toBe(false)
    expect(bound()).toBe(0)
  })

  it('gives the listeners back when the timeline unmounts mid-scrub', () => {
    const { result, unmount } = mountScrub()
    grab(result)

    unmount()

    expect(bound()).toBe(0)
  })
})

describe('usePlayheadDrag following the pointer', () => {
  it('writes the time under the pointer', () => {
    const { result } = mountScrub()
    grab(result)

    moveTo(2.5)

    expect(setCurrentTime).toHaveBeenCalledWith(2.5)
    expect(currentTime()).toBe(2.5)
  })

  it('accounts for what is scrolled out of view to the left', () => {
    containerRef.current!.scrollLeft = 100 // two seconds
    const { result } = mountScrub()
    grab(result)

    moveTo(2.5)

    expect(setCurrentTime).toHaveBeenCalledWith(4.5)
  })

  it('will not scrub before the start of the timeline', () => {
    const { result } = mountScrub()
    grab(result)

    moveTo(-3)

    expect(setCurrentTime).toHaveBeenCalledWith(0)
  })

  it('will not scrub past the end of the timeline', () => {
    const { result } = mountScrub()
    grab(result)

    moveTo(DURATION + 5)

    expect(setCurrentTime).toHaveBeenCalledWith(DURATION)
  })

  it('writes nothing once the track area has gone', () => {
    const { result } = mountScrub()
    grab(result)
    containerRef.current = null

    moveTo(2.5)

    expect(setCurrentTime).not.toHaveBeenCalled()
  })

  it('writes nothing for a pointer that moves without the playhead held', () => {
    mountScrub()

    moveTo(2.5)

    expect(setCurrentTime).not.toHaveBeenCalled()
    expect(currentTime()).toBe(0)
  })

  it('stops writing once the pointer has come up', () => {
    const { result } = mountScrub()
    grab(result)
    moveTo(2.5)

    release()
    moveTo(5)

    expect(setCurrentTime).toHaveBeenCalledTimes(1)
    expect(currentTime()).toBe(2.5)
  })
})
