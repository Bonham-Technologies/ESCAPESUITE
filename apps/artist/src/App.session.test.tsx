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
  getDB,
  listSessionStates,
  saveSessionState,
  type SessionState,
} from './core/storage'
import { holdTabLock, tabLockName } from './app/sessionLock'
import { TAB_ID_KEY } from './app/tabId'
import { SESSION_SLOT_MAX_AGE_MS } from './app/appConstants'
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

/** This tab's id: every case runs as a tab that has run before. */
const THIS_TAB = 'this-tab'

const storedSession = (
  tabId = 'earlier-tab',
  name = 'From Storage',
  timestamp = Date.now() - 60_000
): SessionState => ({
  tabId,
  project: { ...store().project, name },
  sourceVideos: [{ ...sampleVideo }],
  currentTime: 7,
  selectedClipId: null,
  zoom: 3,
  timestamp,
})

/** What this tab's own slot holds (ESCSUITE-274). */
const ownSlot = async () =>
  (await listSessionStates()).find((slot) => slot.tabId === THIS_TAB)?.session

/** Every slot, by tab id — `null` for the row an older build shared. */
const slotsByTab = async () =>
  Object.fromEntries((await listSessionStates()).map((slot) => [String(slot.tabId), slot.session]))

/** Empty every slot, this tab's and every other's, and give this tab its id. */
const resetSlots = async () => {
  for (const slot of await listSessionStates()) await clearSessionState(slot.tabId)
  sessionStorage.clear()
  sessionStorage.setItem(TAB_ID_KEY, THIS_TAB)
}

/** Let fake-indexeddb's queued work run; its scheduling is not faked. */
const flushStorage = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))
  })

/**
 * Render, then let the startup question settle. The debounce is armed only
 * once it has, and that is a lock probe and a listing of every slot away
 * (ESCSUITE-274) — on a cold database open more than renderApp's own flush
 * covers. Waiting here is what keeps the "writes nothing" cases below from
 * passing only because the autosave had not started yet (fix round 1, LOW-7).
 */
const renderSettledApp = async () => {
  const view = await renderApp()
  await flushStorage()
  return view
}

describe('App session storage', () => {
  beforeEach(async () => {
    resetStoreForTest()
    store().clearHistory()
    installCanvasDouble()
    urlParams()
    await resetSlots()
  })

  afterEach(async () => {
    uninstallCanvasDouble()
    vi.useRealTimers()
    await resetSlots()
    vi.clearAllMocks()
  })

  it('writes the session to storage once the debounce elapses', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await renderSettledApp()

    await act(async () => {
      vi.advanceTimersByTime(2500)
    })
    await flushStorage()

    const session = await ownSlot()
    expect(session).toMatchObject({
      project: { name: store().project.name },
      sourceVideos: [{ id: 'video1' }],
      zoom: 1,
    })
  })

  it('writes nothing before the debounce elapses', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await renderSettledApp()

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    await flushStorage()

    expect(await ownSlot()).toBeUndefined()
  })

  // The debounce is re-armed on every `currentTime` change, so a moving playhead
  // holds the write off entirely. App does not subscribe to `currentTime` in its
  // render path (that would re-render the whole timeline every ~200 ms — see
  // App.rerender.test.tsx), so this re-arming runs off a store subscription;
  // these three tests are what pin that it still behaves the same.
  it('holds the write off while the playhead keeps moving', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await renderSettledApp()

    // 2 s of fake time — past the 2 s debounce — but never 2 s without a write.
    for (let i = 1; i <= 20; i++) {
      store().setCurrentTime(i * 0.1)
      await act(async () => {
        vi.advanceTimersByTime(100)
      })
    }
    await flushStorage()

    expect(await ownSlot()).toBeUndefined()
  })

  it('writes once the playhead settles, at the time it settled on', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await renderSettledApp()

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

    expect(await ownSlot()).toMatchObject({ currentTime: 2 })
  })

  it('clears the pending write on unmount', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { unmount } = await renderSettledApp()

    unmount()
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    await flushStorage()

    expect(await ownSlot()).toBeUndefined()
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
    expect(await listSessionStates()).toEqual([{ tabId: 'earlier-tab', session: stored }])
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
    await resetSlots()
  })
  afterEach(async () => {
    uninstallCanvasDouble()
    await resetSlots()
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

// ESCSUITE-274: every tab keeps its own slot (`session:<tabId>`) and holds
// `escapeartist-tab:<tabId>` for its lifetime. These install a Web Locks double
// (jsdom has none, so every case above is a lone tab) and drive the editor as
// a fresh tab beside others, against real storage.
describe('one session slot per tab (ESCSUITE-274)', () => {
  let fake: FakeLocks

  beforeEach(async () => {
    resetStoreForTest()
    store().clearHistory()
    installCanvasDouble()
    urlParams()
    await resetSlots()
    fake = createFakeLocks()
    Object.defineProperty(navigator, 'locks', { value: fake.locks, configurable: true })
  })

  afterEach(async () => {
    delete (navigator as { locks?: LockManager }).locks
    uninstallCanvasDouble()
    vi.useRealTimers()
    await resetSlots()
    vi.clearAllMocks()
  })

  /** Another tab, still open: it holds its own tab lock for as long as it lives. */
  const aliveTab = async (tabId: string) => {
    holdTabLock(tabId, fake.locks)
    await flushLocks()
  }

  it('probes its own tab lock before it holds it', async () => {
    // The order is the behaviour: asked the other way round, the probe would
    // find this tab's own request and call the tab a duplicate of itself.
    await renderApp()
    await flushStorage()

    expect(fake.log).toEqual(['probe', 'acquire'])
    expect(fake.isHeld(tabLockName(THIS_TAB))).toBe(true)
  })

  it('a fresh tab is offered a closed tab\'s session, not a live tab\'s newer one', async () => {
    // A edited and closed (its lock is gone); B edited after it and is still open.
    await saveSessionState(storedSession('tab-a', 'Tab A', Date.now() - 120_000))
    await saveSessionState(storedSession('tab-b', 'Tab B', Date.now() - 1_000))
    await aliveTab('tab-b')

    await renderApp()
    await flushStorage()

    expect(await screen.findByText('Resume Previous Session?')).toBeInTheDocument()
    expect(screen.getByText('Tab A')).toBeInTheDocument()
    expect(screen.queryByText('Tab B')).not.toBeInTheDocument()
  })

  it('this tab\'s autosave writes its own slot and leaves every other tab\'s alone', async () => {
    const a = storedSession('tab-a', 'Tab A')
    const b = storedSession('tab-b', 'Tab B')
    await saveSessionState(a)
    await saveSessionState(b)
    await aliveTab('tab-a')
    await aliveTab('tab-b')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    await renderApp()
    await flushStorage()
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    await flushStorage()

    const slots = await slotsByTab()
    expect(slots['tab-a']).toEqual(a)
    expect(slots['tab-b']).toEqual(b)
    expect(slots[THIS_TAB]).toMatchObject({ tabId: THIS_TAB, sourceVideos: [{ id: 'video1' }] })
  })

  it('restoring a closed tab\'s session adopts it: its old row is gone and the session is under this tab\'s id', async () => {
    await saveSessionState(storedSession('tab-a', 'Tab A'))

    await renderApp()
    await flushStorage()
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Session' }))
    await flushStorage()

    const slots = await slotsByTab()
    expect(slots['tab-a']).toBeUndefined()
    expect(slots[THIS_TAB]).toMatchObject({ tabId: THIS_TAB, project: { name: 'Tab A' } })
    expect(store().project.name).toBe('Tab A')
  })

  it('Start Fresh deletes the slot it was offered and nothing else', async () => {
    const live = storedSession('tab-b', 'Tab B', Date.now() - 1_000)
    await saveSessionState(storedSession('tab-a', 'Tab A', Date.now() - 120_000))
    await saveSessionState(live)
    await aliveTab('tab-b')

    await renderApp()
    await flushStorage()
    fireEvent.click(await screen.findByRole('button', { name: 'Start Fresh' }))
    await flushStorage()

    expect(await slotsByTab()).toEqual({ 'tab-b': live })
  })

  it('New Project clears this tab\'s slot and no other', async () => {
    const live = storedSession('tab-b', 'Tab B')
    await saveSessionState(live)
    await aliveTab('tab-b')
    await renderApp()
    await flushStorage()
    await saveSessionState(storedSession(THIS_TAB, 'Mine'))

    fireEvent.click(screen.getByRole('button', { name: 'File menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /New Project/ }))
    await flushStorage()

    expect(screen.getByText('New project created')).toBeInTheDocument()
    expect(await slotsByTab()).toEqual({ 'tab-b': live })
  })

  it('deletes a slot older than the age limit at startup instead of offering it', async () => {
    await saveSessionState(storedSession('tab-a', 'Tab A', Date.now() - SESSION_SLOT_MAX_AGE_MS - 60_000))

    await renderApp()
    await flushStorage()

    expect(screen.queryByText('Resume Previous Session?')).not.toBeInTheDocument()
    expect(await slotsByTab()).toEqual({})
  })

  it('offers the row an older build shared between tabs, and deletes it once restored', async () => {
    const legacy: Partial<SessionState> = { ...storedSession('ignored', 'Before The Update') }
    delete legacy.tabId
    const db = await getDB()
    await db.put('settings', legacy, 'current-session')

    await renderApp()
    await flushStorage()
    expect(await screen.findByText('Before The Update')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Restore Session' }))
    await flushStorage()

    expect(await db.get('settings', 'current-session')).toBeUndefined()
    expect((await slotsByTab())[THIS_TAB]).toMatchObject({ project: { name: 'Before The Update' } })
  })
})
