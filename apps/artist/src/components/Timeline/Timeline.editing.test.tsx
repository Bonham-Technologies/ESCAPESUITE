// The timeline's editing gestures: razor, selection, drag, snap, trim, ripple
// and marquee.
//
// Every one of these turns a mouse coordinate into a time, so the ruler, the
// track container, each track row and each clip are given the layout box they
// would have in a browser (see src/test/doubles/layout.ts). At the default zoom
// one second is 50px, and the snap threshold of 10px is therefore 0.2s.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { Timeline } from './Timeline'
import { resetStoreForTest, store, addClip, video } from '../../test/fixtures/projectStore'
import { setRect } from '../../test/doubles/layout'
import { installResizeObserverDouble, type ResizeObserverDouble } from '../../test/doubles/resizeObserver'
import styles from './Timeline.module.css'
import marqueeStyles from '../Preview/MarqueeSelection.module.css'

const PPS = 50
const TRACK_HEIGHT = 60

interface Rendered {
  root: HTMLElement
  trackContainer: HTMLElement
  /** Re-measure after a render that replaced nodes. */
  relayout: () => void
  clip: (id: string) => HTMLElement
  trimHandles: (id: string) => HTMLElement[]
}

function renderTimeline(): Rendered {
  const { container } = render(<Timeline />)
  const root = container.firstElementChild as HTMLElement
  const trackContainer = root.querySelector(`.${styles.trackContainer}`) as HTMLElement

  const relayout = () => {
    setRect(trackContainer, { left: 0, top: 0, width: 1000, height: 200 })
    const trackEls = [...root.querySelectorAll('[data-track-id]')] as HTMLElement[]
    trackEls.forEach((el, i) =>
      setRect(el, { left: 0, top: i * TRACK_HEIGHT, width: 5000, height: TRACK_HEIGHT })
    )
    for (const el of root.querySelectorAll('[data-clip-id]')) {
      const id = el.getAttribute('data-clip-id')
      const clip = store().project.timeline.clips.find((c) => c.id === id)
      if (clip) {
        setRect(el, {
          left: clip.timelinePosition * PPS,
          top: 0,
          width: clip.duration * PPS,
          height: TRACK_HEIGHT,
        })
      }
    }
  }
  relayout()

  return {
    root,
    trackContainer,
    relayout,
    clip: (id) => root.querySelector(`[data-clip-id="${id}"]`) as HTMLElement,
    trimHandles: (id) =>
      [
        ...(root.querySelector(`[data-clip-id="${id}"]`) as HTMLElement).querySelectorAll(
          `.${styles.trimHandle}`
        ),
      ] as HTMLElement[],
  }
}

const clipById = (id: string) => store().project.timeline.clips.find((c) => c.id === id)!

/** Press on a clip at `clientX`, drag to `to`, and release. */
function dragClip(view: Rendered, id: string, from: number, to: { x: number; y?: number }) {
  fireEvent.mouseDown(view.clip(id), { clientX: from, clientY: 10 })
  fireEvent.mouseMove(document, { clientX: to.x, clientY: to.y ?? 10 })
  fireEvent.mouseUp(document)
}

describe('Timeline razor tool', () => {
  let resizeObserver: ResizeObserverDouble

  beforeEach(() => {
    resetStoreForTest()
    resizeObserver = installResizeObserverDouble()
    addClip('clip1', 0, 2)
    store().setActiveTool('razor')
  })

  afterEach(() => {
    resizeObserver.uninstall()
  })

  it('splits the clip where it is clicked', () => {
    const view = renderTimeline()

    fireEvent.mouseDown(view.clip('clip1'), { clientX: 50, clientY: 10 })

    expect(store().project.timeline.clips.map((c) => c.duration)).toEqual([1, 1])
  })

  it('refuses to split within 100ms of a clip edge', () => {
    const view = renderTimeline()

    fireEvent.mouseDown(view.clip('clip1'), { clientX: 2, clientY: 10 })
    fireEvent.mouseDown(view.clip('clip1'), { clientX: 98, clientY: 10 })

    expect(store().project.timeline.clips).toHaveLength(1)
  })

  it('leaves a locked track alone', () => {
    store().updateTrack(clipById('clip1').trackId, { locked: true })
    const view = renderTimeline()

    fireEvent.mouseDown(view.clip('clip1'), { clientX: 50, clientY: 10 })

    expect(store().project.timeline.clips).toHaveLength(1)
  })

  it('starts no drag while the razor is out', () => {
    const view = renderTimeline()

    fireEvent.mouseDown(view.clip('clip1'), { clientX: 50, clientY: 10 })
    view.relayout()
    fireEvent.mouseMove(document, { clientX: 400, clientY: 10 })
    fireEvent.mouseUp(document)

    // The split happened; nothing moved
    expect(store().project.timeline.clips.map((c) => c.timelinePosition)).toEqual([0, 1])
  })
})

describe('Timeline clip selection', () => {
  let resizeObserver: ResizeObserverDouble

  beforeEach(() => {
    resetStoreForTest()
    resizeObserver = installResizeObserverDouble()
    addClip('clip1', 0, 2)
    addClip('clip2', 4, 2)
  })

  afterEach(() => {
    resizeObserver.uninstall()
  })

  it('selects the clip that is pressed', () => {
    const view = renderTimeline()

    fireEvent.mouseDown(view.clip('clip2'), { clientX: 210, clientY: 10 })

    expect(store().selectedClipId).toBe('clip2')
  })

  it('adds and removes clips from the multi-selection with ctrl-click', () => {
    const view = renderTimeline()

    fireEvent.mouseDown(view.clip('clip1'), { clientX: 10, clientY: 10, ctrlKey: true })
    fireEvent.mouseDown(view.clip('clip2'), { clientX: 210, clientY: 10, ctrlKey: true })
    expect([...store().selectedClipIds]).toEqual(['clip1', 'clip2'])

    fireEvent.mouseDown(view.clip('clip1'), { clientX: 10, clientY: 10, ctrlKey: true })
    expect([...store().selectedClipIds]).toEqual(['clip2'])
  })

  it('treats cmd-click the same as ctrl-click', () => {
    const view = renderTimeline()

    fireEvent.mouseDown(view.clip('clip1'), { clientX: 10, clientY: 10, metaKey: true })

    expect([...store().selectedClipIds]).toEqual(['clip1'])
  })

  it('keeps a multi-selection intact when one of its clips is pressed', () => {
    store().selectClipsInRange(['clip1', 'clip2'])
    const view = renderTimeline()

    fireEvent.mouseDown(view.clip('clip1'), { clientX: 10, clientY: 10 })

    expect([...store().selectedClipIds]).toEqual(['clip1', 'clip2'])
  })
})

describe('Timeline clip dragging', () => {
  let resizeObserver: ResizeObserverDouble

  beforeEach(() => {
    resetStoreForTest()
    resizeObserver = installResizeObserverDouble()
    addClip('clip1', 0, 2)
  })

  afterEach(() => {
    resizeObserver.uninstall()
  })

  it('moves the clip to where it was dropped', () => {
    const view = renderTimeline()

    dragClip(view, 'clip1', 20, { x: 320 })

    expect(clipById('clip1').timelinePosition).toBe(6)
  })

  it('never drags a clip before the start of the timeline', () => {
    store().setClipTimelinePosition('clip1', 4)
    const view = renderTimeline()
    view.relayout()

    dragClip(view, 'clip1', 210, { x: -100 })

    expect(clipById('clip1').timelinePosition).toBe(0)
  })

  it('leaves a locked track alone', () => {
    store().updateTrack(clipById('clip1').trackId, { locked: true })
    const view = renderTimeline()

    dragClip(view, 'clip1', 20, { x: 320 })

    expect(clipById('clip1').timelinePosition).toBe(0)
  })

  it('snaps the dragged clip start to a neighbouring clip edge', () => {
    store().addTrack()
    addClip('clip2', 8, 2, store().project.timeline.tracks[1].id)
    const view = renderTimeline()
    view.relayout()

    // 415 - 20 offset = 395px = 7.9s, within the 0.2s snap of clip2's start.
    // y stays on clip1's own row, which is the lower of the two.
    dragClip(view, 'clip1', 20, { x: 415, y: 70 })

    expect(clipById('clip1').timelinePosition).toBe(8)
  })

  it('snaps the dragged clip end to a neighbouring clip edge', () => {
    store().addTrack()
    addClip('clip2', 8, 2, store().project.timeline.tracks[1].id)
    const view = renderTimeline()
    view.relayout()

    // 315 - 20 = 295px = 5.9s, so the clip end at 7.9s snaps to 8 and the
    // start lands at 6
    dragClip(view, 'clip1', 20, { x: 315, y: 70 })

    expect(clipById('clip1').timelinePosition).toBe(6)
  })

  it('drops the clip exactly where it was let go once snapping is off', () => {
    store().setSnapEnabled(false)
    store().addTrack()
    addClip('clip2', 8, 2, store().project.timeline.tracks[1].id)
    const view = renderTimeline()
    view.relayout()

    dragClip(view, 'clip1', 20, { x: 415, y: 70 })

    expect(clipById('clip1').timelinePosition).toBeCloseTo(7.9)
  })

  it('draws a snap line while the drag is snapped', () => {
    store().addTrack()
    addClip('clip2', 8, 2, store().project.timeline.tracks[1].id)
    const view = renderTimeline()
    view.relayout()

    fireEvent.mouseDown(view.clip('clip1'), { clientX: 20, clientY: 70 })
    fireEvent.mouseMove(document, { clientX: 415, clientY: 70 })

    expect(view.root.querySelector(`.${styles.snapLine}`)).toHaveStyle({ left: '400px' })

    fireEvent.mouseUp(document)
    expect(view.root.querySelector(`.${styles.snapLine}`)).toBeNull()
  })

  it('refuses a drop that would overlap another clip on the same track', () => {
    addClip('clip2', 6, 2, clipById('clip1').trackId)
    const view = renderTimeline()
    view.relayout()

    dragClip(view, 'clip1', 20, { x: 320 })

    expect(clipById('clip1').timelinePosition).toBe(0)
    expect(clipById('clip2').timelinePosition).toBe(6)
  })

  it('moves the clip to the track the mouse ends over', () => {
    store().addTrack()
    const view = renderTimeline()
    view.relayout()
    const topTrack = store().project.timeline.tracks[1]

    // The rows render highest index first, so y inside the first row is the
    // track that was added last
    fireEvent.mouseDown(view.clip('clip1'), { clientX: 20, clientY: 70 })
    fireEvent.mouseMove(document, { clientX: 320, clientY: 30 })
    expect(view.root.querySelector(`.${styles.clipPreview}`)).toBeInTheDocument()
    fireEvent.mouseUp(document)

    expect(clipById('clip1').trackId).toBe(topTrack.id)
    expect(clipById('clip1').timelinePosition).toBe(6)
  })

  it('moves every selected clip together', () => {
    store().addTrack()
    addClip('clip2', 0, 2, store().project.timeline.tracks[1].id)
    store().selectClipsInRange(['clip1', 'clip2'])
    const view = renderTimeline()
    view.relayout()

    fireEvent.mouseDown(view.clip('clip1'), { clientX: 20, clientY: 70 })
    fireEvent.mouseMove(document, { clientX: 220, clientY: 70 })
    expect(view.root.querySelector(`[data-clip-id="clip2"]`)).toHaveStyle({ left: '200px' })
    fireEvent.mouseUp(document)

    expect(clipById('clip1').timelinePosition).toBe(4)
    expect(clipById('clip2').timelinePosition).toBe(4)
  })
})

describe('Timeline trimming', () => {
  let resizeObserver: ResizeObserverDouble

  beforeEach(() => {
    resetStoreForTest()
    resizeObserver = installResizeObserverDouble()
  })

  afterEach(() => {
    resizeObserver.uninstall()
  })

  it('trims a video clip in from its start', () => {
    addClip('clip1', 0, 2)
    const view = renderTimeline()

    fireEvent.mouseDown(view.trimHandles('clip1')[0], { clientX: 0 })
    fireEvent.mouseMove(document, { clientX: 25 })
    fireEvent.mouseUp(document)

    expect(clipById('clip1')).toMatchObject({ startTime: 0.5, timelinePosition: 0.5 })
    expect(store().selectedClipId).toBe('clip1')
  })

  it('never trims a video clip start past its own end', () => {
    addClip('clip1', 0, 2)
    const view = renderTimeline()

    fireEvent.mouseDown(view.trimHandles('clip1')[0], { clientX: 0 })
    fireEvent.mouseMove(document, { clientX: 500 })

    expect(clipById('clip1').startTime).toBeCloseTo(1.9)
  })

  it('trims a video clip in from its end, capped at the source duration', () => {
    addClip('clip1', 0, 2)
    const view = renderTimeline()

    fireEvent.mouseDown(view.trimHandles('clip1')[1], { clientX: 100 })
    fireEvent.mouseMove(document, { clientX: 150 })
    expect(clipById('clip1').endTime).toBe(3)

    // The source is 30s long, so nothing beyond that can be revealed
    fireEvent.mouseMove(document, { clientX: 5000 })
    expect(clipById('clip1').endTime).toBe(video.duration)
  })

  it('stretches an overlay clip from its end, which has no source to run out of', () => {
    store().addTextOverlayClip(undefined, undefined, 0, 2)
    const clipId = store().project.timeline.clips[0].id
    const view = renderTimeline()

    fireEvent.mouseDown(view.trimHandles(clipId)[1], { clientX: 100 })
    fireEvent.mouseMove(document, { clientX: 2000 })

    expect(clipById(clipId)).toMatchObject({ duration: 40, endTime: 40 })
  })

  it('stretches an overlay clip from its start', () => {
    store().addTextOverlayClip(undefined, undefined, 4, 2)
    const clipId = store().project.timeline.clips[0].id
    const view = renderTimeline()

    fireEvent.mouseDown(view.trimHandles(clipId)[0], { clientX: 200 })
    fireEvent.mouseMove(document, { clientX: 100 })

    expect(clipById(clipId)).toMatchObject({ timelinePosition: 2, duration: 4, endTime: 4 })
  })

  it('refuses to shrink an overlay clip below 100ms', () => {
    store().addTextOverlayClip(undefined, undefined, 0, 2)
    const clipId = store().project.timeline.clips[0].id
    const view = renderTimeline()

    fireEvent.mouseDown(view.trimHandles(clipId)[1], { clientX: 100 })
    fireEvent.mouseMove(document, { clientX: 1 })

    expect(clipById(clipId).duration).toBe(2)
  })

  it('leaves a locked track alone', () => {
    addClip('clip1', 0, 2)
    store().updateTrack(clipById('clip1').trackId, { locked: true })
    const view = renderTimeline()

    fireEvent.mouseDown(view.trimHandles('clip1')[0], { clientX: 0 })
    fireEvent.mouseMove(document, { clientX: 25 })

    expect(clipById('clip1').startTime).toBe(0)
  })

  it('closes the gap behind a ripple trim', () => {
    addClip('clip1', 0, 2)
    const trackId = clipById('clip1').trackId
    addClip('clip2', 2, 2, trackId)
    store().setActiveTool('ripple')
    const view = renderTimeline()
    view.relayout()

    // Pull clip1's end in from 2s to 1.5s
    fireEvent.mouseDown(view.trimHandles('clip1')[1], { clientX: 100 })
    fireEvent.mouseMove(document, { clientX: 75 })
    fireEvent.mouseUp(document)

    expect(clipById('clip1').endTime).toBe(1.5)
    expect(clipById('clip2').timelinePosition).toBe(1.5)
  })

  it('leaves following clips where they are for a plain trim', () => {
    addClip('clip1', 0, 2)
    const trackId = clipById('clip1').trackId
    addClip('clip2', 2, 2, trackId)
    const view = renderTimeline()
    view.relayout()

    fireEvent.mouseDown(view.trimHandles('clip1')[1], { clientX: 100 })
    fireEvent.mouseMove(document, { clientX: 75 })
    fireEvent.mouseUp(document)

    expect(clipById('clip2').timelinePosition).toBe(2)
  })
})

describe('Timeline marquee selection', () => {
  let resizeObserver: ResizeObserverDouble

  beforeEach(() => {
    resetStoreForTest()
    resizeObserver = installResizeObserverDouble()
    addClip('clip1', 0, 2)
    addClip('clip2', 4, 2)
    store().setSelectedClipId(null)
  })

  afterEach(() => {
    resizeObserver.uninstall()
  })

  const marquee = (
    view: Rendered,
    from: { x: number; y: number },
    to: { x: number; y: number },
    modifiers: { ctrlKey?: boolean } = {}
  ) => {
    fireEvent.mouseDown(view.trackContainer, { clientX: from.x, clientY: from.y })
    fireEvent.mouseMove(document, { clientX: to.x, clientY: to.y })
    fireEvent.mouseUp(document, { clientX: to.x, clientY: to.y, ...modifiers })
  }

  it('selects every clip the rectangle covers', () => {
    const view = renderTimeline()

    marquee(view, { x: 10, y: 10 }, { x: 400, y: 100 })

    expect([...store().selectedClipIds].sort()).toEqual(['clip1', 'clip2'])
  })

  it('shows the rectangle while it is being dragged and takes it away on release', () => {
    const view = renderTimeline()
    const box = () => view.root.querySelector(`.${marqueeStyles.marquee}`)

    fireEvent.mouseDown(view.trackContainer, { clientX: 10, clientY: 10 })
    expect(box()).toBeNull()

    fireEvent.mouseMove(document, { clientX: 200, clientY: 50 })
    expect(box()).toHaveStyle({ left: '10px', top: '10px', width: '190px', height: '40px' })

    fireEvent.mouseUp(document, { clientX: 200, clientY: 50 })
    expect(box()).toBeNull()
  })

  it('draws no rectangle for a press that never travels far enough', () => {
    const view = renderTimeline()

    fireEvent.mouseDown(view.trackContainer, { clientX: 10, clientY: 10 })
    fireEvent.mouseMove(document, { clientX: 12, clientY: 11 })

    expect(view.root.querySelector(`.${marqueeStyles.marquee}`)).toBeNull()
    fireEvent.mouseUp(document, { clientX: 12, clientY: 11 })
  })

  it('leaves clips outside the rectangle alone', () => {
    const view = renderTimeline()

    marquee(view, { x: 10, y: 10 }, { x: 120, y: 100 })

    expect([...store().selectedClipIds]).toEqual(['clip1'])
  })

  it('adds to the existing selection when ctrl is held on release', () => {
    store().selectClipsInRange(['clip2'])
    const view = renderTimeline()

    marquee(view, { x: 10, y: 10 }, { x: 120, y: 100 }, { ctrlKey: true })

    expect([...store().selectedClipIds].sort()).toEqual(['clip1', 'clip2'])
  })

  it('does not deselect on the click that ends a marquee', () => {
    const view = renderTimeline()

    marquee(view, { x: 10, y: 10 }, { x: 400, y: 100 })
    fireEvent.click(view.trackContainer, { clientX: 400 })

    expect(store().selectedClipIds.size).toBe(2)
  })

  it('treats a press that never travels as a plain click', () => {
    store().selectClipsInRange(['clip1'])
    const view = renderTimeline()

    marquee(view, { x: 10, y: 10 }, { x: 12, y: 11 })
    fireEvent.click(view.trackContainer, { clientX: 300 })

    expect(store().selectedClipIds.size).toBe(0)
    expect(store().currentTime).toBe(6)
  })

  it('starts no marquee from a press on a clip', () => {
    const view = renderTimeline()

    fireEvent.mouseDown(view.clip('clip1'), { clientX: 10, clientY: 10 })
    fireEvent.mouseMove(document, { clientX: 400, clientY: 100 })
    fireEvent.mouseUp(document)

    // The press started a drag, not a marquee
    expect(store().selectedClipIds.size).toBe(0)
    expect(store().selectedClipId).toBe('clip1')
  })
})

describe('Timeline tool cursors', () => {
  let resizeObserver: ResizeObserverDouble

  beforeEach(() => {
    resetStoreForTest()
    resizeObserver = installResizeObserverDouble()
  })

  afterEach(() => {
    resizeObserver.uninstall()
  })

  it.each([
    ['razor', styles.razorCursor],
    ['ripple', styles.rippleCursor],
  ] as const)('marks the track area while the %s tool is out', (tool, className) => {
    store().setActiveTool(tool)
    const view = renderTimeline()

    expect(view.trackContainer).toHaveClass(className)
  })

  it('leaves the track area unmarked for the selection tool', () => {
    const view = renderTimeline()

    expect(view.trackContainer).not.toHaveClass(styles.razorCursor)
    expect(view.trackContainer).not.toHaveClass(styles.rippleCursor)
  })
})

describe('Timeline clip appearance', () => {
  let resizeObserver: ResizeObserverDouble

  beforeEach(() => {
    resetStoreForTest()
    resizeObserver = installResizeObserverDouble()
  })

  afterEach(() => {
    resizeObserver.uninstall()
  })

  it.each([
    ['audio', styles.clipAudio],
    ['image', styles.clipImage],
  ] as const)('marks a %s clip', (mediaType, className) => {
    store().addSourceVideo({ ...video, id: 'other', mediaType })
    store().addClipToTimeline(
      { id: 'clip1', sourceVideoId: 'other', name: 'clip1', startTime: 0, endTime: 2, duration: 2 },
      undefined,
      0
    )
    const view = renderTimeline()

    expect(view.clip('clip1')).toHaveClass(className)
  })

  it('marks a text overlay clip', () => {
    const clip = store().addTextOverlayClip()
    const view = renderTimeline()

    expect(view.clip(clip.id)).toHaveClass(styles.clipText)
  })

  it.each(['blur', 'rectangle'] as const)('marks a %s shape overlay clip', (type) => {
    const clip = store().addShapeOverlayClip({ type })
    const view = renderTimeline()

    expect(view.clip(clip.id)).toHaveClass(styles.clipShape)
    expect(view.clip(clip.id).querySelector('svg')).toBeInTheDocument()
  })

  it('marks the selected clip and its multi-selected companions', () => {
    addClip('clip1', 0, 2)
    addClip('clip2', 4, 2)
    // selectClipsInRange makes the last clip the primary selection
    store().selectClipsInRange(['clip1', 'clip2'])
    const view = renderTimeline()

    expect(view.clip('clip2')).toHaveClass(styles.clipSelected)
    expect(view.clip('clip1')).toHaveClass(styles.clipMultiSelected)
    expect(view.clip('clip1')).not.toHaveClass(styles.clipSelected)
  })

  it('marks a hidden and a locked track', () => {
    const trackId = store().project.timeline.tracks[0].id
    store().updateTrack(trackId, { visible: false, locked: true })
    const view = renderTimeline()

    const track = view.root.querySelector(`[data-track-id="${trackId}"]`)
    expect(track).toHaveClass(styles.trackHidden)
    expect(track).toHaveClass(styles.trackLocked)
  })
})

describe('Timeline drag lifecycle', () => {
  let resizeObserver: ResizeObserverDouble

  beforeEach(() => {
    resetStoreForTest()
    resizeObserver = installResizeObserverDouble()
  })

  afterEach(() => {
    resizeObserver.uninstall()
  })

  it('removes its document listeners once the drag ends', () => {
    addClip('clip1', 0, 2)
    const view = renderTimeline()
    const removeSpy = vi.spyOn(document, 'removeEventListener')

    dragClip(view, 'clip1', 20, { x: 320 })

    const removed = removeSpy.mock.calls.map(([type]) => type)
    expect(removed).toContain('mousemove')
    expect(removed).toContain('mouseup')
    removeSpy.mockRestore()

    // A stray move after the release changes nothing
    fireEvent.mouseMove(document, { clientX: 900, clientY: 10 })
    expect(clipById('clip1').timelinePosition).toBe(6)
  })
})
