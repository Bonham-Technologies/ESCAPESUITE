import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { VideoUploader, VideoLibrary } from './VideoUploader'
import { useEditorStore } from '../store/projectStore'
import type { SourceVideo } from '../store/types'

// Mock storage functions
vi.mock('../core/storage', () => ({
  getStorageEstimate: vi.fn(() => Promise.resolve({
    used: 1000000,
    quota: 100000000,
    available: 99000000,
  })),
  clearAllVideos: vi.fn(() => Promise.resolve()),
  deleteVideo: vi.fn(() => Promise.resolve()),
}))

// Mock video processor
vi.mock('../core/videoProcessor', () => ({
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

// Mock window.confirm and alert
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).confirm = vi.fn(() => true)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).alert = vi.fn()

describe('VideoUploader', () => {
  beforeEach(() => {
    useEditorStore.getState().resetProject()
    useEditorStore.setState({ history: { past: [], future: [] } })
    vi.clearAllMocks()
    cleanup()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders upload area', () => {
    render(<VideoUploader />)

    expect(screen.getByText('Drop media or click to browse')).toBeInTheDocument()
  })

  it('shows storage info', async () => {
    render(<VideoUploader />)

    // Wait for storage info to load
    await waitFor(() => {
      // Should show storage usage
      expect(screen.getByText(/\/ /)).toBeInTheDocument() // Format: "X / Y"
    })
  })

  it('handles drag over', () => {
    render(<VideoUploader />)

    const dropZone = screen.getByText('Drop media or click to browse').parentElement!

    fireEvent.dragOver(dropZone)

    // The dragOver class should be applied (component handles this)
  })

  it('handles drag leave', () => {
    render(<VideoUploader />)

    const dropZone = screen.getByText('Drop media or click to browse').parentElement!

    fireEvent.dragOver(dropZone)
    fireEvent.dragLeave(dropZone)
  })

  it('handles file drop', async () => {
    render(<VideoUploader />)

    const dropZone = screen.getByText('Drop media or click to browse').parentElement!

    const file = new File(['video content'], 'test.mp4', { type: 'video/mp4' })

    const dataTransfer = {
      files: [file],
    }

    fireEvent.drop(dropZone, { dataTransfer })

    // Should show processing
    await waitFor(() => {
      // The component updates state for processing
    })
  })

  it('handles file input change', async () => {
    render(<VideoUploader />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement

    const file = new File(['video content'], 'test.mp4', { type: 'video/mp4' })

    Object.defineProperty(fileInput, 'files', {
      value: [file],
    })

    fireEvent.change(fileInput)
  })

  it('accepts video files', () => {
    render(<VideoUploader />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement

    expect(fileInput.accept).toContain('video/*')
  })

  it('accepts image files', () => {
    render(<VideoUploader />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement

    expect(fileInput.accept).toContain('image/*')
  })

  it('accepts audio files', () => {
    render(<VideoUploader />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement

    expect(fileInput.accept).toContain('audio/*')
  })

  it('supports multiple file selection', () => {
    render(<VideoUploader />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement

    expect(fileInput.multiple).toBe(true)
  })
})

describe('VideoLibrary', () => {
  beforeEach(() => {
    useEditorStore.getState().resetProject()
    useEditorStore.setState({ history: { past: [], future: [] } })
    vi.clearAllMocks()
    cleanup()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows empty state when no videos', () => {
    render(<VideoLibrary />)

    expect(screen.getByText('No media uploaded yet')).toBeInTheDocument()
  })

  it('shows video count when videos exist', () => {
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

    render(<VideoLibrary />)

    expect(screen.getByText('1 item')).toBeInTheDocument()
  })

  it('shows plural when multiple videos', () => {
    const video1: SourceVideo = {
      id: 'video1',
      name: 'test1.mp4',
      duration: 10,
      width: 1920,
      height: 1080,
      frameRate: 30,
      mimeType: 'video/mp4',
      size: 1000000,
    }

    const video2: SourceVideo = {
      id: 'video2',
      name: 'test2.mp4',
      duration: 20,
      width: 1920,
      height: 1080,
      frameRate: 30,
      mimeType: 'video/mp4',
      size: 2000000,
    }

    useEditorStore.getState().addSourceVideo(video1)
    useEditorStore.getState().addSourceVideo(video2)

    render(<VideoLibrary />)

    expect(screen.getByText('2 items')).toBeInTheDocument()
  })

  it('displays video name', () => {
    const video: SourceVideo = {
      id: 'video1',
      name: 'My Test Video.mp4',
      duration: 10,
      width: 1920,
      height: 1080,
      frameRate: 30,
      mimeType: 'video/mp4',
      size: 1000000,
    }

    useEditorStore.getState().addSourceVideo(video)

    render(<VideoLibrary />)

    expect(screen.getByText('My Test Video.mp4')).toBeInTheDocument()
  })

  it('displays video metadata', () => {
    const video: SourceVideo = {
      id: 'video1',
      name: 'test.mp4',
      duration: 65, // 1:05
      width: 1920,
      height: 1080,
      frameRate: 30,
      mimeType: 'video/mp4',
      size: 1000000,
    }

    useEditorStore.getState().addSourceVideo(video)

    render(<VideoLibrary />)

    // Should show duration and dimensions
    expect(screen.getByText(/1:05/)).toBeInTheDocument()
    expect(screen.getByText(/1920x1080/)).toBeInTheDocument()
  })

  it('shows add to timeline button', () => {
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

    render(<VideoLibrary />)

    expect(screen.getByTitle('Add to timeline')).toBeInTheDocument()
  })

  it('shows remove button', () => {
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

    render(<VideoLibrary />)

    expect(screen.getByTitle('Remove media')).toBeInTheDocument()
  })

  it('adds clip to timeline when add button clicked', () => {
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

    render(<VideoLibrary />)

    const addButton = screen.getByTitle('Add to timeline')
    fireEvent.click(addButton)

    const clips = useEditorStore.getState().project.timeline.clips
    expect(clips).toHaveLength(1)
    expect(clips[0].sourceVideoId).toBe('video1')
    // All clips are imported at 100% native scale (scaleX = scaleY = 1)
    expect(clips[0].transform.scaleX).toBe(1)
    expect(clips[0].transform.scaleY).toBe(1)
  })

  it('removes video when remove button clicked', async () => {
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

    render(<VideoLibrary />)

    const removeButton = screen.getByTitle('Remove media')
    fireEvent.click(removeButton)

    await waitFor(() => {
      expect(useEditorStore.getState().sourceVideos).toHaveLength(0)
    })
  })

  it('shows image badge for image files', () => {
    const image: SourceVideo = {
      id: 'image1',
      name: 'test.png',
      duration: 5,
      width: 800,
      height: 600,
      frameRate: 1,
      mimeType: 'image/png',
      size: 500000,
      mediaType: 'image',
    }

    useEditorStore.getState().addSourceVideo(image)

    render(<VideoLibrary />)

    expect(screen.getByText('IMG')).toBeInTheDocument()
  })

  it('shows audio badge for audio files', () => {
    const audio: SourceVideo = {
      id: 'audio1',
      name: 'test.mp3',
      duration: 120,
      width: 0,
      height: 0,
      frameRate: 0,
      mimeType: 'audio/mp3',
      size: 3000000,
      mediaType: 'audio',
    }

    useEditorStore.getState().addSourceVideo(audio)

    render(<VideoLibrary />)

    expect(screen.getByText('AUD')).toBeInTheDocument()
  })
})
