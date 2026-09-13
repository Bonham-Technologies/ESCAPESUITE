// The timeline's two zoom steps.
//
// Both are a single multiply against the `zoom` they were given, so what is
// worth pinning is the factor, the direction, and that a new `zoom` produces
// new callbacks — the keyboard-shortcut effect lists both in its deps, and a
// callback that outlived its zoom would step from a stale scale.
import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTimelineZoom } from './useTimelineZoom'

describe('useTimelineZoom', () => {
  it('zooms in by a factor of 1.25', () => {
    const setZoom = vi.fn()
    const { result } = renderHook(() => useTimelineZoom({ zoom: 2, setZoom }))

    act(() => result.current.handleZoomIn())

    expect(setZoom).toHaveBeenCalledWith(2.5)
  })

  it('zooms out by the same factor', () => {
    const setZoom = vi.fn()
    const { result } = renderHook(() => useTimelineZoom({ zoom: 2, setZoom }))

    act(() => result.current.handleZoomOut())

    expect(setZoom).toHaveBeenCalledWith(1.6)
  })

  it('steps from the zoom it was last given', () => {
    const setZoom = vi.fn()
    const { result, rerender } = renderHook(
      ({ zoom }) => useTimelineZoom({ zoom, setZoom }),
      { initialProps: { zoom: 1 } }
    )
    const firstZoomIn = result.current.handleZoomIn

    rerender({ zoom: 4 })
    act(() => result.current.handleZoomIn())

    expect(setZoom).toHaveBeenCalledWith(5)
    expect(result.current.handleZoomIn).not.toBe(firstZoomIn)
  })
})
