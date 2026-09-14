// Per-pointer-frame work ceilings for the timeline's five gesture hooks.
//
// Ordinary tests, not `bench` mode: they measure through the same doubles every
// other timeline test uses, then assert the measurement has not grown. That way
// they run in CI and in `test:coverage` like anything else, and a regression
// fails the build instead of moving a number in a report nobody reads.
//
// The scene is the benchmark scene — the 14-clip, four-track, 13-second timeline
// `apps/e2e/tests/perf/timeline-interaction.spec.ts` drags, marquees and scrubs
// in a real browser (see `src/test/fixtures/perfScene.ts`). The browser
// benchmark reports what one pointer frame costs in milliseconds and in forced
// layouts; these tests pin what it costs in *calls*, which is the part that does
// not depend on the runner's CPU.
//
// **What this file cannot see.** jsdom performs no layout, so
// `getBoundingClientRect` is free here and all-zero (`src/test/doubles/layout.ts`).
// A change that halved the rect reads but doubled what each one cost would pass
// every ceiling below. The split is deliberate and neither half stands alone:
// **these tests count calls, the Playwright benchmark measures time.** The same
// goes for renders — counting them says nothing about what a render costs.
//
// Because `setRect` replaces `getBoundingClientRect` on the *element instance*,
// a `vi.spyOn(Element.prototype, …)` would count zero for exactly the elements
// under test. The counters here wrap the instance after `setRect`, and every
// ceiling is paired with an assertion that its counter is **non-zero**, so a
// ceiling can never pass by measuring nothing.
//
// How a ceiling is chosen: measure once, set the ceiling at 2x the measurement
// rounded up, and write the measured value and the date beside it. Counts that
// are exact properties rather than budgets — every listener added is given back,
// one pass over the track rows per gesture — are asserted exactly.
//
// **2026-09-13, after the one-pair-per-gesture change.** The three FINDING pins
// this file carried on its first day are gone: `useClipDrag`, `useTrimDrag` and
// `useTimelineMarquee` each bound and gave back 2 * (MOVES + 1) document
// listeners per gesture, and now bind exactly one pair, like the two hooks that
// always did. What used to be per-move work — the container rect, the walk over
// the `[data-track-id]` rows, the snap-point array — is now per *gesture*, taken
// on the mousedown, so almost every count below has stopped being a budget and
// become a property. They are asserted exactly for that reason: 2 is not a
// ceiling on the listeners, it is how many there are.
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { createElement } from 'react'
import { act, cleanup, render, renderHook } from '@testing-library/react'
import type React from 'react'
import { Timeline } from './Timeline'
import { useClipDrag, type ClipDragDeps } from './useClipDrag'
import { useInOutDrag, type InOutDragDeps } from './useInOutDrag'
import { usePlayheadDrag, type PlayheadDragDeps } from './usePlayheadDrag'
import { useTimelineMarquee, type TimelineMarqueeDeps } from './useTimelineMarquee'
import { useTrimDrag, type TrimDragDeps } from './useTrimDrag'
import { useEditorStore } from '../../store/projectStore'
// Spied for the `getSnapPoints` counter. Deliberately the module `useClipDrag`
// itself imports from: a pass-through spy only counts calls that go through the
// binding the caller actually holds, so if the helper is ever moved to its own
// module this import has to follow the *import site*, not the definition.
import * as timelineSnapping from '../../store/timelineSnapping'
import * as timelineGeometry from './timelineGeometry'
import * as timelineRulerModule from './TimelineRuler'
import * as timelineTrackModule from './TimelineTrack'
import * as trackHeaderModule from './TrackHeader'
import { resetStoreForTest, store } from '../../test/fixtures/projectStore'
import { SCENE_TRACKS, buildSceneProject, sceneSource } from '../../test/fixtures/perfScene'
import { setRect } from '../../test/doubles/layout'
import {
  installResizeObserverDouble,
  type ResizeObserverDouble,
} from '../../test/doubles/resizeObserver'

/** The timeline's default scale: one second is 50px at zoom 1. */
const PPS = 50
/** Client X of the track container's left edge — the timeline's t=0. */
const LEFT = 0
/** Every track in the scene is 64px tall (see `perfScene.SCENE_TRACKS`). */
const ROW_HEIGHT = 64

/**
 * Pointer moves per measured gesture.
 *
 * Enough that a per-move average is not dominated by the one move that starts
 * the gesture, and small enough to stay a unit test. The browser benchmark
 * drives 60; the counts here are per move, so the two are comparable anyway.
 */
const MOVES = 20

/** The two media tracks of the scene, by id. */
const V1 = SCENE_TRACKS[0].id
const V2 = SCENE_TRACKS[1].id

/** Every counter one measured gesture produces. */
interface GestureCounts {
  /** `document.addEventListener` calls for the gesture's own mouse events. */
  listenerAdds: number
  /** `document.removeEventListener` calls for the same. */
  listenerRemoves: number
  /** `getBoundingClientRect` calls on the scrolling track container. */
  containerRects: number
  /** `getBoundingClientRect` calls across every `[data-track-id]` row. */
  rowRects: number
  /** `querySelectorAll` calls on the track container. */
  querySelectorAlls: number
  /** `getSnapPoints` calls, counted through the module boundary. */
  snapPoints: number
}

let resizeObserver: ResizeObserverDouble
let addListener: MockInstance
let removeListener: MockInstance
let getSnapPoints: MockInstance
let container: HTMLDivElement
let containerRef: { current: HTMLDivElement | null }
let rows: HTMLElement[]
let rectCalls: { container: number; rows: number }

/**
 * Wrap one element's `getBoundingClientRect` in a counter.
 *
 * Must run *after* `setRect`, which installs its own instance-level override:
 * wrapping first would be overwritten, and spying on `Element.prototype` would
 * never see the instance override at all.
 */
function countRects(element: Element, bump: () => void): void {
  const measure = element.getBoundingClientRect.bind(element)
  element.getBoundingClientRect = () => {
    bump()
    return measure()
  }
}

/** A stand-in for the track area, laid out the way the app stacks it. */
function buildTrackArea(): void {
  container = document.createElement('div')
  setRect(container, { left: LEFT, top: 0, width: 1000, height: ROW_HEIGHT * 4 })
  countRects(container, () => {
    rectCalls.container += 1
  })

  rows = []
  // Highest track index at the top, as `Timeline` sorts them for display.
  const displayOrder = [...SCENE_TRACKS].sort((a, b) => b.index - a.index)
  displayOrder.forEach((track, i) => {
    const row = document.createElement('div')
    row.setAttribute('data-track-id', track.id)
    setRect(row, { left: LEFT, top: i * ROW_HEIGHT, width: 5000, height: ROW_HEIGHT })
    countRects(row, () => {
      rectCalls.rows += 1
    })
    container.appendChild(row)
    rows.push(row)
  })

  document.body.appendChild(container)
  containerRef = { current: container }
}

/** Client Y of the middle of a track row, by track id. */
function rowY(trackId: string): number {
  const index = rows.findIndex((row) => row.getAttribute('data-track-id') === trackId)
  return index * ROW_HEIGHT + ROW_HEIGHT / 2
}

beforeEach(() => {
  resetStoreForTest()
  resizeObserver = installResizeObserverDouble()
  store().setProject(buildSceneProject())
  store().addSourceVideo(sceneSource)

  addListener = vi.spyOn(document, 'addEventListener')
  removeListener = vi.spyOn(document, 'removeEventListener')
  // Pass-through: no mockImplementation, so the real snap points are still
  // computed and the drag behaves exactly as it does in production.
  getSnapPoints = vi.spyOn(timelineSnapping, 'getSnapPoints')

  rectCalls = { container: 0, rows: 0 }
  buildTrackArea()
})

afterEach(() => {
  cleanup()
  addListener.mockRestore()
  removeListener.mockRestore()
  getSnapPoints.mockRestore()
  resizeObserver.uninstall()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

/** Only the gesture's own listeners count; React and RTL bind others. */
const isGestureEvent = (call: unknown[]) => call[0] === 'mousemove' || call[0] === 'mouseup'

/** Everything the counters have seen since the gesture began. */
function counts(querySelectorAll: MockInstance): GestureCounts {
  return {
    listenerAdds: addListener.mock.calls.filter(isGestureEvent).length,
    listenerRemoves: removeListener.mock.calls.filter(isGestureEvent).length,
    containerRects: rectCalls.container,
    rowRects: rectCalls.rows,
    querySelectorAlls: querySelectorAll.mock.calls.length,
    snapPoints: getSnapPoints.mock.calls.length,
  }
}

/** Zero every counter, so a gesture is measured from its own mousedown. */
function startCounting(querySelectorAll: MockInstance): void {
  addListener.mockClear()
  removeListener.mockClear()
  getSnapPoints.mockClear()
  querySelectorAll.mockClear()
  rectCalls.container = 0
  rectCalls.rows = 0
}

const move = (clientX: number, clientY: number) =>
  act(() => {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY }))
  })

const release = () =>
  act(() => {
    document.dispatchEvent(new MouseEvent('mouseup'))
  })

/** A synthetic React mouse event on `element`, at a client point. */
function press(element: HTMLElement, clientX: number, clientY: number): React.MouseEvent {
  return {
    clientX,
    clientY,
    ctrlKey: false,
    metaKey: false,
    currentTarget: element,
    target: element,
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
  } as unknown as React.MouseEvent
}

/** One of the scene's clips, by id. */
const theClip = (id: string) =>
  useEditorStore.getState().project.timeline.clips.find((c) => c.id === id)!

/** A stand-in for a clip element, with the box the app would give it. */
function clipElement(clipId: string): HTMLDivElement {
  const clip = theClip(clipId)
  const element = document.createElement('div')
  element.setAttribute('data-clip-id', clipId)
  setRect(element, {
    left: LEFT + clip.timelinePosition * PPS,
    top: 0,
    width: clip.duration * PPS,
    height: ROW_HEIGHT,
  })
  return element
}

// ---------------------------------------------------------------------------
// useClipDrag
// ---------------------------------------------------------------------------

describe('useClipDrag per-move work', () => {
  /** The hook's inputs, read fresh from the store on every render. */
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
      setSelectedClipId: state.setSelectedClipId,
      toggleClipSelection: state.toggleClipSelection,
      moveSelectedClips: state.moveSelectedClips,
      setClipTimelinePosition: state.setClipTimelinePosition,
      moveClipToTrack: state.moveClipToTrack,
      splitClip: state.splitClip,
    }
  }

  it('holds its per-move costs to their ceilings over a whole drag', () => {
    const querySelectorAll = vi.spyOn(container, 'querySelectorAll')
    const { result } = renderHook(() => {
      useEditorStore((state) => state.project.timeline.clips)
      return useClipDrag(deps())
    })

    const element = clipElement('perf-clip-0')
    startCounting(querySelectorAll)
    act(() => {
      result.current.handleClipMouseDown(
        press(element, LEFT + 50, rowY(V1)),
        theClip('perf-clip-0')
      )
    })
    for (let i = 1; i <= MOVES; i++) {
      // Across the scene and up onto V2 — the browser benchmark's own gesture.
      move(LEFT + 50 + i * 30, rowY(i > MOVES / 2 ? V2 : V1))
    }
    const measured = counts(querySelectorAll)
    release()
    const final = counts(querySelectorAll)

    // The drag really ran: without this every ceiling below could be satisfied
    // by a gesture that measured nothing at all (see the header on `setRect`).
    expect(result.current.dragState).toBeNull()
    expect(measured.containerRects).toBeGreaterThan(0)
    expect(measured.rowRects).toBeGreaterThan(0)
    expect(measured.snapPoints).toBeGreaterThan(0)
    expect(measured.querySelectorAlls).toBeGreaterThan(0)

    // Exact: every listener the gesture added is given back. A property, not a
    // budget — an unbalanced count is a leak whatever its size.
    expect(final.listenerAdds).toBe(final.listenerRemoves)

    // Exact, measured 2026-09-13 (was 2 * (MOVES + 1) = 42 before the
    // one-pair-per-gesture change): the pair is bound by the mousedown and
    // given back by the mouseup, and nothing in between touches it.
    expect(final.listenerAdds).toBe(2)

    // Measured 2026-09-13 over 20 moves, all on the mousedown and none per
    // move: 1 container rect, 4 track-row rects (one per track in the scene),
    // 1 querySelectorAll, 1 getSnapPoints. Was 20 / 80 / 20 / 20 — one of
    // each per move, and the row rects scaling with the track count.
    //
    // Exact rather than 2x, because these are no longer budgets: a clip drag
    // writes nothing to the store until release, so there is nothing that can
    // legitimately make it measure the track area twice. The one thing that
    // can — a scroll or a resize mid-gesture — is covered by
    // `timelineGestureCaching.test.ts`, which is where the re-measure lives.
    //
    // What this does *not* claim is a 5x cut in forced layouts: Chromium
    // reported 0.82 layouts per move for the whole frame, because nothing
    // dirtied layout between the five reads and they collapsed into one pass
    // (docs/performance/2026-09-13-timeline-baseline.md). What stops is the
    // scaling with track count, and the churn.
    expect(measured.containerRects).toBe(1)
    expect(measured.rowRects).toBe(rows.length)
    expect(measured.querySelectorAlls).toBe(1)
    expect(measured.snapPoints).toBe(1)
  })

  it('measures every track row once, on the mousedown', () => {
    // The whole-gesture counts above would also be met by a drag that measured
    // the rows lazily on its first move. This pins the shape the brief asks
    // for: the cache is built by the press, so the move handler allocates
    // nothing and a drag that never moves has already paid for the rows.
    const querySelectorAll = vi.spyOn(container, 'querySelectorAll')
    const { result } = renderHook(() => {
      useEditorStore((state) => state.project.timeline.clips)
      return useClipDrag(deps())
    })

    const element = clipElement('perf-clip-0')
    startCounting(querySelectorAll)
    act(() => {
      result.current.handleClipMouseDown(
        press(element, LEFT + 50, rowY(V1)),
        theClip('perf-clip-0')
      )
    })
    const afterPress = counts(querySelectorAll)
    move(LEFT + 200, rowY(V1))
    const measured = counts(querySelectorAll)
    release()

    // Measured 2026-09-13: the press measures all 4 rows and the move measures
    // none. Before the change the press measured none and every move measured
    // all four.
    expect(afterPress.rowRects).toBe(rows.length)
    expect(afterPress.containerRects).toBe(1)
    expect(afterPress.snapPoints).toBe(1)
    expect(measured.rowRects).toBe(afterPress.rowRects)
    expect(measured.containerRects).toBe(afterPress.containerRects)
  })
})

// ---------------------------------------------------------------------------
// useTrimDrag
// ---------------------------------------------------------------------------

describe('useTrimDrag per-move work', () => {
  const deps = (): TrimDragDeps => {
    const state = useEditorStore.getState()
    return {
      trackContainerRef: containerRef,
      pixelsPerSecond: PPS,
      clips: state.project.timeline.clips,
      sourceVideos: state.sourceVideos,
      tracks: state.project.timeline.tracks,
      activeTool: state.activeTool,
      setSelectedClipId: state.setSelectedClipId,
      updateClip: state.updateClip,
      shiftClipsAfter: state.shiftClipsAfter,
    }
  }

  it('holds its per-move costs to their ceilings over a whole trim', () => {
    const querySelectorAll = vi.spyOn(container, 'querySelectorAll')
    const { result } = renderHook(() => {
      useEditorStore((state) => state.project.timeline.clips)
      return useTrimDrag(deps())
    })

    const clip = useEditorStore.getState().project.timeline.clips[0]
    const element = clipElement(clip.id)
    startCounting(querySelectorAll)
    act(() => {
      result.current.handleTrimMouseDown(press(element, LEFT + 100, rowY(V1)), clip, 'end')
    })
    for (let i = 1; i <= MOVES; i++) {
      move(LEFT + 100 - i, rowY(V1))
    }
    const measured = counts(querySelectorAll)
    release()
    const final = counts(querySelectorAll)

    // The trim really ran: it writes the store on every move, so the clip is
    // shorter than the two seconds the scene gave it.
    const trimmed = useEditorStore.getState().project.timeline.clips.find((c) => c.id === clip.id)!
    expect(trimmed.duration).toBeLessThan(clip.duration)
    expect(measured.containerRects).toBeGreaterThan(0)

    // Exact: balanced, as above.
    expect(final.listenerAdds).toBe(final.listenerRemoves)

    // Exact, measured 2026-09-13 (was 2 * (MOVES + 1) = 42): a trim still
    // writes the store on every move, so `clips` is still a fresh array every
    // frame — it just no longer re-binds anything, because the listeners hang
    // off `trimState !== null` rather than off the clips.
    expect(final.listenerAdds).toBe(2)

    // Measured 2026-09-13 over 20 moves: 1 container rect for the whole
    // gesture (was 20, one per move), no row rects, no querySelectorAll. All
    // three exact — a trim has no reason to walk the track rows, and no reason
    // to measure the container more than once.
    expect(measured.containerRects).toBe(1)
    expect(measured.rowRects).toBe(0)
    expect(measured.querySelectorAlls).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// useTimelineMarquee
// ---------------------------------------------------------------------------

describe('useTimelineMarquee per-move work', () => {
  const deps = (): TimelineMarqueeDeps => {
    const state = useEditorStore.getState()
    return {
      trackContainerRef: containerRef,
      pixelsPerSecond: PPS,
      clips: state.project.timeline.clips,
      selectedClipIds: state.selectedClipIds,
      selectClipsInRange: state.selectClipsInRange,
      isDraggingPlayhead: false,
      dragState: null,
      marqueeJustFinished: { current: false },
    }
  }

  it('holds its per-move costs to their ceilings over a whole marquee', () => {
    const querySelectorAll = vi.spyOn(container, 'querySelectorAll')
    const { result } = renderHook(() => {
      useEditorStore((state) => state.selectedClipIds)
      return useTimelineMarquee(deps())
    })

    startCounting(querySelectorAll)
    act(() => {
      result.current.handleTrackMouseDown(press(container, LEFT + 700, rowY(V1)))
    })
    for (let i = 1; i <= MOVES; i++) {
      move(LEFT + 700 - i * 20, rowY(i > MOVES / 2 ? V2 : V1))
    }
    const measured = counts(querySelectorAll)
    release()
    const final = counts(querySelectorAll)

    // The marquee really selected something, so the mouseup path below was
    // taken rather than the "no drag, let the click handle it" one.
    expect(useEditorStore.getState().selectedClipIds.size).toBeGreaterThan(0)
    expect(measured.containerRects).toBeGreaterThan(0)

    // Exact: balanced, as above.
    expect(final.listenerAdds).toBe(final.listenerRemoves)

    // Exact, measured 2026-09-13 (was 2 * (MOVES + 1) = 42): the rectangle's
    // corners moved out of the effect's deps and into refs, so rewriting them
    // no longer rebinds anything.
    expect(final.listenerAdds).toBe(2)

    // Measured 2026-09-13: 1 container rect for the whole gesture — taken by
    // the mousedown that records the origin — and none on the moves or the
    // release. Was 21 across the press and the moves, and 22 including the
    // release. Exact, as above.
    expect(measured.containerRects).toBe(1)
    expect(final.containerRects - measured.containerRects).toBe(0)

    // Exact, and the correction this file exists to record: the marquee's
    // `querySelectorAll` and its walk over the track rows are on the **mouseup
    // path only** — once per gesture, not once per pointer frame — and they
    // must stay there. Measured 2026-09-13: 0 during the moves, then 1
    // querySelectorAll and 4 row rects (one per track) on release.
    expect(measured.rowRects).toBe(0)
    expect(measured.querySelectorAlls).toBe(0)
    expect(final.querySelectorAlls).toBe(1)
    expect(final.rowRects).toBe(rows.length)
  })
})

// ---------------------------------------------------------------------------
// usePlayheadDrag and useInOutDrag — pinned at what they already do well
// ---------------------------------------------------------------------------

describe('usePlayheadDrag and useInOutDrag per-move work', () => {
  // Neither hook writes anything its own effect depends on — `isDraggingPlayhead`
  // and the two in/out flags are booleans, and the store setters are stable
  // zustand actions — so both already bind one pair of document listeners per
  // gesture rather than per frame. Pinned here so a later refactor cannot
  // quietly drop them into the churn the other three are in.

  it('binds the playhead scrub once and measures the container once per move', () => {
    const querySelectorAll = vi.spyOn(container, 'querySelectorAll')
    const { result } = renderHook(() =>
      usePlayheadDrag({
        trackContainerRef: containerRef,
        pixelsPerSecond: PPS,
        timelineDuration: useEditorStore.getState().project.timeline.duration,
        setCurrentTime: useEditorStore.getState().setCurrentTime,
      } as PlayheadDragDeps)
    )

    startCounting(querySelectorAll)
    act(() => {
      result.current.handlePlayheadMouseDown(press(container, LEFT + 100, rowY(V1)))
    })
    for (let i = 1; i <= MOVES; i++) {
      move(LEFT + 100 + i * 10, rowY(V1))
    }
    const measured = counts(querySelectorAll)
    release()
    const final = counts(querySelectorAll)

    // The scrub really ran.
    expect(useEditorStore.getState().currentTime).toBeGreaterThan(0)
    expect(measured.containerRects).toBeGreaterThan(0)

    // Exact: one pair of listeners for the whole gesture, added and removed
    // once. This is the property the other three hooks do not yet have, and it
    // is pinned here so it cannot be lost.
    expect(final.listenerAdds).toBe(2)
    expect(final.listenerAdds).toBe(final.listenerRemoves)

    // Measured 2026-09-13 over 20 moves: 20 container rects (1 per move),
    // nothing else. Ceiling at 2x; the other two exact, as above.
    expect(measured.containerRects / MOVES).toBeLessThanOrEqual(2)
    expect(measured.rowRects).toBe(0)
    expect(final.querySelectorAlls).toBe(0)
  })

  it('binds an in-point drag once and measures the container once per move', () => {
    const querySelectorAll = vi.spyOn(container, 'querySelectorAll')
    const { result } = renderHook(() =>
      useInOutDrag({
        trackContainerRef: containerRef,
        rulerRef: { current: null },
        pixelsPerSecond: PPS,
        timelineDuration: useEditorStore.getState().project.timeline.duration,
        setInPoint: useEditorStore.getState().setInPoint,
        setOutPoint: useEditorStore.getState().setOutPoint,
      } as InOutDragDeps)
    )

    startCounting(querySelectorAll)
    act(() => {
      result.current.handleInPointMouseDown(press(container, LEFT + 100, rowY(V1)))
    })
    for (let i = 1; i <= MOVES; i++) {
      move(LEFT + 100 + i * 10, rowY(V1))
    }
    const measured = counts(querySelectorAll)
    release()
    const final = counts(querySelectorAll)

    // The drag really ran.
    expect(useEditorStore.getState().inPoint).toBeGreaterThan(0)
    expect(measured.containerRects).toBeGreaterThan(0)

    // Exact: one pair for the whole gesture, as above.
    expect(final.listenerAdds).toBe(2)
    expect(final.listenerAdds).toBe(final.listenerRemoves)

    // Measured 2026-09-13 over 20 moves: 20 container rects (1 per move),
    // nothing else. Ceiling at 2x; the other two exact, as above.
    expect(measured.containerRects / MOVES).toBeLessThanOrEqual(2)
    expect(measured.rowRects).toBe(0)
    expect(final.querySelectorAlls).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// The rendered timeline: what a gesture frame re-renders
// ---------------------------------------------------------------------------

/**
 * Every render counter installed by the current test, drained in `afterEach`.
 *
 * `vi.restoreAllMocks` cannot undo the `type` swap below, and a counter left on
 * a component would follow the module into the next test in this file. The
 * tests call `restore()` themselves at the end of a measurement; this is the
 * safety net for the run where an assertion throws first.
 */
const installedCounters: Array<() => void> = []

afterEach(() => {
  while (installedCounters.length > 0) installedCounters.pop()!()
})

/** A render counter installed on a component, and the way to take it off. */
interface RenderCounter {
  calls: () => number
  /** Every props object the component has been rendered with, in order. */
  props: () => unknown[]
  restore: () => void
}

/**
 * Count one `React.memo`'d component's renders.
 *
 * `vi.spyOn` cannot do it: `React.memo(fn)` is an *object*, and spying refuses
 * anything that is not a function. What React actually calls on each render is
 * that object's `type`, so the counter goes there — a pass-through `vi.fn`
 * around the original render function, swapped back in `restore`. A memo that
 * bails out never reaches `type`, which is exactly what these counters are for:
 * a skipped render is a call that does not happen.
 */
function countMemoRenders(component: unknown): RenderCounter {
  const memo = component as { type?: (props: never) => unknown }
  const original = memo.type
  // A component that is no longer memo'd has no `type`, and the counter would
  // then sit on nothing and report a perfect zero. Refuse instead: these
  // ceilings exist to catch a lost memo, not to be satisfied by one.
  if (typeof original !== 'function') {
    throw new Error('countMemoRenders: not a React.memo component')
  }
  const spy = vi.fn(original)
  memo.type = spy
  const restore = () => { memo.type = original }
  installedCounters.push(restore)
  return {
    calls: () => spy.mock.calls.length,
    props: () => spy.mock.calls.map((call) => call[0]),
    restore,
  }
}

/** The three memo boundaries of the track stack, counted together. */
function countTimelineRenders() {
  const tracks = countMemoRenders(timelineTrackModule.TimelineTrack)
  const headers = countMemoRenders(trackHeaderModule.TrackHeader)
  const rulers = countMemoRenders(timelineRulerModule.TimelineRuler)
  // `getRulerTicks` is a plain function, so the ordinary pass-through spy
  // applies. No mockImplementation: the real ticks are still built.
  const ticks = vi.spyOn(timelineGeometry, 'getRulerTicks')
  const read = () => ({
    tracks: tracks.calls(),
    headers: headers.calls(),
    rulers: rulers.calls(),
    ticks: ticks.mock.calls.length,
  })
  return {
    read,
    restore: () => {
      tracks.restore()
      headers.restore()
      rulers.restore()
      ticks.mockRestore()
    },
  }
}

/** The per-frame difference between two counter readings. */
function perFrame(
  before: ReturnType<ReturnType<typeof countTimelineRenders>['read']>,
  after: ReturnType<ReturnType<typeof countTimelineRenders>['read']>
) {
  return {
    tracks: (after.tracks - before.tracks) / MOVES,
    headers: (after.headers - before.headers) / MOVES,
    rulers: (after.rulers - before.rulers) / MOVES,
    ticks: (after.ticks - before.ticks) / MOVES,
  }
}

describe('the rendered timeline during a clip drag', () => {
  it('holds its renders per drag frame to their ceilings', () => {
    const counters = countTimelineRenders()

    const { container: root } = render(createElement(Timeline))
    const trackArea = root.querySelector('[data-track-id]')!.parentElement!
      .parentElement as HTMLElement
    setRect(trackArea, { left: LEFT, top: 0, width: 1000, height: ROW_HEIGHT * 4 })
    // Rows come back in document order, which is the order `Timeline` displays
    // them in: highest track index at the top, so `V1` is the bottom row.
    const trackRows = [...root.querySelectorAll('[data-track-id]')] as HTMLElement[]
    trackRows.forEach((row, i) =>
      setRect(row, { left: LEFT, top: i * ROW_HEIGHT, width: 5000, height: ROW_HEIGHT })
    )
    const v1Y =
      trackRows.findIndex((row) => row.getAttribute('data-track-id') === V1) * ROW_HEIGHT +
      ROW_HEIGHT / 2
    const clip = root.querySelector('[data-clip-id="perf-clip-0"]') as HTMLElement
    setRect(clip, { left: LEFT, top: 0, width: 2 * PPS, height: ROW_HEIGHT })

    act(() => {
      clip.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, clientX: LEFT + 50, clientY: v1Y })
      )
    })
    const afterPress = counters.read()
    // Along `V1` to 14 s — past the 13 s scene, so the commit on release cannot
    // be vetoed for an overlap and the drag provably happened.
    for (let i = 1; i <= MOVES; i++) {
      move(LEFT + 50 + (i * 700) / MOVES, v1Y)
    }

    const measured = perFrame(afterPress, counters.read())
    release()
    counters.restore()

    // The drag really moved the clip, so the counts above describe a real
    // gesture rather than a mousedown the timeline ignored.
    expect(
      useEditorStore.getState().project.timeline.clips.find((c) => c.id === 'perf-clip-0')!
        .timelinePosition
    ).toBeGreaterThan(0)
    expect(measured.tracks).toBeGreaterThan(0)

    // Measured 2026-09-13, per drag frame, after the three memo boundaries
    // landed: 4 TimelineTrack renders (one per track), 0 TrackHeader renders,
    // 0 TimelineRuler renders, 0 getRulerTicks calls. Before them it was
    // 4 / 4 / 1 / 1.
    //
    // `dragState` lives in `useClipDrag`'s own `useState`, so every pointer
    // move still re-renders `Timeline` itself. What changed is what that costs
    // below it: the headers column and the ruler are `React.memo`'d and every
    // prop they take is stable across a gesture, so neither re-renders and the
    // ruler's 61 tick objects are no longer rebuilt 20 times a drag. The rows
    // are memo'd too but still re-render here, because `dragState` is one of
    // their props and any row may have to draw the ghost — see the marquee test
    // below for the gesture where the memo does catch them.
    //
    // The three zeroes are asserted exactly, not at 2x: they are the memo
    // boundaries themselves, and one re-render per frame means a prop has
    // become unstable again. Every number here is a count of renders, not of
    // what a render costs; the milliseconds are in the browser benchmark.
    expect(measured.tracks).toBeLessThanOrEqual(8)
    expect(measured.headers).toBe(0)
    expect(measured.rulers).toBe(0)
    expect(measured.ticks).toBe(0)
  })
})

describe('the clips a drag frame allocates', () => {
  it('hands each row the same clips array for the whole drag', () => {
    const tracks = countMemoRenders(timelineTrackModule.TimelineTrack)

    const { container: root } = render(createElement(Timeline))
    const trackArea = root.querySelector('[data-track-id]')!.parentElement!
      .parentElement as HTMLElement
    setRect(trackArea, { left: LEFT, top: 0, width: 1000, height: ROW_HEIGHT * 4 })
    const trackRows = [...root.querySelectorAll('[data-track-id]')] as HTMLElement[]
    trackRows.forEach((row, i) =>
      setRect(row, { left: LEFT, top: i * ROW_HEIGHT, width: 5000, height: ROW_HEIGHT })
    )
    const v1Y =
      trackRows.findIndex((row) => row.getAttribute('data-track-id') === V1) * ROW_HEIGHT +
      ROW_HEIGHT / 2
    const clip = root.querySelector('[data-clip-id="perf-clip-0"]') as HTMLElement
    setRect(clip, { left: LEFT, top: 0, width: 2 * PPS, height: ROW_HEIGHT })

    act(() => {
      clip.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, clientX: LEFT + 50, clientY: v1Y })
      )
    })
    const before = tracks.calls()
    for (let i = 1; i <= MOVES; i++) {
      move(LEFT + 50 + (i * 700) / MOVES, v1Y)
    }
    const renders = tracks.calls() - before
    const distinct = new Set(
      tracks.props().slice(before).map((props) => (props as { clips: unknown[] }).clips)
    )
    release()
    tracks.restore()

    // The rows really did re-render, so the identity below is not the identity
    // of nothing: `dragState` is one of their props and changes every frame.
    expect(renders).toBe(MOVES * SCENE_TRACKS.length)

    // Exact, not a ceiling — this is a conservation law. Four tracks, one
    // `clips` array each, built once by `Timeline`'s `clipsByTrack` memo and
    // handed out unchanged for all 80 renders above. A per-render
    // `visibleClipsByTrack.get(id).map(...)` allocated a fresh array every time
    // — 80 of them — and would have defeated `TimelineTrack`'s memo wherever
    // the memo could otherwise hold (see the marquee test below).
    expect(distinct.size).toBe(SCENE_TRACKS.length)
  })
})

describe('the rendered timeline during a marquee', () => {
  it('re-renders none of the track stack while the rectangle is dragged', () => {
    const counters = countTimelineRenders()

    const { container: root } = render(createElement(Timeline))
    // Every ceiling below is zero, so the counters have to prove they can count
    // before they are allowed to report none: the mount itself renders all four.
    const mounted = counters.read()
    expect(Math.min(mounted.tracks, mounted.headers, mounted.rulers, mounted.ticks)).toBeGreaterThan(0)
    const trackArea = root.querySelector('[data-track-id]')!.parentElement!
      .parentElement as HTMLElement
    setRect(trackArea, { left: LEFT, top: 0, width: 1000, height: ROW_HEIGHT * 4 })
    const trackRows = [...root.querySelectorAll('[data-track-id]')] as HTMLElement[]
    trackRows.forEach((row, i) =>
      setRect(row, { left: LEFT, top: i * ROW_HEIGHT, width: 5000, height: ROW_HEIGHT })
    )

    // Press on empty track space, well past the scene's last clip, so the
    // gesture is unambiguously a marquee and not a clip drag.
    act(() => {
      trackArea.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, clientX: LEFT + 900, clientY: 8 })
      )
    })
    const afterPress = counters.read()
    for (let i = 1; i <= MOVES; i++) {
      move(LEFT + 900 - (i * 400) / MOVES, 8 + (i * ROW_HEIGHT * 3) / MOVES)
    }
    const measured = perFrame(afterPress, counters.read())
    release()
    counters.restore()

    // The rectangle really existed: a marquee that never cleared its threshold
    // would re-render nothing for the trivial reason that nothing happened.
    expect(useEditorStore.getState().selectedClipIds.size).toBeGreaterThan(0)

    // Measured 2026-09-13, per marquee frame: 0 / 0 / 0 / 0, against
    // 4 / 4 / 1 / 1 before the memo boundaries. A marquee changes none of the
    // props the track stack takes — `dragState` is null throughout and the
    // selection is only written on release — so with `Timeline`'s `clipsByTrack`
    // memo keeping each row's `clips` array identical, the whole stack now sits
    // out the gesture and only the rectangle itself re-renders. Asserted
    // exactly: any number above zero means a prop has become unstable.
    expect(measured.tracks).toBe(0)
    expect(measured.headers).toBe(0)
    expect(measured.rulers).toBe(0)
    expect(measured.ticks).toBe(0)
  })
})
