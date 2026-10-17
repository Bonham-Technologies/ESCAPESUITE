// Two ESCAPEARTIST frames in one host page (ESCSUITE-332).
//
// `sessionStorage` belongs to the top-level tab, so two same-origin frames in
// one host page share it. Before this ticket the second frame read the first
// frame's id from it, found that id's tab lock held, renewed — and wrote its
// new id over the shared key; after a host reload both frames started from
// that one id, and which frame was offered which session was whichever
// startup check ran first (ESCSUITE-311's two-iframes probe measured the swap).
//
// Each frame here is one mount of the hook, as `App` mounts it, over one
// `sessionStorage`, one Web Locks double and the real session storage on
// fake-indexeddb. The autosave's two effects — hold this frame's tab lock, write
// its slot — are done by hand with the same calls (`holdTabLock`,
// `saveSessionState`), so the case is about the id and the slot it names.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, type RenderHookResult } from '@testing-library/react'
import { useSessionRestore, type SessionRestore, type SessionRestoreDeps } from './useSessionRestore'
import { holdTabLock } from './sessionLock'
import { TAB_ID_KEY } from './tabId'
import { __resetDeclinedSlotsForTests } from './declinedSlots'
import { clearSessionState, listSessionStates, saveSessionState, type SessionState } from '../core/storage'
import { useEditorStore } from '../store/projectStore'
import { resetStoreForTest } from '../test/fixtures/projectStore'
import { sampleVideo } from '../test/appDoubles'
import { createFakeLocks, flushLocks, type FakeLocks } from '../test/doubles/locks'

// Every mount in this file is a frame.
vi.mock('@escapesuite/shared/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@escapesuite/shared/config')>()),
  isEmbedded: () => true,
}))

let fake: FakeLocks
/** Every slot a case wrote, so the next case starts with none. */
const written = new Set<string>()
/** Every tab lock a case is still holding: one frame's autosave, still open. */
const holds: Array<() => void> = []

const deps = (tabKey: string | null): SessionRestoreDeps => ({
  suppressRestore: false,
  tabKey,
  setProject: vi.fn(),
  addSourceVideo: vi.fn(),
  seekTo: vi.fn(),
  setSelectedClipId: vi.fn(),
  setZoom: vi.fn(),
  clearHistory: vi.fn(),
  showNotification: vi.fn(),
})

type Frame = RenderHookResult<SessionRestore, unknown>

/** A frame starting up: the startup check settled, or the prompt up. */
const openFrame = async (tabKey: string | null): Promise<Frame> => {
  const frame = renderHook(() => useSessionRestore(deps(tabKey)))
  await waitFor(() =>
    expect(frame.result.current.sessionRestored || frame.result.current.showSessionPrompt).toBe(true)
  )
  return frame
}

/** What the frame's autosave does once it is running: hold its lock, write its slot. */
const autosave = async (frame: Frame, clipCount: number) => {
  const tabId = frame.result.current.tabId
  holds.push(holdTabLock(tabId, fake.locks))
  await flushLocks()
  const base = useEditorStore.getState().project
  const session: SessionState = {
    tabId,
    project: {
      ...base,
      name: `${clipCount} clip(s)`,
      timeline: {
        ...base.timeline,
        clips: Array.from({ length: clipCount }, (_, i) => ({ ...base.timeline.clips[0], id: `clip-${i}` })),
      },
    } as SessionState['project'],
    sourceVideos: [{ ...sampleVideo }],
    currentTime: 0,
    selectedClipId: null,
    zoom: 1,
    timestamp: Date.now(),
  }
  await saveSessionState(session)
  written.add(tabId)
}

/** The host page reloads: every frame's document goes, and its locks with it. */
const reloadHost = async (...frames: Frame[]) => {
  frames.forEach((frame) => frame.unmount())
  holds.splice(0).forEach((release) => release())
  await flushLocks()
}

beforeEach(() => {
  resetStoreForTest()
  sessionStorage.clear()
  fake = createFakeLocks()
  Object.defineProperty(navigator, 'locks', { value: fake.locks, configurable: true })
})

afterEach(async () => {
  holds.splice(0).forEach((release) => release())
  for (const tabId of written) await clearSessionState(tabId)
  written.clear()
  delete (navigator as { locks?: LockManager }).locks
  vi.restoreAllMocks()
  sessionStorage.clear()
  __resetDeclinedSlotsForTests()
})

describe('two editors framed in one host page (ESCSUITE-332)', () => {
  it('each frame named with ?tabKey= keeps its own slot across a host reload', async () => {
    const a = await openFrame('a')
    await autosave(a, 1)
    const b = await openFrame('b')
    await autosave(b, 3)

    expect(a.result.current.tabId).toBe('host:a')
    expect(b.result.current.tabId).toBe('host:b')
    expect((await listSessionStates()).map((slot) => slot.tabId).sort()).toEqual(['host:a', 'host:b'])
    // Neither frame read or wrote the key the two of them would have shared.
    expect(sessionStorage.getItem(TAB_ID_KEY)).toBeNull()

    await reloadHost(a, b)
    // The order the frames' startup checks run in decides nothing: B first.
    const bAgain = await openFrame('b')
    const aAgain = await openFrame('a')

    expect(aAgain.result.current.pendingSession?.project.name).toBe('1 clip(s)')
    expect(bAgain.result.current.pendingSession?.project.name).toBe('3 clip(s)')
  })

  it('two frames the host did not name each get an id of their own, and neither writes the shared key', async () => {
    const a = await openFrame(null)
    await autosave(a, 1)
    const b = await openFrame(null)

    expect(b.result.current.tabId).not.toBe(a.result.current.tabId)
    expect(a.result.current.tabId).toMatch(/^[0-9a-f-]{36}$/)
    expect(b.result.current.tabId).toMatch(/^[0-9a-f-]{36}$/)
    expect(sessionStorage.getItem(TAB_ID_KEY)).toBeNull()
    // B found nothing of its own and A's slot held by A: no offer, nothing renewed.
    expect(b.result.current.showSessionPrompt).toBe(false)
  })

  it('a second frame given the same key warns once and takes an id for this page load, overwriting nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const a = await openFrame('a')
    await autosave(a, 1)

    const twin = await openFrame('a')

    expect(twin.result.current.tabId).not.toBe('host:a')
    expect(twin.result.current.tabId).toMatch(/^[0-9a-f-]{36}$/)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('tabKey=a')
    expect(sessionStorage.getItem(TAB_ID_KEY)).toBeNull()
    // Not offered the live frame's work, and that work is where it was.
    expect(twin.result.current.showSessionPrompt).toBe(false)
    expect((await listSessionStates()).map((slot) => slot.tabId)).toEqual(['host:a'])
  })
})
