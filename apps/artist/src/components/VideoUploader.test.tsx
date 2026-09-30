import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { VideoUploader, VideoLibrary } from './VideoUploader'
import { useEditorStore } from '../store/projectStore'
import { resetStoreForTest, store, addClip } from '../test/fixtures/projectStore'
import { storeVideo, getAllVideoMetadata } from '../core/storage'
import { DEFAULT_IMAGE_DURATION } from '../store/types'
import type { SourceVideo } from '../store/types'
import styles from './VideoUploader.module.css'
import { lastObjectUrl } from '../test/objectUrls'

// The metadata extractors need real media decoding, so they stay collaborators;
// storage runs for real against fake-indexeddb.
const { mockProcessVideoFile, mockProcessImageFile, mockProcessAudioFile, mockResolveThumbnailUrl } = vi.hoisted(() => ({
  mockProcessVideoFile: vi.fn(),
  mockProcessImageFile: vi.fn(),
  mockProcessAudioFile: vi.fn(),
  mockResolveThumbnailUrl: vi.fn<(id: string) => Promise<string | undefined>>(),
}))

vi.mock('../core/videoProcessor', () => ({
  processVideoFile: mockProcessVideoFile,
  processImageFile: mockProcessImageFile,
  processAudioFile: mockProcessAudioFile,
}))

// Only the thumbnail read is a collaborator: the library's lazy rebuild
// (ESCSUITE-117) has to be driveable one landing at a time, including one that
// lands after the source has gone. Everything else in storage stays real, on
// the fake-indexeddb this file already round-trips through — including
// `revokeSourceThumbnails`, which is what the store calls.
vi.mock('../core/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/storage')>()),
  resolveThumbnailUrl: mockResolveThumbnailUrl,
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

const file = (name: string, type: string, content = 'x') => new File([content], name, { type })

/**
 * What `App` passes down: `useProjectActions`' "given a project file" entry.
 *
 * The uploader recognises a `.veditor` and hands it up — it asks nothing and
 * loads nothing itself, so every case can render it with a spy here.
 */
let onProjectFile: Mock<(file: File) => void>

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
    scriptStorage(50 * MB, 500 * MB)
    mockProcessVideoFile.mockResolvedValue(videoMeta)
    mockProcessImageFile.mockResolvedValue(imageMeta)
    mockProcessAudioFile.mockResolvedValue(audioMeta)
    onProjectFile = vi.fn()
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('alert', vi.fn())
  })

  afterEach(() => {
    // Deliberately NOT vi.unstubAllGlobals(): that restores jsdom's own URL and
    // Blob over the stubs src/test/setup.ts installs, for the whole rest of the
    // file — so every describe after this one ran against jsdom's real
    // createObjectURL (which cannot read a Node Blob at all) instead of the
    // counting stub (ESCSUITE-117). `confirm` and `alert` are re-stubbed by the
    // beforeEach above, so nothing needs restoring here.
    vi.useRealTimers()
    Reflect.deleteProperty(navigator, 'storage')
  })

  describe('the drop zone', () => {
    /**
     * Mount the uploader and let the storage estimate it asks for on mount resolve. Without
     * this, the state update it makes lands after the test has finished — outside act(), and
     * unasserted.
     */
    async function renderUploader(): Promise<void> {
      render(<VideoUploader onProjectFile={onProjectFile} />)
      await act(async () => {
        await Promise.resolve()
      })
    }

    it('invites the user to drop or browse', async () => {
      await renderUploader()

      expect(screen.getByText('Drop media or click to browse')).toBeInTheDocument()
      const input = fileInput()
      expect(input.accept).toBe('video/*,image/*,audio/*,.veditor')
      expect(input.multiple).toBe(true)
    })

    it('highlights itself while a file is dragged over it', async () => {
      await renderUploader()

      fireEvent.dragOver(dropZone())
      expect(dropZone()).toHaveClass(styles.dragOver)

      fireEvent.dragLeave(dropZone())
      expect(dropZone()).not.toHaveClass(styles.dragOver)
    })

    it('opens the file picker when clicked', async () => {
      await renderUploader()
      const click = vi.spyOn(fileInput(), 'click').mockImplementation(() => {})

      fireEvent.click(dropZone())

      expect(click).toHaveBeenCalledTimes(1)
    })
  })

  describe('storage information', () => {
    it('reports what is used against the quota', async () => {
      render(<VideoUploader onProjectFile={onProjectFile} />)

      expect(await screen.findByText('50.0 MB / 500.0 MB')).toBeInTheDocument()
      const fill = document.querySelector<HTMLElement>(`.${styles.storageProgressFill}`)!
      expect(fill.style.width).toBe('10%')
      expect(document.querySelector(`.${styles.storageBar}`)).not.toHaveClass(styles.storageWarning)
    })

    it('warns when less than 100MB is left', async () => {
      scriptStorage(60 * MB, 100 * MB)
      render(<VideoUploader onProjectFile={onProjectFile} />)

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
        render(<VideoUploader onProjectFile={onProjectFile} />)

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
      render(<VideoUploader onProjectFile={onProjectFile} />)
      const dropped = file('test.mp4', 'video/mp4')

      fireEvent.drop(dropZone(), { dataTransfer: { files: [dropped] } })

      expect(await screen.findByText('Complete')).toBeInTheDocument()
      expect(mockProcessVideoFile).toHaveBeenCalledWith(dropped)
      expect(store().sourceVideos).toEqual([videoMeta])
    })

    it('routes an image to the image processor', async () => {
      render(<VideoUploader onProjectFile={onProjectFile} />)

      selectFiles([file('test.png', 'image/png')])

      await waitFor(() => expect(mockProcessImageFile).toHaveBeenCalledTimes(1))
      expect(mockProcessVideoFile).not.toHaveBeenCalled()
      expect(store().sourceVideos).toEqual([imageMeta])
    })

    it('routes audio to the audio processor', async () => {
      render(<VideoUploader onProjectFile={onProjectFile} />)

      selectFiles([file('test.mp3', 'audio/mp3')])

      await waitFor(() => expect(mockProcessAudioFile).toHaveBeenCalledTimes(1))
      expect(store().sourceVideos).toEqual([audioMeta])
    })

    it('clears the file input so the same file can be picked again', async () => {
      render(<VideoUploader onProjectFile={onProjectFile} />)
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
      render(<VideoUploader onProjectFile={onProjectFile} />)

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

    // ESCSUITE-120: the 2 s "remove from the list" timer used to outlive the
    // component. A test that finished inside two seconds left it armed, and
    // when the file's jsdom was torn down before it fired, react-dom threw
    // `window is not defined` from inside the callback — an unhandled error
    // that failed CI with every assertion green.
    it('arms no timer past its own unmount (ESCSUITE-120)', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
      const { unmount } = render(<VideoUploader onProjectFile={onProjectFile} />)

      fireEvent.drop(dropZone(), { dataTransfer: { files: [file('a.mp4', 'video/mp4'), file('b.mp4', 'video/mp4')] } })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(screen.getAllByText('Complete')).toHaveLength(2)
      expect(vi.getTimerCount()).toBe(2)

      unmount()

      expect(vi.getTimerCount()).toBe(0)
      // And nothing runs on the gone component either way.
      act(() => {
        vi.advanceTimersByTime(2000)
      })
    })

    it('rejects files that are not media at all', async () => {
      render(<VideoUploader onProjectFile={onProjectFile} />)

      selectFiles([file('notes.txt', 'text/plain')])

      await waitFor(() =>
        expect(globalThis.alert).toHaveBeenCalledWith('Please select video, image, or audio files')
      )
      expect(mockProcessVideoFile).not.toHaveBeenCalled()
    })

    it('refuses a file that would not fit in the remaining quota', async () => {
      scriptStorage(10 * MB, 15 * MB)
      render(<VideoUploader onProjectFile={onProjectFile} />)

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
        render(<VideoUploader onProjectFile={onProjectFile} />)

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
        render(<VideoUploader onProjectFile={onProjectFile} />)

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
        render(<VideoUploader onProjectFile={onProjectFile} />)

        selectFiles([file('test.mp4', 'video/mp4')])

        expect(await screen.findByText('Unknown error')).toBeInTheDocument()
      } finally {
        errorLog.mockRestore()
      }
    })
  })

  describe('handing a project file to its caller', () => {
    // The uploader used to own a *second* `ProjectLoadDialog`, its own
    // `pendingProjectFile` / `showProjectLoadDialog` state and its own copies of
    // the replace/merge handlers — a dialog `App`'s `modalOpen` knew nothing
    // about (ESCSUITE-63). The question, the dialog and the load all belong to
    // `useProjectActions` now; the seven cases that drove the uploader's own
    // dialog moved there and to App.project.test.tsx with them.
    it('hands a dropped project file up, and asks nothing itself', async () => {
      render(<VideoUploader onProjectFile={onProjectFile} />)
      const projectFile = file('my.veditor', '')

      fireEvent.drop(dropZone(), { dataTransfer: { files: [projectFile] } })

      await waitFor(() => expect(onProjectFile).toHaveBeenCalledWith(projectFile))
      expect(screen.queryByTestId('project-load-dialog')).not.toBeInTheDocument()
    })

    it('hands a picked project file up the same way', async () => {
      render(<VideoUploader onProjectFile={onProjectFile} />)
      const projectFile = file('my.veditor', '')

      selectFiles([projectFile])

      await waitFor(() => expect(onProjectFile).toHaveBeenCalledWith(projectFile))
    })

    it('hands it up whatever is on the timeline — the caller decides what to ask', async () => {
      addClip('clip1', 0, 2)
      render(<VideoUploader onProjectFile={onProjectFile} />)

      selectFiles([file('my.veditor', '')])

      await waitFor(() => expect(onProjectFile).toHaveBeenCalledTimes(1))
      expect(screen.queryByTestId('project-load-dialog')).not.toBeInTheDocument()
      expect(store().project.timeline.clips).toHaveLength(1)
    })

    it('ignores the media alongside a project file', async () => {
      render(<VideoUploader onProjectFile={onProjectFile} />)

      selectFiles([file('my.veditor', ''), file('test.mp4', 'video/mp4')])

      await waitFor(() => expect(onProjectFile).toHaveBeenCalledTimes(1))
      expect(mockProcessVideoFile).not.toHaveBeenCalled()
    })

    it('leaves a file that is not a project to the media path', async () => {
      render(<VideoUploader onProjectFile={onProjectFile} />)

      selectFiles([file('test.mp4', 'video/mp4')])

      await waitFor(() => expect(mockProcessVideoFile).toHaveBeenCalledTimes(1))
      expect(onProjectFile).not.toHaveBeenCalled()
    })
  })

  describe('freeing space', () => {
    it('clears every stored video once confirmed', async () => {
      await storeVideo('video1', new Blob(['bytes']), videoMeta)
      store().addSourceVideo(videoMeta)
      render(<VideoUploader onProjectFile={onProjectFile} />)

      fireEvent.click(await screen.findByRole('button', { name: 'Clear All' }))

      await waitFor(() => expect(store().sourceVideos).toHaveLength(0))
      expect(globalThis.confirm).toHaveBeenCalledWith('Clear ALL stored media? This cannot be undone.')
      expect(await getAllVideoMetadata()).toHaveLength(0)
    })

    // ESCSUITE-113: every source Clear All drops holds a live
    // URL.createObjectURL handle, and nothing else was ever going to free it.
    it('revokes every cleared source\'s thumbnail URL', async () => {
      // This file's own afterEach unstubs the globals setup.ts mocks
      // (including URL), so a spy of this test's own is what survives to
      // assert on — see that afterEach's comment.
      const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL')
      await storeVideo('video1', new Blob(['bytes']), videoMeta)
      store().addSourceVideo({ ...videoMeta, thumbnailUrl: 'blob:thumb-1' })
      render(<VideoUploader onProjectFile={onProjectFile} />)

      fireEvent.click(await screen.findByRole('button', { name: 'Clear All' }))

      await waitFor(() => expect(store().sourceVideos).toHaveLength(0))
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:thumb-1')
    })

    it('keeps everything when the confirmation is declined', async () => {
      vi.mocked(globalThis.confirm).mockReturnValue(false)
      await storeVideo('kept', new Blob(['bytes']), { ...videoMeta, id: 'kept' })
      store().addSourceVideo(videoMeta)
      render(<VideoUploader onProjectFile={onProjectFile} />)

      fireEvent.click(await screen.findByRole('button', { name: 'Clear All' }))

      await waitFor(() => expect(globalThis.confirm).toHaveBeenCalledTimes(1))
      expect(store().sourceVideos).toHaveLength(1)
      expect((await getAllVideoMetadata()).map((v) => v.id)).toContain('kept')
    })

    // ESCSUITE-142: the shared `video-editor-db` also holds ESCAPECRAFT's own
    // recordings — rows this editor never imported and has no row for. Clear
    // All must touch only what the library shows (`sourceVideos`), the same
    // way Clear Unused already does, not sweep the whole object store.
    it('leaves a recording ESCAPECRAFT owns untouched', async () => {
      await storeVideo('video1', new Blob(['bytes']), videoMeta)
      store().addSourceVideo(videoMeta)
      await storeVideo('craft-take', new Blob(['bytes']), {
        ...videoMeta, id: 'craft-take', name: 'take.webm', source: 'recording',
      })
      render(<VideoUploader onProjectFile={onProjectFile} />)

      fireEvent.click(await screen.findByRole('button', { name: 'Clear All' }))

      await waitFor(() => expect(store().sourceVideos).toHaveLength(0))
      expect((await getAllVideoMetadata()).map((v) => v.id)).toContain('craft-take')
    })

    // ESCSUITE-84: clear-all deletes the BLOBS before it touches the store, so
    // a store refusal afterwards would leave a locked clip pointing at bytes
    // that are gone. It is all-or-nothing here instead.
    it('refuses to clear everything while a clip on a locked track uses media', async () => {
      await storeVideo('video1', new Blob(['bytes']), videoMeta)
      store().addSourceVideo(videoMeta)
      const clip = addClip('clip1', 0, 4)
      store().updateTrack(clip.trackId, { locked: true })
      render(<VideoUploader onProjectFile={onProjectFile} />)

      const button = await screen.findByTitle('Media is used by a clip on a locked track')
      expect(button).toBeDisabled()

      // The handler refuses too, however the click reaches it.
      fireEvent.click(button)
      await act(async () => { await Promise.resolve() })

      expect(globalThis.confirm).not.toHaveBeenCalled()
      expect(store().sourceVideos).toHaveLength(1)
      expect((await getAllVideoMetadata()).map((v) => v.id)).toContain('video1')
    })

    it('hides the clear-all button when almost nothing is stored', async () => {
      scriptStorage(1024, 500 * MB)
      render(<VideoUploader onProjectFile={onProjectFile} />)

      await screen.findByText('1.0 KB / 500.0 MB')
      expect(screen.queryByRole('button', { name: 'Clear All' })).not.toBeInTheDocument()
    })

    it('offers to clear only the media no clip uses', async () => {
      await storeVideo('unused', new Blob(['bytes']), { ...videoMeta, id: 'unused' })
      store().addSourceVideo(videoMeta)
      store().addSourceVideo({ ...videoMeta, id: 'unused', name: 'spare.mp4', size: 2048 })
      addClip('clip1', 0, 2) // references video1
      render(<VideoUploader onProjectFile={onProjectFile} />)

      fireEvent.click(await screen.findByRole('button', { name: 'Clear Unused (2.0 KB)' }))

      await waitFor(() => expect(store().sourceVideos.map((v) => v.id)).toEqual(['video1']))
      expect((await getAllVideoMetadata()).map((v) => v.id)).not.toContain('unused')
    })

    it('revokes the thumbnail URL of the unused media it clears', async () => {
      const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL')
      await storeVideo('unused', new Blob(['bytes']), { ...videoMeta, id: 'unused' })
      store().addSourceVideo(videoMeta)
      store().addSourceVideo({
        ...videoMeta, id: 'unused', name: 'spare.mp4', size: 2048, thumbnailUrl: 'blob:unused-thumb',
      })
      addClip('clip1', 0, 2) // references video1
      render(<VideoUploader onProjectFile={onProjectFile} />)

      fireEvent.click(await screen.findByRole('button', { name: 'Clear Unused (2.0 KB)' }))

      await waitFor(() => expect(store().sourceVideos.map((v) => v.id)).toEqual(['video1']))
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:unused-thumb')
    })

    it('hides the clear-unused button when every source is in use', async () => {
      store().addSourceVideo(videoMeta)
      addClip('clip1', 0, 2)
      render(<VideoUploader onProjectFile={onProjectFile} />)

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
    // The quiet case: nothing stored to rebuild from, so the lazy rebuild
    // (ESCSUITE-117) reads once per thumbnail-less source and sets nothing.
    mockResolveThumbnailUrl.mockReset()
    mockResolveThumbnailUrl.mockResolvedValue(undefined)
    vi.stubGlobal('confirm', vi.fn(() => true))
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

  // ESCSUITE-84: removing media takes every clip that uses it, so a clip on a
  // locked track makes its media un-removable — the store refuses, and the
  // button says so rather than doing nothing.
  it('refuses to remove media a clip on a locked track uses', async () => {
    await storeVideo('video1', new Blob(['bytes']), videoMeta)
    store().addSourceVideo(videoMeta)
    const clip = addClip('clip1', 0, 4)
    store().updateTrack(clip.trackId, { locked: true })
    render(<VideoLibrary />)

    const button = screen.getByTitle('Used by a clip on a locked track')
    expect(button).toBeDisabled()
    expect(screen.queryByTitle('Remove media')).not.toBeInTheDocument()
  })

  it('still offers to remove media only unlocked clips use', () => {
    store().addSourceVideo(videoMeta)
    const clip = addClip('clip1', 0, 4)
    store().updateTrack(clip.trackId, { locked: false })
    render(<VideoLibrary />)

    expect(screen.getByTitle('Remove media')).toBeEnabled()
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

  // ESCSUITE-117: a source restored by undo has no thumbnailUrl — ESCSUITE-113
  // scrubbed the revoked handle out of the history snapshots rather than hand
  // back a dead one (pinned in `store/projectStore.test.ts`'s resetProject
  // case, "undo brings the source back with no thumbnail rather than a dead
  // one") — so the tile was blank until that source was next genuinely loaded.
  // The library rebuilds it from what is stored instead.
  describe('rebuilding a thumbnail the history scrubbed', () => {
    /** What the real `resolveThumbnailUrl` does when a thumbnail IS stored. */
    const storedThumbnail = () =>
      mockResolveThumbnailUrl.mockImplementation(async () =>
        URL.createObjectURL(new Blob(['thumb'], { type: 'image/jpeg' }))
      )

    /**
     * Reads the test lands itself, one per source id, so it can change the
     * library — or unmount the editor — while they are still in flight.
     */
    function parkedReads() {
      const pending = new Map<string, (url: string | undefined) => void>()
      mockResolveThumbnailUrl.mockImplementation(
        (id: string) => new Promise<string | undefined>((resolve) => { pending.set(id, resolve) })
      )
      return async (id: string, url: string | undefined) => {
        const land = pending.get(id)
        if (!land) throw new Error(`no read is parked for ${id}`)
        await act(async () => { land(url) })
      }
    }

    it('puts the stored thumbnail on the tile, and records no undo step doing it', async () => {
      storedThumbnail()
      store().addSourceVideo(videoMeta)
      const historyBefore = store().history.past.length
      // Spied here as well as asserted through the store, because the two cases
      // below claim this was NOT called — a claim worth nothing unless the spy
      // is demonstrably the function the component reaches.
      const setSourceThumbnail = vi.spyOn(useEditorStore.getState(), 'setSourceThumbnail')

      render(<VideoLibrary />)

      const img = (await screen.findByAltText('test.mp4')) as HTMLImageElement
      expect(mockResolveThumbnailUrl).toHaveBeenCalledWith('video1')
      expect(setSourceThumbnail).toHaveBeenCalledWith('video1', lastObjectUrl())
      expect(img.src).toContain(lastObjectUrl())
      expect(store().sourceVideos[0].thumbnailUrl).toBe(lastObjectUrl())
      // A repair, not an edit.
      expect(store().history.past).toHaveLength(historyBefore)
      expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(lastObjectUrl())
      setSourceThumbnail.mockRestore()
    })

    it('leaves a source whose thumbnail is already live alone', async () => {
      storedThumbnail()
      store().addSourceVideo({ ...videoMeta, thumbnailUrl: 'blob:already-live' })

      render(<VideoLibrary />)

      await waitFor(() => expect(screen.getByAltText('test.mp4')).toBeInTheDocument())
      expect(mockResolveThumbnailUrl).not.toHaveBeenCalled()
      expect(store().sourceVideos[0].thumbnailUrl).toBe('blob:already-live')
    })

    it('sets nothing and frees nothing when no thumbnail is stored for it', async () => {
      store().addSourceVideo(videoMeta)
      const revokesBefore = vi.mocked(URL.revokeObjectURL).mock.calls.length

      render(<VideoLibrary />)

      await waitFor(() => expect(mockResolveThumbnailUrl).toHaveBeenCalledWith('video1'))
      expect(store().sourceVideos[0].thumbnailUrl).toBeUndefined()
      expect(screen.queryByAltText('test.mp4')).not.toBeInTheDocument()
      expect(vi.mocked(URL.revokeObjectURL).mock.calls).toHaveLength(revokesBefore)
    })

    it('frees the handle it minted when the source left the library before the read landed', async () => {
      const land = parkedReads()
      store().addSourceVideo(videoMeta)
      const setSourceThumbnail = vi.spyOn(useEditorStore.getState(), 'setSourceThumbnail')
      render(<VideoLibrary />)
      await waitFor(() => expect(mockResolveThumbnailUrl).toHaveBeenCalledWith('video1'))

      act(() => { store().removeSourceVideo('video1') })
      const orphaned = URL.createObjectURL(new Blob(['thumb'], { type: 'image/jpeg' }))
      await land('video1', orphaned)

      expect(URL.revokeObjectURL).toHaveBeenCalledWith(orphaned)
      expect(setSourceThumbnail).not.toHaveBeenCalled()
      expect(store().sourceVideos).toHaveLength(0)
      setSourceThumbnail.mockRestore()
    })

    it('frees the handle it minted when the editor went away before the read landed', async () => {
      const land = parkedReads()
      store().addSourceVideo(videoMeta)
      const { unmount } = render(<VideoLibrary />)
      await waitFor(() => expect(mockResolveThumbnailUrl).toHaveBeenCalledWith('video1'))

      unmount()
      const orphaned = URL.createObjectURL(new Blob(['thumb'], { type: 'image/jpeg' }))
      await land('video1', orphaned)

      expect(URL.revokeObjectURL).toHaveBeenCalledWith(orphaned)
      expect(store().sourceVideos[0].thumbnailUrl).toBeUndefined()
    })

    it('reads a source once, however many times it re-renders while the read is parked', async () => {
      const land = parkedReads()
      store().addSourceVideo(videoMeta)
      const { rerender } = render(<VideoLibrary />)
      await waitFor(() => expect(mockResolveThumbnailUrl).toHaveBeenCalledWith('video1'))

      act(() => {
        store().addSourceVideo({ ...videoMeta, id: 'video2', name: 'second.mp4', thumbnailUrl: 'blob:second' })
      })
      rerender(<VideoLibrary />)

      expect(mockResolveThumbnailUrl.mock.calls.filter(([id]) => id === 'video1')).toHaveLength(1)
      await land('video1', undefined)
    })

    // A landing rebuild writes the store, which hands this component a NEW
    // sourceVideos array and re-runs the effect. An effect-scoped "am I still
    // mounted?" flag, flipped by the previous run's cleanup, therefore told every
    // read still parked that the editor had gone — so each freed the handle it
    // had just minted instead of setting it, and its id was already in the
    // already-read set, so the re-run did not try again. One tile repaired per
    // burst, and undo across a project load restores every source of the project
    // at once (review round 1).
    it('repairs every thumbnail-less source, not only the first to land', async () => {
      const land = parkedReads()
      store().addSourceVideo(videoMeta)
      store().addSourceVideo({ ...videoMeta, id: 'video2', name: 'second.mp4' })
      render(<VideoLibrary />)
      await waitFor(() => expect(mockResolveThumbnailUrl).toHaveBeenCalledTimes(2))

      await land('video1', 'blob:rebuilt-1')
      await land('video2', 'blob:rebuilt-2')

      expect(store().sourceVideos.map((v) => v.thumbnailUrl)).toEqual([
        'blob:rebuilt-1',
        'blob:rebuilt-2',
      ])
      expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:rebuilt-1')
      expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:rebuilt-2')
    })

    // The same fault, reached by any other store write: a source arriving while
    // the read is parked re-runs the effect just as a landing rebuild does.
    it('keeps the handle it minted when an unrelated source joins the library mid-read', async () => {
      const land = parkedReads()
      store().addSourceVideo(videoMeta)
      render(<VideoLibrary />)
      await waitFor(() => expect(mockResolveThumbnailUrl).toHaveBeenCalledWith('video1'))

      act(() => {
        store().addSourceVideo({ ...imageMeta, thumbnailUrl: 'blob:unrelated' })
      })
      await land('video1', 'blob:rebuilt')

      expect(store().sourceVideos.find((v) => v.id === 'video1')?.thumbnailUrl).toBe('blob:rebuilt')
      expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:rebuilt')
      // The newcomer already had one, so it was never read for.
      expect(mockResolveThumbnailUrl).toHaveBeenCalledTimes(1)
    })

    // The third arm of the guard, distinct from "unmounted" and "gone from the
    // library": the source is still here and now has a handle of its own, put
    // there by a real load — an import, a session restore — while the read was
    // parked. That one is on screen, so the rebuild's is freed (review round 1).
    it('frees the handle it minted when a real load won the race', async () => {
      const land = parkedReads()
      store().addSourceVideo(videoMeta)
      render(<VideoLibrary />)
      await waitFor(() => expect(mockResolveThumbnailUrl).toHaveBeenCalledWith('video1'))

      act(() => {
        store().addSourceVideo({ ...videoMeta, thumbnailUrl: 'blob:from-a-real-load' })
      })
      await land('video1', 'blob:rebuilt')

      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:rebuilt')
      expect(store().sourceVideos[0].thumbnailUrl).toBe('blob:from-a-real-load')
    })

    it('says so and stops when the read itself fails', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockResolveThumbnailUrl.mockRejectedValue(new Error('db closed'))
      store().addSourceVideo(videoMeta)
      const revokesBefore = vi.mocked(URL.revokeObjectURL).mock.calls.length

      render(<VideoLibrary />)

      await waitFor(() =>
        expect(consoleError).toHaveBeenCalledWith('Failed to rebuild thumbnail:', expect.any(Error))
      )
      expect(store().sourceVideos[0].thumbnailUrl).toBeUndefined()
      expect(vi.mocked(URL.revokeObjectURL).mock.calls).toHaveLength(revokesBefore)
      consoleError.mockRestore()
    })
  })
})
