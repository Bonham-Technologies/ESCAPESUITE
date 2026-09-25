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
import { useSessionRestore, type SessionRestoreDeps } from './useSessionRestore'
import { clearSessionState, getSessionState, type SessionState } from '../core/storage'
import { useEditorStore } from '../store/projectStore'
import { resetStoreForTest } from '../test/fixtures/projectStore'
import { sampleVideo } from '../test/appDoubles'

vi.mock('../core/storage', async () => (await import('../test/appDoubles')).storageDouble())

let deps: SessionRestoreDeps

const savedSession = (overrides: Partial<SessionState> = {}): SessionState => ({
  project: { ...useEditorStore.getState().project, name: 'From Storage' },
  sourceVideos: [{ ...sampleVideo }],
  currentTime: 7,
  selectedClipId: 'clip-1',
  zoom: 2,
  timestamp: Date.parse('2026-01-02T03:04:05Z'),
  ...overrides,
})

const mountRestore = (overrides: Partial<SessionRestoreDeps> = {}) => {
  deps = { ...deps, ...overrides }
  return renderHook(() => useSessionRestore(deps))
}

beforeEach(() => {
  resetStoreForTest()
  vi.mocked(getSessionState).mockResolvedValue(undefined)
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
})

describe('the startup session check', () => {
  it('settles the question without looking when the host suppresses it', async () => {
    const { result } = mountRestore({ suppressRestore: true })

    await waitFor(() => expect(result.current.sessionRestored).toBe(true))
    expect(getSessionState).not.toHaveBeenCalled()
    expect(result.current.showSessionPrompt).toBe(false)
  })

  it('leaves the question open while the storage read is still in flight', async () => {
    // The flag is false from the first render, before the read comes back —
    // not only once a prompt is on screen. `App` hands `!sessionRestored` to
    // `useHostIntegration` precisely for this window: `showSessionPrompt` is
    // still false here, and a handed-over take placed now would be replaced by
    // the Restore the user has not even been offered yet.
    let answer: (session: SessionState | undefined) => void = () => {}
    vi.mocked(getSessionState).mockImplementation(
      () => new Promise((resolve) => { answer = resolve })
    )

    const { result } = mountRestore()

    expect(result.current.sessionRestored).toBe(false)
    expect(result.current.showSessionPrompt).toBe(false)

    await act(async () => {
      answer(undefined)
      await Promise.resolve()
    })

    expect(result.current.sessionRestored).toBe(true)
  })

  it('offers a session that has media in it', async () => {
    const session = savedSession()
    vi.mocked(getSessionState).mockResolvedValue(session)

    const { result } = mountRestore()

    await waitFor(() => expect(result.current.showSessionPrompt).toBe(true))
    expect(result.current.pendingSession).toBe(session)
    // Still unanswered: the autosave stays off until the user decides.
    expect(result.current.sessionRestored).toBe(false)
  })

  it('does not offer a session with no media in it', async () => {
    vi.mocked(getSessionState).mockResolvedValue(savedSession({ sourceVideos: [] }))

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
    vi.mocked(getSessionState).mockRejectedValue(new Error('no database'))

    const { result } = mountRestore()

    await waitFor(() => expect(result.current.sessionRestored).toBe(true))
    expect(consoleError).toHaveBeenCalledWith('Failed to check session:', expect.any(Error))
  })

  it('only looks once — an answered question is not asked again', async () => {
    const { result, rerender } = mountRestore()
    await waitFor(() => expect(result.current.sessionRestored).toBe(true))

    rerender()

    expect(getSessionState).toHaveBeenCalledTimes(1)
  })
})

describe('answering the prompt', () => {
  /** Mount with a session waiting, the way the prompt is reached in the app. */
  const mountWithPendingSession = async (session: SessionState) => {
    vi.mocked(getSessionState).mockResolvedValue(session)
    const view = mountRestore()
    await waitFor(() => expect(view.result.current.showSessionPrompt).toBe(true))
    return view
  }

  it('restoring writes the whole session into the store and clears the history', async () => {
    const session = savedSession()
    const { result } = await mountWithPendingSession(session)

    act(() => result.current.handleRestoreSession(session))

    expect(deps.setProject).toHaveBeenCalledWith(session.project)
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
    expect(getSessionState).toHaveBeenCalledTimes(1)
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
