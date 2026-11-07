// The inspector's collapsed flag (ESCSUITE-345): where it starts, how it
// follows the 900px breakpoint, and that a user's toggle outlasts a resize.
//
// `window.matchMedia` is replaced by a controllable double for the
// breakpoint's query, so a test can say which side of 900px the viewport is
// on and fire the `change` a resize across it would.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { INSPECTOR_OVERLAY_QUERY, useInspectorCollapsed } from './useInspectorCollapsed'

interface BreakpointDouble {
  /** Move the viewport across the breakpoint and fire `change`. */
  setNarrow: (narrow: boolean) => void
  listenerCount: () => number
}

const originalMatchMedia = window.matchMedia

/** Install a `matchMedia` whose overlay query answers `narrow`. */
function stubBreakpoint(narrow: boolean): BreakpointDouble {
  let matches = narrow
  const listeners = new Set<() => void>()
  window.matchMedia = vi.fn((query: string) => {
    expect(query).toBe(INSPECTOR_OVERLAY_QUERY)
    return {
      get matches() {
        return matches
      },
      media: query,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    } as unknown as MediaQueryList
  })
  return {
    setNarrow: (next) => {
      matches = next
      listeners.forEach((listener) => listener())
    },
    listenerCount: () => listeners.size,
  }
}

afterEach(() => {
  window.matchMedia = originalMatchMedia
})

describe('useInspectorCollapsed', () => {
  it('matches the stylesheet breakpoint where the inspector becomes a slide-out', () => {
    expect(INSPECTOR_OVERLAY_QUERY).toBe('(max-width: 900px)')
  })

  it('starts collapsed below the breakpoint', () => {
    stubBreakpoint(true)
    const { result } = renderHook(() => useInspectorCollapsed())
    expect(result.current.collapsed).toBe(true)
  })

  it('starts expanded at and above the breakpoint', () => {
    stubBreakpoint(false)
    const { result } = renderHook(() => useInspectorCollapsed())
    expect(result.current.collapsed).toBe(false)
  })

  it('starts expanded where the browser has no matchMedia', () => {
    // @ts-expect-error -- simulating an environment without the API
    window.matchMedia = undefined
    const { result } = renderHook(() => useInspectorCollapsed())
    expect(result.current.collapsed).toBe(false)

    // The toggle still works without a breakpoint to follow.
    act(() => result.current.toggle())
    expect(result.current.collapsed).toBe(true)
  })

  it('follows the breakpoint across a resize while the user has not toggled', () => {
    const breakpoint = stubBreakpoint(true)
    const { result } = renderHook(() => useInspectorCollapsed())

    act(() => breakpoint.setNarrow(false))
    expect(result.current.collapsed).toBe(false)

    act(() => breakpoint.setNarrow(true))
    expect(result.current.collapsed).toBe(true)
  })

  it('keeps a toggle that opened it on a narrow screen across resizes', () => {
    const breakpoint = stubBreakpoint(true)
    const { result } = renderHook(() => useInspectorCollapsed())

    act(() => result.current.toggle())
    expect(result.current.collapsed).toBe(false)

    act(() => breakpoint.setNarrow(false))
    act(() => breakpoint.setNarrow(true))
    expect(result.current.collapsed).toBe(false)
  })

  it('keeps a toggle that collapsed it on a wide screen across resizes', () => {
    const breakpoint = stubBreakpoint(false)
    const { result } = renderHook(() => useInspectorCollapsed())

    act(() => result.current.toggle())
    expect(result.current.collapsed).toBe(true)

    act(() => breakpoint.setNarrow(true))
    act(() => breakpoint.setNarrow(false))
    expect(result.current.collapsed).toBe(true)

    act(() => result.current.toggle())
    expect(result.current.collapsed).toBe(false)
  })

  it('stops listening to the breakpoint on unmount', () => {
    const breakpoint = stubBreakpoint(true)
    const { unmount } = renderHook(() => useInspectorCollapsed())
    expect(breakpoint.listenerCount()).toBe(1)

    unmount()
    expect(breakpoint.listenerCount()).toBe(0)
  })
})
