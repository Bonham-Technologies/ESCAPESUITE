import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { PreviewPlayer, PlaybackControls } from './PreviewPlayer'
import { useEditorStore } from '../../store/projectStore'
import type { SourceVideo } from '../../store/types'

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
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverMock }).ResizeObserver = ResizeObserverMock

// Mock storage
vi.mock('../../core/storage', () => ({
  getVideoBlob: vi.fn(() => Promise.resolve(new Blob(['test'], { type: 'video/mp4' }))),
}))

describe('PreviewPlayer', () => {
  beforeEach(() => {
    useEditorStore.getState().resetProject()
    useEditorStore.setState({ history: { past: [], future: [] } })
    vi.clearAllMocks()
    cleanup()
  })

  afterEach(() => {
    cleanup()
  })

  describe('empty state', () => {
    it('shows placeholder when no clips', () => {
      render(<PreviewPlayer />)

      expect(screen.getByText('Add clips to the timeline to preview')).toBeInTheDocument()
    })

    it('displays timecode', () => {
      render(<PreviewPlayer />)

      // Should show 00:00.000 initially
      expect(screen.getByText(/00:00/)).toBeInTheDocument()
    })
  })

  describe('with clips', () => {
    const mockVideo: SourceVideo = {
      id: 'video1',
      name: 'test.mp4',
      duration: 10,
      width: 1920,
      height: 1080,
      frameRate: 30,
      mimeType: 'video/mp4',
      size: 1000000,
    }

    beforeEach(() => {
      useEditorStore.getState().addSourceVideo(mockVideo)
      const trackId = useEditorStore.getState().project.timeline.tracks[0].id
      useEditorStore.getState().addClipToTimeline({
        id: 'clip1',
        name: 'Test Clip',
        sourceVideoId: 'video1',
        startTime: 0,
        endTime: 10,
        duration: 10,
        animation: undefined,
      }, trackId, 0)
    })

    it('shows clip info when at clip position', () => {
      useEditorStore.getState().setCurrentTime(5)

      render(<PreviewPlayer />)

      // Should show loading or clip info
      expect(screen.queryByText('Add clips to the timeline to preview')).not.toBeInTheDocument()
    })
  })
})

describe('PlaybackControls', () => {
  beforeEach(() => {
    useEditorStore.getState().resetProject()
    useEditorStore.setState({ history: { past: [], future: [] } })
    cleanup()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders all control buttons', () => {
    render(<PlaybackControls />)

    expect(screen.getByTitle('Go to start (Home)')).toBeInTheDocument()
    expect(screen.getByTitle('Step backward (←)')).toBeInTheDocument()
    expect(screen.getByTitle('Play (Space)')).toBeInTheDocument()
    expect(screen.getByTitle('Step forward (→)')).toBeInTheDocument()
    expect(screen.getByTitle('Go to end (End)')).toBeInTheDocument()
  })

  it('disables play button when no clips', () => {
    render(<PlaybackControls />)

    const playButton = screen.getByTitle('Play (Space)')
    expect(playButton).toBeDisabled()
  })

  it('enables play button when clips exist', () => {
    const video: SourceVideo = {
      id: 'video1',
      name: 'test.mp4',
      duration: 10,
      width: 1920,
      height: 1080,
      frameRate: 30,
      mimeType: 'video/mp4',
      size: 1000000,
    }
    useEditorStore.getState().addSourceVideo(video)

    const trackId = useEditorStore.getState().project.timeline.tracks[0].id
    useEditorStore.getState().addClipToTimeline({
      id: 'clip1',
      name: 'Test',
      sourceVideoId: 'video1',
      startTime: 0,
      endTime: 10,
      duration: 10,
      animation: undefined,
    }, trackId, 0)

    render(<PlaybackControls />)

    const playButton = screen.getByTitle('Play (Space)')
    expect(playButton).not.toBeDisabled()
  })

  it('goes to start when button clicked', () => {
    useEditorStore.getState().setCurrentTime(5)

    render(<PlaybackControls />)

    const startButton = screen.getByTitle('Go to start (Home)')
    fireEvent.click(startButton)

    expect(useEditorStore.getState().currentTime).toBe(0)
  })

  it('steps backward when button clicked', () => {
    useEditorStore.getState().setCurrentTime(5)

    render(<PlaybackControls />)

    const backButton = screen.getByTitle('Step backward (←)')
    fireEvent.click(backButton)

    expect(useEditorStore.getState().currentTime).toBe(4)
  })

  it('steps forward when button clicked', () => {
    const video: SourceVideo = {
      id: 'video1',
      name: 'test.mp4',
      duration: 10,
      width: 1920,
      height: 1080,
      frameRate: 30,
      mimeType: 'video/mp4',
      size: 1000000,
    }
    useEditorStore.getState().addSourceVideo(video)

    const trackId = useEditorStore.getState().project.timeline.tracks[0].id
    useEditorStore.getState().addClipToTimeline({
      id: 'clip1',
      name: 'Test',
      sourceVideoId: 'video1',
      startTime: 0,
      endTime: 10,
      duration: 10,
      animation: undefined,
    }, trackId, 0)

    useEditorStore.getState().setCurrentTime(5)

    render(<PlaybackControls />)

    const forwardButton = screen.getByTitle('Step forward (→)')
    fireEvent.click(forwardButton)

    expect(useEditorStore.getState().currentTime).toBe(6)
  })

  it('goes to end when button clicked', () => {
    const video: SourceVideo = {
      id: 'video1',
      name: 'test.mp4',
      duration: 10,
      width: 1920,
      height: 1080,
      frameRate: 30,
      mimeType: 'video/mp4',
      size: 1000000,
    }
    useEditorStore.getState().addSourceVideo(video)

    const trackId = useEditorStore.getState().project.timeline.tracks[0].id
    useEditorStore.getState().addClipToTimeline({
      id: 'clip1',
      name: 'Test',
      sourceVideoId: 'video1',
      startTime: 0,
      endTime: 10,
      duration: 10,
      animation: undefined,
    }, trackId, 0)

    render(<PlaybackControls />)

    const endButton = screen.getByTitle('Go to end (End)')
    fireEvent.click(endButton)

    expect(useEditorStore.getState().currentTime).toBe(10)
  })

  it('toggles play state when play button clicked', () => {
    const video: SourceVideo = {
      id: 'video1',
      name: 'test.mp4',
      duration: 10,
      width: 1920,
      height: 1080,
      frameRate: 30,
      mimeType: 'video/mp4',
      size: 1000000,
    }
    useEditorStore.getState().addSourceVideo(video)

    const trackId = useEditorStore.getState().project.timeline.tracks[0].id
    useEditorStore.getState().addClipToTimeline({
      id: 'clip1',
      name: 'Test',
      sourceVideoId: 'video1',
      startTime: 0,
      endTime: 10,
      duration: 10,
      animation: undefined,
    }, trackId, 0)

    render(<PlaybackControls />)

    const playButton = screen.getByTitle('Play (Space)')
    fireEvent.click(playButton)

    expect(useEditorStore.getState().isPlaying).toBe(true)
  })

  it('shows pause button when playing', () => {
    const video: SourceVideo = {
      id: 'video1',
      name: 'test.mp4',
      duration: 10,
      width: 1920,
      height: 1080,
      frameRate: 30,
      mimeType: 'video/mp4',
      size: 1000000,
    }
    useEditorStore.getState().addSourceVideo(video)

    const trackId = useEditorStore.getState().project.timeline.tracks[0].id
    useEditorStore.getState().addClipToTimeline({
      id: 'clip1',
      name: 'Test',
      sourceVideoId: 'video1',
      startTime: 0,
      endTime: 10,
      duration: 10,
      animation: undefined,
    }, trackId, 0)

    useEditorStore.getState().setIsPlaying(true)

    render(<PlaybackControls />)

    expect(screen.getByTitle('Pause (Space)')).toBeInTheDocument()
  })

  it('clamps step backward to 0', () => {
    useEditorStore.getState().setCurrentTime(0.5)

    render(<PlaybackControls />)

    const backButton = screen.getByTitle('Step backward (←)')
    fireEvent.click(backButton)

    expect(useEditorStore.getState().currentTime).toBe(0)
  })

  it('clamps step forward to duration', () => {
    const video: SourceVideo = {
      id: 'video1',
      name: 'test.mp4',
      duration: 10,
      width: 1920,
      height: 1080,
      frameRate: 30,
      mimeType: 'video/mp4',
      size: 1000000,
    }
    useEditorStore.getState().addSourceVideo(video)

    const trackId = useEditorStore.getState().project.timeline.tracks[0].id
    useEditorStore.getState().addClipToTimeline({
      id: 'clip1',
      name: 'Test',
      sourceVideoId: 'video1',
      startTime: 0,
      endTime: 10,
      duration: 10,
      animation: undefined,
    }, trackId, 0)

    useEditorStore.getState().setCurrentTime(9.5)

    render(<PlaybackControls />)

    const forwardButton = screen.getByTitle('Step forward (→)')
    fireEvent.click(forwardButton)

    expect(useEditorStore.getState().currentTime).toBe(10)
  })
})

describe('PlaybackControls keyboard shortcuts', () => {
  beforeEach(() => {
    useEditorStore.getState().resetProject()
    useEditorStore.setState({ history: { past: [], future: [] } })

    const video: SourceVideo = {
      id: 'video1',
      name: 'test.mp4',
      duration: 10,
      width: 1920,
      height: 1080,
      frameRate: 30,
      mimeType: 'video/mp4',
      size: 1000000,
    }
    useEditorStore.getState().addSourceVideo(video)

    const trackId = useEditorStore.getState().project.timeline.tracks[0].id
    useEditorStore.getState().addClipToTimeline({
      id: 'clip1',
      name: 'Test',
      sourceVideoId: 'video1',
      startTime: 0,
      endTime: 10,
      duration: 10,
      animation: undefined,
    }, trackId, 0)

    cleanup()
  })

  afterEach(() => {
    cleanup()
  })

  it('handles Space key for play/pause', () => {
    render(<PlaybackControls />)

    fireEvent.keyDown(window, { code: 'Space' })

    expect(useEditorStore.getState().isPlaying).toBe(true)
  })

  it('handles ArrowLeft for step backward', () => {
    useEditorStore.getState().setCurrentTime(5)

    render(<PlaybackControls />)

    fireEvent.keyDown(window, { code: 'ArrowLeft' })

    expect(useEditorStore.getState().currentTime).toBe(4)
  })

  it('handles ArrowRight for step forward', () => {
    useEditorStore.getState().setCurrentTime(5)

    render(<PlaybackControls />)

    fireEvent.keyDown(window, { code: 'ArrowRight' })

    expect(useEditorStore.getState().currentTime).toBe(6)
  })

  it('handles Home key for go to start', () => {
    useEditorStore.getState().setCurrentTime(5)

    render(<PlaybackControls />)

    fireEvent.keyDown(window, { code: 'Home' })

    expect(useEditorStore.getState().currentTime).toBe(0)
  })

  it('handles End key for go to end', () => {
    render(<PlaybackControls />)

    fireEvent.keyDown(window, { code: 'End' })

    expect(useEditorStore.getState().currentTime).toBe(10)
  })
})
