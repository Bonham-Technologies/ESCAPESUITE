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
import { clearSessionState } from '../core/storage'
import { useEditorStore } from '../store/projectStore'
import { resetStoreForTest } from '../test/fixtures/projectStore'
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
    expect(deps.addSourceVideo).toHaveBeenCalledWith(
      expect.objectContaining({ id: sampleVideo.id }),
      0,
      expect.any(Array)
    )
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
