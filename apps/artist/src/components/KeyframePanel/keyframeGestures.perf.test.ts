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
// ESCSUITE-183's own pin, below: the graph's point drag builds its occupied
// windows once per gesture too. Its own imports are kept here rather than
// folded into the four above so the two 167/m4 cases stay byte-identical.
import { fireEvent, render } from '@testing-library/react'
import { createElement } from 'react'
import { KeyframeGraph } from './KeyframeGraph'
import { DEFAULT_ANIMATION, DEFAULT_EFFECTS, DEFAULT_TRANSFORM } from '../../store/types'
import * as keyframeClamp from '../../utils/keyframeClamp'

// The real implementation, behind a counting wrapper: this pins HOW OFTEN the
// windows are built, not what they come out as, so every other case in this
// file and in the suite keeps the real arithmetic.
vi.mock('../../utils/keyframeClamp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/keyframeClamp')>()
  return { ...actual, occupiedWindows: vi.fn(actual.occupiedWindows) }
})

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
    const onAnnounce = vi.fn()
    const { result } = renderHook(() =>
      useKeyframeDrag(CLIP_DURATION, -1, [], onKeyframeMoved, onAnnounce)
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

  // Review round 1, MINOR 2: `occupiedTimesRef` used to be recomputed (and
  // reallocated) on every pointer move inside `findSnapTime`, plus once more
  // in `handleMouseUp` — a per-frame array the keyframe times cannot
  // actually justify, since nothing writes to the store between mousedown
  // and mouseup. It is now a `.filter()` taken once, on `startDrag`, into a
  // ref read by both. Spying on the exact array instance the hook is handed
  // (rather than `Array.prototype`) is what lets this count only the calls
  // this hook makes on its own input, the same reason
  // `components/Timeline/timelineGestures.perf.test.ts` wraps the element
  // instance after `setRect` rather than spying on the prototype.
  it('computes the occupied-times array once per gesture, however many moves it makes', () => {
    const onKeyframeMoved = vi.fn()
    const onAnnounce = vi.fn()
    const allKeyframeTimes = [1, 5, 9]
    const filterSpy = vi.spyOn(allKeyframeTimes, 'filter')

    const { result } = renderHook(() =>
      useKeyframeDrag(CLIP_DURATION, -1, allKeyframeTimes, onKeyframeMoved, onAnnounce)
    )
    result.current.trackRef.current = trackElement()

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

    // Measured 2026-10-02, after the fix: exactly one `.filter()` call for
    // the whole gesture. Before this fix round, it was called once per move
    // inside `findSnapTime` plus once more in `handleMouseUp` — 11 times
    // over 10 moves — because the occupied list was recomputed from
    // `dragState.originalTime` on every call instead of cached at the
    // gesture's start.
    expect(filterSpy).toHaveBeenCalledTimes(1)
  })
})

// ESCSUITE-183, review finding 10: the graph's point drag grew the same
// per-gesture snapshot the diamond row drag has had since ESCSUITE-167 / m4,
// and it was unpinned — true by construction (it is built in
// `handleKeyframeMouseDown`, the only path that starts a drag) rather than
// enforced. This is the graph's mirror of the `.filter()` case above, counted
// through the shared helper both drags now call.
describe('KeyframeGraph drag occupied-window snapshot (ESCSUITE-183)', () => {
  const GRAPH_CLIP_DURATION = 10

  afterEach(() => {
    cleanup()
  })

  function renderGraph() {
    return render(
      createElement(KeyframeGraph, {
        property: 'opacity',
        clipDuration: GRAPH_CLIP_DURATION,
        animation: {
          ...DEFAULT_ANIMATION,
          keyframes: {
            opacity: [
              { time: 1, value: 1, easing: 'linear' },
              { time: 5, value: 0.5, easing: 'linear' },
              { time: 9, value: 0, easing: 'linear' },
            ],
          },
        },
        transform: DEFAULT_TRANSFORM,
        effects: DEFAULT_EFFECTS,
        playheadTime: 0,
        locked: false,
        onKeyframeMoved: () => true,
        onKeyframeValueChanged: () => true,
        onAddKeyframe: () => {},
      })
    )
  }

  it('builds the occupied windows once per gesture, however many moves it makes', () => {
    const { container } = renderGraph()
    const svg = container.querySelector('svg')!
    // The graph draws into a 500x200 viewBox; giving the element exactly that
    // box makes screen coordinates equal viewBox coordinates.
    svg.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 500,
        height: 200,
        right: 500,
        bottom: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect

    const buildSpy = vi.mocked(keyframeClamp.occupiedWindows)
    buildSpy.mockClear()

    const point = container.querySelectorAll('circle')[0]
    fireEvent.mouseDown(point, { altKey: true })

    for (let i = 0; i < MOVES; i++) {
      fireEvent.mouseMove(window, { clientX: 60 + i, clientY: 100 })
    }

    fireEvent.mouseUp(window)

    // Measured 2026-10-03: exactly 1 regardless of MOVES — the windows are
    // built in `handleKeyframeMouseDown` and read from a ref by every move,
    // and `clampToLegalTime` itself allocates nothing. A clamp that rebuilt
    // them per pointer frame would read 11 here (one per move plus the
    // mousedown), the same shape the diamond drag's `.filter()` showed before
    // ESCSUITE-167 / m4's review fixed it.
    expect(buildSpy).toHaveBeenCalledTimes(1)
  })
})
