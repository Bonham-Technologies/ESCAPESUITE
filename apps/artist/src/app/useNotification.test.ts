// The status toast: one slot, a default type, and a timer that nobody owns.
//
// The three-second clear is real behaviour worth pinning, and so is the fact
// that a second notification does not cancel the first one's timer — that is
// a carried smell, asserted here as a *finding* rather than a target. Flip the
// last test when the timer is ever made cancellable.
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

  it('FINDING: a second notification does not cancel the first timer, so it is blanked early', () => {
    const { result } = renderHook(() => useNotification())
    act(() => result.current.showNotification('First'))

    act(() => void vi.advanceTimersByTime(2500))
    act(() => result.current.showNotification('Second'))
    expect(result.current.notification).toEqual({ message: 'Second', type: 'info' })

    // The first notification's timer is still running and blanks the second
    // message 500 ms in, instead of it getting its own three seconds.
    act(() => void vi.advanceTimersByTime(500))
    expect(result.current.notification).toBeNull()
  })

  it('keeps the same showNotification across renders, so it is a stable dependency', () => {
    const { result, rerender } = renderHook(() => useNotification())
    const first = result.current.showNotification

    act(() => result.current.showNotification('Anything'))
    rerender()

    expect(result.current.showNotification).toBe(first)
  })
})
