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
  const hook = renderHook(() =>
    useKeyframeDrag(
      CLIP_DURATION,
      options.playheadTime ?? -1,
      options.allKeyframeTimes ?? [],
      onKeyframeMoved
    )
  )
  hook.result.current.trackRef.current = trackElement()
  return { ...hook, onKeyframeMoved }
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
    const { result } = renderHook(() =>
      useKeyframeDrag(CLIP_DURATION, -1, [], onKeyframeMoved)
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

    it('snaps to another keyframe on the track', () => {
      const { result } = render({ allKeyframeTimes: [1, 5.04, 9] })

      act(() => result.current.startDrag('opacity', keyframe(0), mouseDownEvent()))
      moveMouse(TRACK_LEFT + 250)

      expect(result.current.dragState.currentTime).toBe(5.04)
    })

    it('never snaps a keyframe back to where it started', () => {
      const { result } = render({ allKeyframeTimes: [5.04] })

      act(() => result.current.startDrag('opacity', keyframe(5.04), mouseDownEvent()))
      moveMouse(TRACK_LEFT + 250)

      expect(result.current.dragState.currentTime).toBe(5)
    })

    it('prefers the playhead over a nearby keyframe', () => {
      const { result } = render({ playheadTime: 5.02, allKeyframeTimes: [5.04] })

      act(() => result.current.startDrag('opacity', keyframe(0), mouseDownEvent()))
      moveMouse(TRACK_LEFT + 250)

      expect(result.current.dragState.currentTime).toBe(5.02)
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
