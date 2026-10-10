// Session autosave and restore, against real IndexedDB.
//
// The other App test files replace ./core/storage with a double, which can only
// show that App *asked* for a write. What matters about ?suppressRestore=1 is
// what ends up in storage, so this file leaves the storage module alone and
// lets it talk to fake-indexeddb (installed for every artist test in
// src/test/setup.ts). Only the debounce timer is faked, so fake-indexeddb's own
// setImmediate scheduling keeps working.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import { store, resetStoreForTest } from './test/fixtures/projectStore'
import { renderApp } from './test/renderApp'
import { installCanvasDouble, uninstallCanvasDouble } from './test/doubles/canvas'
import { installMediaPlaybackStubs } from './test/doubles/media'
import { defaultUrlParams, sampleVideo } from './test/appDoubles'
import { initIntegration, loadVideoFromUrl, parseUrlParams } from './utils/integration'
import { processMediaFile } from './core/videoProcessor'
import {
  clearSessionState,
  getSessionState,
  saveSessionState,
  type SessionState,
} from './core/storage'
import { SESSION_HELD_NOTICE } from './app/useSessionRestore'
import { SESSION_LOCK_NAME } from './app/sessionLock'
import { createFakeLocks, flushLocks, type FakeLocks } from './test/doubles/locks'

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

// ESCSUITE-225: a host project that arrives under the "Resume Previous Session?"
// prompt is the host's later, explicit instruction and survives either answer.
describe('a host LOAD_PROJECT under the restore prompt (ESCSUITE-225)', () => {
  beforeEach(async () => {
    resetStoreForTest()
    store().clearHistory()
    installCanvasDouble()
    urlParams()
    await clearSessionState()
  })
  afterEach(async () => {
    uninstallCanvasDouble()
    await clearSessionState()
    vi.clearAllMocks()
  })

  const hostSends = async (message: { type: string; payload?: unknown }) => {
    const calls = vi.mocked(initIntegration).mock.calls
    const handler = calls[calls.length - 1][0]
    await act(async () => {
      await handler(message as never)
    })
  }

  const openPrompt = async () => {
    await saveSessionState(storedSession())
    await renderApp()
    await flushStorage()
    expect(await screen.findByText('Resume Previous Session?')).toBeInTheDocument()
  }

  it('keeps the host project after Restore Session', async () => {
    await openPrompt()
    await hostSends({ type: 'LOAD_PROJECT', payload: { ...store().project, name: 'From Host' } })
    expect(store().project.name).not.toBe('From Host')

    fireEvent.click(screen.getByRole('button', { name: 'Restore Session' }))
    await flushStorage()

    expect(store().project.name).toBe('From Host')
  })

  it('keeps the host project after Start Fresh', async () => {
    await openPrompt()
    await hostSends({ type: 'LOAD_PROJECT', payload: { ...store().project, name: 'From Host' } })

    fireEvent.click(screen.getByRole('button', { name: 'Start Fresh' }))
    await flushStorage()

    expect(store().project.name).toBe('From Host')
  })

  it('keeps a LOAD_VIDEO source in the library through Restore Session', async () => {
    vi.mocked(loadVideoFromUrl).mockResolvedValue({ blob: new Blob(), name: 'host.mp4' })
    vi.mocked(processMediaFile).mockResolvedValue({ ...sampleVideo, id: 'host-video', name: 'host.mp4' })
    await openPrompt()

    await hostSends({ type: 'LOAD_VIDEO', payload: { url: 'https://host.example/host.mp4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Restore Session' }))
    await flushStorage()

    expect(store().project.name).toBe('From Storage')
    expect(store().sourceVideos.map((v) => v.id)).toContain('host-video')
  })
})

// ESCSUITE-227: every tab of an origin shares one session slot. These install
// a Web Locks double (jsdom has none, so every case above is a lone tab) and
// drive the editor as the second tab, against real storage.
describe('two tabs, one session slot (ESCSUITE-227)', () => {
  let fake: FakeLocks

  beforeEach(async () => {
    resetStoreForTest()
    store().clearHistory()
    installCanvasDouble()
    urlParams()
    await clearSessionState()
    fake = createFakeLocks()
    Object.defineProperty(navigator, 'locks', { value: fake.locks, configurable: true })
  })

  afterEach(async () => {
    delete (navigator as { locks?: LockManager }).locks
    uninstallCanvasDouble()
    vi.useRealTimers()
    await clearSessionState()
    vi.clearAllMocks()
  })

  it('asks who owns the session before it queues for the session itself', async () => {
    // The order is the behaviour: asked the other way round, the probe would
    // find this tab's own queued request and call the tab "another tab".
    await renderApp()
    await flushStorage()

    expect(fake.log).toEqual(['probe', 'acquire'])
    expect(fake.isHeld(SESSION_LOCK_NAME)).toBe(true)
    expect(screen.queryByText(SESSION_HELD_NOTICE)).not.toBeInTheDocument()
  })

  it('a second tab is not offered the first tab\'s live session and leaves it in the slot', async () => {
    const stored = storedSession()
    await saveSessionState(stored)
    // The first tab, still open: it owns the session and never lets go.
    void fake.locks.request(SESSION_LOCK_NAME, () => new Promise<void>(() => {}))
    await flushLocks()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    await renderApp()
    await flushStorage()

    expect(screen.getByText(SESSION_HELD_NOTICE)).toBeInTheDocument()
    expect(screen.queryByText('Resume Previous Session?')).not.toBeInTheDocument()

    // Well past the debounce: this tab holds a source, so only the lock is
    // keeping it from writing over the first tab's session.
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    await flushStorage()

    expect(await getSessionState()).toEqual(stored)
  })

  it('a second tab\'s New Project starts over without deleting the first tab\'s session', async () => {
    const stored = storedSession()
    await saveSessionState(stored)
    void fake.locks.request(SESSION_LOCK_NAME, () => new Promise<void>(() => {}))
    await flushLocks()

    await renderApp()
    await flushStorage()
    fireEvent.click(screen.getByRole('button', { name: 'File menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /New Project/ }))
    await flushStorage()

    expect(screen.getByText('New project created')).toBeInTheDocument()
    expect(await getSessionState()).toEqual(stored)
  })

  it('the owning tab\'s New Project still clears the slot', async () => {
    await renderApp()
    await flushStorage()
    expect(fake.isHeld(SESSION_LOCK_NAME)).toBe(true)
    await saveSessionState(storedSession())

    fireEvent.click(screen.getByRole('button', { name: 'File menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /New Project/ }))
    await flushStorage()

    expect(await getSessionState()).toBeUndefined()
  })
})
