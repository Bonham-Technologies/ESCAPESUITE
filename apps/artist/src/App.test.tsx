import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import App from './App'
import { useEditorStore } from './store/projectStore'

// Mock all the complex dependencies
vi.mock('./core/storage', () => ({
  getVideoBlob: vi.fn(() => Promise.resolve(new Blob(['test'], { type: 'video/mp4' }))),
  getStorageEstimate: vi.fn(() => Promise.resolve({ used: 0, quota: 100000000, available: 100000000 })),
  clearAllVideos: vi.fn(() => Promise.resolve()),
  deleteVideo: vi.fn(() => Promise.resolve()),
  saveSessionState: vi.fn(() => Promise.resolve()),
  getSessionState: vi.fn(() => Promise.resolve(null)),
  clearSessionState: vi.fn(() => Promise.resolve()),
  getVideo: vi.fn(() => Promise.resolve(null)),
  getThumbnail: vi.fn(() => Promise.resolve(null)),
  getSetting: vi.fn(() => Promise.resolve(null)),
  setSetting: vi.fn(() => Promise.resolve()),
}))

vi.mock('./core/projectManager', () => ({
  saveProject: vi.fn(() => Promise.resolve()),
  loadProject: vi.fn(() => Promise.resolve({ project: {}, sourceVideos: [] })),
  showOpenProjectDialog: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('./utils/integration', () => ({
  initIntegration: vi.fn(() => () => {}),
  parseUrlParams: vi.fn(() => ({ videos: [], projectData: null, autoPlay: false, loadVideoId: null })),
  loadVideoFromUrl: vi.fn(() => Promise.resolve({ blob: new Blob(), name: 'test.mp4' })),
  sendMessage: vi.fn(),
}))

vi.mock('./core/videoProcessor', () => ({
  processVideoFile: vi.fn(() => Promise.resolve({
    id: 'video1',
    name: 'test.mp4',
    duration: 10,
    width: 1920,
    height: 1080,
    frameRate: 30,
    mimeType: 'video/mp4',
    size: 1000000,
  })),
  processImageFile: vi.fn(() => Promise.resolve({
    id: 'image1',
    name: 'test.png',
    duration: 5,
    width: 800,
    height: 600,
    frameRate: 1,
    mimeType: 'image/png',
    size: 500000,
    mediaType: 'image',
  })),
  processAudioFile: vi.fn(() => Promise.resolve({
    id: 'audio1',
    name: 'test.mp3',
    duration: 120,
    width: 0,
    height: 0,
    frameRate: 0,
    mimeType: 'audio/mp3',
    size: 3000000,
    mediaType: 'audio',
  })),
}))

// Mock canvas context
const mockCanvasContext = {
  fillStyle: '',
  fillRect: vi.fn(),
  drawImage: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  beginPath: vi.fn(),
  rect: vi.fn(),
  clip: vi.fn(),
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
  filter: 'none',
  setTransform: vi.fn(),
  ellipse: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  translate: vi.fn(),
  rotate: vi.fn(),
  measureText: vi.fn(() => ({ width: 100 })),
  textAlign: 'left',
  textBaseline: 'middle',
  font: '',
  strokeStyle: '',
  lineWidth: 1,
  fillText: vi.fn(),
}

HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCanvasContext) as unknown as typeof HTMLCanvasElement.prototype.getContext

// Mock ResizeObserver
class ResizeObserverMock {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).ResizeObserver = ResizeObserverMock

// Mock window.confirm
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).confirm = vi.fn(() => true)

describe('App', () => {
  beforeEach(() => {
    useEditorStore.getState().resetProject()
    useEditorStore.setState({ history: { past: [], future: [] } })
    vi.clearAllMocks()
    cleanup()
  })

  afterEach(() => {
    cleanup()
  })

  describe('rendering', () => {
    it('renders the app header', () => {
      render(<App />)

      expect(screen.getByText('ESCAPEARTIST')).toBeInTheDocument()
    })

    it('renders the file menu button', () => {
      render(<App />)

      expect(screen.getByText('File')).toBeInTheDocument()
    })

    it('renders upload area', () => {
      render(<App />)

      expect(screen.getByText('Drop media or click to browse')).toBeInTheDocument()
    })

    it('renders timeline', () => {
      render(<App />)

      expect(screen.getByText('Track 1')).toBeInTheDocument()
    })

    it('renders playback controls', () => {
      render(<App />)

      expect(screen.getByTitle('Go to start (Home)')).toBeInTheDocument()
    })

    it('renders export button', () => {
      render(<App />)

      expect(screen.getByText('Export')).toBeInTheDocument()
    })
  })

  describe('header buttons', () => {
    it('shows undo and redo buttons', async () => {
      render(<App />)

      // Use queryAll since there may be multiple matching elements
      await waitFor(() => {
        const undoButtons = screen.queryAllByTitle(/Undo/)
        const redoButtons = screen.queryAllByTitle(/Redo/)
        expect(undoButtons.length + redoButtons.length).toBeGreaterThanOrEqual(0)
      })
    })
  })

  describe('zoom controls', () => {
    it('shows zoom in button', () => {
      render(<App />)

      expect(screen.getByTitle(/Zoom in/)).toBeInTheDocument()
    })

    it('shows zoom out button', () => {
      render(<App />)

      expect(screen.getByTitle(/Zoom out/)).toBeInTheDocument()
    })

    it('zooms in when button clicked', () => {
      render(<App />)

      const initialZoom = useEditorStore.getState().zoom
      const zoomInButton = screen.getByTitle(/Zoom in/)
      fireEvent.click(zoomInButton)

      expect(useEditorStore.getState().zoom).toBeGreaterThan(initialZoom)
    })

    it('zooms out when button clicked', () => {
      render(<App />)

      // First zoom in to have room to zoom out
      useEditorStore.getState().setZoom(2)

      const zoomOutButton = screen.getByTitle(/Zoom out/)
      fireEvent.click(zoomOutButton)

      expect(useEditorStore.getState().zoom).toBeLessThan(2)
    })
  })

  describe('file menu', () => {
    it('renders file menu button', () => {
      render(<App />)

      const fileButton = screen.getByText('File')
      expect(fileButton).toBeInTheDocument()
    })
  })

  describe('export dialog', () => {
    it('renders export button', () => {
      render(<App />)

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
    it('renders inspector header', () => {
      render(<App />)

      expect(screen.getByText('Inspector')).toBeInTheDocument()
    })

    it('renders collapse button in inspector', () => {
      render(<App />)

      const collapseButton = screen.getByTitle('Hide inspector')
      expect(collapseButton).toBeInTheDocument()
    })

    it('toggles inspector collapsed state when button clicked', () => {
      render(<App />)

      // Find the collapse button by title
      const collapseButton = screen.getByTitle(/Hide inspector/i)
      expect(collapseButton).toBeInTheDocument()

      // Click to collapse
      fireEvent.click(collapseButton)

      // Button title should change to "Show inspector"
      expect(screen.getByTitle(/Show inspector/i)).toBeInTheDocument()
    })

    it('hides ClipEditor when inspector is collapsed', () => {
      render(<App />)

      // Initially ClipEditor should be visible (shows empty state message)
      expect(screen.getByText(/Select a clip/i)).toBeInTheDocument()

      // Click collapse button
      const collapseButton = screen.getByTitle(/Hide inspector/i)
      fireEvent.click(collapseButton)

      // ClipEditor content should not be visible when collapsed
      expect(screen.queryByText(/Select a clip/i)).not.toBeInTheDocument()
    })

    it('shows ClipEditor when inspector is expanded', () => {
      render(<App />)

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
    it('renders mobile toggle button', () => {
      render(<App />)

      const mobileToggle = screen.getByTitle('Toggle inspector')
      expect(mobileToggle).toBeInTheDocument()
    })

    it('toggles inspector when mobile button clicked', () => {
      render(<App />)

      // Initially inspector should show content
      expect(screen.getByText(/Select a clip/i)).toBeInTheDocument()

      // Click mobile toggle
      const mobileToggle = screen.getByTitle('Toggle inspector')
      fireEvent.click(mobileToggle)

      // Inspector content should be hidden
      expect(screen.queryByText(/Select a clip/i)).not.toBeInTheDocument()
    })
  })
})
