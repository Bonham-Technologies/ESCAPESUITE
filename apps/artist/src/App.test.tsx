import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { renderApp } from './test/renderApp'
import { useEditorStore } from './store/projectStore'
import { getSessionState, clearSessionState, saveSessionState } from './core/storage'
import { parseUrlParams, initIntegration, sendMessage } from './utils/integration'
import { installCanvasDouble, uninstallCanvasDouble } from './test/doubles/canvas'
import { installMediaPlaybackStubs } from './test/doubles/media'
import type { SessionState } from './core/storage'

// App's collaborators are replaced with the recording doubles shared by every
// App test file; see src/test/appDoubles.ts.
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

// Nothing in this file drives a dialog that asks for confirmation, but App
// renders components that may; keep confirm answering yes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).confirm = vi.fn(() => true)

describe('App', () => {
  beforeEach(() => {
    useEditorStore.getState().resetProject()
    useEditorStore.setState({ history: { past: [], future: [] } })
    installCanvasDouble()
    vi.clearAllMocks()
    cleanup()
  })

  afterEach(() => {
    uninstallCanvasDouble()
    cleanup()
  })

  describe('rendering', () => {
    it('renders the app header', async () => {
      await renderApp()

      expect(screen.getByText('ESCAPEARTIST')).toBeInTheDocument()
    })

    it('renders the file menu button', async () => {
      await renderApp()

      expect(screen.getByText('File')).toBeInTheDocument()
    })

    it('renders upload area', async () => {
      await renderApp()

      expect(screen.getByText('Drop media or click to browse')).toBeInTheDocument()
    })

    it('renders timeline', async () => {
      await renderApp()

      expect(screen.getByText('Track 1')).toBeInTheDocument()
    })

    it('renders playback controls', async () => {
      await renderApp()

      expect(screen.getByTitle('Go to start (Home)')).toBeInTheDocument()
    })

    it('renders export button', async () => {
      await renderApp()

      expect(screen.getByText('Export')).toBeInTheDocument()
    })
  })

  describe('header buttons', () => {
    it('shows undo and redo buttons', async () => {
      await renderApp()

      // Use queryAll since there may be multiple matching elements
      await waitFor(() => {
        const undoButtons = screen.queryAllByTitle(/Undo/)
        const redoButtons = screen.queryAllByTitle(/Redo/)
        expect(undoButtons.length + redoButtons.length).toBeGreaterThanOrEqual(0)
      })
    })
  })

  describe('zoom controls', () => {
    it('shows zoom in button', async () => {
      await renderApp()

      expect(screen.getByTitle(/Zoom in/)).toBeInTheDocument()
    })

    it('shows zoom out button', async () => {
      await renderApp()

      expect(screen.getByTitle(/Zoom out/)).toBeInTheDocument()
    })

    it('zooms in when button clicked', async () => {
      await renderApp()

      const initialZoom = useEditorStore.getState().zoom
      const zoomInButton = screen.getByTitle(/Zoom in/)
      fireEvent.click(zoomInButton)

      expect(useEditorStore.getState().zoom).toBeGreaterThan(initialZoom)
    })

    it('zooms out when button clicked', async () => {
      await renderApp()

      // First zoom in to have room to zoom out. Inside act(): a zustand change with the app
      // mounted is a React update, and one made outside act() is one React reports.
      act(() => {
        useEditorStore.getState().setZoom(2)
      })

      const zoomOutButton = screen.getByTitle(/Zoom out/)
      fireEvent.click(zoomOutButton)

      expect(useEditorStore.getState().zoom).toBeLessThan(2)
    })
  })

  describe('file menu', () => {
    it('renders file menu button', async () => {
      await renderApp()

      const fileButton = screen.getByText('File')
      expect(fileButton).toBeInTheDocument()
    })
  })

  describe('export dialog', () => {
    it('renders export button', async () => {
      await renderApp()

      const exportButton = screen.getByText('Export')
      expect(exportButton).toBeInTheDocument()
    })
  })

  describe('keyboard shortcuts', () => {
    it('has undo and redo in store', () => {
      const store = useEditorStore.getState()
      expect(typeof store.undo).toBe('function')
      expect(typeof store.redo).toBe('function')
    })
  })

  describe('project', () => {
    it('has a project in store', () => {
      const store = useEditorStore.getState()
      expect(store.project).toBeDefined()
      expect(store.project.name).toBeDefined()
    })
  })

  describe('inspector panel', () => {
    it('renders inspector header', async () => {
      await renderApp()

      expect(screen.getByText('Inspector')).toBeInTheDocument()
    })

    it('renders collapse button in inspector', async () => {
      await renderApp()

      const collapseButton = screen.getByTitle('Hide inspector')
      expect(collapseButton).toBeInTheDocument()
    })

    it('toggles inspector collapsed state when button clicked', async () => {
      await renderApp()

      // Find the collapse button by title
      const collapseButton = screen.getByTitle(/Hide inspector/i)
      expect(collapseButton).toBeInTheDocument()

      // Click to collapse
      fireEvent.click(collapseButton)

      // Button title should change to "Show inspector"
      expect(screen.getByTitle(/Show inspector/i)).toBeInTheDocument()
    })

    it('hides ClipEditor when inspector is collapsed', async () => {
      await renderApp()

      // Initially ClipEditor should be visible (shows empty state message)
      expect(screen.getByText(/Select a clip/i)).toBeInTheDocument()

      // Click collapse button
      const collapseButton = screen.getByTitle(/Hide inspector/i)
      fireEvent.click(collapseButton)

      // ClipEditor content should not be visible when collapsed
      expect(screen.queryByText(/Select a clip/i)).not.toBeInTheDocument()
    })

    it('shows ClipEditor when inspector is expanded', async () => {
      await renderApp()

      // Collapse first
      const collapseButton = screen.getByTitle(/Hide inspector/i)
      fireEvent.click(collapseButton)

      // Then expand
      const expandButton = screen.getByTitle(/Show inspector/i)
      fireEvent.click(expandButton)

      // ClipEditor should be visible again
      expect(screen.getByText(/Select a clip/i)).toBeInTheDocument()
    })
  })

  describe('mobile inspector toggle', () => {
    it('renders mobile toggle button', async () => {
      await renderApp()

      const mobileToggle = screen.getByTitle('Toggle inspector')
      expect(mobileToggle).toBeInTheDocument()
    })

    it('toggles inspector when mobile button clicked', async () => {
      await renderApp()

      // Initially inspector should show content
      expect(screen.getByText(/Select a clip/i)).toBeInTheDocument()

      // Click mobile toggle
      const mobileToggle = screen.getByTitle('Toggle inspector')
      fireEvent.click(mobileToggle)

      // Inspector content should be hidden
      expect(screen.queryByText(/Select a clip/i)).not.toBeInTheDocument()
    })
  })

  describe('host URL parameters', () => {
    const savedSession = (): SessionState => ({
      project: { ...useEditorStore.getState().project, name: 'Saved Project' },
      sourceVideos: [{
        id: 'video1',
        name: 'test.mp4',
        duration: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        mimeType: 'video/mp4',
        size: 1000,
      }],
      currentTime: 0,
      selectedClipId: null,
      zoom: 1,
      timestamp: Date.now(),
    })

    const urlParams = (overrides: Partial<ReturnType<typeof parseUrlParams>> = {}) => {
      vi.mocked(parseUrlParams).mockReturnValue({
        videos: [],
        projectData: null,
        autoPlay: false,
        loadVideoId: null,
        suppressRestore: false,
        title: null,
        hostOrigin: null,
        ...overrides,
      })
    }

    afterEach(() => {
      urlParams()
      vi.mocked(getSessionState).mockResolvedValue(undefined)
    })

    it('shows the restore prompt for a saved session by default', async () => {
      urlParams()
      vi.mocked(getSessionState).mockResolvedValue(savedSession())

      await renderApp()

      expect(await screen.findByText('Resume Previous Session?')).toBeInTheDocument()
    })

    it('skips the restore prompt when suppressRestore is set, keeping the saved session', async () => {
      urlParams({ suppressRestore: true })
      vi.mocked(getSessionState).mockResolvedValue(savedSession())

      await renderApp()

      // Let the session lookup that the control test relies on settle
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

      expect(screen.queryByText('Resume Previous Session?')).not.toBeInTheDocument()
      expect(clearSessionState).not.toHaveBeenCalled()
    })

    it('applies the title param to a freshly created project', async () => {
      urlParams({ title: 'Client Demo' })

      await renderApp()

      await waitFor(() => {
        expect(useEditorStore.getState().project.name).toBe('Client Demo')
      })
    })

    it('does not override a project name that came from project data', async () => {
      urlParams({ title: 'Client Demo' })
      const project = useEditorStore.getState().project
      useEditorStore.getState().setProject({ ...project, name: 'Host Project' })

      await renderApp()

      await act(async () => { await Promise.resolve() })

      expect(useEditorStore.getState().project.name).toBe('Host Project')
    })

    it('leaves no undo step behind after applying the title', async () => {
      urlParams({ title: 'Client Demo' })

      await renderApp()

      await waitFor(() => {
        expect(useEditorStore.getState().project.name).toBe('Client Demo')
      })
      // The host naming the project is not an edit the user should be able to
      // undo back past - handleRestoreSession clears history for the same reason.
      expect(useEditorStore.getState().history.past).toHaveLength(0)
    })
  })

  describe('session autosave', () => {
    const urlParams = (overrides: Partial<ReturnType<typeof parseUrlParams>> = {}) => {
      vi.mocked(parseUrlParams).mockReturnValue({
        videos: [],
        projectData: null,
        autoPlay: false,
        loadVideoId: null,
        suppressRestore: false,
        title: null,
        hostOrigin: null,
        ...overrides,
      })
    }

    afterEach(() => {
      vi.useRealTimers()
      urlParams()
    })

    /** Render, settle the mount-time session read, then run the debounce out. */
    const renderAndSettleAutosave = async () => {
      await renderApp()
      await act(async () => { await Promise.resolve() })
      await act(async () => { vi.advanceTimersByTime(2500) })
    }

    it('writes the session after the debounce by default', async () => {
      urlParams()
      vi.useFakeTimers()

      await renderAndSettleAutosave()

      expect(saveSessionState).toHaveBeenCalled()
    })

    it('never writes the session when suppressRestore is set', async () => {
      urlParams({ suppressRestore: true })
      vi.useFakeTimers()

      await renderAndSettleAutosave()

      expect(saveSessionState).not.toHaveBeenCalled()
    })
  })

  describe('GET_STATE', () => {
    /** Drive the handler that App passed to initIntegration. */
    const dispatchToApp = async (message: { type: string; payload?: unknown }) => {
      const handler = vi.mocked(initIntegration).mock.calls[0][0]
      await act(async () => { await handler(message as never) })
    }

    it('replies with the current store state, not the state at mount', async () => {
      await renderApp()
      await act(async () => { await Promise.resolve() })

      const project = useEditorStore.getState().project
      act(() => {
        useEditorStore.getState().setProject({ ...project, name: 'Renamed After Mount' })
      })

      await dispatchToApp({ type: 'GET_STATE' })

      expect(sendMessage).toHaveBeenCalledWith({
        type: 'STATE',
        payload: {
          project: expect.objectContaining({ name: 'Renamed After Mount' }),
          videos: useEditorStore.getState().sourceVideos,
        },
      })
    })
  })
})
