// Click-to-seek, on the ruler and on the track area.
//
// The ruler's handler has one job. The track area's is mostly a list of
// reasons not to act — a drag, a scrub, the click that ends a marquee, a click
// on the playhead — so most of these tests are about what does *not* happen,
// and about the one case where the seek runs but the selection survives
// (a click that landed on a clip).
//
// Both surfaces sit at client X 100 with a scale of 50px per second, so client
// X 225 is 2.5s on either; the ruler is given the same left edge deliberately,
// so a handler reading the wrong element would not be hidden by the maths.
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type React from 'react'
import { useTimelineSeek, type TimelineSeekDeps } from './useTimelineSeek'
import { useEditorStore } from '../../store/projectStore'
import { addClip, resetStoreForTest, store } from '../../test/fixtures/projectStore'
import { setRect } from '../../test/doubles/layout'
import type { DragState } from './types'

/** The timeline's default scale: one second is 50px at zoom 1. */
const PPS = 50
/** Client X of both surfaces' left edge — the timeline's t=0. */
const LEFT = 100

let container: HTMLDivElement
let ruler: HTMLDivElement
let containerRef: { current: HTMLDivElement | null }
let rulerRef: { current: HTMLDivElement | null }
let marqueeJustFinishedRef: { current: boolean }
let actions: {
  setIsPlaying: MockInstance
  setCurrentTime: MockInstance
  setSelectedClipId: MockInstance
  clearMultiSelection: MockInstance
}
/** Overrides applied over the defaults by the test that needs them. */
let overrides: Partial<TimelineSeekDeps>

beforeEach(() => {
  resetStoreForTest()

  container = document.createElement('div')
  setRect(container, { left: LEFT, top: 0, width: 800, height: 200 })
  ruler = document.createElement('div')
  setRect(ruler, { left: LEFT, top: 0, width: 800, height: 24 })
  document.body.append(container, ruler)
  containerRef = { current: container }
  rulerRef = { current: ruler }
  marqueeJustFinishedRef = { current: false }
  overrides = {}

  const state = useEditorStore.getState()
  actions = {
    setIsPlaying: vi.fn(state.setIsPlaying),
    setCurrentTime: vi.fn(state.setCurrentTime),
    setSelectedClipId: vi.fn(state.setSelectedClipId),
    clearMultiSelection: vi.fn(state.clearMultiSelection),
  }
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

/** The hook's inputs, read fresh from the store on every render. */
const deps = (): TimelineSeekDeps => {
  const state = useEditorStore.getState()
  return {
    rulerRef,
    trackContainerRef: containerRef,
    pixelsPerSecond: PPS,
    timelineDuration: state.project.timeline.duration,
    minTimelineDuration: Math.max(state.project.timeline.duration, 60),
    isPlaying: state.isPlaying,
    isDraggingPlayhead: false,
    dragState: null,
    marqueeJustFinishedRef,
    ...(actions as unknown as Pick<
      TimelineSeekDeps,
      'setIsPlaying' | 'setCurrentTime' | 'setSelectedClipId' | 'clearMultiSelection'
    >),
    ...overrides,
  }
}

const mountSeek = () =>
  renderHook(() => {
    useEditorStore((state) => state.isPlaying)
    return useTimelineSeek(deps())
  })

/** A click on `target` at a time on the timeline. */
const clickAt = (seconds: number, target: Element): React.MouseEvent =>
  ({ clientX: LEFT + seconds * PPS, target }) as unknown as React.MouseEvent

const currentTime = () => useEditorStore.getState().currentTime

describe('useTimelineSeek on the ruler', () => {
  it('seeks to the time under the pointer', () => {
    addClip('clip1', 0, 4)
    const { result } = mountSeek()

    act(() => result.current.handleRulerClick(clickAt(2.5, ruler)))

    expect(actions.setCurrentTime).toHaveBeenCalledWith(2.5)
    expect(currentTime()).toBe(2.5)
  })

  it('accounts for what is scrolled out of view to the left', () => {
    addClip('clip1', 0, 10)
    ruler.scrollLeft = 100 // two seconds
    const { result } = mountSeek()

    act(() => result.current.handleRulerClick(clickAt(2.5, ruler)))

    expect(actions.setCurrentTime).toHaveBeenCalledWith(4.5)
  })

  it('pauses playback before seeking', () => {
    addClip('clip1', 0, 4)
    store().setIsPlaying(true)
    const { result } = mountSeek()

    act(() => result.current.handleRulerClick(clickAt(2.5, ruler)))

    expect(actions.setIsPlaying).toHaveBeenCalledWith(false)
    expect(useEditorStore.getState().isPlaying).toBe(false)
  })

  it('leaves a paused timeline paused', () => {
    addClip('clip1', 0, 4)
    const { result } = mountSeek()

    act(() => result.current.handleRulerClick(clickAt(2.5, ruler)))

    expect(actions.setIsPlaying).not.toHaveBeenCalled()
  })

  it('clamps the seek to the end of the timeline', () => {
    addClip('clip1', 0, 4)
    const { result } = mountSeek()

    act(() => result.current.handleRulerClick(clickAt(90, ruler)))

    expect(actions.setCurrentTime).toHaveBeenCalledWith(4)
  })

  it('seeks anywhere in the ruler it draws when the timeline is empty', () => {
    // A carried quirk: with no clips the duration is 0, and the ruler alone
    // falls back to the 60s floor it is drawn against rather than pinning the
    // playhead at 0 the way a track click does.
    const { result } = mountSeek()

    act(() => result.current.handleRulerClick(clickAt(2.5, ruler)))

    expect(actions.setCurrentTime).toHaveBeenCalledWith(2.5)
  })

  it('does nothing when the ruler has gone', () => {
    addClip('clip1', 0, 4)
    const { result } = mountSeek()
    rulerRef.current = null

    act(() => result.current.handleRulerClick(clickAt(2.5, ruler)))

    expect(actions.setCurrentTime).not.toHaveBeenCalled()
  })
})

describe('useTimelineSeek on the track area', () => {
  /** An element that reads as bare track space. */
  const bare = () => {
    const el = document.createElement('div')
    container.appendChild(el)
    return el
  }

  /** An element that reads as part of a clip. */
  const onClip = () => {
    const el = bare()
    el.setAttribute('data-clip-id', 'clip1')
    return el
  }

  /** An element that reads as the playhead. */
  const onPlayhead = () => {
    const el = bare()
    el.setAttribute('data-playhead', '')
    return el
  }

  it('seeks and clears the selection for a click on bare track', () => {
    addClip('clip1', 0, 4)
    store().setSelectedClipId('clip1')
    const { result } = mountSeek()

    act(() => result.current.handleTrackClick(clickAt(2.5, bare())))

    expect(actions.setCurrentTime).toHaveBeenCalledWith(2.5)
    expect(actions.clearMultiSelection).toHaveBeenCalled()
    expect(actions.setSelectedClipId).toHaveBeenCalledWith(null)
    expect(useEditorStore.getState().selectedClipId).toBeNull()
  })

  it('seeks but keeps the selection for a click that landed on a clip', () => {
    addClip('clip1', 0, 4)
    store().setSelectedClipId('clip1')
    const { result } = mountSeek()

    act(() => result.current.handleTrackClick(clickAt(2.5, onClip())))

    expect(actions.setCurrentTime).toHaveBeenCalledWith(2.5)
    expect(actions.clearMultiSelection).not.toHaveBeenCalled()
    expect(useEditorStore.getState().selectedClipId).toBe('clip1')
  })

  it('pauses playback before seeking', () => {
    addClip('clip1', 0, 4)
    store().setIsPlaying(true)
    const { result } = mountSeek()

    act(() => result.current.handleTrackClick(clickAt(2.5, bare())))

    expect(actions.setIsPlaying).toHaveBeenCalledWith(false)
  })

  it('pins the playhead at 0 while the timeline is empty', () => {
    const { result } = mountSeek()

    act(() => result.current.handleTrackClick(clickAt(2.5, bare())))

    expect(actions.setCurrentTime).toHaveBeenCalledWith(0)
  })

  it('does nothing for the click that ended a marquee, and forgets it happened', () => {
    addClip('clip1', 0, 4)
    marqueeJustFinishedRef.current = true
    const { result } = mountSeek()

    act(() => result.current.handleTrackClick(clickAt(2.5, bare())))

    expect(actions.setCurrentTime).not.toHaveBeenCalled()
    expect(actions.clearMultiSelection).not.toHaveBeenCalled()
    expect(marqueeJustFinishedRef.current).toBe(false)

    // The next click is an ordinary one again.
    act(() => result.current.handleTrackClick(clickAt(2.5, bare())))
    expect(actions.setCurrentTime).toHaveBeenCalledWith(2.5)
  })

  it('does nothing while a clip is being dragged', () => {
    addClip('clip1', 0, 4)
    overrides.dragState = { clipId: 'clip1' } as unknown as DragState
    const { result } = mountSeek()

    act(() => result.current.handleTrackClick(clickAt(2.5, bare())))

    expect(actions.setCurrentTime).not.toHaveBeenCalled()
  })

  it('does nothing while the playhead is being scrubbed', () => {
    addClip('clip1', 0, 4)
    overrides.isDraggingPlayhead = true
    const { result } = mountSeek()

    act(() => result.current.handleTrackClick(clickAt(2.5, bare())))

    expect(actions.setCurrentTime).not.toHaveBeenCalled()
  })

  it('does nothing when the track area has gone', () => {
    addClip('clip1', 0, 4)
    const { result } = mountSeek()
    containerRef.current = null

    act(() => result.current.handleTrackClick(clickAt(2.5, bare())))

    expect(actions.setCurrentTime).not.toHaveBeenCalled()
  })

  it('neither seeks nor deselects for a click on the playhead', () => {
    addClip('clip1', 0, 4)
    store().setSelectedClipId('clip1')
    const { result } = mountSeek()

    act(() => result.current.handleTrackClick(clickAt(2.5, onPlayhead())))

    expect(actions.setCurrentTime).not.toHaveBeenCalled()
    expect(actions.clearMultiSelection).not.toHaveBeenCalled()
    expect(useEditorStore.getState().selectedClipId).toBe('clip1')
  })
})
