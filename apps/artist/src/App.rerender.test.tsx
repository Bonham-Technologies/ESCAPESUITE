// What a playback tick costs the React tree.
//
// The preview writes `currentTime` to the store roughly every 200 ms while the
// project plays. Nothing about a moving playhead should re-render the timeline's
// ruler, its track headers or every visible clip — only the playhead line and the
// time readout, which subscribe to `currentTime` themselves (see
// components/Timeline/TimelinePlayhead.tsx).
//
// Timeline's own subscription is pinned in TimelinePlayhead.test.tsx. This file
// pins the other half: App must not subscribe to `currentTime` either, because
// it renders <Timeline/> and would drag the whole tree along with it regardless
// of what Timeline itself reads.
//
// How the count is taken: `useVirtualizedTimeline` is called exactly once per
// Timeline render and by nothing else in the tree, so a *pass-through* spy on it
// (no mockImplementation — the real hook still runs) counts Timeline renders.
// A React Profiler cannot do this: `onRender` fires for every commit in its
// subtree, which includes the playhead's own commits, and there is nowhere to
// put a Profiler inside Timeline.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resetStoreForTest, store, addClip } from './test/fixtures/projectStore'
import { renderApp } from './test/renderApp'
import { installCanvasDouble, uninstallCanvasDouble } from './test/doubles/canvas'
import { installMediaPlaybackStubs } from './test/doubles/media'
import * as virtualized from './hooks/useVirtualizedTimeline'

vi.mock('./core/storage', async () => (await import('./test/appDoubles')).storageDouble())
vi.mock('./core/projectManager', async () =>
  (await import('./test/appDoubles')).projectManagerDouble()
)
vi.mock('./utils/integration', async () => (await import('./test/appDoubles')).integrationDouble())
vi.mock('./core/videoProcessor', async () =>
  (await import('./test/appDoubles')).videoProcessorDouble()
)

// jsdom's <video> pause()/play()/load() only report "Not implemented" to the
// virtual console, and the preview player pauses on every clip change.
installMediaPlaybackStubs()

describe('a playback tick and the React tree', () => {
  beforeEach(() => {
    resetStoreForTest()
    store().clearHistory()
    installCanvasDouble()
  })

  afterEach(() => {
    uninstallCanvasDouble()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('does not re-render the timeline inside the running app', async () => {
    addClip('clip1', 0, 10)
    const timelineRenders = vi.spyOn(virtualized, 'useVirtualizedTimeline')
    await renderApp()
    const mountRenders = timelineRenders.mock.calls.length

    for (let i = 1; i <= 10; i++) {
      store().setCurrentTime(i * 0.2)
    }

    expect(timelineRenders.mock.calls.length - mountRenders).toBeLessThanOrEqual(1)
  })

  it('still re-renders the timeline when something it reads changes', async () => {
    addClip('clip1', 0, 10)
    const timelineRenders = vi.spyOn(virtualized, 'useVirtualizedTimeline')
    await renderApp()
    const mountRenders = timelineRenders.mock.calls.length

    store().setZoom(2)

    expect(timelineRenders.mock.calls.length).toBeGreaterThan(mountRenders)
  })
})
