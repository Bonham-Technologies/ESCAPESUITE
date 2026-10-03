import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useKeyframeDrag } from './useKeyframeDrag'
import type { Keyframe } from '../../../store/types'

const CLIP_DURATION = 10
const TRACK_LEFT = 100
const TRACK_WIDTH = 500

const keyframe = (time: number): Keyframe => ({ time, value: 1, easing: 'linear' })

/** A React.MouseEvent stand-in carrying what startDrag actually uses. */
function mouseDownEvent() {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.MouseEvent & {
    preventDefault: ReturnType<typeof vi.fn>
    stopPropagation: ReturnType<typeof vi.fn>
  }
}

/** A keyframe track element positioned in the page the way the panel lays it out. */
function trackElement(width = TRACK_WIDTH): HTMLDivElement {
  const element = document.createElement('div')
  element.getBoundingClientRect = () =>
    ({ left: TRACK_LEFT, top: 0, width, height: 20, right: TRACK_LEFT + width, bottom: 20, x: TRACK_LEFT, y: 0, toJSON: () => ({}) }) as DOMRect
  return element
}

function moveMouse(clientX: number) {
  act(() => {
    window.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY: 10 }))
  })
}

function releaseMouse() {
  act(() => {
    window.dispatchEvent(new MouseEvent('mouseup'))
  })
}

function render(options: { playheadTime?: number; allKeyframeTimes?: number[] } = {}) {
  const onKeyframeMoved = vi.fn()
  const onAnnounce = vi.fn()
  const hook = renderHook(() =>
    useKeyframeDrag(
      CLIP_DURATION,
      options.playheadTime ?? -1,
      options.allKeyframeTimes ?? [],
      onKeyframeMoved,
      onAnnounce
    )
  )
  hook.result.current.trackRef.current = trackElement()
  return { ...hook, onKeyframeMoved, onAnnounce }
}

describe('useKeyframeDrag', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('starts idle', () => {
    const { result } = render()

    expect(result.current.dragState).toEqual({
      isDragging: false,
      keyframe: null,
      property: null,
      originalTime: 0,
      currentTime: 0,
    })
  })

  it('records the dragged keyframe and swallows the mouse event', () => {
    const { result } = render()
    const event = mouseDownEvent()
    const kf = keyframe(3)

    act(() => result.current.startDrag('opacity', kf, event))

    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
    expect(result.current.dragState).toEqual({
      isDragging: true,
      keyframe: kf,
      property: 'opacity',
      originalTime: 3,
      currentTime: 3,
    })
  })

  it('ignores mouse moves before a drag starts', () => {
    const { result } = render()

    moveMouse(TRACK_LEFT + 250)

    expect(result.current.dragState.currentTime).toBe(0)
  })

  it('maps the pointer position across the track to a time within the clip', () => {
    const { result } = render()

    act(() => result.current.startDrag('opacity', keyframe(0), mouseDownEvent()))
    // Halfway across a 500px track representing a 10s clip.
    moveMouse(TRACK_LEFT + 250)

    expect(result.current.dragState.currentTime).toBe(5)
  })

  it('clamps the time to the clip bounds', () => {
    const { result } = render()

    act(() => result.current.startDrag('opacity', keyframe(4), mouseDownEvent()))

    moveMouse(TRACK_LEFT - 400)
    expect(result.current.dragState.currentTime).toBe(0)

    moveMouse(TRACK_LEFT + TRACK_WIDTH + 400)
    expect(result.current.dragState.currentTime).toBe(CLIP_DURATION)
  })

  it('does nothing while the track element is not mounted', () => {
    const onKeyframeMoved = vi.fn()
    const onAnnounce = vi.fn()
    const { result } = renderHook(() =>
      useKeyframeDrag(CLIP_DURATION, -1, [], onKeyframeMoved, onAnnounce)
    )

    act(() => result.current.startDrag('opacity', keyframe(2), mouseDownEvent()))
    moveMouse(TRACK_LEFT + 250)

    expect(result.current.dragState.currentTime).toBe(2)
  })

  describe('snapping', () => {
    it('snaps to the playhead when the pointer comes within five pixels', () => {
      // 5px of a 500px / 10s track is 0.1s.
      const { result } = render({ playheadTime: 5.05 })

      act(() => result.current.startDrag('opacity', keyframe(0), mouseDownEvent()))
      moveMouse(TRACK_LEFT + 250) // 5.0s, 0.05s from the playhead

      expect(result.current.dragState.currentTime).toBe(5.05)
    })

    it('does not snap to a playhead further than the threshold', () => {
      const { result } = render({ playheadTime: 5.5 })

      act(() => result.current.startDrag('opacity', keyframe(0), mouseDownEvent()))
      moveMouse(TRACK_LEFT + 250)

      expect(result.current.dragState.currentTime).toBe(5)
    })

    // ESCSUITE-167 / M6: snapping onto another keyframe's time is exactly the
    // case that makes moveClipKeyframe silently delete it — findSnapTime no
    // longer offers one as a candidate at all, so the raw (unsnapped) pointer
    // position is what the drag shows.
    it('does not snap onto another keyframe — that would destroy it', () => {
      const { result } = render({ allKeyframeTimes: [1, 5.04, 9] })

      act(() => result.current.startDrag('opacity', keyframe(0), mouseDownEvent()))
      moveMouse(TRACK_LEFT + 250) // 5.0s, 0.04s from the neighbour at 5.04

      expect(result.current.dragState.currentTime).toBe(5)
    })

    // Review round 1, MINOR 4: a keyframe sitting on the playhead DOES snap
    // back to where it started — `occupiedTimesRef` excludes `originalTime`
    // itself, so `playheadOccupied` is false and the ordinary playhead-snap
    // branch fires. Harmless (currentTime === originalTime means no move and
    // no refusal either), but it is the real behaviour; the prior version of
    // this test used `allKeyframeTimes` with no playhead at all and so passed
    // for an unrelated reason (nothing snaps once keyframe times are not
    // candidates) rather than proving anything about the keyframe being
    // dragged.
    it('still snaps to the playhead when a keyframe sits exactly on it', () => {
      const { result } = render({ playheadTime: 5.04, allKeyframeTimes: [5.04] })

      act(() => result.current.startDrag('opacity', keyframe(5.04), mouseDownEvent()))
      moveMouse(TRACK_LEFT + 250)

      expect(result.current.dragState.currentTime).toBe(5.04)
    })

    it('snaps to the playhead even with a keyframe nearby', () => {
      const { result } = render({ playheadTime: 5.02, allKeyframeTimes: [5.04] })

      act(() => result.current.startDrag('opacity', keyframe(0), mouseDownEvent()))
      moveMouse(TRACK_LEFT + 250)

      expect(result.current.dragState.currentTime).toBe(5.02)
    })

    // ESCSUITE-167 / M6: the playhead is a snap target only when no keyframe
    // already sits there — snapping onto it would be indistinguishable from
    // snapping onto that keyframe, which moveClipKeyframe would then delete.
    it('does not snap to the playhead when a keyframe already sits there', () => {
      const { result } = render({ playheadTime: 5.0, allKeyframeTimes: [5.0] })

      act(() => result.current.startDrag('opacity', keyframe(0), mouseDownEvent()))
      moveMouse(TRACK_LEFT + 252) // 5.04s — within the 0.1s threshold of both

      expect(result.current.dragState.currentTime).toBeCloseTo(5.04, 6)
    })
  })

  // ESCSUITE-183: a drop within KEYFRAME_TIME_EPSILON of another keyframe
  // used to be refused outright on release — the diamond followed the
  // pointer into the forbidden zone and snapped back, the shape ESCSUITE-88
  // ruled against for a locked track's own drag. `handleMouseMove` now
  // clamps `currentTime` on every move so the point can never enter a
  // neighbour's epsilon window at all; these cases supersede (without
  // deleting) the 167/M6 refusal tests above, which this clamp makes land
  // instead of refuse.
  describe('clamping away from an occupied neighbour (ESCSUITE-183, supersedes 167/M6\'s refuse-and-snap-back)', () => {
    it('clamps a drop approaching a neighbour from the left, to just short of it', () => {
      const { result, onKeyframeMoved, onAnnounce } = render({ allKeyframeTimes: [1, 5, 9] })

      act(() => result.current.startDrag('opacity', keyframe(0), mouseDownEvent()))
      moveMouse(TRACK_LEFT + 249.975) // raw 4.9995s — inside the 5s neighbour's window, from below
      expect(result.current.dragState.currentTime).toBeCloseTo(4.999, 6)
      releaseMouse()

      expect(onKeyframeMoved).toHaveBeenCalledTimes(1)
      const [, , landedTime] = onKeyframeMoved.mock.calls[0]
      expect(landedTime).toBeCloseTo(4.999, 6)
      // The hook forwards '' once a drop actually lands — no refusal text.
      expect(onAnnounce).toHaveBeenCalledExactlyOnceWith('')
    })

    it('clamps a drop approaching a neighbour from the right, to just past it', () => {
      const { result, onKeyframeMoved, onAnnounce } = render({ allKeyframeTimes: [1, 5, 9] })

      act(() => result.current.startDrag('opacity', keyframe(0), mouseDownEvent()))
      moveMouse(TRACK_LEFT + 250.025) // raw 5.0005s — inside the 5s neighbour's window, from above
      expect(result.current.dragState.currentTime).toBeCloseTo(5.001, 6)
      releaseMouse()

      expect(onKeyframeMoved).toHaveBeenCalledTimes(1)
      const [, , landedTime] = onKeyframeMoved.mock.calls[0]
      expect(landedTime).toBeCloseTo(5.001, 6)
      expect(onAnnounce).toHaveBeenCalledExactlyOnceWith('')
    })

    // `occupiedTime + KEYFRAME_TIME_EPSILON` does not always land a distance
    // of exactly `KEYFRAME_TIME_EPSILON` away in floating point — at a
    // neighbour of 3, `Math.abs(3 - (3 + 0.001))` comes back
    // `0.0009999999999998899`, which IS `< 0.001`, so `handleMouseUp`'s own
    // occupied check would (correctly, on its own terms) refuse the landing
    // the clamp meant to allow. `CLAMP_MARGIN` is what keeps this neighbour
    // specifically from regressing.
    it('clamps to a landing that survives floating-point rounding, at a neighbour where the bare epsilon would not', () => {
      const { result, onKeyframeMoved, onAnnounce } = render({ allKeyframeTimes: [3] })

      act(() => result.current.startDrag('opacity', keyframe(0), mouseDownEvent()))
      moveMouse(TRACK_LEFT + 150.025) // raw 3.0005s — inside the 3s neighbour's window, from above
      releaseMouse()

      expect(onKeyframeMoved).toHaveBeenCalledTimes(1)
      const [, , landedTime] = onKeyframeMoved.mock.calls[0]
      expect(landedTime).toBeCloseTo(3.001, 6)
      expect(onAnnounce).toHaveBeenCalledExactlyOnceWith('')
    })

    it('clamps two separate gestures toward the same neighbour independently, one from each side', () => {
      const { result, onKeyframeMoved, onAnnounce } = render({ allKeyframeTimes: [1, 5, 9] })

      act(() => result.current.startDrag('opacity', keyframe(0), mouseDownEvent()))
      moveMouse(TRACK_LEFT + 249.975) // 4.9995s — clamps from below
      releaseMouse()
      act(() => result.current.startDrag('opacity', keyframe(9), mouseDownEvent()))
      moveMouse(TRACK_LEFT + 250.025) // 5.0005s — clamps from above
      releaseMouse()

      expect(onKeyframeMoved).toHaveBeenCalledTimes(2)
      expect(onKeyframeMoved.mock.calls[0][2]).toBeLessThan(5)
      expect(onKeyframeMoved.mock.calls[1][2]).toBeGreaterThan(5)
      expect(onAnnounce).not.toHaveBeenCalledWith(
        expect.stringContaining('another keyframe')
      )
    })

    it('leaves the dragState idle once a clamped drop lands', () => {
      const { result } = render({ allKeyframeTimes: [1, 5, 9] })

      act(() => result.current.startDrag('opacity', keyframe(0), mouseDownEvent()))
      moveMouse(TRACK_LEFT + 250)
      releaseMouse()

      expect(result.current.dragState).toEqual({
        isDragging: false,
        keyframe: null,
        property: null,
        originalTime: 0,
        currentTime: 0,
      })
    })

    it('does not clamp a drop near, but not within epsilon of, a keyframe', () => {
      const { result, onKeyframeMoved } = render({ allKeyframeTimes: [1, 5.5, 9] })

      act(() => result.current.startDrag('opacity', keyframe(0), mouseDownEvent()))
      moveMouse(TRACK_LEFT + 250) // 5.0s — 0.5s from the neighbour, nowhere near it
      releaseMouse()

      expect(onKeyframeMoved).toHaveBeenCalledExactlyOnceWith('opacity', 0, 5)
    })

    // The release-time refusal in `handleMouseUp` is kept as a backstop (the
    // same rule the keyboard's `nudgeTime` enforces for its own entry point)
    // but should now be unreachable by a mouse drag, since the clamp above
    // runs on every move first. Landing exactly on a neighbour used to be
    // the refusal's own trigger case; it now lands clamped instead.
    it('never announces the occupied-neighbour refusal from a mouse drag', () => {
      const { result, onAnnounce } = render({ allKeyframeTimes: [1, 5, 9] })

      act(() => result.current.startDrag('opacity', keyframe(0), mouseDownEvent()))
      moveMouse(TRACK_LEFT + 250) // exactly 5s — used to be refused outright
      releaseMouse()

      for (const call of onAnnounce.mock.calls) {
        expect(call[0]).not.toContain('another keyframe is at')
      }
    })
  })

  describe('finishing the drag', () => {
    it('reports the move and returns to idle', () => {
      const { result, onKeyframeMoved } = render()

      act(() => result.current.startDrag('scaleX', keyframe(2), mouseDownEvent()))
      moveMouse(TRACK_LEFT + 250)
      releaseMouse()

      expect(onKeyframeMoved).toHaveBeenCalledExactlyOnceWith('scaleX', 2, 5)
      expect(result.current.dragState).toEqual({
        isDragging: false,
        keyframe: null,
        property: null,
        originalTime: 0,
        currentTime: 0,
      })
    })

    it('reports nothing when the keyframe was not actually moved', () => {
      const { result, onKeyframeMoved } = render()

      act(() => result.current.startDrag('scaleX', keyframe(5), mouseDownEvent()))
      moveMouse(TRACK_LEFT + 250) // lands back on 5s
      releaseMouse()

      expect(onKeyframeMoved).not.toHaveBeenCalled()
      expect(result.current.dragState.isDragging).toBe(false)
    })

    it('reports nothing for a click with no movement', () => {
      const { result, onKeyframeMoved } = render()

      act(() => result.current.startDrag('opacity', keyframe(3), mouseDownEvent()))
      releaseMouse()

      expect(onKeyframeMoved).not.toHaveBeenCalled()
    })

    it('commits once when two mouseups land before React re-renders', () => {
      // The window pair is unbound by a re-render, so a second mouseup in the
      // same batch still reaches the handler — with the ref already idle. It
      // must neither commit again nor announce anything.
      const { result, onKeyframeMoved, onAnnounce } = render()

      act(() => result.current.startDrag('scaleX', keyframe(2), mouseDownEvent()))
      moveMouse(TRACK_LEFT + 250)
      act(() => {
        window.dispatchEvent(new MouseEvent('mouseup'))
        window.dispatchEvent(new MouseEvent('mouseup'))
      })

      expect(onKeyframeMoved).toHaveBeenCalledExactlyOnceWith('scaleX', 2, 5)
      expect(onAnnounce).toHaveBeenCalledExactlyOnceWith('')
      expect(result.current.dragState.isDragging).toBe(false)
    })

    it('stops tracking the mouse after the drag ends', () => {
      const { result } = render()

      act(() => result.current.startDrag('opacity', keyframe(2), mouseDownEvent()))
      releaseMouse()
      moveMouse(TRACK_LEFT + 400)

      expect(result.current.dragState.currentTime).toBe(0)
    })
  })

  it('detaches its window listeners on unmount', () => {
    const { result, unmount, onKeyframeMoved } = render()

    act(() => result.current.startDrag('opacity', keyframe(2), mouseDownEvent()))
    unmount()

    window.dispatchEvent(new MouseEvent('mousemove', { clientX: TRACK_LEFT + 400 }))
    window.dispatchEvent(new MouseEvent('mouseup'))

    expect(onKeyframeMoved).not.toHaveBeenCalled()
  })
})
