// Session autosave and restore, against real IndexedDB.
//
// The other App test files replace ./core/storage with a double, which can only
// show that App *asked* for a write. What matters about ?suppressRestore=1 is
// what ends up in storage, so this file leaves the storage module alone and
// lets it talk to fake-indexeddb (installed for every artist test in
// src/test/setup.ts). Only the debounce timer is faked, so fake-indexeddb's own
// setImmediate scheduling keeps working.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen } from '@testing-library/react'
import { store, resetStoreForTest } from './test/fixtures/projectStore'
import { renderApp } from './test/renderApp'
import { installCanvasDouble, uninstallCanvasDouble } from './test/doubles/canvas'
import { installMediaPlaybackStubs } from './test/doubles/media'
import { defaultUrlParams, sampleVideo } from './test/appDoubles'
import { parseUrlParams } from './utils/integration'
import {
  clearSessionState,
  getSessionState,
  saveSessionState,
  type SessionState,
} from './core/storage'

vi.mock('./core/projectManager', async () =>
  (await import('./test/appDoubles')).projectManagerDouble()
)
vi.mock('./utils/integration', async () => (await import('./test/appDoubles')).integrationDouble())
vi.mock('./core/videoProcessor', async () =>
  (await import('./test/appDoubles')).videoProcessorDouble()
)

// jsdom's <video> pause()/play()/load() only report "Not implemented" to the
// virtual console, and the preview player pauses on every clip change. Patch
// them for the whole file — including the unmount that testing-library's
// cleanup triggers, which is outside any afterEach this file could own.
installMediaPlaybackStubs()

const urlParams = (overrides: Partial<ReturnType<typeof defaultUrlParams>> = {}) => {
  vi.mocked(parseUrlParams).mockReturnValue({ ...defaultUrlParams(), ...overrides })
}

const storedSession = (): SessionState => ({
  project: { ...store().project, name: 'From Storage' },
  sourceVideos: [{ ...sampleVideo }],
  currentTime: 7,
  selectedClipId: null,
  zoom: 3,
  timestamp: Date.parse('2026-01-02T03:04:05Z'),
})

/** Let fake-indexeddb's queued work run; its scheduling is not faked. */
const flushStorage = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))
  })

describe('App session storage', () => {
  beforeEach(async () => {
    resetStoreForTest()
    store().clearHistory()
    installCanvasDouble()
    urlParams()
    await clearSessionState()
  })

  afterEach(async () => {
    uninstallCanvasDouble()
    vi.useRealTimers()
    await clearSessionState()
    vi.clearAllMocks()
  })

  it('writes the session to storage once the debounce elapses', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await renderApp()

    await act(async () => {
      vi.advanceTimersByTime(2500)
    })
    await flushStorage()

    const session = await getSessionState()
    expect(session).toMatchObject({
      project: { name: store().project.name },
      sourceVideos: [{ id: 'video1' }],
      zoom: 1,
    })
  })

  it('writes nothing before the debounce elapses', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await renderApp()

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    await flushStorage()

    expect(await getSessionState()).toBeUndefined()
  })

  // The debounce is re-armed on every `currentTime` change, so a moving playhead
  // holds the write off entirely. App does not subscribe to `currentTime` in its
  // render path (that would re-render the whole timeline every ~200 ms — see
  // App.rerender.test.tsx), so this re-arming runs off a store subscription;
  // these three tests are what pin that it still behaves the same.
  it('holds the write off while the playhead keeps moving', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await renderApp()

    // 2 s of fake time — past the 2 s debounce — but never 2 s without a write.
    for (let i = 1; i <= 20; i++) {
      store().setCurrentTime(i * 0.1)
      await act(async () => {
        vi.advanceTimersByTime(100)
      })
    }
    await flushStorage()

    expect(await getSessionState()).toBeUndefined()
  })

  it('writes once the playhead settles, at the time it settled on', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await renderApp()

    for (let i = 1; i <= 20; i++) {
      store().setCurrentTime(i * 0.1)
      await act(async () => {
        vi.advanceTimersByTime(100)
      })
    }
    await act(async () => {
      vi.advanceTimersByTime(2500)
    })
    await flushStorage()

    expect(await getSessionState()).toMatchObject({ currentTime: 2 })
  })

  it('clears the pending write on unmount', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { unmount } = await renderApp()

    unmount()
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    await flushStorage()

    expect(await getSessionState()).toBeUndefined()
  })

  it('leaves a stored session exactly as it found it under suppressRestore', async () => {
    const stored = storedSession()
    await saveSessionState(stored)
    urlParams({ suppressRestore: true })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    await renderApp()
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    await flushStorage()

    expect(screen.queryByText('Resume Previous Session?')).not.toBeInTheDocument()
    expect(await getSessionState()).toEqual(stored)
  })

  it('offers the session it finds in storage', async () => {
    await saveSessionState(storedSession())

    await renderApp()
    await flushStorage()

    expect(await screen.findByText('Resume Previous Session?')).toBeInTheDocument()
    expect(screen.getByText('From Storage')).toBeInTheDocument()
  })
})
