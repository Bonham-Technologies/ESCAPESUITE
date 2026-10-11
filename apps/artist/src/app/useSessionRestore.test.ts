// The startup session question: what the editor finds in storage, and the two
// answers to it.
//
// Session storage is the App suite's recording double; every store write is a
// plain `vi.fn()`, so each test names the writes an answer actually made.
//
// `sessionRestored` is the flag the autosave gates on, so every case asserts
// where it ends up — including the suppressed one, which settles the question
// without ever looking in storage.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { useSessionRestore, type SessionRestoreDeps } from './useSessionRestore'
import { holdTabLock } from './sessionLock'
import { TAB_ID_KEY } from './tabId'
import {
  clearSessionState,
  getThumbnail,
  listSessionStates,
  revokeSourceThumbnails,
  saveSessionState,
  type SessionSlot,
  type SessionState,
} from '../core/storage'
import { useEditorStore } from '../store/projectStore'
import { resetStoreForTest, store } from '../test/fixtures/projectStore'
import { sampleVideo, slotOf } from '../test/appDoubles'
import { lastObjectUrl } from '../test/objectUrls'
import { createFakeLocks, flushLocks, type FakeLocks } from '../test/doubles/locks'

vi.mock('../core/storage', async () => (await import('../test/appDoubles')).storageDouble())
// The tab locks (ESCSUITE-274) are the real module: jsdom has no Web Locks, so
// unless a case installs the double every other tab counts as gone — a lone
// tab, which is what every case before ESCSUITE-227 assumed.

/** This tab's id, seeded the way a tab that has run before has one. */
const THIS_TAB = 'this-tab'

let deps: SessionRestoreDeps

const savedSession = (overrides: Partial<SessionState> = {}): SessionState => ({
  tabId: 'earlier-tab',
  project: { ...useEditorStore.getState().project, name: 'From Storage' },
  sourceVideos: [{ ...sampleVideo }],
  currentTime: 7,
  selectedClipId: 'clip-1',
  zoom: 2,
  // Recent: a slot older than SESSION_SLOT_MAX_AGE_MS is pruned, not offered.
  timestamp: Date.now() - 60_000,
  ...overrides,
})

const mountRestore = (overrides: Partial<SessionRestoreDeps> = {}) => {
  deps = { ...deps, ...overrides }
  return renderHook(() => useSessionRestore(deps))
}

beforeEach(() => {
  resetStoreForTest()
  // resetStoreForTest() drives the REAL store's resetProject(), which calls
  // the same (mocked) revokeSourceThumbnails this file asserts on — clear
  // that setup call so a test's own assertion only sees what it did itself.
  vi.mocked(revokeSourceThumbnails).mockClear()
  vi.mocked(listSessionStates).mockResolvedValue([])
  vi.mocked(getThumbnail).mockResolvedValue(undefined)
  sessionStorage.clear()
  sessionStorage.setItem(TAB_ID_KEY, THIS_TAB)
  deps = {
    suppressRestore: false,
    setProject: vi.fn(),
    addSourceVideo: vi.fn(),
    setCurrentTime: vi.fn(),
    setSelectedClipId: vi.fn(),
    setZoom: vi.fn(),
    clearHistory: vi.fn(),
    showNotification: vi.fn(),
  }
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  sessionStorage.clear()
})

describe('the startup session check', () => {
  it('settles the question without looking when the host suppresses it', async () => {
    const { result } = mountRestore({ suppressRestore: true })

    await waitFor(() => expect(result.current.sessionRestored).toBe(true))
    expect(listSessionStates).not.toHaveBeenCalled()
    expect(result.current.showSessionPrompt).toBe(false)
  })

  it('leaves the question open while the storage read is still in flight', async () => {
    // The flag is false from the first render, before the read comes back —
    // not only once a prompt is on screen. `App` hands `!sessionRestored` to
    // `useHostIntegration` precisely for this window: `showSessionPrompt` is
    // still false here, and a handed-over take placed now would be replaced by
    // the Restore the user has not even been offered yet.
    let answer: (slots: SessionSlot[]) => void = () => {}
    vi.mocked(listSessionStates).mockImplementation(
      () => new Promise((resolve) => { answer = resolve })
    )

    const { result } = mountRestore()

    expect(result.current.sessionRestored).toBe(false)
    expect(result.current.showSessionPrompt).toBe(false)

    // The read starts once this tab's own lock probe (ESCSUITE-274) has
    // answered; the question is still open while it is out.
    await waitFor(() => expect(listSessionStates).toHaveBeenCalledTimes(1))
    expect(result.current.sessionRestored).toBe(false)

    await act(async () => {
      answer([])
      await Promise.resolve()
    })

    expect(result.current.sessionRestored).toBe(true)
  })

  it('offers a session that has media in it', async () => {
    const session = savedSession()
    vi.mocked(listSessionStates).mockResolvedValue([slotOf(session)])

    const { result } = mountRestore()

    await waitFor(() => expect(result.current.showSessionPrompt).toBe(true))
    expect(result.current.pendingSession).toBe(session)
    // Still unanswered: the autosave stays off until the user decides.
    expect(result.current.sessionRestored).toBe(false)
  })

  it('does not offer a session with no media in it', async () => {
    vi.mocked(listSessionStates).mockResolvedValue([slotOf(savedSession({ sourceVideos: [] }))])

    const { result } = mountRestore()

    await waitFor(() => expect(result.current.sessionRestored).toBe(true))
    expect(result.current.showSessionPrompt).toBe(false)
    expect(result.current.pendingSession).toBeNull()
  })

  it('settles the question when storage holds nothing', async () => {
    const { result } = mountRestore()

    await waitFor(() => expect(result.current.sessionRestored).toBe(true))
    expect(result.current.showSessionPrompt).toBe(false)
  })

  it('settles the question when the lookup fails, and says why', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(listSessionStates).mockRejectedValue(new Error('no database'))

    const { result } = mountRestore()

    await waitFor(() => expect(result.current.sessionRestored).toBe(true))
    expect(consoleError).toHaveBeenCalledWith('Failed to check session:', expect.any(Error))
  })

  it('only looks once — an answered question is not asked again', async () => {
    const { result, rerender } = mountRestore()
    await waitFor(() => expect(result.current.sessionRestored).toBe(true))

    rerender()

    expect(listSessionStates).toHaveBeenCalledTimes(1)
  })

  it('only looks once under StrictMode, which runs the effect twice', async () => {
    // A second probe of this tab's own lock would find the first one's
    // momentary hold and call this tab a duplicate of itself (ESCSUITE-227,
    // ESCSUITE-274).
    const fake = createFakeLocks()
    Object.defineProperty(navigator, 'locks', { value: fake.locks, configurable: true })
    try {
      const { result } = renderHook(() => useSessionRestore(deps), { wrapper: StrictMode })

      await waitFor(() => expect(result.current.sessionRestored).toBe(true))
      expect(fake.log).toEqual(['probe'])
      expect(listSessionStates).toHaveBeenCalledTimes(1)
      expect(result.current.tabId).toBe(THIS_TAB)
    } finally {
      delete (navigator as { locks?: LockManager }).locks
    }
  })
})

// ESCSUITE-274: every tab keeps its own slot and holds `escapeartist-tab:<id>`
// for its lifetime. The prompt offers the newest slot whose tab is gone — a tab
// that closed or crashed — and never one whose tab is still alive.
describe('one slot per tab (ESCSUITE-274)', () => {
  let fake: FakeLocks

  beforeEach(() => {
    fake = createFakeLocks()
    Object.defineProperty(navigator, 'locks', { value: fake.locks, configurable: true })
  })

  afterEach(() => {
    delete (navigator as { locks?: LockManager }).locks
  })

  /** Another tab, still open: it holds its own tab lock. */
  const aliveTab = async (tabId: string) => {
    holdTabLock(tabId, fake.locks)
    await flushLocks()
  }

  it('keeps this tab\'s id across a reload, and offers its own slot back', async () => {
    sessionStorage.setItem(TAB_ID_KEY, 'reloaded-tab')
    const mine = savedSession({ tabId: 'reloaded-tab' })
    vi.mocked(listSessionStates).mockResolvedValue([slotOf(mine, 'reloaded-tab')])

    const { result } = mountRestore()

    expect(result.current.tabId).toBe('reloaded-tab')
    await waitFor(() => expect(result.current.showSessionPrompt).toBe(true))
    expect(result.current.pendingSession).toBe(mine)
  })

  it('gives a new tab an id of its own', async () => {
    sessionStorage.clear()

    const { result } = mountRestore()

    await waitFor(() => expect(result.current.sessionRestored).toBe(true))
    expect(result.current.tabId).toMatch(/^[0-9a-f-]{36}$/)
    expect(sessionStorage.getItem(TAB_ID_KEY)).toBe(result.current.tabId)
  })

  it('asks whether its own id is alive elsewhere as the effect runs, before any storage read', async () => {
    // Synchronously, so the probe is queued ahead of this tab's own hold on
    // the lock — the autosave's effect, after this one.
    const { result } = mountRestore()

    expect(fake.log).toEqual(['probe'])
    expect(listSessionStates).not.toHaveBeenCalled()
    await waitFor(() => expect(result.current.sessionRestored).toBe(true))
    expect(listSessionStates).toHaveBeenCalledTimes(1)
  })

  it('a tab opened with a live tab\'s id — a duplicated tab — takes a new id and is not offered that tab\'s session', async () => {
    // Duplicating a tab copies its sessionStorage, id and all.
    sessionStorage.setItem(TAB_ID_KEY, 'original')
    await aliveTab('original')
    vi.mocked(listSessionStates).mockResolvedValue([slotOf(savedSession({ tabId: 'original' }), 'original')])

    const { result } = mountRestore()

    await waitFor(() => expect(result.current.sessionRestored).toBe(true))
    expect(result.current.tabId).not.toBe('original')
    expect(sessionStorage.getItem(TAB_ID_KEY)).toBe(result.current.tabId)
    expect(result.current.showSessionPrompt).toBe(false)
    expect(clearSessionState).not.toHaveBeenCalled()
  })

  it('offers a closed tab\'s session while a live tab has saved a newer one', async () => {
    const closed = savedSession({ tabId: 'tab-a', project: { ...savedSession().project, name: 'Tab A' } })
    const live = savedSession({ tabId: 'tab-b', timestamp: Date.now() - 1_000 })
    vi.mocked(listSessionStates).mockResolvedValue([slotOf(closed, 'tab-a'), slotOf(live, 'tab-b')])
    await aliveTab('tab-b')

    const { result } = mountRestore()

    await waitFor(() => expect(result.current.showSessionPrompt).toBe(true))
    expect(result.current.pendingSession).toBe(closed)
    expect(deps.showNotification).not.toHaveBeenCalled()
  })

  it('offers nothing and throws nothing away when the only slot belongs to a live tab', async () => {
    vi.mocked(listSessionStates).mockResolvedValue([slotOf(savedSession({ tabId: 'tab-b' }), 'tab-b')])
    await aliveTab('tab-b')

    const { result } = mountRestore()

    await waitFor(() => expect(result.current.sessionRestored).toBe(true))
    expect(result.current.showSessionPrompt).toBe(false)
    expect(clearSessionState).not.toHaveBeenCalled()
    expect(deps.showNotification).not.toHaveBeenCalled()
  })

  it('restoring another tab\'s slot adopts it: rewritten under this tab\'s id, the old row deleted', async () => {
    const crashed = savedSession({ tabId: 'crashed' })
    vi.mocked(listSessionStates).mockResolvedValue([slotOf(crashed, 'crashed')])
    const { result } = mountRestore()
    await waitFor(() => expect(result.current.showSessionPrompt).toBe(true))

    await act(async () => {
      await result.current.handleRestoreSession(crashed)
    })

    await vi.waitFor(() => expect(clearSessionState).toHaveBeenCalledWith('crashed'))
    expect(saveSessionState).toHaveBeenCalledWith({ ...crashed, tabId: THIS_TAB })
  })

  it('restoring this tab\'s own slot rewrites and deletes nothing', async () => {
    const mine = savedSession({ tabId: THIS_TAB })
    vi.mocked(listSessionStates).mockResolvedValue([slotOf(mine, THIS_TAB)])
    const { result } = mountRestore()
    await waitFor(() => expect(result.current.showSessionPrompt).toBe(true))

    await act(async () => {
      await result.current.handleRestoreSession(mine)
    })

    expect(deps.showNotification).toHaveBeenCalledWith('Session restored', 'success')
    expect(saveSessionState).not.toHaveBeenCalled()
    expect(clearSessionState).not.toHaveBeenCalled()
  })

  it('declining deletes the slot it was offered', async () => {
    vi.mocked(listSessionStates).mockResolvedValue([slotOf(savedSession({ tabId: 'crashed' }), 'crashed')])
    const { result } = mountRestore()
    await waitFor(() => expect(result.current.showSessionPrompt).toBe(true))

    act(() => result.current.handleDeclineSession())

    expect(clearSessionState).toHaveBeenCalledTimes(1)
    expect(clearSessionState).toHaveBeenCalledWith('crashed')
  })

  it('offers the row an older build shared between tabs, and deletes it when declined', async () => {
    const { tabId: _tabId, ...legacy } = savedSession()
    vi.mocked(listSessionStates).mockResolvedValue([slotOf(legacy as SessionState, null)])
    const { result } = mountRestore()
    await waitFor(() => expect(result.current.showSessionPrompt).toBe(true))

    act(() => result.current.handleDeclineSession())

    expect(clearSessionState).toHaveBeenCalledWith(null)
  })

  it('adopts the row an older build shared between tabs when it is restored', async () => {
    const { tabId: _tabId, ...legacy } = savedSession()
    vi.mocked(listSessionStates).mockResolvedValue([slotOf(legacy as SessionState, null)])
    const { result } = mountRestore()
    await waitFor(() => expect(result.current.showSessionPrompt).toBe(true))

    await act(async () => {
      await result.current.handleRestoreSession(legacy as SessionState)
    })

    await vi.waitFor(() => expect(clearSessionState).toHaveBeenCalledWith(null))
    expect(saveSessionState).toHaveBeenCalledWith({ ...legacy, tabId: THIS_TAB })
  })

  it('still offers a session when the browser rejects the lock requests', async () => {
    // A lock manager that rejects (SecurityError on an opaque origin) is
    // treated as no lock manager at all: a lone tab, which is offered its
    // session (ESCSUITE-227 fix round 1).
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const rejecting = {
      request: () => Promise.reject(new DOMException('opaque origin', 'SecurityError')),
    } as unknown as LockManager
    Object.defineProperty(navigator, 'locks', { value: rejecting, configurable: true })
    const session = savedSession()
    vi.mocked(listSessionStates).mockResolvedValue([slotOf(session)])

    const { result } = mountRestore()

    await waitFor(() => expect(result.current.showSessionPrompt).toBe(true))
    expect(result.current.pendingSession).toBe(session)
    expect(result.current.tabId).toBe(THIS_TAB)
  })
})

describe('answering the prompt', () => {
  /** Mount with a session waiting, the way the prompt is reached in the app. */
  const mountWithPendingSession = async (session: SessionState) => {
    vi.mocked(listSessionStates).mockResolvedValue([slotOf(session)])
    const view = mountRestore()
    await waitFor(() => expect(view.result.current.showSessionPrompt).toBe(true))
    return view
  }

  // ESCSUITE-244: the restore adds its sources through the same action an
  // import uses, which now records nothing; the history it ends with is empty
  // on the real store, whatever stood on it before.
  it('ends with an empty history on the real store, and the restored sources are not undoable (ESCSUITE-244)', async () => {
    const session = savedSession()
    store().setProjectResolution(1280, 720)
    expect(store().history.past).toHaveLength(1)
    vi.mocked(listSessionStates).mockResolvedValue([slotOf(session)])
    const view = mountRestore({
      setProject: (p) => store().setProject(p),
      addSourceVideo: (v) => store().addSourceVideo(v),
      clearHistory: () => store().clearHistory(),
    })
    await waitFor(() => expect(view.result.current.showSessionPrompt).toBe(true))

    await act(async () => {
      await view.result.current.handleRestoreSession(session)
    })

    expect(useEditorStore.getState().history).toEqual({ past: [], future: [] })
    expect(useEditorStore.getState().sourceVideos.map((v) => v.id)).toEqual([sampleVideo.id])
    act(() => { store().undo() })
    expect(useEditorStore.getState().sourceVideos.map((v) => v.id)).toEqual([sampleVideo.id])
  })

  it('restoring writes the whole session into the store and clears the history', async () => {
    const session = savedSession()
    const { result } = await mountWithPendingSession(session)

    // Rebuilding the thumbnail is an await away (ESCSUITE-96), so restoring
    // is no longer synchronous.
    await act(async () => {
      await result.current.handleRestoreSession(session)
    })

    expect(deps.setProject).toHaveBeenCalledWith(session.project)
    // getThumbnail resolves undefined by default, so the rebuilt source
    // carries no thumbnail — value-equal to the untouched fixture, which
    // never had the field either.
    expect(deps.addSourceVideo).toHaveBeenCalledWith(
      session.sourceVideos[0],
      0,
      session.sourceVideos
    )
    expect(deps.setCurrentTime).toHaveBeenCalledWith(7)
    expect(deps.setSelectedClipId).toHaveBeenCalledWith('clip-1')
    expect(deps.setZoom).toHaveBeenCalledWith(2)
    expect(deps.clearHistory).toHaveBeenCalled()
    expect(deps.showNotification).toHaveBeenCalledWith('Session restored', 'success')

    expect(result.current.showSessionPrompt).toBe(false)
    expect(result.current.pendingSession).toBeNull()
    expect(result.current.sessionRestored).toBe(true)
    // The question is settled, so the effect must not go looking again.
    expect(listSessionStates).toHaveBeenCalledTimes(1)
  })

  it('rebuilds a source thumbnail from what is actually stored, not the dead handle the session carried', async () => {
    const staleVideo = { ...sampleVideo, thumbnailUrl: 'blob:stale' }
    const session = savedSession({ sourceVideos: [staleVideo] })
    const freshThumbnail = new Blob(['thumb'], { type: 'image/jpeg' })
    vi.mocked(getThumbnail).mockResolvedValue(freshThumbnail)
    const { result } = await mountWithPendingSession(session)

    await act(async () => {
      await result.current.handleRestoreSession(session)
    })

    expect(getThumbnail).toHaveBeenCalledWith(staleVideo.id)
    expect(deps.addSourceVideo).toHaveBeenCalledWith(
      expect.objectContaining({ id: staleVideo.id, thumbnailUrl: lastObjectUrl() }),
      0,
      expect.anything()
    )
  })

  // ESCSUITE-113: the library is not reliably empty when a restore lands —
  // the CRAFT handoff (`importTake`) adds a take's parts to it as soon as
  // they arrive, well before the placement that waits on this question
  // settling. A restore must not blanket-revoke "whatever is here": it would
  // kill the handoff's still-live thumbnails. Wired to the REAL store's
  // `addSourceVideo` (not the `vi.fn()` every other case in this file uses),
  // because the fix this pins lives there, not in this hook.
  it('restoring over a handoff-filled library leaves the handoff\'s thumbnails live and revokes only the id it actually replaces', async () => {
    const handoffOnly = { ...sampleVideo, id: 'handoff-only', thumbnailUrl: 'blob:handoff-only' }
    const handoffShared = { ...sampleVideo, id: 'shared', thumbnailUrl: 'blob:handoff-shared' }
    store().addSourceVideo(handoffOnly)
    store().addSourceVideo(handoffShared)
    const session = savedSession({ sourceVideos: [{ ...sampleVideo, id: 'shared' }] })
    vi.mocked(getThumbnail).mockResolvedValue(new Blob(['thumb'], { type: 'image/jpeg' }))
    vi.mocked(listSessionStates).mockResolvedValue([slotOf(session)])
    const { result } = mountRestore({ addSourceVideo: (v) => store().addSourceVideo(v) })
    await waitFor(() => expect(result.current.showSessionPrompt).toBe(true))

    await act(async () => {
      await result.current.handleRestoreSession(session)
    })

    // Never touched — no clip of this take is even in the session.
    expect(store().sourceVideos.find((v) => v.id === 'handoff-only')?.thumbnailUrl).toBe('blob:handoff-only')
    expect(revokeSourceThumbnails).not.toHaveBeenCalledWith([handoffOnly])
    // The shared id's stale (handoff) URL is what actually gets revoked —
    // by addSourceVideo's replace-in-place, not by this hook up front.
    expect(revokeSourceThumbnails).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'shared', thumbnailUrl: 'blob:handoff-shared' }),
    ])
    expect(store().sourceVideos.find((v) => v.id === 'shared')?.thumbnailUrl).toBe(lastObjectUrl())
  })

  it('restores with no thumbnail — not the dead handle — when nothing is stored for it', async () => {
    const staleVideo = { ...sampleVideo, thumbnailUrl: 'blob:stale' }
    const session = savedSession({ sourceVideos: [staleVideo] })
    vi.mocked(getThumbnail).mockResolvedValue(undefined)
    const { result } = await mountWithPendingSession(session)

    await act(async () => {
      await result.current.handleRestoreSession(session)
    })

    expect(deps.addSourceVideo).toHaveBeenCalledWith(
      expect.objectContaining({ id: staleVideo.id, thumbnailUrl: undefined }),
      0,
      expect.anything()
    )
  })

  it('rebuilds every source before writing the store once, not one card at a time', async () => {
    const videoA = { ...sampleVideo, id: 'videoA', thumbnailUrl: 'blob:stale-a' }
    const videoB = { ...sampleVideo, id: 'videoB', thumbnailUrl: 'blob:stale-b' }
    const session = savedSession({ sourceVideos: [videoA, videoB] })
    vi.mocked(getThumbnail).mockResolvedValue(new Blob(['thumb'], { type: 'image/jpeg' }))
    const { result } = await mountWithPendingSession(session)

    await act(async () => {
      await result.current.handleRestoreSession(session)
    })

    expect(deps.addSourceVideo).toHaveBeenCalledTimes(2)
    expect(getThumbnail).toHaveBeenCalledWith('videoA')
    expect(getThumbnail).toHaveBeenCalledWith('videoB')
    // Every rebuilt source is already resolved by the time the first write
    // happens — no intermediate render carries a dead handle.
    expect(vi.mocked(deps.setProject).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.addSourceVideo).mock.invocationCallOrder[0]
    )
  })

  it('a decline that lands while the restore is still reading thumbnails wins — the restore must not commit after it', async () => {
    let releaseThumbnail: (thumbnail: Blob | undefined) => void = () => {}
    vi.mocked(getThumbnail).mockImplementation(
      () => new Promise((resolve) => { releaseThumbnail = resolve })
    )
    const session = savedSession()
    const { result } = await mountWithPendingSession(session)

    let restorePromise!: Promise<void>
    act(() => {
      restorePromise = result.current.handleRestoreSession(session)
    })
    // "Start Fresh" while the restore's reads are still in flight.
    act(() => result.current.handleDeclineSession())

    expect(clearSessionState).toHaveBeenCalled()
    expect(result.current.showSessionPrompt).toBe(false)
    expect(result.current.sessionRestored).toBe(true)

    // The restore's read finally comes back — it must find its answer
    // overruled rather than write over the decline that already ran.
    await act(async () => {
      releaseThumbnail(undefined)
      await restorePromise
    })

    expect(deps.setProject).not.toHaveBeenCalled()
    expect(deps.addSourceVideo).not.toHaveBeenCalled()
    expect(deps.showNotification).not.toHaveBeenCalled()
    // Nor adopt the slot the decline already deleted.
    expect(saveSessionState).not.toHaveBeenCalled()
  })

  it('a second restore call while the first is still reading thumbnails is a no-op', async () => {
    vi.mocked(getThumbnail).mockResolvedValue(undefined)
    const session = savedSession()
    const { result } = await mountWithPendingSession(session)

    // Two clicks (or a click and a repeated Enter) before the first
    // resolves — each source must still be added exactly once.
    await act(async () => {
      await Promise.all([
        result.current.handleRestoreSession(session),
        result.current.handleRestoreSession(session),
      ])
    })

    expect(deps.addSourceVideo).toHaveBeenCalledTimes(1)
    expect(deps.showNotification).toHaveBeenCalledTimes(1)
  })

  it('a rejected thumbnail read fails the restore instead of leaving it stuck', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getThumbnail).mockRejectedValue(new Error('storage exploded'))
    const session = savedSession()
    const { result } = await mountWithPendingSession(session)

    await act(async () => {
      await result.current.handleRestoreSession(session)
    })

    expect(consoleError).toHaveBeenCalledWith('Failed to restore session:', expect.any(Error))
    expect(deps.setProject).not.toHaveBeenCalled()
    expect(deps.addSourceVideo).not.toHaveBeenCalled()
    expect(deps.showNotification).toHaveBeenCalledWith('Failed to restore session', 'error')
    expect(result.current.showSessionPrompt).toBe(false)
    expect(result.current.pendingSession).toBeNull()
    expect(result.current.sessionRestored).toBe(true)
    // This was not the user's answer — the saved session stays in storage so
    // a reload can offer it again, unlike a decline.
    expect(clearSessionState).not.toHaveBeenCalled()
    expect(saveSessionState).not.toHaveBeenCalled()

    consoleError.mockRestore()
  })

  it('a failed restore clears its attempt, so it does not permanently block a later one', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getThumbnail).mockRejectedValueOnce(new Error('storage exploded'))
    const session = savedSession()
    const { result } = await mountWithPendingSession(session)

    await act(async () => {
      await result.current.handleRestoreSession(session)
    })
    expect(deps.addSourceVideo).not.toHaveBeenCalled()

    // The saved session is still there to offer again; drive the same
    // handler a second time the way a reload's "Restore Session" would.
    vi.mocked(getThumbnail).mockResolvedValue(undefined)
    await act(async () => {
      await result.current.handleRestoreSession(session)
    })

    expect(deps.addSourceVideo).toHaveBeenCalledTimes(1)
    expect(deps.showNotification).toHaveBeenLastCalledWith('Session restored', 'success')

    consoleError.mockRestore()
  })

  it('a rejected read that lands after a decline logs but does not re-announce a failure over it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let rejectThumbnail: (error: Error) => void = () => {}
    vi.mocked(getThumbnail).mockImplementation(
      () => new Promise((_resolve, reject) => { rejectThumbnail = reject })
    )
    const session = savedSession()
    const { result } = await mountWithPendingSession(session)

    let restorePromise!: Promise<void>
    act(() => {
      restorePromise = result.current.handleRestoreSession(session)
    })
    // "Start Fresh" while the restore's read is still in flight — same as
    // the decline-wins-the-race case above, except this read is doomed.
    act(() => result.current.handleDeclineSession())

    await act(async () => {
      rejectThumbnail(new Error('storage exploded'))
      await restorePromise
    })

    // The decline already settled the question and answered nothing wrong;
    // the failed read arriving afterwards logs it and stops there — no
    // second notification fighting over state that already moved on.
    expect(consoleError).toHaveBeenCalledWith('Failed to restore session:', expect.any(Error))
    expect(deps.showNotification).not.toHaveBeenCalled()

    consoleError.mockRestore()
  })

  it('declining throws the stored session away and writes nothing', async () => {
    const { result } = await mountWithPendingSession(savedSession())

    act(() => result.current.handleDeclineSession())

    expect(clearSessionState).toHaveBeenCalled()
    expect(deps.setProject).not.toHaveBeenCalled()
    expect(deps.showNotification).not.toHaveBeenCalled()
    expect(result.current.showSessionPrompt).toBe(false)
    expect(result.current.pendingSession).toBeNull()
    expect(result.current.sessionRestored).toBe(true)
  })

  it('logs a throw-away that fails rather than leaving it unhandled', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(clearSessionState).mockRejectedValueOnce(new Error('blocked'))
    const { result } = await mountWithPendingSession(savedSession())

    act(() => result.current.handleDeclineSession())

    // The user's answer lands synchronously whatever storage does about it.
    expect(result.current.showSessionPrompt).toBe(false)
    expect(result.current.pendingSession).toBeNull()
    expect(result.current.sessionRestored).toBe(true)

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith(expect.any(Error)))
    consoleError.mockRestore()
  })
})

describe('the editor block (ESCSUITE-245)', () => {
  const clip = (duration: number) => ({
    ...useEditorStore.getState().project.timeline,
    clips: [{ id: 'c1', timelinePosition: 0, duration }],
  })
  const sessionWithClip = (editor: unknown, duration = 10) =>
    savedSession({
      project: { ...useEditorStore.getState().project, timeline: clip(duration) as never },
      editor: editor as never,
    })
  const marker = (id: string, time: number) => ({ id, time, label: id, color: '#ffcc00' })

  const restore = async (session: SessionState) => {
    vi.mocked(listSessionStates).mockResolvedValue([slotOf(session)])
    const view = mountRestore()
    await waitFor(() => expect(view.result.current.showSessionPrompt).toBe(true))
    await act(async () => {
      await view.result.current.handleRestoreSession(session)
    })
  }

  it('applies the saved range and markers, sorted, with no undo entry', async () => {
    const undoableBefore = useEditorStore.getState().canUndo()
    await restore(sessionWithClip({ inPoint: 1, outPoint: 4, markers: [marker('b', 6), marker('a', 2)] }))

    const state = useEditorStore.getState()
    expect(state.inPoint).toBe(1)
    expect(state.outPoint).toBe(4)
    expect(state.markers).toEqual([marker('a', 2), marker('b', 6)])
    expect(state.canUndo()).toBe(undoableBefore)
  })

  it('clears a stale range and markers when the snapshot has no block', async () => {
    store().setInPoint(2)
    store().addMarker(3)
    await restore(savedSession())

    expect(useEditorStore.getState().inPoint).toBeNull()
    expect(useEditorStore.getState().outPoint).toBeNull()
    expect(useEditorStore.getState().markers).toEqual([])
  })

  it('drops a malformed block to defaults with one warning and still restores the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await restore(sessionWithClip({ inPoint: 4, outPoint: 1, markers: [marker('a', 1)] }))

    expect(warn).toHaveBeenCalledTimes(1)
    expect(useEditorStore.getState().inPoint).toBeNull()
    expect(useEditorStore.getState().markers).toEqual([])
    expect(deps.setProject).toHaveBeenCalled()
    expect(deps.showNotification).toHaveBeenCalledWith('Session restored', 'success')
    warn.mockRestore()
  })

  it('clamps a range past the timeline and keeps a marker past the end', async () => {
    await restore(sessionWithClip({ inPoint: 2, outPoint: 99, markers: [marker('late', 50)] }, 8))

    expect(useEditorStore.getState().inPoint).toBe(2)
    expect(useEditorStore.getState().outPoint).toBe(8)
    expect(useEditorStore.getState().markers).toEqual([marker('late', 50)])
  })
})

