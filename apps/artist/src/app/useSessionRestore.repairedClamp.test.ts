// ESCSUITE-329: a session restore clamps the saved range against the clips the
// store actually holds after `setProject` has migrated them, not the raw clips
// the snapshot carried. ESCSUITE-304's migration can lengthen an overlay saved
// with a non-positive duration to its dragged length, so the raw timeline is
// shorter than the restored one.
//
// Same doubles and setup as `useSessionRestore.test.ts`; the store is the real
// one, so the migration really runs.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useSessionRestore, type SessionRestoreDeps } from './useSessionRestore'
import { TAB_ID_KEY } from './tabId'
import { __resetDeclinedSlotsForTests } from './declinedSlots'
import {
  getThumbnail,
  getVideo,
  listSessionStates,
  revokeSourceThumbnails,
  type SessionState,
} from '../core/storage'
import { useEditorStore } from '../store/projectStore'
import { resetStoreForTest, store } from '../test/fixtures/projectStore'
import { sampleVideo, slotOf } from '../test/appDoubles'

vi.mock('../core/storage', async () => (await import('../test/appDoubles')).storageDouble())

const marker = { id: 'm1', time: 1.8, label: '', color: '#ff0000' }

/**
 * A session whose one text overlay was saved the way ESCSUITE-304's bug left
 * it: `startTime 4 / endTime 2 / duration -2`, which the migration repairs to
 * `0 / 2 / 2`. The saved timeline is therefore -2 long raw and 2 long restored.
 */
const sessionWith = (clipFields: object, editor: SessionState['editor'], savedDuration = 0): SessionState => {
  const project = useEditorStore.getState().project
  const trackId = project.timeline.tracks[0].id
  const clip = {
    id: 'text-1', sourceVideoId: '', trackId, name: 'Title', overlayType: 'text',
    startTime: 4, endTime: 2, duration: -2, timelinePosition: 0, ...clipFields,
  }
  return {
    tabId: 'earlier-tab',
    project: { ...project, timeline: { ...project.timeline, clips: [clip] as never, duration: savedDuration } },
    sourceVideos: [{ ...sampleVideo }],
    currentTime: 0,
    selectedClipId: null,
    zoom: 1,
    timestamp: Date.now() - 60_000,
    editor,
  }
}

const restore = async (session: SessionState) => {
  vi.mocked(listSessionStates).mockResolvedValue([slotOf(session)])
  const deps: SessionRestoreDeps = {
    suppressRestore: false,
    setProject: (p) => store().setProject(p),
    addSourceVideo: (v) => store().addSourceVideo(v),
    seekTo: (t) => store().seekTo(t),
    setSelectedClipId: (id) => store().setSelectedClipId(id),
    setZoom: vi.fn(),
    clearHistory: () => store().clearHistory(),
    showNotification: vi.fn(),
  }
  const view = renderHook(() => useSessionRestore(deps))
  await waitFor(() => expect(view.result.current.showSessionPrompt).toBe(true))
  await act(async () => {
    await view.result.current.handleRestoreSession(session)
  })
}

beforeEach(() => {
  resetStoreForTest()
  vi.mocked(revokeSourceThumbnails).mockClear()
  vi.mocked(listSessionStates).mockResolvedValue([])
  vi.mocked(getThumbnail).mockResolvedValue(undefined)
  vi.mocked(getVideo).mockImplementation(async (id) => ({
    blob: new Blob(['bytes']),
    metadata: { ...sampleVideo, id },
  }))
  sessionStorage.clear()
  sessionStorage.setItem(TAB_ID_KEY, 'this-tab')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  sessionStorage.clear()
  __resetDeclinedSlotsForTests()
})

describe('the saved range against the restored clips (ESCSUITE-329)', () => {
  it('clamps against the migration-repaired timeline, not the saved clips', async () => {
    await restore(sessionWith({}, { inPoint: 0.5, outPoint: 1.5, markers: [marker] }))

    const state = useEditorStore.getState()
    // The repair is what makes the range reachable at all.
    expect(state.project.timeline.clips[0]).toMatchObject({ startTime: 0, endTime: 2, duration: 2 })
    expect(state.project.timeline.duration).toBe(2)
    expect(state.inPoint).toBe(0.5)
    expect(state.outPoint).toBe(1.5)
    expect(state.markers).toEqual([marker])
  })

  it('still clamps a range that runs past the restored timeline', async () => {
    await restore(sessionWith({}, { inPoint: 0.5, outPoint: 5, markers: [] }))

    const state = useEditorStore.getState()
    expect(state.inPoint).toBe(0.5)
    expect(state.outPoint).toBe(2)
  })

  it('leaves a session that needs no repair exactly as it was saved', async () => {
    await restore(
      sessionWith({ startTime: 0, endTime: 4, duration: 4 }, { inPoint: 1, outPoint: 3, markers: [marker] }, 4)
    )

    const state = useEditorStore.getState()
    expect(state.project.timeline.duration).toBe(4)
    expect(state.inPoint).toBe(1)
    expect(state.outPoint).toBe(3)
    expect(state.markers).toEqual([marker])
  })
})
