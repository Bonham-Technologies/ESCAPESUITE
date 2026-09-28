// The project actions: saving, opening (with the safety dialog in front of
// it) and starting over.
//
// The two modules that reach outside the editor — the project file
// reader/writer and session storage — are replaced with the same recording
// doubles the App suite uses. Everything else is a plain `vi.fn()`, so each
// test can say exactly which store writes an action made.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useProjectActions, type ProjectActionsDeps } from './useProjectActions'
import { loadProject, saveProject, showOpenProjectDialog } from '../core/projectManager'
import { clearSessionState, revokeSourceThumbnails } from '../core/storage'
import { useEditorStore } from '../store/projectStore'
import { resetStoreForTest, store } from '../test/fixtures/projectStore'
import { sampleVideo } from '../test/appDoubles'

vi.mock('../core/storage', async () => (await import('../test/appDoubles')).storageDouble())
vi.mock('../core/projectManager', async () =>
  (await import('../test/appDoubles')).projectManagerDouble()
)

const projectFile = () => new File(['{}'], 'demo.escape', { type: 'application/json' })

let deps: ProjectActionsDeps

const mountActions = (overrides: Partial<ProjectActionsDeps> = {}) => {
  deps = { ...deps, ...overrides }
  return renderHook(() => useProjectActions(deps))
}

beforeEach(() => {
  resetStoreForTest()
  // resetStoreForTest() drives the REAL store's resetProject(), which calls
  // the same (mocked) revokeSourceThumbnails this file asserts on — clear
  // that setup call so a test's own assertion only sees what it did itself.
  vi.mocked(revokeSourceThumbnails).mockClear()
  // Put the doubles back to their quiet defaults: vi.clearAllMocks() forgets
  // the calls but keeps whatever implementation the last test installed.
  vi.mocked(saveProject).mockResolvedValue(undefined)
  vi.mocked(loadProject).mockResolvedValue({ project: {} as never, sourceVideos: [] })
  vi.mocked(showOpenProjectDialog).mockResolvedValue(null)
  deps = {
    project: useEditorStore.getState().project,
    sourceVideos: [{ ...sampleVideo }],
    clipCount: 0,
    resetProject: vi.fn(),
    setProject: vi.fn(),
    addSourceVideo: vi.fn(),
    clearHistory: vi.fn(),
    showNotification: vi.fn(),
  }
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('saving', () => {
  it('writes the project and its media, and says so', async () => {
    const { result } = mountActions()

    await act(async () => {
      await result.current.handleSaveProject()
    })

    expect(saveProject).toHaveBeenCalledWith(deps.project, deps.sourceVideos)
    expect(deps.showNotification).toHaveBeenCalledWith('Project saved successfully', 'success')
    expect(result.current.isSaving).toBe(false)
  })

  it('holds isSaving up for as long as the write takes', async () => {
    let finishSave!: () => void
    vi.mocked(saveProject).mockReturnValue(new Promise<void>((resolve) => { finishSave = resolve }))
    const { result } = mountActions()

    act(() => { void result.current.handleSaveProject() })
    expect(result.current.isSaving).toBe(true)

    await act(async () => { finishSave() })
    expect(result.current.isSaving).toBe(false)
  })

  it('reports a failed write and lets go of the flag', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(saveProject).mockRejectedValue(new Error('disk full'))
    const { result } = mountActions()

    await act(async () => {
      await result.current.handleSaveProject()
    })

    expect(consoleError).toHaveBeenCalledWith('Save failed:', expect.any(Error))
    expect(deps.showNotification).toHaveBeenCalledWith('Failed to save project', 'error')
    expect(result.current.isSaving).toBe(false)
  })
})

describe('opening a project', () => {
  it('does nothing when the file picker is dismissed', async () => {
    const { result } = mountActions({ clipCount: 3 })

    await act(async () => {
      await result.current.handleLoadProject()
    })

    expect(loadProject).not.toHaveBeenCalled()
    expect(result.current.showProjectLoadDialog).toBe(false)
  })

  it('loads straight away when the timeline is empty', async () => {
    vi.mocked(showOpenProjectDialog).mockResolvedValue(projectFile())
    vi.mocked(loadProject).mockResolvedValue({
      project: { ...deps.project, name: 'Opened' },
      sourceVideos: [{ ...sampleVideo }],
    })
    const { result } = mountActions({ clipCount: 0 })

    await act(async () => {
      await result.current.handleLoadProject()
    })

    expect(deps.resetProject).toHaveBeenCalled()
    expect(deps.setProject).toHaveBeenCalledWith(expect.objectContaining({ name: 'Opened' }))
    // ESCSUITE-113 (review round 2): addSourceVideo is now called from an
    // explicit loop rather than `loadedVideos.forEach`, so it is called with
    // just the source — not forEach's incidental (element, index, array).
    expect(deps.addSourceVideo).toHaveBeenCalledWith(expect.objectContaining({ id: sampleVideo.id }))
    expect(deps.showNotification).toHaveBeenCalledWith('Project loaded successfully', 'success')
    expect(result.current.showProjectLoadDialog).toBe(false)
    expect(result.current.isLoading).toBe(false)
  })

  it('asks first when there is work on the timeline', async () => {
    vi.mocked(showOpenProjectDialog).mockResolvedValue(projectFile())
    const { result } = mountActions({ clipCount: 2 })

    await act(async () => {
      await result.current.handleLoadProject()
    })

    expect(result.current.showProjectLoadDialog).toBe(true)
    expect(loadProject).not.toHaveBeenCalled()
  })

  it('holds isLoading up for as long as the read takes', async () => {
    vi.mocked(showOpenProjectDialog).mockResolvedValue(projectFile())
    let finishLoad!: (value: { project: never; sourceVideos: never[] }) => void
    vi.mocked(loadProject).mockReturnValue(
      new Promise((resolve) => { finishLoad = resolve as typeof finishLoad })
    )
    const { result } = mountActions({ clipCount: 0 })

    await act(async () => {
      void result.current.handleLoadProject()
    })
    expect(result.current.isLoading).toBe(true)

    await act(async () => {
      finishLoad({ project: deps.project as never, sourceVideos: [] })
    })
    expect(result.current.isLoading).toBe(false)
  })

  it('reports a file it cannot read', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(showOpenProjectDialog).mockResolvedValue(projectFile())
    vi.mocked(loadProject).mockRejectedValue(new Error('not a project'))
    const { result } = mountActions({ clipCount: 0 })

    await act(async () => {
      await result.current.handleLoadProject()
    })

    expect(consoleError).toHaveBeenCalledWith('Load failed:', expect.any(Error))
    expect(deps.showNotification).toHaveBeenCalledWith('Failed to load project', 'error')
    expect(result.current.isLoading).toBe(false)
    // loadProject itself is what threw — there is nothing it minted to revoke.
    expect(revokeSourceThumbnails).not.toHaveBeenCalled()
  })

  it('rejects a malformed project without emptying the editor first (ESCSUITE-102), and revokes the incoming thumbnails loadProject already minted', async () => {
    vi.mocked(showOpenProjectDialog).mockResolvedValue(projectFile())
    // A file that parses as JSON but is not a shape parseProject accepts —
    // no clips array on the timeline. loadProject still minted a thumbnail
    // for whatever it read before parseProject ever saw the result.
    const incoming = { ...sampleVideo, id: 'incoming', thumbnailUrl: 'blob:incoming' }
    vi.mocked(loadProject).mockResolvedValue({
      project: { id: 'p', name: 'Bad', created: 1, modified: 1, resolution: { width: 1920, height: 1080 }, timeline: {} } as never,
      sourceVideos: [incoming],
    })
    const { result } = mountActions({ clipCount: 0 })

    await act(async () => {
      await result.current.handleLoadProject()
    })

    expect(deps.resetProject).not.toHaveBeenCalled()
    expect(deps.setProject).not.toHaveBeenCalled()
    expect(deps.addSourceVideo).not.toHaveBeenCalled()
    expect(deps.showNotification).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load project'),
      'error'
    )
    expect(result.current.isLoading).toBe(false)
    // ESCSUITE-113: nothing is ever going to render these now, and nothing
    // else would ever free them either.
    expect(revokeSourceThumbnails).toHaveBeenCalledWith([incoming])
  })

  // ESCSUITE-113: loadProject succeeded (it minted thumbnails) but something
  // after it — here, parseProject itself — threw before the sources ever
  // reached the store. The outer catch is the only place left that can free
  // them.
  it('revokes what loadProject minted when something after it throws before the sources are ever added', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(showOpenProjectDialog).mockResolvedValue(projectFile())
    const incoming = { ...sampleVideo, id: 'incoming', thumbnailUrl: 'blob:incoming' }
    vi.mocked(loadProject).mockResolvedValue({
      project: { ...deps.project, name: 'Opened' },
      sourceVideos: [incoming],
    })
    vi.mocked(deps.setProject).mockImplementation(() => { throw new Error('store exploded') })
    const { result } = mountActions({ clipCount: 0 })

    await act(async () => {
      await result.current.handleLoadProject()
    })

    expect(consoleError).toHaveBeenCalledWith('Load failed:', expect.any(Error))
    expect(revokeSourceThumbnails).toHaveBeenCalledWith([incoming])
  })

  // ESCSUITE-113 (round 2 re-review): the loop shrinks `mintedButNotYetOwned`
  // after every successful addSourceVideo, so a throw partway through a
  // multi-source load revokes only the sources the store never took in —
  // never the ones already live and on screen. A plain forEach would revoke
  // all three here.
  it('revokes only the sources the store never took in when addSourceVideo throws partway through', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(showOpenProjectDialog).mockResolvedValue(projectFile())
    const incoming = ['a', 'b', 'c'].map((id) => ({ ...sampleVideo, id, thumbnailUrl: `blob:${id}` }))
    vi.mocked(loadProject).mockResolvedValue({
      project: { ...deps.project, name: 'Opened' },
      sourceVideos: incoming,
    })
    vi.mocked(deps.addSourceVideo)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => { throw new Error('store exploded') })
    const { result } = mountActions({ clipCount: 0 })

    await act(async () => {
      await result.current.handleLoadProject()
    })

    expect(consoleError).toHaveBeenCalledWith('Load failed:', expect.any(Error))
    expect(deps.addSourceVideo).toHaveBeenCalledTimes(2)
    expect(revokeSourceThumbnails).toHaveBeenCalledTimes(1)
    expect(revokeSourceThumbnails).toHaveBeenCalledWith([incoming[1], incoming[2]])
  })

  it('does not revoke a source that made it into the store before a load is reported successful', async () => {
    vi.mocked(showOpenProjectDialog).mockResolvedValue(projectFile())
    vi.mocked(loadProject).mockResolvedValue({
      project: { ...deps.project, name: 'Opened' },
      sourceVideos: [{ ...sampleVideo, id: 'incoming', thumbnailUrl: 'blob:incoming' }],
    })
    const { result } = mountActions({ clipCount: 0 })

    await act(async () => {
      await result.current.handleLoadProject()
    })

    expect(deps.addSourceVideo).toHaveBeenCalled()
    expect(revokeSourceThumbnails).not.toHaveBeenCalled()
  })

  // ESCSUITE-113 (MINOR 1 review): resetProject() itself owns revoking the
  // outgoing library — real behaviour pinned through the REAL store, the
  // same pattern the ESCSUITE-102 review test below uses, rather than a
  // mocked resetProject that would hide whether the real one still does it.
  it('revoking the outgoing library on load goes through the REAL resetProject, not a second call from this hook', async () => {
    vi.mocked(showOpenProjectDialog).mockResolvedValue(projectFile())
    vi.mocked(loadProject).mockResolvedValue({
      project: { ...deps.project, name: 'Opened' },
      sourceVideos: [],
    })
    store().addSourceVideo({ ...sampleVideo, id: 'outgoing', thumbnailUrl: 'blob:outgoing' })
    vi.mocked(URL.revokeObjectURL).mockClear()
    const { result } = mountActions({
      clipCount: 0,
      resetProject: () => store().resetProject(),
      setProject: (p) => store().setProject(p),
      addSourceVideo: (v) => store().addSourceVideo(v),
    })

    await act(async () => {
      await result.current.handleLoadProject()
    })

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:outgoing')
    expect(store().sourceVideos.find((v) => v.id === 'outgoing')).toBeUndefined()
  })

  it('leaves the REAL store untouched by a bad file — same project reference, no history entry (ESCSUITE-102 review)', async () => {
    vi.mocked(showOpenProjectDialog).mockResolvedValue(projectFile())
    vi.mocked(loadProject).mockResolvedValue({
      project: {
        id: 'p', name: 'Bad', created: 1, modified: 1,
        resolution: { width: 1920, height: 1080 }, timeline: {},
      } as never,
      sourceVideos: [],
    })
    const projectBefore = useEditorStore.getState().project
    const historyLengthBefore = useEditorStore.getState().history.past.length
    // Wired to the real store's own actions, not the vi.fn() doubles every
    // other test in this file uses — this test is about what the store
    // itself ends up holding, not about which callback was invoked.
    const { result } = mountActions({
      resetProject: () => store().resetProject(),
      setProject: (p) => store().setProject(p),
      clipCount: 0,
    })

    await act(async () => {
      await result.current.handleLoadProject()
    })

    expect(useEditorStore.getState().project).toBe(projectBefore)
    expect(useEditorStore.getState().history.past).toHaveLength(historyLengthBefore)
  })
})

describe('a project file handed in from elsewhere', () => {
  // `handleProjectFile` is the "given a project file" half of
  // `handleLoadProject`, exposed so the uploader's drop/pick path can ask the
  // same question instead of owning a second dialog of its own (ESCSUITE-63).
  it('loads it straight away when the timeline is empty', async () => {
    const file = projectFile()
    vi.mocked(loadProject).mockResolvedValue({
      project: { ...deps.project, name: 'Dropped' },
      sourceVideos: [],
    })
    const { result } = mountActions({ clipCount: 0 })

    await act(async () => {
      result.current.handleProjectFile(file)
    })

    expect(loadProject).toHaveBeenCalledWith(file)
    expect(deps.setProject).toHaveBeenCalledWith(expect.objectContaining({ name: 'Dropped' }))
    expect(deps.showNotification).toHaveBeenCalledWith('Project loaded successfully', 'success')
    expect(result.current.showProjectLoadDialog).toBe(false)
    // Nothing was picked: the file arrived from the caller, not the file picker.
    expect(showOpenProjectDialog).not.toHaveBeenCalled()
  })

  it('asks first when there is work on the timeline, and the answer loads that file', async () => {
    const file = projectFile()
    const { result } = mountActions({ clipCount: 2 })

    act(() => {
      result.current.handleProjectFile(file)
    })
    expect(result.current.showProjectLoadDialog).toBe(true)
    expect(loadProject).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.handleProjectLoadDiscardAndLoad()
    })

    expect(loadProject).toHaveBeenCalledWith(file)
  })
})

describe('the safety dialog', () => {
  /** Open the dialog the way Ctrl+O over a populated timeline does. */
  const openDialog = async (result: { current: { handleLoadProject: () => Promise<void> } }) => {
    vi.mocked(showOpenProjectDialog).mockResolvedValue(projectFile())
    await act(async () => {
      await result.current.handleLoadProject()
    })
  }

  it('cancelling shuts the dialog and forgets the file', async () => {
    const { result } = mountActions({ clipCount: 2 })
    await openDialog(result)

    act(() => result.current.handleProjectLoadCancel())
    expect(result.current.showProjectLoadDialog).toBe(false)

    // The file is gone, so "save and load anyway" now has nothing to load.
    await act(async () => {
      await result.current.handleProjectLoadSaveAndLoad()
    })
    expect(loadProject).not.toHaveBeenCalled()
  })

  it('saves before it loads when asked to', async () => {
    const { result } = mountActions({ clipCount: 2 })
    await openDialog(result)

    await act(async () => {
      await result.current.handleProjectLoadSaveAndLoad()
    })

    expect(deps.showNotification).toHaveBeenCalledWith('Project saved', 'success')
    expect(result.current.showProjectLoadDialog).toBe(false)
    const saved = vi.mocked(saveProject).mock.invocationCallOrder[0]
    const loaded = vi.mocked(loadProject).mock.invocationCallOrder[0]
    expect(saved).toBeLessThan(loaded)
  })

  it('loads anyway when the save it was asked for fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = mountActions({ clipCount: 2 })
    await openDialog(result)
    vi.mocked(saveProject).mockRejectedValue(new Error('disk full'))

    await act(async () => {
      await result.current.handleProjectLoadSaveAndLoad()
    })

    expect(consoleError).toHaveBeenCalledWith('Failed to save current project:', expect.any(Error))
    expect(deps.showNotification).toHaveBeenCalledWith('Failed to save project', 'error')
    expect(loadProject).toHaveBeenCalled()
  })

  it('discards the current work when asked to', async () => {
    const { result } = mountActions({ clipCount: 2 })
    await openDialog(result)

    await act(async () => {
      await result.current.handleProjectLoadDiscardAndLoad()
    })

    expect(saveProject).not.toHaveBeenCalled()
    expect(loadProject).toHaveBeenCalled()
    expect(result.current.showProjectLoadDialog).toBe(false)
  })

  it('discarding with no file pending loads nothing', async () => {
    const { result } = mountActions({ clipCount: 2 })

    await act(async () => {
      await result.current.handleProjectLoadDiscardAndLoad()
    })

    expect(loadProject).not.toHaveBeenCalled()
  })
})

describe('starting a new project', () => {
  it('does not ask when there is nothing to lose', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { result } = mountActions({ clipCount: 0 })

    act(() => result.current.handleNewProject())

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(deps.resetProject).toHaveBeenCalled()
    expect(deps.clearHistory).toHaveBeenCalled()
    expect(clearSessionState).toHaveBeenCalled()
    expect(deps.showNotification).toHaveBeenCalledWith('New project created', 'info')
  })

  it('asks, and starts over when the answer is yes', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { result } = mountActions({ clipCount: 2 })

    act(() => result.current.handleNewProject())

    expect(confirmSpy).toHaveBeenCalledWith('Start a new project? Unsaved changes will be lost.')
    expect(deps.resetProject).toHaveBeenCalled()
  })

  it('leaves everything alone when the answer is no', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { result } = mountActions({ clipCount: 2 })

    act(() => result.current.handleNewProject())

    expect(deps.resetProject).not.toHaveBeenCalled()
    expect(deps.clearHistory).not.toHaveBeenCalled()
    expect(clearSessionState).not.toHaveBeenCalled()
    expect(deps.showNotification).not.toHaveBeenCalled()
  })
})
