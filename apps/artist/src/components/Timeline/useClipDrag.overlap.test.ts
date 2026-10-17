// A drag of a caption that already overlaps another (ESCSUITE-308), through the
// real hook and the real store.
//
// `addCaptionCues` keeps a caption file's overlapping cues where the file put
// them, on the one Captions track. Before the fix the single-clip veto
// (`wouldOverlap`) and the group veto (`canMoveSelectedClips`) both read the
// pair as already colliding and refused every drag of either cue. A drag may
// now keep — or change — an overlap it found when it began, and still may not
// make one with a clip it did not overlap.
//
// The scene: a 60 px Captions row holding a 1-10 s cue with a 2-3 s cue inside
// it and a 12-14 s cue after it, a track container whose left edge is at client
// X 100, and 50 px per second. The pointer takes hold of the long cue 20 px
// into it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type React from 'react'
import { useClipDrag, type ClipDragDeps } from './useClipDrag'
import { useEditorStore } from '../../store/projectStore'
import { captionStyleFor } from '../../core/captions'
import { resetStoreForTest, store } from '../../test/fixtures/projectStore'
import { setRect } from '../../test/doubles/layout'

const PPS = 50
const LEFT = 100
const GRAB = 20

let containerRef: { current: HTMLDivElement | null }
let actions: Pick<
  ClipDragDeps,
  | 'setSelectedClipId'
  | 'toggleClipSelection'
  | 'moveSelectedClips'
  | 'setClipTimelinePosition'
  | 'moveClipToTrack'
  | 'splitClip'
>

const style = captionStyleFor({ width: 1920, height: 1080 })

beforeEach(() => {
  resetStoreForTest()
  // Snapping off: the pointer says exactly where the clip lands.
  useEditorStore.setState({ snapEnabled: false })
  const { trackId } = store().addCaptionCues(
    [
      { start: 1, end: 10, text: 'Long' },
      { start: 2, end: 3, text: 'Inner' },
      { start: 12, end: 14, text: 'Third' },
    ],
    style
  )!

  const container = document.createElement('div')
  setRect(container, { left: LEFT, top: 0, width: 1000, height: 200 })
  const row = document.createElement('div')
  row.setAttribute('data-track-id', trackId)
  setRect(row, { left: LEFT, top: 0, width: 1000, height: 60 })
  container.appendChild(row)
  document.body.appendChild(container)
  containerRef = { current: container }

  const state = useEditorStore.getState()
  actions = {
    setSelectedClipId: vi.fn(state.setSelectedClipId),
    toggleClipSelection: vi.fn(state.toggleClipSelection),
    moveSelectedClips: vi.fn(state.moveSelectedClips),
    setClipTimelinePosition: vi.fn(state.setClipTimelinePosition),
    moveClipToTrack: vi.fn(state.moveClipToTrack),
    splitClip: vi.fn(state.splitClip),
  }
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

const deps = (): ClipDragDeps => {
  const state = useEditorStore.getState()
  return {
    trackContainerRef: containerRef,
    pixelsPerSecond: PPS,
    clips: state.project.timeline.clips,
    tracks: state.project.timeline.tracks,
    snapEnabled: state.snapEnabled,
    snapThreshold: state.snapThreshold,
    selectedClipIds: state.selectedClipIds,
    activeTool: state.activeTool,
    ...actions,
  }
}

const mountDrag = () =>
  renderHook(() => {
    useEditorStore((state) => state.project.timeline.clips)
    useEditorStore((state) => state.selectedClipIds)
    return useClipDrag(deps())
  })

/** The caption clip whose text is `text`, as the store holds it now. */
const cue = (text: string) =>
  useEditorStore.getState().project.timeline.clips.find((c) => c.name === text)!

/** Take hold of the long cue `GRAB` px into it. */
function grabLong(result: { current: ReturnType<typeof useClipDrag> }) {
  const long = cue('Long')
  const el = document.createElement('div')
  setRect(el, { left: LEFT + long.timelinePosition * PPS, top: 0, width: long.duration * PPS, height: 60 })
  const event = {
    clientX: LEFT + long.timelinePosition * PPS + GRAB,
    clientY: 10,
    ctrlKey: false,
    metaKey: false,
    currentTarget: el,
    target: el,
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
  } as unknown as React.MouseEvent
  act(() => {
    result.current.handleClipMouseDown(event, long)
  })
}

/** Move the pointer so the long cue's start would be at `seconds`, then let go. */
function dropLongAt(seconds: number) {
  act(() => {
    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: LEFT + seconds * PPS + GRAB, clientY: 10 })
    )
  })
  act(() => {
    document.dispatchEvent(new MouseEvent('mouseup'))
  })
}

describe('useClipDrag over a pre-existing caption overlap (ESCSUITE-308)', () => {
  it('drags the long cue a second later, still over the cue inside it', () => {
    const { result } = mountDrag()

    grabLong(result)
    dropLongAt(2)

    expect(cue('Long').timelinePosition).toBe(2)
    expect(actions.setClipTimelinePosition).toHaveBeenCalledTimes(1)
  })

  it('still refuses to drop the long cue onto a cue it did not overlap', () => {
    const { result } = mountDrag()

    grabLong(result)
    dropLongAt(4)

    expect(cue('Long').timelinePosition).toBe(1)
    expect(actions.setClipTimelinePosition).not.toHaveBeenCalled()
  })

  it('drags the two overlapping cues together as a group', () => {
    store().selectClipsInRange([cue('Long').id, cue('Inner').id])
    const { result } = mountDrag()

    grabLong(result)
    dropLongAt(1.5)

    expect(actions.moveSelectedClips).toHaveBeenCalledTimes(1)
    expect(cue('Long').timelinePosition).toBe(1.5)
    expect(cue('Inner').timelinePosition).toBe(2.5)
  })
})
