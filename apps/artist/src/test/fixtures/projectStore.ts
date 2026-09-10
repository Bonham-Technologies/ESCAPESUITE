// Shared fixtures for the projectStore test files.
//
// The store is a module singleton, so every file that drives it needs the same
// reset. Lives under src/test/ so neither the vitest `include` glob (which
// would treat it as a suite containing no tests) nor the coverage `include`
// glob (which would score test scaffolding as production code) picks it up.
import { useEditorStore } from '../../store/projectStore'
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

export const store = () => useEditorStore.getState()

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
 * resetProject() covers the project, playhead, selection and markers; the
 * keyframe panel is UI state it deliberately leaves alone, so reset that here.
 */
export function resetStoreForTest(): void {
  store().resetProject()
  useEditorStore.setState({
    history: { past: [], future: [] },
    keyframePanelState: {
      ...store().keyframePanelState,
      isOpen: false,
      selectedProperty: null,
      graphZoom: 1,
    },
  })
  store().addSourceVideo(video)
}
