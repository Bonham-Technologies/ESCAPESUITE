// A trim of a caption that already overlaps another (ESCSUITE-308), through the
// real hook and the real store.
//
// `addCaptionCues` keeps a caption file's overlapping cues where the file put
// them, on the one Captions track. Before the fix the first move of the long
// cue's end handle clamped the pointer to the start of the cue inside it, so a
// 9 s caption became 1 s; its start handle clamped to that cue's end. A clip it
// did not overlap when the trim began still stops it (ESCSUITE-161).
//
// The scene: a Captions track holding a 1-10 s cue with a 2-3 s cue inside it,
// a track container whose left edge is at client X 100, and 50 px per second,
// so client X 625 is 10.5 s.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type React from 'react'
import { useTrimDrag, type TrimDragDeps } from './useTrimDrag'
import { useEditorStore } from '../../store/projectStore'
import { captionStyleFor } from '../../core/captions'
import { resetStoreForTest, store } from '../../test/fixtures/projectStore'
import { setRect } from '../../test/doubles/layout'

const PPS = 50
const LEFT = 100

let containerRef: { current: HTMLDivElement | null }
let actions: Pick<TrimDragDeps, 'setSelectedClipId' | 'trimClip' | 'shiftClipsAfter' | 'setClipTimelinePosition'>

const style = captionStyleFor({ width: 1920, height: 1080 })

beforeEach(() => {
  resetStoreForTest()

  const container = document.createElement('div')
  setRect(container, { left: LEFT, top: 0, width: 1000, height: 200 })
  document.body.appendChild(container)
  containerRef = { current: container }

  const state = useEditorStore.getState()
  actions = {
    setSelectedClipId: vi.fn(state.setSelectedClipId),
    trimClip: vi.fn(state.trimClip),
    shiftClipsAfter: vi.fn(state.shiftClipsAfter),
    setClipTimelinePosition: vi.fn(state.setClipTimelinePosition),
  }
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

const deps = (): TrimDragDeps => {
  const state = useEditorStore.getState()
  return {
    trackContainerRef: containerRef,
    pixelsPerSecond: PPS,
    clips: state.project.timeline.clips,
    sourceVideos: state.sourceVideos,
    tracks: state.project.timeline.tracks,
    activeTool: state.activeTool,
    ...actions,
  }
}

const mountTrim = () =>
  renderHook(() => {
    useEditorStore((state) => state.project.timeline.clips)
    return useTrimDrag(deps())
  })

/** The caption clip whose text is `text`, as the store holds it now. */
const cue = (text: string) =>
  useEditorStore.getState().project.timeline.clips.find((c) => c.name === text)!

function grab(result: { current: ReturnType<typeof useTrimDrag> }, text: string, edge: 'start' | 'end') {
  const event = { stopPropagation: vi.fn(), preventDefault: vi.fn() } as unknown as React.MouseEvent
  act(() => {
    result.current.handleTrimMouseDown(event, cue(text), edge)
  })
}

const moveTo = (seconds: number) =>
  act(() => {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: LEFT + seconds * PPS }))
  })

const release = () =>
  act(() => {
    document.dispatchEvent(new MouseEvent('mouseup'))
  })

describe('useTrimDrag over a pre-existing caption overlap (ESCSUITE-308)', () => {
  beforeEach(() => {
    store().addCaptionCues(
      [
        { start: 1, end: 10, text: 'Long' },
        { start: 2, end: 3, text: 'Inner' },
      ],
      style
    )
  })

  it('trims the long cue’s end out past the cue inside it', () => {
    const { result } = mountTrim()

    grab(result, 'Long', 'end')
    moveTo(10.5)
    release()

    const long = cue('Long')
    expect(long.timelinePosition).toBe(1)
    expect(long.timelinePosition + long.duration).toBe(10.5)
  })

  it('trims the long cue’s start back past the cue inside it', () => {
    const { result } = mountTrim()

    grab(result, 'Long', 'start')
    moveTo(0.5)
    release()

    const long = cue('Long')
    expect(long.timelinePosition).toBe(0.5)
    expect(long.timelinePosition + long.duration).toBe(10)
  })

  it('still stops at a cue it did not overlap when the trim began', () => {
    store().addCaptionCues([{ start: 12, end: 13, text: 'After' }], style)
    const { result } = mountTrim()

    grab(result, 'Long', 'end')
    moveTo(14)
    release()

    const long = cue('Long')
    expect(long.timelinePosition + long.duration).toBe(12)
  })
})
