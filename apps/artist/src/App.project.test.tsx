// Project lifecycle: the File menu, saving, loading (including the safety
// dialog), the session restore prompt, and the chrome around them.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { store, resetStoreForTest } from './test/fixtures/projectStore'
import { renderApp } from './test/renderApp'
import { installCanvasDouble, uninstallCanvasDouble } from './test/doubles/canvas'
import { installMediaPlaybackStubs } from './test/doubles/media'
import { sampleVideo } from './test/appDoubles'
import { addClip } from './test/fixtures/projectStore'
import { loadProject, saveProject, showOpenProjectDialog } from './core/projectManager'
import { clearSessionState, getSessionState, type SessionState } from './core/storage'
import styles from './App.module.css'

vi.mock('./core/storage', async () => (await import('./test/appDoubles')).storageDouble())
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

const projectFile = () => new File(['{}'], 'demo.escape', { type: 'application/json' })

const openFileMenu = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'File menu' }))

const notification = () => screen.queryByRole('status')?.textContent

const savedSession = (): SessionState => ({
  project: { ...store().project, name: 'Saved Project' },
  sourceVideos: [{ ...sampleVideo }],
  currentTime: 4,
  selectedClipId: null,
  zoom: 2,
  timestamp: Date.parse('2026-01-02T03:04:05Z'),
})

describe('App project lifecycle', () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetStoreForTest()
    store().clearHistory()
    installCanvasDouble()
    // The timeline-height tests write to localStorage, and artist's test setup
    // installs its own store that the shared afterEach does not clear.
    localStorage.clear()
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    uninstallCanvasDouble()
    confirmSpy.mockRestore()
    vi.clearAllMocks()
  })

  describe('the File menu', () => {
    it('opens and closes again from its backdrop', async () => {
      const user = userEvent.setup()
      const { container } = await renderApp()

      await openFileMenu(user)
      expect(screen.getByRole('menu', { name: 'File options' })).toBeInTheDocument()

      await user.click(container.querySelector(`.${styles.menuBackdrop}`) as HTMLElement)
      expect(screen.queryByRole('menu', { name: 'File options' })).not.toBeInTheDocument()
    })

    it('will not export an empty timeline', async () => {
      const user = userEvent.setup()
      await renderApp()

      await openFileMenu(user)

      expect(screen.getByRole('button', { name: /Export Video/ })).toBeDisabled()
    })

    it('exports from the menu once there is a clip', async () => {
      const user = userEvent.setup()
      addClip('clip1', 0, 2)
      await renderApp()

      await openFileMenu(user)
      await user.click(screen.getByRole('button', { name: /Export Video/ }))

      expect(await screen.findByRole('heading', { name: 'Export Video' })).toBeInTheDocument()
    })
  })

  describe('a new project', () => {
    it('starts one without asking when nothing would be lost', async () => {
      const user = userEvent.setup()
      await renderApp()

      await openFileMenu(user)
      await user.click(screen.getByRole('button', { name: /New Project/ }))

      expect(confirmSpy).not.toHaveBeenCalled()
      expect(clearSessionState).toHaveBeenCalled()
      expect(notification()).toBe('New project created')
    })

    it('asks before throwing away a timeline', async () => {
      const user = userEvent.setup()
      addClip('clip1', 0, 2)
      await renderApp()

      await openFileMenu(user)
      await user.click(screen.getByRole('button', { name: /New Project/ }))

      expect(confirmSpy).toHaveBeenCalledWith('Start a new project? Unsaved changes will be lost.')
      expect(store().project.timeline.clips).toHaveLength(0)
      expect(store().history.past).toHaveLength(0)
    })

    it('keeps the work when the question is declined', async () => {
      confirmSpy.mockReturnValue(false)
      const user = userEvent.setup()
      addClip('clip1', 0, 2)
      await renderApp()

      await openFileMenu(user)
      await user.click(screen.getByRole('button', { name: /New Project/ }))

      expect(store().project.timeline.clips).toHaveLength(1)
      expect(clearSessionState).not.toHaveBeenCalled()
    })
  })

  describe('saving', () => {
    it('saves from the quick action button', async () => {
      const user = userEvent.setup()
      await renderApp()

      await user.click(screen.getByRole('button', { name: 'Save project' }))

      await waitFor(() => expect(notification()).toBe('Project saved successfully'))
      expect(saveProject).toHaveBeenCalledWith(store().project, store().sourceVideos)
    })

    it('saves from the File menu', async () => {
      const user = userEvent.setup()
      await renderApp()

      await openFileMenu(user)
      await user.click(screen.getByRole('button', { name: /Save Project/ }))

      await waitFor(() => expect(saveProject).toHaveBeenCalled())
    })
  })

  describe('loading', () => {
    it('does nothing when the picker is dismissed', async () => {
      const user = userEvent.setup()
      await renderApp()

      await openFileMenu(user)
      await user.click(screen.getByRole('button', { name: /Open Project/ }))

      await waitFor(() => expect(showOpenProjectDialog).toHaveBeenCalled())
      expect(loadProject).not.toHaveBeenCalled()
    })

    it('loads straight away when the timeline is empty', async () => {
      const user = userEvent.setup()
      const file = projectFile()
      vi.mocked(showOpenProjectDialog).mockResolvedValueOnce(file)
      vi.mocked(loadProject).mockResolvedValueOnce({
        project: { ...store().project, name: 'Loaded Project' },
        sourceVideos: [{ ...sampleVideo, id: 'loaded1' }],
      })
      await renderApp()

      await openFileMenu(user)
      await user.click(screen.getByRole('button', { name: /Open Project/ }))

      await waitFor(() => expect(notification()).toBe('Project loaded successfully'))
      expect(loadProject).toHaveBeenCalledWith(file)
      expect(store().project.name).toBe('Loaded Project')
      expect(store().sourceVideos.map((v) => v.id)).toEqual(['loaded1'])
    })

    it('reports a project it cannot read', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const user = userEvent.setup()
      vi.mocked(showOpenProjectDialog).mockResolvedValueOnce(projectFile())
      vi.mocked(loadProject).mockRejectedValueOnce(new Error('corrupt'))
      await renderApp()

      await openFileMenu(user)
      await user.click(screen.getByRole('button', { name: /Open Project/ }))

      await waitFor(() => expect(notification()).toBe('Failed to load project'))
      expect(consoleError).toHaveBeenCalledWith('Load failed:', expect.any(Error))
      consoleError.mockRestore()
    })
  })

  describe('the load safety dialog', () => {
    const openWithWork = async (user: ReturnType<typeof userEvent.setup>) => {
      addClip('clip1', 0, 2)
      vi.mocked(showOpenProjectDialog).mockResolvedValueOnce(projectFile())
      await renderApp()
      await openFileMenu(user)
      await user.click(screen.getByRole('button', { name: /Open Project/ }))
      expect(await screen.findByTestId('project-load-dialog')).toBeInTheDocument()
    }

    it('asks before replacing work in progress', async () => {
      const user = userEvent.setup()
      await openWithWork(user)

      await user.click(screen.getByTestId('project-load-cancel'))

      expect(screen.queryByTestId('project-load-dialog')).not.toBeInTheDocument()
      expect(loadProject).not.toHaveBeenCalled()
      expect(store().project.timeline.clips).toHaveLength(1)
    })

    it('saves first when asked to', async () => {
      const user = userEvent.setup()
      await openWithWork(user)

      await user.click(screen.getByTestId('project-load-save'))

      await waitFor(() => expect(loadProject).toHaveBeenCalled())
      expect(saveProject).toHaveBeenCalled()
      expect(vi.mocked(saveProject).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(loadProject).mock.invocationCallOrder[0]
      )
    })

    it('still loads when that save fails', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const user = userEvent.setup()
      vi.mocked(saveProject).mockRejectedValueOnce(new Error('disk full'))
      await openWithWork(user)

      await user.click(screen.getByTestId('project-load-save'))

      await waitFor(() => expect(loadProject).toHaveBeenCalled())
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to save current project:',
        expect.any(Error)
      )
      consoleError.mockRestore()
    })

    it('discards the current work when asked to', async () => {
      const user = userEvent.setup()
      await openWithWork(user)

      await user.click(screen.getByTestId('project-load-discard'))

      await waitFor(() => expect(loadProject).toHaveBeenCalled())
      expect(saveProject).not.toHaveBeenCalled()
    })
  })

  describe('the session restore prompt', () => {
    it('restores the saved session', async () => {
      const user = userEvent.setup()
      vi.mocked(getSessionState).mockResolvedValueOnce(savedSession())
      await renderApp()

      expect(await screen.findByText('Resume Previous Session?')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Restore Session' }))

      expect(store().project.name).toBe('Saved Project')
      expect(store().currentTime).toBe(4)
      expect(store().zoom).toBe(2)
      expect(store().history.past).toHaveLength(0)
      expect(notification()).toBe('Session restored')
      expect(screen.queryByText('Resume Previous Session?')).not.toBeInTheDocument()
    })

    it('lists a restored video once when the library already holds its id', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const user = userEvent.setup()
      // resetStoreForTest seeds the library with one source video, and the saved session
      // names that same id — exactly what an autosave of the current session looks like on
      // the next visit.
      expect(store().sourceVideos.map((v) => v.id)).toEqual([sampleVideo.id])
      vi.mocked(getSessionState).mockResolvedValueOnce(savedSession())
      await renderApp()

      await user.click(await screen.findByRole('button', { name: 'Restore Session' }))

      expect(store().sourceVideos.map((v) => v.id)).toEqual([sampleVideo.id])
      expect(screen.getAllByText(sampleVideo.name)).toHaveLength(1)
      expect(screen.getByText('1 item')).toBeInTheDocument()
      // Two library rows under one React key is not cosmetic: React says the behaviour
      // is unsupported, and a click on either row addresses the same source.
      const keyWarning = consoleError.mock.calls.find((args) =>
        args.some((arg) => typeof arg === 'string' && arg.includes('same key'))
      )
      expect(keyWarning).toBeUndefined()
      consoleError.mockRestore()
    })

    it('describes what is on offer', async () => {
      vi.mocked(getSessionState).mockResolvedValueOnce(savedSession())
      await renderApp()

      expect(await screen.findByText('Saved Project')).toBeInTheDocument()
      expect(screen.getByText(/1 video\(s\), 0 clip\(s\) on timeline/)).toBeInTheDocument()
    })

    it('throws the session away when the user starts fresh', async () => {
      const user = userEvent.setup()
      vi.mocked(getSessionState).mockResolvedValueOnce(savedSession())
      await renderApp()

      await user.click(await screen.findByRole('button', { name: 'Start Fresh' }))

      expect(clearSessionState).toHaveBeenCalled()
      expect(store().project.name).not.toBe('Saved Project')
      expect(screen.queryByText('Resume Previous Session?')).not.toBeInTheDocument()
    })

    it('offers nothing for a session with no media in it', async () => {
      vi.mocked(getSessionState).mockResolvedValueOnce({ ...savedSession(), sourceVideos: [] })
      await renderApp()

      expect(screen.queryByText('Resume Previous Session?')).not.toBeInTheDocument()
    })

    it('carries on when the session lookup fails', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(getSessionState).mockRejectedValueOnce(new Error('db closed'))
      await renderApp()

      expect(consoleError).toHaveBeenCalledWith('Failed to check session:', expect.any(Error))
      expect(screen.queryByText('Resume Previous Session?')).not.toBeInTheDocument()
      consoleError.mockRestore()
    })
  })

  describe('the editor chrome', () => {
    it('renames the project from the header field', async () => {
      const user = userEvent.setup()
      await renderApp()

      const field = screen.getByLabelText('Project name')
      await user.clear(field)
      await user.type(field, 'Client cut')

      expect(store().project.name).toBe('Client cut')
    })

    it('collapses and reopens the media library', async () => {
      const user = userEvent.setup()
      await renderApp()

      await user.click(screen.getByTitle('Collapse sidebar'))
      expect(screen.queryByText('Media Library')).not.toBeInTheDocument()

      await user.click(screen.getByTitle('Expand sidebar'))
      expect(screen.getByText('Media Library')).toBeInTheDocument()
    })

    it('adds a track from the timeline controls', async () => {
      const user = userEvent.setup()
      await renderApp()

      await user.click(screen.getByRole('button', { name: 'Add new track' }))

      expect(store().project.timeline.tracks).toHaveLength(2)
    })

    it('drags the timeline taller and remembers the height', async () => {
      const { container } = await renderApp()
      const handle = screen.getByTitle('Drag to resize timeline (double-click to reset)')
      const footer = container.querySelector('footer') as HTMLElement

      fireEvent.mouseDown(handle)
      fireEvent.mouseMove(document, { clientY: window.innerHeight - 400 })
      expect(footer).toHaveStyle({ height: '400px' })

      fireEvent.mouseUp(document)
      expect(localStorage.getItem('escapeartist-timeline-height')).toBe('400')
    })

    it('clamps the timeline height to its limits', async () => {
      const { container } = await renderApp()
      const handle = screen.getByTitle('Drag to resize timeline (double-click to reset)')
      const footer = container.querySelector('footer') as HTMLElement

      fireEvent.mouseDown(handle)
      fireEvent.mouseMove(document, { clientY: window.innerHeight - 5000 })
      expect(footer).toHaveStyle({ height: '600px' })

      fireEvent.mouseMove(document, { clientY: window.innerHeight })
      expect(footer).toHaveStyle({ height: '120px' })
      fireEvent.mouseUp(document)
    })

    it('resets the timeline height on a double-click', async () => {
      const user = userEvent.setup()
      const { container } = await renderApp()
      const handle = screen.getByTitle('Drag to resize timeline (double-click to reset)')

      fireEvent.mouseDown(handle)
      fireEvent.mouseMove(document, { clientY: window.innerHeight - 500 })
      fireEvent.mouseUp(document)

      await user.dblClick(handle)

      expect(container.querySelector('footer')).toHaveStyle({ height: '320px' })
      expect(localStorage.getItem('escapeartist-timeline-height')).toBe('320')
      expect(notification()).toBe('Timeline height reset')
    })

    it('starts at the height it was left at', async () => {
      localStorage.setItem('escapeartist-timeline-height', '250')

      const { container } = await renderApp()

      expect(container.querySelector('footer')).toHaveStyle({ height: '250px' })
    })

    it('opens and closes the export dialog from the header', async () => {
      const user = userEvent.setup()
      addClip('clip1', 0, 2)
      await renderApp()

      await user.click(screen.getByRole('button', { name: 'Export video' }))
      expect(await screen.findByRole('heading', { name: 'Export Video' })).toBeInTheDocument()

      await user.click(screen.getByTitle('Close'))
      expect(screen.queryByRole('heading', { name: 'Export Video' })).not.toBeInTheDocument()
    })

    it('opens the shortcut sheet from the toolbar and closes it again', async () => {
      const user = userEvent.setup()
      await renderApp()

      await user.click(screen.getByTitle('Keyboard Shortcuts (?)'))
      expect(screen.getByRole('heading', { name: 'Keyboard Shortcuts' })).toBeInTheDocument()

      await user.click(screen.getByTitle('Close (Escape)'))
      expect(screen.queryByRole('heading', { name: 'Keyboard Shortcuts' })).not.toBeInTheDocument()
    })

    it('exports just the selected region from the timeline', async () => {
      const user = userEvent.setup()
      addClip('clip1', 0, 10)
      store().setInPoint(2)
      store().setOutPoint(6)
      await renderApp()

      await user.click(screen.getByRole('button', { name: 'Export Selection' }))

      expect(await screen.findByRole('heading', { name: 'Export Video' })).toBeInTheDocument()
    })

    it('shows a loading overlay while a project is being read', async () => {
      const user = userEvent.setup()
      let finishLoad: (value: { project: unknown; sourceVideos: unknown[] }) => void = () => {}
      vi.mocked(showOpenProjectDialog).mockResolvedValueOnce(projectFile())
      vi.mocked(loadProject).mockReturnValueOnce(
        new Promise((resolve) => {
          finishLoad = resolve as typeof finishLoad
        }) as ReturnType<typeof loadProject>
      )
      await renderApp()

      await openFileMenu(user)
      await user.click(screen.getByRole('button', { name: /Open Project/ }))

      expect(await screen.findByText('Loading project...')).toBeInTheDocument()

      await act(async () => {
        finishLoad({ project: store().project, sourceVideos: [] })
      })
      await waitFor(() => expect(screen.queryByText('Loading project...')).not.toBeInTheDocument())
    })
  })
})
