// The per-gesture measurement of the track area: what it takes, when it keeps
// it, and what makes it take it again.
//
// jsdom performs no layout, so `getBoundingClientRect` is free and all-zero
// here (`src/test/doubles/layout.ts`) — these tests give the elements their
// boxes with `setRect` and count the calls through a wrapper installed on the
// instance afterwards, the same way `timelineGestures.perf.test.ts` does. What
// they can prove is the *shape*: one measurement per gesture, rows in the
// container's own layout space, and a re-measure after exactly the two things
// that move the box under a live gesture.
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTrackAreaCache } from './useTrackAreaCache'
import { setRect } from '../../test/doubles/layout'

/** Every track row is 60px tall, as in the gesture-hook tests. */
const ROW_HEIGHT = 60

let container: HTMLDivElement
let rectCalls: { container: number; rows: number }
let addListener: MockInstance
let removeListener: MockInstance
let addWindowListener: MockInstance
let removeWindowListener: MockInstance

/** How many of each invalidation listener the cache currently holds. */
function listening(): { scroll: number; resize: number } {
  const count = (spy: MockInstance, type: string) =>
    spy.mock.calls.filter((call) => call[0] === type).length
  return {
    scroll: count(addListener, 'scroll') - count(removeListener, 'scroll'),
    resize: count(addWindowListener, 'resize') - count(removeWindowListener, 'resize'),
  }
}

/** Wrap one element's `getBoundingClientRect` in a counter, after `setRect`. */
function countRects(element: Element, bump: () => void): void {
  const measure = element.getBoundingClientRect.bind(element)
  element.getBoundingClientRect = () => {
    bump()
    return measure()
  }
}

/** Give the container and its rows their boxes, and start counting again. */
function layOut(containerTop: number): void {
  setRect(container, { left: 100, top: containerTop, width: 800, height: ROW_HEIGHT * 2 })
  countRects(container, () => {
    rectCalls.container += 1
  })
  const rows = [...container.querySelectorAll('[data-track-id]')]
  rows.forEach((row, i) => {
    setRect(row, {
      left: 100,
      top: containerTop + i * ROW_HEIGHT,
      width: 800,
      height: ROW_HEIGHT,
    })
    countRects(row, () => {
      rectCalls.rows += 1
    })
  })
}

beforeEach(() => {
  addListener = vi.spyOn(document, 'addEventListener')
  removeListener = vi.spyOn(document, 'removeEventListener')
  addWindowListener = vi.spyOn(window, 'addEventListener')
  removeWindowListener = vi.spyOn(window, 'removeEventListener')

  rectCalls = { container: 0, rows: 0 }
  container = document.createElement('div')
  for (const id of ['track-a', 'track-b']) {
    const row = document.createElement('div')
    row.setAttribute('data-track-id', id)
    container.appendChild(row)
  }
  document.body.appendChild(container)
  layOut(0)
})

afterEach(() => {
  addListener.mockRestore()
  removeListener.mockRestore()
  addWindowListener.mockRestore()
  removeWindowListener.mockRestore()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('useTrackAreaCache measuring', () => {
  it('takes the container and its rows once, in the container’s layout space', () => {
    const { result } = renderHook(() => useTrackAreaCache())

    act(() => {
      result.current.begin(container, true)
    })

    expect(rectCalls).toEqual({ container: 1, rows: 2 })
    expect(result.current.read(container)).toEqual({
      left: 100,
      top: 0,
      rows: [
        { id: 'track-a', top: 0, height: ROW_HEIGHT },
        { id: 'track-b', top: ROW_HEIGHT, height: ROW_HEIGHT },
      ],
    })
    // Reading it back measured nothing more.
    expect(rectCalls).toEqual({ container: 1, rows: 2 })
  })

  it('measures rows from the top of the unscrolled area, not the viewport', () => {
    // A container scrolled 40px down draws its rows 40px higher on screen while
    // staying where it is itself; the rows' *layout* positions have not moved,
    // which is the whole reason the cache survives a scroll of the track area.
    container.scrollTop = 40
    setRect(container, { left: 100, top: 0, width: 800, height: ROW_HEIGHT * 2 })
    const scrolledRows = [...container.querySelectorAll('[data-track-id]')]
    scrolledRows.forEach((row, i) => {
      setRect(row, { left: 100, top: i * ROW_HEIGHT - 40, width: 800, height: ROW_HEIGHT })
    })
    const { result } = renderHook(() => useTrackAreaCache())

    act(() => {
      result.current.begin(container, true)
    })

    expect(result.current.read(container).rows).toEqual([
      { id: 'track-a', top: 0, height: ROW_HEIGHT },
      { id: 'track-b', top: ROW_HEIGHT, height: ROW_HEIGHT },
    ])
  })

  it('leaves the rows unmeasured until something asks for them', () => {
    const { result } = renderHook(() => useTrackAreaCache())

    act(() => {
      result.current.begin(container, false)
    })

    expect(rectCalls).toEqual({ container: 1, rows: 0 })
    expect(result.current.read(container).rows).toBeNull()

    const rows = result.current.readRows(container)

    expect(rows.map((row) => row.id)).toEqual(['track-a', 'track-b'])
    expect(rectCalls).toEqual({ container: 1, rows: 2 })
    // And a second ask is answered from the cache.
    expect(result.current.readRows(container)).toBe(rows)
    expect(rectCalls).toEqual({ container: 1, rows: 2 })
  })

  it('measures nothing when the track area is not mounted yet', () => {
    // The timeline can be gone between the press and the first move; the press
    // still starts a gesture, and the first read that has an element takes the
    // measurement instead.
    const { result } = renderHook(() => useTrackAreaCache())

    act(() => {
      result.current.begin(null, true)
    })

    expect(rectCalls).toEqual({ container: 0, rows: 0 })

    const box = result.current.read(container)

    expect(box.left).toBe(100)
    expect(rectCalls).toEqual({ container: 1, rows: 0 })
  })
})

describe('useTrackAreaCache identity', () => {
  it('is the same object on every render', () => {
    // The three gesture hooks name the cache in their mousedown `useCallback`
    // deps, and `Timeline` passes those handlers down as props. A cache that
    // changed identity per render would make all three callbacks vacuous, cost
    // three object allocations per pointer frame, and defeat any memo boundary
    // put around `TimelineTrack` later.
    const { result, rerender } = renderHook(() => useTrackAreaCache())
    const first = result.current

    rerender()
    rerender()

    expect(result.current).toBe(first)
    expect(result.current.begin).toBe(first.begin)
    expect(result.current.end).toBe(first.end)
    expect(result.current.read).toBe(first.read)
    expect(result.current.readRows).toBe(first.readRows)
  })
})

describe('useTrackAreaCache going stale', () => {
  it('measures again after a scroll anywhere above it', () => {
    const { result } = renderHook(() => useTrackAreaCache())
    act(() => {
      result.current.begin(container, true)
    })

    // The panel scrolled: the same rows are 100px higher on screen. `scroll`
    // does not bubble, so the cache has to be listening in the capture phase
    // for an event dispatched on the container to reach it at all.
    layOut(-100)
    act(() => {
      container.dispatchEvent(new Event('scroll'))
    })

    expect(result.current.read(container).top).toBe(-100)
    expect(result.current.readRows(container)).toEqual([
      { id: 'track-a', top: 0, height: ROW_HEIGHT },
      { id: 'track-b', top: ROW_HEIGHT, height: ROW_HEIGHT },
    ])
  })

  it('measures again after the window is resized', () => {
    const { result } = renderHook(() => useTrackAreaCache())
    act(() => {
      result.current.begin(container, false)
    })

    layOut(25)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    expect(result.current.read(container).top).toBe(25)
  })

  it('stops listening when the gesture ends', () => {
    const { result } = renderHook(() => useTrackAreaCache())
    act(() => {
      result.current.begin(container, true)
    })

    act(() => {
      result.current.end()
    })

    expect(listening()).toEqual({ scroll: 0, resize: 0 })
    // And it has let go of what it measured, so the next gesture starts clean.
    expect(result.current.read(container).rows).toBeNull()
  })

  it('stops listening when the timeline unmounts mid-gesture', () => {
    const { result, unmount } = renderHook(() => useTrackAreaCache())
    act(() => {
      result.current.begin(container, true)
    })
    expect(listening()).toEqual({ scroll: 1, resize: 1 })

    unmount()

    expect(listening()).toEqual({ scroll: 0, resize: 0 })
  })
})
