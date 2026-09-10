// Shared fixtures for the projectStore test files.
//
// The store is a module singleton, so every file that drives it needs the same
// reset. Lives under src/test/ so neither the vitest `include` glob (which
// would treat it as a suite containing no tests) nor the coverage `include`
// glob (which would score test scaffolding as production code) picks it up.
import { act } from '@testing-library/react'
import { useEditorStore } from '../../store/projectStore'
import { DEFAULT_KEYFRAME_PANEL_STATE } from '../../store/types'
import type { Clip, SourceVideo } from '../../store/types'

export const video: SourceVideo = {
  id: 'video1',
  name: 'test.mp4',
  duration: 30,
  width: 1920,
  height: 1080,
  frameRate: 30,
  mimeType: 'video/mp4',
  size: 1000,
}

type EditorStore = ReturnType<typeof useEditorStore.getState>

/**
 * The editor store, with every action call flushed inside `act()`.
 *
 * Zustand notifies its React subscribers synchronously, so `store().setIsPlaying(true)` in a
 * test that has a component mounted *is* a React update — one made outside `act()`, which
 * React reports ("An update to PreviewPlayer inside a test was not wrapped in act(...)") and
 * whose re-render has not necessarily happened by the time the next assertion runs. Wrapping
 * it here rather than at each of the several hundred call sites keeps the tests reading like
 * the app's own code and covers every file that drives the store through this fixture; with
 * nothing mounted, `act` flushes an empty queue and changes nothing.
 *
 * Reads are untouched — `store().project` is the store's own object, not a copy.
 */
export const store = (): EditorStore => {
  const state = useEditorStore.getState()
  return new Proxy(state, {
    get(target, key) {
      const value = Reflect.get(target, key, target) as unknown
      if (typeof value !== 'function') return value
      return (...args: unknown[]): unknown => {
        let result: unknown
        act(() => {
          result = (value as (...a: unknown[]) => unknown).apply(target, args)
        })
        return result
      }
    },
  })
}

/** Add a media clip and return the clip the store actually created. */
export function addClip(
  id: string,
  position: number,
  duration = 2,
  trackId?: string
): Clip {
  store().addClipToTimeline(
    { id, sourceVideoId: video.id, name: id, startTime: 0, endTime: duration, duration },
    trackId,
    position
  )
  return store().project.timeline.clips.find((c) => c.id === id)!
}

/**
 * Put the store back to a freshly loaded editor holding one source video.
 *
 * resetProject() covers the project, playhead, selection, clipboard, in/out
 * points and markers, and nothing else: every other top-level field of the
 * store survives it and would otherwise leak from one test into the next.
 * Those are `zoom`, `snapEnabled`, `activeTool`, `loopPlayback`,
 * `keyframePanelState` (the panel's own position and size included) and the
 * history resetProject itself pushes to — all reset here. `snapThreshold` is
 * the one remaining field, and it has no setter, so it cannot drift.
 */
export function resetStoreForTest(): void {
  store().resetProject()
  useEditorStore.setState({
    history: { past: [], future: [] },
    zoom: 1,
    snapEnabled: true,
    activeTool: 'select',
    loopPlayback: false,
    keyframePanelState: structuredClone(DEFAULT_KEYFRAME_PANEL_STATE),
  })
  store().addSourceVideo(video)
}
