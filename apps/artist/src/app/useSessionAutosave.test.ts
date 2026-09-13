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
import { useSessionAutosave, type SessionAutosaveDeps } from './useSessionAutosave'
import { saveSessionState } from '../core/storage'
import { useEditorStore } from '../store/projectStore'
import { resetStoreForTest } from '../test/fixtures/projectStore'
import { AUTO_SAVE_DELAY } from './appConstants'

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
})
