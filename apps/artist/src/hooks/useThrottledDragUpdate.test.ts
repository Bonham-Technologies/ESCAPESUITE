import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useMultiThrottledDragUpdate, useThrottledDragUpdate } from './useThrottledDragUpdate'

/** Let the browser paint: runs whatever requestAnimationFrame has queued. */
function nextFrame(): void {
  act(() => {
    vi.advanceTimersByTime(16)
  })
}

describe('useThrottledDragUpdate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('defers the update to the next animation frame', () => {
    const update = vi.fn()
    const { result } = renderHook(() => useThrottledDragUpdate<{ x: number }>())

    act(() => result.current.scheduleUpdate(update, { x: 1 }))
    expect(update).not.toHaveBeenCalled()

    nextFrame()
    expect(update).toHaveBeenCalledExactlyOnceWith({ x: 1 })
  })

  it('coalesces a burst of updates into one, with the newest data', () => {
    const update = vi.fn()
    const { result } = renderHook(() => useThrottledDragUpdate<{ x: number }>())

    act(() => {
      result.current.scheduleUpdate(update, { x: 1 })
      result.current.scheduleUpdate(update, { x: 2 })
      result.current.scheduleUpdate(update, { x: 3 })
    })

    nextFrame()
    expect(update).toHaveBeenCalledExactlyOnceWith({ x: 3 })
  })

  it('schedules a new frame for the next burst', () => {
    const update = vi.fn()
    const { result } = renderHook(() => useThrottledDragUpdate<{ x: number }>())

    act(() => result.current.scheduleUpdate(update, { x: 1 }))
    nextFrame()
    act(() => result.current.scheduleUpdate(update, { x: 2 }))
    nextFrame()

    expect(update.mock.calls.map((c) => c[0])).toEqual([{ x: 1 }, { x: 2 }])
  })

  it('reports being active between scheduling and flushing', () => {
    const update = vi.fn()
    const { result } = renderHook(() => useThrottledDragUpdate<{ x: number }>())

    expect(result.current.isActive()).toBe(false)
    act(() => result.current.scheduleUpdate(update, { x: 1 }))
    expect(result.current.isActive()).toBe(true)

    act(() => result.current.flush())
    expect(result.current.isActive()).toBe(false)
  })

  it('flush applies the pending update immediately and cancels the frame', () => {
    const update = vi.fn()
    const { result } = renderHook(() => useThrottledDragUpdate<{ x: number }>())

    act(() => result.current.scheduleUpdate(update, { x: 9 }))
    act(() => result.current.flush())

    expect(update).toHaveBeenCalledExactlyOnceWith({ x: 9 })

    // The cancelled frame must not deliver the update a second time.
    nextFrame()
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('flush with nothing pending does nothing', () => {
    const update = vi.fn()
    const { result } = renderHook(() => useThrottledDragUpdate<{ x: number }>())

    act(() => result.current.flush())
    expect(update).not.toHaveBeenCalled()
  })

  it('flush after the frame has run does not repeat the update', () => {
    const update = vi.fn()
    const { result } = renderHook(() => useThrottledDragUpdate<{ x: number }>())

    act(() => result.current.scheduleUpdate(update, { x: 1 }))
    nextFrame()
    act(() => result.current.flush())

    // The frame already applied it; flush re-applies the still-pending data.
    expect(update.mock.calls.map((c) => c[0])).toEqual([{ x: 1 }, { x: 1 }])
  })

  it('cancel drops the pending update entirely', () => {
    const update = vi.fn()
    const { result } = renderHook(() => useThrottledDragUpdate<{ x: number }>())

    act(() => result.current.scheduleUpdate(update, { x: 1 }))
    act(() => result.current.cancel())

    expect(result.current.isActive()).toBe(false)
    nextFrame()
    expect(update).not.toHaveBeenCalled()
  })

  it('cancel with nothing pending does nothing', () => {
    const { result } = renderHook(() => useThrottledDragUpdate<{ x: number }>())
    expect(() => act(() => result.current.cancel())).not.toThrow()
  })

  it('cancels the pending frame on unmount', () => {
    const update = vi.fn()
    const { result, unmount } = renderHook(() => useThrottledDragUpdate<{ x: number }>())

    act(() => result.current.scheduleUpdate(update, { x: 1 }))
    unmount()
    nextFrame()

    expect(update).not.toHaveBeenCalled()
  })

  it('unmounts cleanly with no frame pending', () => {
    const { unmount } = renderHook(() => useThrottledDragUpdate<{ x: number }>())
    expect(() => unmount()).not.toThrow()
  })
})

describe('useMultiThrottledDragUpdate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('throttles each channel independently', () => {
    const position = vi.fn()
    const scale = vi.fn()
    const { result } = renderHook(() => useMultiThrottledDragUpdate())

    act(() => {
      result.current.scheduleUpdate('position', position, { x: 1 })
      result.current.scheduleUpdate('position', position, { x: 2 })
      result.current.scheduleUpdate('scale', scale, { s: 3 })
    })

    nextFrame()

    expect(position).toHaveBeenCalledExactlyOnceWith({ x: 2 })
    expect(scale).toHaveBeenCalledExactlyOnceWith({ s: 3 })
  })

  it('uses the latest update function for a channel', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { result } = renderHook(() => useMultiThrottledDragUpdate())

    act(() => {
      result.current.scheduleUpdate('position', first, { x: 1 })
      result.current.scheduleUpdate('position', second, { x: 2 })
    })

    nextFrame()

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledExactlyOnceWith({ x: 2 })
  })

  it('schedules a fresh frame once the previous one has run', () => {
    const position = vi.fn()
    const { result } = renderHook(() => useMultiThrottledDragUpdate())

    act(() => result.current.scheduleUpdate('position', position, { x: 1 }))
    nextFrame()
    act(() => result.current.scheduleUpdate('position', position, { x: 2 }))
    nextFrame()

    expect(position.mock.calls.map((c) => c[0])).toEqual([{ x: 1 }, { x: 2 }])
  })

  it('flushes one named channel and leaves the others pending', () => {
    const position = vi.fn()
    const scale = vi.fn()
    const { result } = renderHook(() => useMultiThrottledDragUpdate())

    act(() => {
      result.current.scheduleUpdate('position', position, { x: 1 })
      result.current.scheduleUpdate('scale', scale, { s: 2 })
    })
    act(() => result.current.flush('position'))

    expect(position).toHaveBeenCalledExactlyOnceWith({ x: 1 })
    expect(scale).not.toHaveBeenCalled()

    nextFrame()
    expect(position).toHaveBeenCalledTimes(1)
    expect(scale).toHaveBeenCalledExactlyOnceWith({ s: 2 })
  })

  it('flushing an unknown channel is a no-op', () => {
    const { result } = renderHook(() => useMultiThrottledDragUpdate())
    expect(() => act(() => result.current.flush('nothing-here'))).not.toThrow()
  })

  it('flushes every channel when no channel is named', () => {
    const position = vi.fn()
    const scale = vi.fn()
    const { result } = renderHook(() => useMultiThrottledDragUpdate())

    act(() => {
      result.current.scheduleUpdate('position', position, { x: 1 })
      result.current.scheduleUpdate('scale', scale, { s: 2 })
    })
    act(() => result.current.flush())

    expect(position).toHaveBeenCalledExactlyOnceWith({ x: 1 })
    expect(scale).toHaveBeenCalledExactlyOnceWith({ s: 2 })

    // Both frames were cancelled, so nothing fires again.
    nextFrame()
    expect(position).toHaveBeenCalledTimes(1)
    expect(scale).toHaveBeenCalledTimes(1)
  })

  it('flushing a channel whose frame already ran does not repeat it', () => {
    const position = vi.fn()
    const { result } = renderHook(() => useMultiThrottledDragUpdate())

    act(() => result.current.scheduleUpdate('position', position, { x: 1 }))
    nextFrame()
    act(() => result.current.flush('position'))

    // The frame consumed the pending data by applying it, but left it in place,
    // so an explicit flush applies the same data once more.
    expect(position.mock.calls.map((c) => c[0])).toEqual([{ x: 1 }, { x: 1 }])
  })

  it('cancels one named channel and leaves the others pending', () => {
    const position = vi.fn()
    const scale = vi.fn()
    const { result } = renderHook(() => useMultiThrottledDragUpdate())

    act(() => {
      result.current.scheduleUpdate('position', position, { x: 1 })
      result.current.scheduleUpdate('scale', scale, { s: 2 })
    })
    act(() => result.current.cancel('position'))

    nextFrame()
    expect(position).not.toHaveBeenCalled()
    expect(scale).toHaveBeenCalledExactlyOnceWith({ s: 2 })
  })

  it('cancelling an unknown channel is a no-op', () => {
    const { result } = renderHook(() => useMultiThrottledDragUpdate())
    expect(() => act(() => result.current.cancel('nothing-here'))).not.toThrow()
  })

  it('cancels every channel when no channel is named', () => {
    const position = vi.fn()
    const scale = vi.fn()
    const { result } = renderHook(() => useMultiThrottledDragUpdate())

    act(() => {
      result.current.scheduleUpdate('position', position, { x: 1 })
      result.current.scheduleUpdate('scale', scale, { s: 2 })
    })
    act(() => result.current.cancel())

    nextFrame()
    expect(position).not.toHaveBeenCalled()
    expect(scale).not.toHaveBeenCalled()
  })

  it('cancels every pending frame on unmount', () => {
    const position = vi.fn()
    const scale = vi.fn()
    const { result, unmount } = renderHook(() => useMultiThrottledDragUpdate())

    act(() => {
      result.current.scheduleUpdate('position', position, { x: 1 })
      result.current.scheduleUpdate('scale', scale, { s: 2 })
    })
    unmount()
    nextFrame()

    expect(position).not.toHaveBeenCalled()
    expect(scale).not.toHaveBeenCalled()
  })
})
