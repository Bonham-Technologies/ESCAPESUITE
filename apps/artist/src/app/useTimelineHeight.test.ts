// The timeline panel's height: where it starts, what a drag does to it, and
// what the drag leaves behind on the document.
//
// The gesture is driven the way the browser delivers it — mousedown on the
// handle, then `mousemove`/`mouseup` on `document`, because that is where the
// effect listens. jsdom's window is 768px tall, so a pointer at clientY 700
// asks for a 68px timeline (below the 120 floor) and one at clientY 0 asks for
// 768 (above the 600 ceiling).
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act, fireEvent, renderHook } from '@testing-library/react'
import type React from 'react'
import { useTimelineHeight } from './useTimelineHeight'
import { TIMELINE_HEIGHT_KEY, DEFAULT_TIMELINE_HEIGHT, MIN_TIMELINE_HEIGHT, MAX_TIMELINE_HEIGHT } from './appConstants'
import type { ShowNotification } from './useNotification'

/** jsdom's viewport height — the drag measures up from the bottom of it. */
const VIEWPORT = 768

let showNotification: Mock<ShowNotification>

const mountHeight = () => renderHook(() => useTimelineHeight({ showNotification }))

/** Press the grab strip, the way TimelineResizeHandle's onMouseDown would. */
const startDrag = (result: { current: { handleResizeStart: (e: React.MouseEvent) => void } }) => {
  const preventDefault = vi.fn()
  act(() => result.current.handleResizeStart({ preventDefault } as unknown as React.MouseEvent))
  return preventDefault
}

beforeEach(() => {
  localStorage.clear()
  showNotification = vi.fn()
})

afterEach(() => {
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  vi.clearAllMocks()
})

describe('useTimelineHeight', () => {
  it('starts at the default height when nothing is stored', () => {
    const { result } = mountHeight()

    expect(result.current.timelineHeight).toBe(DEFAULT_TIMELINE_HEIGHT)
    expect(result.current.isResizing).toBe(false)
  })

  it('starts at the persisted height', () => {
    localStorage.setItem(TIMELINE_HEIGHT_KEY, '250')

    const { result } = mountHeight()

    expect(result.current.timelineHeight).toBe(250)
  })

  it('binds nothing to the document until a drag starts', () => {
    mountHeight()

    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })

  it('takes over the cursor and text selection while dragging', () => {
    const { result } = mountHeight()

    const preventDefault = startDrag(result)

    expect(preventDefault).toHaveBeenCalled()
    expect(result.current.isResizing).toBe(true)
    expect(document.body.style.cursor).toBe('ns-resize')
    expect(document.body.style.userSelect).toBe('none')
  })

  it('tracks the pointer, measuring up from the bottom of the window', () => {
    const { result } = mountHeight()
    startDrag(result)

    fireEvent.mouseMove(document, { clientY: VIEWPORT - 400 })

    expect(result.current.timelineHeight).toBe(400)
  })

  it('clamps a pointer that asks for less than the minimum', () => {
    const { result } = mountHeight()
    startDrag(result)

    fireEvent.mouseMove(document, { clientY: 700 })

    expect(result.current.timelineHeight).toBe(MIN_TIMELINE_HEIGHT)
  })

  it('clamps a pointer that asks for more than the maximum', () => {
    const { result } = mountHeight()
    startDrag(result)

    fireEvent.mouseMove(document, { clientY: 0 })

    expect(result.current.timelineHeight).toBe(MAX_TIMELINE_HEIGHT)
  })

  it('persists the final height on release and gives the document back', () => {
    const { result } = mountHeight()
    startDrag(result)
    fireEvent.mouseMove(document, { clientY: VIEWPORT - 400 })

    fireEvent.mouseUp(document)

    expect(result.current.isResizing).toBe(false)
    expect(localStorage.getItem(TIMELINE_HEIGHT_KEY)).toBe('400')
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })

  it('stops tracking the pointer once the drag has ended', () => {
    const { result } = mountHeight()
    startDrag(result)
    fireEvent.mouseMove(document, { clientY: VIEWPORT - 400 })
    fireEvent.mouseUp(document)

    fireEvent.mouseMove(document, { clientY: VIEWPORT - 200 })

    expect(result.current.timelineHeight).toBe(400)
  })

  it('resets to the default height on a double-click, and says so', () => {
    localStorage.setItem(TIMELINE_HEIGHT_KEY, '250')
    const { result } = mountHeight()

    act(() => result.current.handleResizeDoubleClick())

    expect(result.current.timelineHeight).toBe(DEFAULT_TIMELINE_HEIGHT)
    expect(localStorage.getItem(TIMELINE_HEIGHT_KEY)).toBe(String(DEFAULT_TIMELINE_HEIGHT))
    expect(showNotification).toHaveBeenCalledWith('Timeline height reset', 'info')
  })

  it('gives the document back when it unmounts mid-drag', () => {
    const { result, unmount } = mountHeight()
    startDrag(result)

    unmount()

    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
    // And the listeners are gone with it: a stray move writes nothing.
    fireEvent.mouseMove(document, { clientY: VIEWPORT - 200 })
    fireEvent.mouseUp(document)
    expect(localStorage.getItem(TIMELINE_HEIGHT_KEY)).toBeNull()
  })
})
