// The status toast: one slot, a default type, and a timer the hook owns.
//
// The three-second clear is the behaviour worth pinning, and so is the fact
// that the hook holds on to the handle: a second notification cancels the
// first one's timer and gets its own three seconds, and an unmounted hook's
// pending timer writes nothing. `showNotification`'s identity has to survive
// all of that — five other hooks take it as a dependency — so the last test
// pins that too.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useNotification } from './useNotification'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useNotification', () => {
  it('shows nothing until asked', () => {
    const { result } = renderHook(() => useNotification())

    expect(result.current.notification).toBeNull()
  })

  it('carries the message and the type through', () => {
    const { result } = renderHook(() => useNotification())

    act(() => result.current.showNotification('Project saved successfully', 'success'))

    expect(result.current.notification).toEqual({
      message: 'Project saved successfully',
      type: 'success',
    })
  })

  it('defaults the type to info', () => {
    const { result } = renderHook(() => useNotification())

    act(() => result.current.showNotification('Undo'))

    expect(result.current.notification).toEqual({ message: 'Undo', type: 'info' })
  })

  it('clears the toast three seconds later', () => {
    const { result } = renderHook(() => useNotification())
    act(() => result.current.showNotification('Marker added'))

    act(() => void vi.advanceTimersByTime(2999))
    expect(result.current.notification).not.toBeNull()

    act(() => void vi.advanceTimersByTime(1))
    expect(result.current.notification).toBeNull()
  })

  it('gives a second notification its own three seconds', () => {
    const { result } = renderHook(() => useNotification())
    act(() => result.current.showNotification('First'))

    act(() => void vi.advanceTimersByTime(2500))
    act(() => result.current.showNotification('Second'))
    expect(result.current.notification).toEqual({ message: 'Second', type: 'info' })

    // The moment the first notification's timer would have fired: the second
    // message survives it, because showing it cancelled that timer.
    act(() => void vi.advanceTimersByTime(500))
    expect(result.current.notification).toEqual({ message: 'Second', type: 'info' })

    // And it runs its own full three seconds from when it was shown.
    act(() => void vi.advanceTimersByTime(2499))
    expect(result.current.notification).not.toBeNull()

    act(() => void vi.advanceTimersByTime(1))
    expect(result.current.notification).toBeNull()
  })

  it('writes nothing once the hook has gone', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result, unmount } = renderHook(() => useNotification())
    act(() => result.current.showNotification('Marker added'))

    unmount()

    // Nothing is left armed: unmounting cleared the pending timer.
    expect(vi.getTimerCount()).toBe(0)

    act(() => void vi.advanceTimersByTime(3000))
    // A timer that outlived its hook would set state on an unmounted component.
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('keeps the same showNotification across renders, so it is a stable dependency', () => {
    const { result, rerender } = renderHook(() => useNotification())
    const first = result.current.showNotification

    act(() => result.current.showNotification('Anything'))
    rerender()

    expect(result.current.showNotification).toBe(first)
  })
})
