// The debounced session autosave: when it writes, when it re-arms, and when
// it does nothing at all.
//
// This file uses the App suite's storage double plus vitest's fake timers,
// rather than real IndexedDB — what matters here is the timer arithmetic and
// the store subscription, and the double says precisely what was handed to
// `saveSessionState`. (`App.session.test.tsx` covers the other half, against
// real storage.)
//
// The playhead deliberately is not a dependency of the effect: it re-arms the
// debounce through a store subscription instead, so that playback does not
// re-render the editor every ~200 ms. The re-arm test below is what pins that.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  useSessionAutosave,
  autosaveFailureNotice,
  AUTOSAVE_QUOTA_NOTICE,
  AUTOSAVE_GENERIC_NOTICE,
  type SessionAutosaveDeps,
} from './useSessionAutosave'
import { saveSessionState } from '../core/storage'
import { useEditorStore } from '../store/projectStore'
import { resetStoreForTest, video } from '../test/fixtures/projectStore'
import { AUTO_SAVE_DELAY } from './appConstants'
import { SESSION_LOCK_NAME } from './sessionLock'
import { createFakeLocks, flushLocks, type FakeLocks } from '../test/doubles/locks'

vi.mock('../core/storage', async () => (await import('../test/appDoubles')).storageDouble())

let deps: SessionAutosaveDeps

const mountAutosave = (overrides: Partial<SessionAutosaveDeps> = {}) => {
  deps = { ...deps, ...overrides }
  return renderHook((props: SessionAutosaveDeps = deps) => useSessionAutosave(props), {
    initialProps: deps,
  })
}

/** Move the playhead without rendering anything — the way playback does. */
const movePlayhead = (time: number) => useEditorStore.getState().setCurrentTime(time)

beforeEach(() => {
  resetStoreForTest()
  vi.useFakeTimers()
  const state = useEditorStore.getState()
  deps = {
    sessionRestored: true,
    suppressRestore: false,
    project: state.project,
    sourceVideos: state.sourceVideos,
    selectedClipId: state.selectedClipId,
    zoom: state.zoom,
    showNotification: vi.fn(),
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('useSessionAutosave', () => {
  it('writes the session once the debounce elapses', () => {
    mountAutosave()

    vi.advanceTimersByTime(AUTO_SAVE_DELAY)

    expect(saveSessionState).toHaveBeenCalledTimes(1)
    expect(saveSessionState).toHaveBeenCalledWith({
      project: deps.project,
      sourceVideos: deps.sourceVideos,
      currentTime: 0,
      selectedClipId: null,
      zoom: 1,
      editor: { inPoint: null, outPoint: null, markers: [] },
      timestamp: expect.any(Number),
    })
  })

  it('writes nothing before the debounce elapses', () => {
    mountAutosave()

    vi.advanceTimersByTime(AUTO_SAVE_DELAY - 1)

    expect(saveSessionState).not.toHaveBeenCalled()
  })

  it('reads the payload at fire time, not at arm time', () => {
    mountAutosave()

    movePlayhead(5)
    vi.advanceTimersByTime(AUTO_SAVE_DELAY)

    expect(saveSessionState).toHaveBeenCalledWith(expect.objectContaining({ currentTime: 5 }))
  })

  it('re-arms on a playhead move, through the store subscription', () => {
    mountAutosave()

    vi.advanceTimersByTime(AUTO_SAVE_DELAY - 500)
    movePlayhead(1)
    vi.advanceTimersByTime(AUTO_SAVE_DELAY - 500)
    // The first timer would have fired by now; the move pushed it out.
    expect(saveSessionState).not.toHaveBeenCalled()

    vi.advanceTimersByTime(500)
    expect(saveSessionState).toHaveBeenCalledTimes(1)
  })

  it('is off until the startup session question has been settled', () => {
    mountAutosave({ sessionRestored: false })

    vi.advanceTimersByTime(AUTO_SAVE_DELAY * 2)
    movePlayhead(3)
    vi.advanceTimersByTime(AUTO_SAVE_DELAY * 2)

    expect(saveSessionState).not.toHaveBeenCalled()
  })

  it('is off entirely when the host drives its own state', () => {
    mountAutosave({ suppressRestore: true })

    vi.advanceTimersByTime(AUTO_SAVE_DELAY * 2)

    expect(saveSessionState).not.toHaveBeenCalled()
  })

  it('re-arms when an edit changes one of its dependencies', () => {
    const { rerender } = mountAutosave()

    vi.advanceTimersByTime(AUTO_SAVE_DELAY - 500)
    rerender({ ...deps, zoom: 2 })
    vi.advanceTimersByTime(AUTO_SAVE_DELAY - 500)
    expect(saveSessionState).not.toHaveBeenCalled()

    vi.advanceTimersByTime(500)
    expect(saveSessionState).toHaveBeenCalledTimes(1)
  })

  it('drops the pending write and stops listening on unmount', () => {
    const { unmount } = mountAutosave()
    vi.advanceTimersByTime(AUTO_SAVE_DELAY - 1)

    unmount()

    vi.advanceTimersByTime(AUTO_SAVE_DELAY)
    expect(saveSessionState).not.toHaveBeenCalled()

    // And the subscription is gone with it: a later move arms nothing.
    movePlayhead(9)
    vi.advanceTimersByTime(AUTO_SAVE_DELAY * 2)
    expect(saveSessionState).not.toHaveBeenCalled()
  })

  it('logs a rejected write rather than leaving it unhandled', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(saveSessionState).mockRejectedValueOnce(new Error('quota exceeded'))
    mountAutosave()

    vi.advanceTimersByTime(AUTO_SAVE_DELAY)
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith(expect.any(Error)))

    consoleError.mockRestore()
  })

  it('raises nothing when the write resolves', () => {
    mountAutosave()

    vi.advanceTimersByTime(AUTO_SAVE_DELAY)

    expect(deps.showNotification).not.toHaveBeenCalled()
  })

  it('reports a rejected write through the editor notice, once', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('disk full')
    // Three separate `...Once` rejections, not a persistent `mockRejectedValue`
    // — the latter would replace the double's base implementation for every
    // later test in this file, not just the three ticks this one drives.
    vi.mocked(saveSessionState)
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
    mountAutosave()

    // Three ticks, all failing. `advanceTimersByTimeAsync` — unlike the sync
    // `advanceTimersByTime` the other tests use — flushes the promise chain
    // after each timer fires, so the latch set inside this tick's `.catch`
    // has actually run before the next tick is armed.
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY)
    movePlayhead(1)
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY)
    movePlayhead(2)
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY)

    expect(saveSessionState).toHaveBeenCalledTimes(3)
    expect(deps.showNotification).toHaveBeenCalledTimes(1)
    expect(deps.showNotification).toHaveBeenCalledWith(AUTOSAVE_GENERIC_NOTICE, 'error')
    // The detail is still logged on every failure, latch or no latch.
    expect(consoleError).toHaveBeenCalledTimes(3)

    consoleError.mockRestore()
  })

  it('reports a later failure again once a write in between has succeeded', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('disk full')
    mountAutosave()

    vi.mocked(saveSessionState).mockRejectedValueOnce(error)
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY)
    expect(deps.showNotification).toHaveBeenCalledTimes(1)

    // This tick succeeds (the double's default), clearing the latch.
    movePlayhead(1)
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY)
    expect(saveSessionState).toHaveBeenCalledTimes(2)

    vi.mocked(saveSessionState).mockRejectedValueOnce(error)
    movePlayhead(2)
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY)

    expect(deps.showNotification).toHaveBeenCalledTimes(2)

    consoleError.mockRestore()
  })

  it('shows the quota sentence for a bare QuotaExceededError', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(saveSessionState).mockRejectedValueOnce(
      new DOMException('full', 'QuotaExceededError')
    )
    mountAutosave()

    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY)

    expect(deps.showNotification).toHaveBeenCalledWith(AUTOSAVE_QUOTA_NOTICE, 'error')

    consoleError.mockRestore()
  })

  it('shows the generic sentence for a rejection that is not a quota error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(saveSessionState).mockRejectedValueOnce(new Error('disk full'))
    mountAutosave()

    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY)

    expect(deps.showNotification).toHaveBeenCalledWith(AUTOSAVE_GENERIC_NOTICE, 'error')

    consoleError.mockRestore()
  })
})

describe('autosaveFailureNotice', () => {
  it('reads the quota sentence from a bare DOMException', () => {
    expect(autosaveFailureNotice(new DOMException('full', 'QuotaExceededError'))).toBe(
      AUTOSAVE_QUOTA_NOTICE
    )
  })

  it('reads the quota sentence through a wrapped cause (ESCSUITE-210 shape)', () => {
    // The shape `core/permissions.ts`'s ESCAPECRAFT counterpart actually
    // produces is `new Error('…', { cause })`, but the lib this project
    // targets (ES2020, unlike ESCAPECRAFT's ES2022) has no typed `cause`
    // option on `Error` itself — the real wrapper only ever reaches
    // `autosaveFailureNotice` as `unknown` regardless, so a plain object of
    // the same shape exercises the same `error.cause ?? error` read.
    const quotaError = new DOMException('full', 'QuotaExceededError')
    expect(autosaveFailureNotice({ cause: quotaError })).toBe(AUTOSAVE_QUOTA_NOTICE)
  })

  it('falls back to the generic sentence for a wrapped cause that is not a quota error', () => {
    const otherError = new DOMException('nope', 'UnknownError')
    expect(autosaveFailureNotice({ cause: otherError })).toBe(AUTOSAVE_GENERIC_NOTICE)
  })

  it('falls back to the generic sentence for a plain Error with no cause', () => {
    expect(autosaveFailureNotice(new Error('disk full'))).toBe(AUTOSAVE_GENERIC_NOTICE)
  })

  it('falls back to the generic sentence for a rejection that is not an object at all', () => {
    // Nothing today rejects `saveSessionState` with a bare value; this pins
    // that the optional chains hold if something ever does, rather than
    // turning a rejection into a crash.
    expect(autosaveFailureNotice(undefined)).toBe(AUTOSAVE_GENERIC_NOTICE)
  })
})

describe('the editor block re-arms the debounce (ESCSUITE-245)', () => {
  it.each([
    ['an in point', () => useEditorStore.getState().setInPoint(1)],
    ['an out point', () => useEditorStore.getState().setOutPoint(2)],
    ['a marker', () => useEditorStore.getState().addMarker(3)],
  ])('writes the session after %s changes, without a render', (_label, change) => {
    mountAutosave()
    vi.advanceTimersByTime(AUTO_SAVE_DELAY - 1)
    change()
    vi.advanceTimersByTime(AUTO_SAVE_DELAY - 1)
    expect(saveSessionState).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(saveSessionState).toHaveBeenCalledTimes(1)
    expect(vi.mocked(saveSessionState).mock.calls[0][0].editor).toBeDefined()
  })
})


// ESCSUITE-227: two tabs share one session slot. Only the tab that owns the
// session lock writes, and an empty project never overwrites the slot at all.
// jsdom has no `navigator.locks` — every case above runs as a lone tab that
// owns the session at once — so these install the double for themselves.
describe('one owner tab (ESCSUITE-227)', () => {
  let fake: FakeLocks

  beforeEach(() => {
    fake = createFakeLocks()
    Object.defineProperty(navigator, 'locks', { value: fake.locks, configurable: true })
  })

  afterEach(() => {
    delete (navigator as { locks?: LockManager }).locks
  })

  /** Another tab owning the session: hold the lock from outside the hook. */
  const anotherTabOwns = async () => {
    let releaseHold: () => void = () => {}
    void fake.locks.request(SESSION_LOCK_NAME, () => new Promise<void>((resolve) => { releaseHold = resolve }))
    await flushLocks()
    return () => releaseHold()
  }

  it('writes nothing while another tab owns the session', async () => {
    await anotherTabOwns()
    mountAutosave()
    await flushLocks()

    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY * 2)
    movePlayhead(1)
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY * 2)

    expect(saveSessionState).not.toHaveBeenCalled()
  })

  it('writes from the next change once the owning tab closes', async () => {
    const closeOwner = await anotherTabOwns()
    mountAutosave()
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY)
    expect(saveSessionState).not.toHaveBeenCalled()

    closeOwner()
    await flushLocks()
    movePlayhead(2)
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY)

    expect(saveSessionState).toHaveBeenCalledTimes(1)
    expect(saveSessionState).toHaveBeenCalledWith(expect.objectContaining({ currentTime: 2 }))
  })

  it('writes once it owns the session', async () => {
    mountAutosave()
    await flushLocks()

    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY)

    expect(fake.log).toEqual(['acquire'])
    expect(saveSessionState).toHaveBeenCalledTimes(1)
  })

  it('lets the session go when it unmounts', async () => {
    const { unmount } = mountAutosave()
    await flushLocks()
    expect(fake.isHeld(SESSION_LOCK_NAME)).toBe(true)

    unmount()
    await flushLocks()

    expect(fake.isHeld(SESSION_LOCK_NAME)).toBe(false)
  })

  it('says whether this tab owns the session, through a stable reader', async () => {
    const closeOwner = await anotherTabOwns()
    const { result, rerender } = mountAutosave()
    const reader = result.current.ownsSession
    await flushLocks()
    expect(result.current.ownsSession()).toBe(false)

    closeOwner()
    await flushLocks()
    rerender({ ...deps, zoom: 2 })

    expect(result.current.ownsSession).toBe(reader)
    expect(result.current.ownsSession()).toBe(true)
  })

  it('stops owning the session when it unmounts', async () => {
    const { result, unmount } = mountAutosave()
    await flushLocks()
    const ownsSession = result.current.ownsSession
    expect(ownsSession()).toBe(true)

    unmount()

    expect(ownsSession()).toBe(false)
  })

  it('does not ask for the session at all when the host drives its own state', async () => {
    // A host-driven editor writes nothing, so holding the lock would only
    // stop a real tab from ever owning the slot.
    const { result } = mountAutosave({ suppressRestore: true })
    await flushLocks()

    expect(result.current.ownsSession()).toBe(false)
    expect(fake.log).toEqual([])
    expect(fake.isHeld(SESSION_LOCK_NAME)).toBe(false)
  })
})

describe('an empty project never overwrites the slot (ESCSUITE-227)', () => {
  it('skips the write while the project has no sources and no clips', () => {
    useEditorStore.getState().resetProject()
    mountAutosave({ sourceVideos: useEditorStore.getState().sourceVideos })

    vi.advanceTimersByTime(AUTO_SAVE_DELAY * 2)

    expect(saveSessionState).not.toHaveBeenCalled()
  })

  it('writes as soon as the project holds something again', () => {
    useEditorStore.getState().resetProject()
    const { rerender } = mountAutosave({ sourceVideos: useEditorStore.getState().sourceVideos })
    vi.advanceTimersByTime(AUTO_SAVE_DELAY)

    useEditorStore.getState().addSourceVideo(video)
    rerender({ ...deps, sourceVideos: useEditorStore.getState().sourceVideos })
    vi.advanceTimersByTime(AUTO_SAVE_DELAY)

    expect(saveSessionState).toHaveBeenCalledTimes(1)
    expect(vi.mocked(saveSessionState).mock.calls[0][0].sourceVideos).toEqual([video])
  })
})
