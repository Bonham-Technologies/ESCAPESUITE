// Per-pointer-frame work ceiling for the keyframe panel's diamond-row drag.
//
// ESCSUITE-167 / m4: `useKeyframeDrag`'s window listener pair used to be
// rebound on every pointer move — `dragState.currentTime` (and the snap
// function, which read it) sat in the effect's deps — exactly the churn the
// five timeline gesture hooks were moved off of
// (`components/Timeline/timelineGestures.perf.test.ts` pins `useClipDrag`,
// `useTrimDrag` and the rest at one listener pair per gesture). One pair per
// gesture is a property here too, not a budget, so it is asserted exactly —
// 2 adds, 2 removes — whatever `MOVES` is, the same way that file pins the
// timeline hooks.
//
// An ordinary vitest file, not `bench` mode: it runs in CI and in
// `test:coverage` like any other test, so a regression here fails the build
// instead of moving a number nobody reads.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useKeyframeDrag } from './hooks/useKeyframeDrag'
import type { Keyframe } from '../../store/types'

const CLIP_DURATION = 10
const TRACK_LEFT = 100
const TRACK_WIDTH = 500

/**
 * Pointer moves for the measured gesture. Deliberately more than one, so a
 * hook that still rebinds per move would show it: the finding this file
 * guards against measured 22 adds/removes over 10 moves (one pair per move,
 * plus the pair bound on mousedown).
 */
const MOVES = 10

const keyframe = (time: number): Keyframe => ({ time, value: 1, easing: 'linear' })

function trackElement(): HTMLDivElement {
  const element = document.createElement('div')
  element.getBoundingClientRect = () =>
    ({
      left: TRACK_LEFT,
      top: 0,
      width: TRACK_WIDTH,
      height: 20,
      right: TRACK_LEFT + TRACK_WIDTH,
      bottom: 20,
      x: TRACK_LEFT,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect
  return element
}

describe('useKeyframeDrag listener lifecycle (ESCSUITE-167 / m4)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('binds exactly one window listener pair per gesture, however many moves it makes', () => {
    const onKeyframeMoved = vi.fn()
    const { result } = renderHook(() =>
      useKeyframeDrag(CLIP_DURATION, -1, [], onKeyframeMoved)
    )
    result.current.trackRef.current = trackElement()

    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    act(() => {
      result.current.startDrag('opacity', keyframe(2), {
        preventDefault: () => {},
        stopPropagation: () => {},
      } as unknown as React.MouseEvent)
    })

    for (let i = 0; i < MOVES; i++) {
      act(() => {
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: TRACK_LEFT + i, clientY: 10 }))
      })
    }

    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'))
    })

    const mouseEventTypes = new Set(['mousemove', 'mouseup'])
    const adds = addSpy.mock.calls.filter(([type]) => mouseEventTypes.has(type as string)).length
    const removes = removeSpy.mock.calls.filter(([type]) => mouseEventTypes.has(type as string)).length

    // Measured 2026-10-02, after the fix: exactly 2 and 2 regardless of
    // MOVES — the pair is bound on mousedown and given back on mouseup,
    // because the effect is keyed on `isDragging` rather than on the drag's
    // live position. Before the fix, 10 moves produced 22 of each (one extra
    // pair per move).
    expect({ adds, removes }).toEqual({ adds: 2, removes: 2 })
  })
})
