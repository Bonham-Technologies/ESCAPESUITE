// A take handed over while the startup session question is still open.
//
// `app/useHostIntegration.test.ts` pins the hook's own half — a take waits
// while `sessionDecisionPending` is true and is placed when it goes false.
// What only the whole app can show is *what App fills that flag from*, and the
// window that makes it matter: on a cold load `getSessionState()` has not come
// back yet, so `showSessionPrompt` is still `false` while the question is very
// much unanswered. A take placed in that window is replaced moments later by
// the "Restore" the user has not been offered yet, with no undo step back to
// it — which is why App passes `!sessionRestored` and not `showSessionPrompt`.
//
// The session read is held open here on purpose, because the ordering this file
// is about is exactly the one a real load does not guarantee: the import is a
// blob read plus a metadata scan plus a duration probe, and the session read is
// one small get, so in practice the prompt wins — but nothing makes it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen } from '@testing-library/react'
import { useEditorStore } from './store/projectStore'
import { store, resetStoreForTest } from './test/fixtures/projectStore'
import { renderApp } from './test/renderApp'
import { installCanvasDouble, uninstallCanvasDouble } from './test/doubles/canvas'
import { installMediaPlaybackStubs } from './test/doubles/media'
import { defaultUrlParams, sampleVideo } from './test/appDoubles'
import { parseUrlParams } from './utils/integration'
import { getSessionState, getVideo } from './core/storage'
import type { SessionState } from './core/storage'

vi.mock('./core/storage', async () => (await import('./test/appDoubles')).storageDouble())
vi.mock('./core/projectManager', async () =>
  (await import('./test/appDoubles')).projectManagerDouble()
)
vi.mock('./utils/integration', async () => (await import('./test/appDoubles')).integrationDouble())
vi.mock('./core/videoProcessor', async () =>
  (await import('./test/appDoubles')).videoProcessorDouble()
)

installMediaPlaybackStubs()

const HANDED_OVER = { ...sampleVideo, id: 'rec-1', name: 'Recording.webm' }

/** Answer the session read whenever the test chooses to, not when it lands. */
let answerSessionRead: (session: SessionState | undefined) => void

const savedSession = (): SessionState => ({
  project: { ...store().project, name: 'From Storage' },
  sourceVideos: [{ ...sampleVideo }],
  currentTime: 0,
  selectedClipId: null,
  zoom: 1,
  timestamp: Date.parse('2026-01-02T03:04:05Z'),
})

/**
 * Let the handoff's whole chain resolve.
 *
 * `settleApp` gives two microtask turns, which is what the App suite's quiet
 * cases need; the import is longer than that — a `getVideo`, a duration probe
 * and a `getThumbnail`, each with a `.catch` of its own.
 */
const flushImport = () =>
  act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve()
  })

const clipNames = () => useEditorStore.getState().project.timeline.clips.map((c) => c.name)
const libraryIds = () => useEditorStore.getState().sourceVideos.map((v) => v.id)

beforeEach(() => {
  resetStoreForTest()
  store().clearHistory()
  installCanvasDouble()
  vi.mocked(parseUrlParams).mockReturnValue({ ...defaultUrlParams(), loadVideoId: 'rec-1' })
  vi.mocked(getVideo).mockResolvedValue({ metadata: HANDED_OVER } as never)
  vi.mocked(getSessionState).mockImplementation(
    () =>
      new Promise((resolve) => {
        answerSessionRead = resolve
      })
  )
})

afterEach(() => {
  uninstallCanvasDouble()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('a ?loadVideo= handoff and the startup session question', () => {
  it('does not place the take while the session read is still in flight', async () => {
    await renderApp()
    await flushImport()

    // The prompt is not on screen — the read has not come back — so a flag
    // built from `showSessionPrompt` would read "nothing in the way" and place
    // the take, which the Restore below would then silently replace.
    expect(screen.queryByText('Resume Previous Session?')).toBeNull()
    // The library is safe either way, and gets the recording now.
    expect(libraryIds()).toContain('rec-1')
    expect(clipNames()).toEqual([])
  })

  it('places the take once the question is settled with nothing stored', async () => {
    await renderApp()
    await flushImport()

    await act(async () => {
      answerSessionRead(undefined)
      await Promise.resolve()
    })

    // No session, no prompt: the question is answered by the read itself, and
    // the take goes on with nothing else having happened.
    expect(clipNames()).toEqual(['Recording.webm'])
  })

  it('places the take after the session the user chose to restore', async () => {
    await renderApp()
    await flushImport()

    await act(async () => {
      answerSessionRead(savedSession())
      await Promise.resolve()
    })
    expect(await screen.findByText('Resume Previous Session?')).toBeVisible()
    expect(clipNames()).toEqual([])

    await act(async () => {
      screen.getByText('Restore Session').click()
      await Promise.resolve()
    })

    // The restored project's own clips first (it has none here), then the take
    // appended after them — rather than the take being placed and thrown away.
    expect(clipNames()).toEqual(['Recording.webm'])
    // The restore's clearHistory() ran before the placement, so the take is
    // still the one undoable step it promises to be.
    expect(useEditorStore.getState().history.past).toHaveLength(1)
  })
})
