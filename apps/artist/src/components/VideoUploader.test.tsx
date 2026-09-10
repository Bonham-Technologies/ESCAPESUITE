import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { VideoUploader, VideoLibrary } from './VideoUploader'
import { useEditorStore } from '../store/projectStore'
import { resetStoreForTest, store, addClip } from '../test/fixtures/projectStore'
import { getFrameCache, resetFrameCache } from '../core/frameCache'
import { storeVideo, getAllVideoMetadata } from '../core/storage'
import { DEFAULT_IMAGE_DURATION } from '../store/types'
import type { Project, SourceVideo } from '../store/types'
import styles from './VideoUploader.module.css'

// The metadata extractors need real media decoding, so they stay collaborators;
// storage runs for real against fake-indexeddb.
const { mockProcessVideoFile, mockProcessImageFile, mockProcessAudioFile } = vi.hoisted(() => ({
  mockProcessVideoFile: vi.fn(),
  mockProcessImageFile: vi.fn(),
  mockProcessAudioFile: vi.fn(),
}))

vi.mock('../core/videoProcessor', () => ({
  processVideoFile: mockProcessVideoFile,
  processImageFile: mockProcessImageFile,
  processAudioFile: mockProcessAudioFile,
}))

const { mockSaveProject, mockLoadProject } = vi.hoisted(() => ({
  mockSaveProject: vi.fn(),
  mockLoadProject: vi.fn(),
}))

vi.mock('../core/projectManager', () => ({
  saveProject: mockSaveProject,
  loadProject: mockLoadProject,
}))

const MB = 1024 * 1024

const videoMeta: SourceVideo = {
  id: 'video1',
  name: 'test.mp4',
  duration: 10,
  width: 1920,
  height: 1080,
  frameRate: 30,
  mimeType: 'video/mp4',
  size: 1000000,
}

const imageMeta: SourceVideo = {
  ...videoMeta,
  id: 'image1',
  name: 'test.png',
  // Deliberately not DEFAULT_IMAGE_DURATION, so a clip that took the still
  // default is distinguishable from one that copied the source duration.
  duration: 7,
  width: 800,
  height: 600,
  mimeType: 'image/png',
  mediaType: 'image',
}

const audioMeta: SourceVideo = {
  ...videoMeta,
  id: 'audio1',
  name: 'test.mp3',
  duration: 120,
  width: 0,
  height: 0,
  mimeType: 'audio/mp3',
  mediaType: 'audio',
}

/** jsdom has no navigator.storage; script the quota the browser would report. */
function scriptStorage(used: number, quota: number): void {
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { estimate: () => Promise.resolve({ usage: used, quota }) },
  })
}

function fakeBitmap(width = 100, height = 100) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap
}

const file = (name: string, type: string, content = 'x') => new File([content], name, { type })

const dropZone = () => screen.getByText('Drop media or click to browse').parentElement!
const fileInput = () => screen.getByLabelText('Add media files') as HTMLInputElement

function selectFiles(files: File[]) {
  const input = fileInput()
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  fireEvent.change(input)
}

describe('VideoUploader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStoreForTest()
    store().removeSourceVideo('video1')
    resetFrameCache()
    scriptStorage(50 * MB, 500 * MB)
    mockProcessVideoFile.mockResolvedValue(videoMeta)
    mockProcessImageFile.mockResolvedValue(imageMeta)
    mockProcessAudioFile.mockResolvedValue(audioMeta)
    mockSaveProject.mockResolvedValue(undefined)
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('alert', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    Reflect.deleteProperty(navigator, 'storage')
  })

  describe('the drop zone', () => {
    it('invites the user to drop or browse', () => {
      render(<VideoUploader />)

      expect(screen.getByText('Drop media or click to browse')).toBeInTheDocument()
      const input = fileInput()
      expect(input.accept).toBe('video/*,image/*,audio/*,.veditor')
      expect(input.multiple).toBe(true)
    })

    it('highlights itself while a file is dragged over it', () => {
      render(<VideoUploader />)

      fireEvent.dragOver(dropZone())
      expect(dropZone()).toHaveClass(styles.dragOver)

      fireEvent.dragLeave(dropZone())
      expect(dropZone()).not.toHaveClass(styles.dragOver)
    })

    it('opens the file picker when clicked', () => {
      render(<VideoUploader />)
      const click = vi.spyOn(fileInput(), 'click').mockImplementation(() => {})

      fireEvent.click(dropZone())

      expect(click).toHaveBeenCalledTimes(1)
    })
  })

  describe('storage information', () => {
    it('reports what is used against the quota', async () => {
      render(<VideoUploader />)

      expect(await screen.findByText('50.0 MB / 500.0 MB')).toBeInTheDocument()
      const fill = document.querySelector<HTMLElement>(`.${styles.storageProgressFill}`)!
      expect(fill.style.width).toBe('10%')
      expect(document.querySelector(`.${styles.storageBar}`)).not.toHaveClass(styles.storageWarning)
    })

    it('warns when less than 100MB is left', async () => {
      scriptStorage(60 * MB, 100 * MB)
      render(<VideoUploader />)

      await waitFor(() =>
        expect(document.querySelector(`.${styles.storageBar}`)).toHaveClass(styles.storageWarning)
      )
    })

    it('logs, and shows no bar, when the browser refuses to estimate', async () => {
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: { estimate: () => Promise.reject(new Error('denied')) },
      })
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        render(<VideoUploader />)

        await waitFor(() =>
          expect(errorLog).toHaveBeenCalledWith(
            'Failed to get storage estimate:',
            expect.any(Error)
          )
        )
        expect(document.querySelector(`.${styles.storageBar}`)).toBeNull()
      } finally {
        errorLog.mockRestore()
      }
    })
  })

  describe('importing media', () => {
    it('imports a dropped video into the media library', async () => {
      render(<VideoUploader />)
      const dropped = file('test.mp4', 'video/mp4')

      fireEvent.drop(dropZone(), { dataTransfer: { files: [dropped] } })

      expect(await screen.findByText('Complete')).toBeInTheDocument()
      expect(mockProcessVideoFile).toHaveBeenCalledWith(dropped)
      expect(store().sourceVideos).toEqual([videoMeta])
    })

    it('routes an image to the image processor', async () => {
      render(<VideoUploader />)

      selectFiles([file('test.png', 'image/png')])

      await waitFor(() => expect(mockProcessImageFile).toHaveBeenCalledTimes(1))
      expect(mockProcessVideoFile).not.toHaveBeenCalled()
      expect(store().sourceVideos).toEqual([imageMeta])
    })

    it('routes audio to the audio processor', async () => {
      render(<VideoUploader />)

      selectFiles([file('test.mp3', 'audio/mp3')])

      await waitFor(() => expect(mockProcessAudioFile).toHaveBeenCalledTimes(1))
      expect(store().sourceVideos).toEqual([audioMeta])
    })

    it('clears the file input so the same file can be picked again', async () => {
      render(<VideoUploader />)
      const input = fileInput()
      // jsdom never reports a non-empty value for a file input, so record what
      // the component writes rather than reading the value back.
      const valueWrites: string[] = []
      Object.defineProperty(input, 'value', {
        configurable: true,
        get: () => 'C:\\fakepath\\test.mp4',
        set: (next: string) => valueWrites.push(next),
      })
      Object.defineProperty(input, 'files', { value: [file('test.mp4', 'video/mp4')], configurable: true })

      fireEvent.change(input)

      await waitFor(() => expect(mockProcessVideoFile).toHaveBeenCalled())
      expect(valueWrites).toEqual([''])
    })

    it('drops the finished upload from the list after a moment', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
      render(<VideoUploader />)

      fireEvent.drop(dropZone(), { dataTransfer: { files: [file('test.mp4', 'video/mp4')] } })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(screen.getByText('Complete')).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(2000)
      })

      expect(screen.queryByText('Complete')).not.toBeInTheDocument()
    })

    it('rejects files that are not media at all', async () => {
      render(<VideoUploader />)

      selectFiles([file('notes.txt', 'text/plain')])

      await waitFor(() =>
        expect(globalThis.alert).toHaveBeenCalledWith('Please select video, image, or audio files')
      )
      expect(mockProcessVideoFile).not.toHaveBeenCalled()
    })

    it('refuses a file that would not fit in the remaining quota', async () => {
      scriptStorage(10 * MB, 15 * MB)
      render(<VideoUploader />)

      selectFiles([file('big.mp4', 'video/mp4', 'x'.repeat(2048))])

      expect(
        await screen.findByText(
          'Not enough storage space. Need 2.0 KB, only 5.0 MB available. Remove some media to free up space.'
        )
      ).toBeInTheDocument()
      expect(mockProcessVideoFile).not.toHaveBeenCalled()
    })

    it('reports a processing failure against the file and lets it be dismissed', async () => {
      mockProcessVideoFile.mockRejectedValue(new Error('Unsupported codec'))
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        render(<VideoUploader />)

        selectFiles([file('test.mp4', 'video/mp4')])

        expect(await screen.findByText('Unsupported codec')).toBeInTheDocument()
        expect(errorLog).toHaveBeenCalledWith('Failed to process media:', expect.any(Error))

        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

        expect(screen.queryByText('Unsupported codec')).not.toBeInTheDocument()
      } finally {
        errorLog.mockRestore()
      }
    })

    it('translates a quota failure into advice about freeing space', async () => {
      mockProcessVideoFile.mockRejectedValue(new Error('QuotaExceededError: no room'))
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        render(<VideoUploader />)

        selectFiles([file('test.mp4', 'video/mp4')])

        expect(
          await screen.findByText('Storage quota exceeded. Remove some media to free up space.')
        ).toBeInTheDocument()
      } finally {
        errorLog.mockRestore()
      }
    })

    it('describes a thrown non-Error as an unknown failure', async () => {
      mockProcessVideoFile.mockRejectedValue('kaboom')
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        render(<VideoUploader />)

        selectFiles([file('test.mp4', 'video/mp4')])

        expect(await screen.findByText('Unknown error')).toBeInTheDocument()
      } finally {
        errorLog.mockRestore()
      }
    })
  })

  describe('loading a project file', () => {
    const loadedProject = (): Project => ({
      ...store().project,
      id: 'loaded',
      name: 'Loaded Project',
    })

    beforeEach(() => {
      mockLoadProject.mockImplementation(() =>
        Promise.resolve({ project: loadedProject(), sourceVideos: [videoMeta] })
      )
    })

    it('loads straight away when the timeline is empty', async () => {
      render(<VideoUploader />)
      const projectFile = file('my.veditor', '')

      selectFiles([projectFile])

      await waitFor(() => expect(store().project.name).toBe('Loaded Project'))
      expect(mockLoadProject).toHaveBeenCalledWith(projectFile)
      expect(store().sourceVideos).toEqual([videoMeta])
      expect(screen.queryByTestId('project-load-dialog')).not.toBeInTheDocument()
    })

    it('asks first when the timeline already holds clips', async () => {
      addClip('clip1', 0, 2)
      render(<VideoUploader />)

      selectFiles([file('my.veditor', '')])

      expect(await screen.findByTestId('project-load-dialog')).toBeInTheDocument()
      expect(mockLoadProject).not.toHaveBeenCalled()
    })

    it('leaves the current project alone when the prompt is cancelled', async () => {
      addClip('clip1', 0, 2)
      render(<VideoUploader />)
      selectFiles([file('my.veditor', '')])
      await screen.findByTestId('project-load-dialog')

      fireEvent.click(screen.getByTestId('project-load-cancel'))

      expect(screen.queryByTestId('project-load-dialog')).not.toBeInTheDocument()
      expect(mockLoadProject).not.toHaveBeenCalled()
      expect(store().project.timeline.clips).toHaveLength(1)
    })

    it('saves the current project before loading when asked to', async () => {
      addClip('clip1', 0, 2)
      const currentProject = store().project
      const currentSources = store().sourceVideos
      render(<VideoUploader />)
      selectFiles([file('my.veditor', '')])
      await screen.findByTestId('project-load-dialog')

      fireEvent.click(screen.getByTestId('project-load-save'))

      await waitFor(() => expect(mockLoadProject).toHaveBeenCalledTimes(1))
      expect(mockSaveProject).toHaveBeenCalledWith(currentProject, currentSources)
      expect(store().project.name).toBe('Loaded Project')
    })

    it('still loads when saving the current project fails', async () => {
      addClip('clip1', 0, 2)
      mockSaveProject.mockRejectedValue(new Error('disk full'))
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        render(<VideoUploader />)
        selectFiles([file('my.veditor', '')])
        await screen.findByTestId('project-load-dialog')

        fireEvent.click(screen.getByTestId('project-load-save'))

        await waitFor(() => expect(store().project.name).toBe('Loaded Project'))
        expect(errorLog).toHaveBeenCalledWith(
          'Failed to save current project:',
          expect.any(Error)
        )
      } finally {
        errorLog.mockRestore()
      }
    })

    it('discards the current project when asked to', async () => {
      addClip('clip1', 0, 2)
      render(<VideoUploader />)
      selectFiles([file('my.veditor', '')])
      await screen.findByTestId('project-load-dialog')

      fireEvent.click(screen.getByTestId('project-load-discard'))

      await waitFor(() => expect(store().project.name).toBe('Loaded Project'))
      expect(mockSaveProject).not.toHaveBeenCalled()
    })

    it('tells the user when the project file cannot be read', async () => {
      mockLoadProject.mockRejectedValue(new Error('corrupt'))
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        render(<VideoUploader />)

        selectFiles([file('my.veditor', '')])

        await waitFor(() =>
          expect(globalThis.alert).toHaveBeenCalledWith('Failed to load project file.')
        )
        expect(errorLog).toHaveBeenCalledWith('Failed to load project file:', expect.any(Error))
      } finally {
        errorLog.mockRestore()
      }
    })

    it('ignores the media alongside a project file', async () => {
      render(<VideoUploader />)

      selectFiles([file('my.veditor', ''), file('test.mp4', 'video/mp4')])

      await waitFor(() => expect(mockLoadProject).toHaveBeenCalledTimes(1))
      expect(mockProcessVideoFile).not.toHaveBeenCalled()
    })
  })

  describe('freeing space', () => {
    it('clears every stored video once confirmed', async () => {
      await storeVideo('video1', new Blob(['bytes']), videoMeta)
      store().addSourceVideo(videoMeta)
      const bitmap = fakeBitmap()
      getFrameCache().set(0, bitmap)
      render(<VideoUploader />)

      fireEvent.click(await screen.findByRole('button', { name: 'Clear All' }))

      await waitFor(() => expect(store().sourceVideos).toHaveLength(0))
      expect(globalThis.confirm).toHaveBeenCalledWith('Clear ALL stored media? This cannot be undone.')
      expect(await getAllVideoMetadata()).toHaveLength(0)
      expect(getFrameCache().getStats().frameCount).toBe(0)
      expect(bitmap.close).toHaveBeenCalled()
    })

    it('keeps everything when the confirmation is declined', async () => {
      vi.mocked(globalThis.confirm).mockReturnValue(false)
      await storeVideo('kept', new Blob(['bytes']), { ...videoMeta, id: 'kept' })
      store().addSourceVideo(videoMeta)
      render(<VideoUploader />)

      fireEvent.click(await screen.findByRole('button', { name: 'Clear All' }))

      await waitFor(() => expect(globalThis.confirm).toHaveBeenCalledTimes(1))
      expect(store().sourceVideos).toHaveLength(1)
      expect((await getAllVideoMetadata()).map((v) => v.id)).toContain('kept')
    })

    it('hides the clear-all button when almost nothing is stored', async () => {
      scriptStorage(1024, 500 * MB)
      render(<VideoUploader />)

      await screen.findByText('1.0 KB / 500.0 MB')
      expect(screen.queryByRole('button', { name: 'Clear All' })).not.toBeInTheDocument()
    })

    it('offers to clear the frame cache only while frames are held', async () => {
      render(<VideoUploader />)
      await screen.findByText('50.0 MB / 500.0 MB')
      expect(screen.queryByRole('button', { name: /Clear Cache/ })).not.toBeInTheDocument()
    })

    it('clears the frame cache', async () => {
      const bitmap = fakeBitmap()
      getFrameCache().set(0, bitmap)
      render(<VideoUploader />)

      // 100x100 RGBA = 40000 bytes
      fireEvent.click(await screen.findByRole('button', { name: 'Clear Cache (39.1 KB)' }))

      expect(getFrameCache().getStats().frameCount).toBe(0)
      expect(bitmap.close).toHaveBeenCalled()
      expect(screen.queryByRole('button', { name: /Clear Cache/ })).not.toBeInTheDocument()
    })

    it('offers to clear only the media no clip uses', async () => {
      await storeVideo('unused', new Blob(['bytes']), { ...videoMeta, id: 'unused' })
      store().addSourceVideo(videoMeta)
      store().addSourceVideo({ ...videoMeta, id: 'unused', name: 'spare.mp4', size: 2048 })
      addClip('clip1', 0, 2) // references video1
      render(<VideoUploader />)

      fireEvent.click(await screen.findByRole('button', { name: 'Clear Unused (2.0 KB)' }))

      await waitFor(() => expect(store().sourceVideos.map((v) => v.id)).toEqual(['video1']))
      expect((await getAllVideoMetadata()).map((v) => v.id)).not.toContain('unused')
    })

    it('hides the clear-unused button when every source is in use', async () => {
      store().addSourceVideo(videoMeta)
      addClip('clip1', 0, 2)
      render(<VideoUploader />)

      await screen.findByText('50.0 MB / 500.0 MB')
      expect(screen.queryByRole('button', { name: /Clear Unused/ })).not.toBeInTheDocument()
    })
  })
})

describe('VideoLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStoreForTest()
    store().removeSourceVideo('video1')
    vi.stubGlobal('confirm', vi.fn(() => true))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows an empty state when nothing has been imported', () => {
    render(<VideoLibrary />)

    expect(screen.getByText('No media uploaded yet')).toBeInTheDocument()
  })

  it('counts one item and many items', () => {
    store().addSourceVideo(videoMeta)
    const { rerender } = render(<VideoLibrary />)
    expect(screen.getByText('1 item')).toBeInTheDocument()

    act(() => {
      store().addSourceVideo({ ...videoMeta, id: 'video2', name: 'second.mp4' })
    })
    rerender(<VideoLibrary />)

    expect(screen.getByText('2 items')).toBeInTheDocument()
  })

  it('describes a video by duration, dimensions and size', () => {
    store().addSourceVideo({ ...videoMeta, name: 'My Test Video.mp4', duration: 65 })

    render(<VideoLibrary />)

    expect(screen.getByText('My Test Video.mp4')).toBeInTheDocument()
    expect(screen.getByText('1:05 · 1920x1080 · 976.6 KB')).toBeInTheDocument()
  })

  it('describes an image without a duration', () => {
    store().addSourceVideo(imageMeta)

    render(<VideoLibrary />)

    expect(screen.getByText('Image · 800x600 · 976.6 KB')).toBeInTheDocument()
    expect(screen.getByText('IMG')).toBeInTheDocument()
  })

  it('describes audio without dimensions', () => {
    store().addSourceVideo(audioMeta)

    render(<VideoLibrary />)

    expect(screen.getByText('2:00 · 976.6 KB')).toBeInTheDocument()
    expect(screen.getByText('AUD')).toBeInTheDocument()
  })

  it('shows the thumbnail when one was generated', () => {
    store().addSourceVideo({ ...videoMeta, thumbnailUrl: 'blob:thumb' })

    render(<VideoLibrary />)

    const img = screen.getByAltText('test.mp4') as HTMLImageElement
    expect(img.src).toContain('blob:thumb')
  })

  it('adds a video to the timeline at its native scale', () => {
    store().addSourceVideo(videoMeta)
    render(<VideoLibrary />)

    fireEvent.click(screen.getByTitle('Add to timeline'))

    const clips = store().project.timeline.clips
    expect(clips).toHaveLength(1)
    expect(clips[0].sourceVideoId).toBe('video1')
    expect(clips[0].duration).toBe(10)
    expect(clips[0].transform.scaleX).toBe(1)
    expect(clips[0].transform.scaleY).toBe(1)
  })

  it('gives an image the default still duration rather than its own', () => {
    store().addSourceVideo(imageMeta)
    render(<VideoLibrary />)

    fireEvent.click(screen.getByTitle('Add to timeline'))

    const clip = store().project.timeline.clips[0]
    expect(clip.duration).toBe(DEFAULT_IMAGE_DURATION)
    expect(clip.duration).not.toBe(imageMeta.duration)
    expect(clip.endTime).toBe(DEFAULT_IMAGE_DURATION)
  })

  it('removes a video once confirmed', async () => {
    await storeVideo('video1', new Blob(['bytes']), videoMeta)
    store().addSourceVideo(videoMeta)
    render(<VideoLibrary />)

    fireEvent.click(screen.getByTitle('Remove media'))

    await waitFor(() => expect(store().sourceVideos).toHaveLength(0))
    expect((await getAllVideoMetadata()).map((v) => v.id)).not.toContain('video1')
  })

  it('keeps the video when the confirmation is declined', async () => {
    vi.mocked(globalThis.confirm).mockReturnValue(false)
    await storeVideo('video1', new Blob(['bytes']), videoMeta)
    store().addSourceVideo(videoMeta)
    render(<VideoLibrary />)

    fireEvent.click(screen.getByTitle('Remove media'))

    await waitFor(() => expect(globalThis.confirm).toHaveBeenCalledTimes(1))
    expect(useEditorStore.getState().sourceVideos).toHaveLength(1)
    expect((await getAllVideoMetadata()).map((v) => v.id)).toContain('video1')
  })
})
