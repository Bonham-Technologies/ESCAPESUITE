import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import { VideoUploader, VideoLibrary } from './VideoUploader'
import { useEditorStore } from '../store/projectStore'
import { resetStoreForTest, store, addClip } from '../test/fixtures/projectStore'
import { storeVideo, getAllVideoMetadata, storeThumbnail, getThumbnail, getVideoBlob, saveSessionState, clearSessionState } from '../core/storage'
import * as storageModule from '../core/storage'
import { DEFAULT_IMAGE_DURATION } from '../store/types'
import type { SourceVideo } from '../store/types'
import type { ShowNotification } from '../app/useNotification'
import styles from './VideoUploader.module.css'
import { lastObjectUrl } from '../test/objectUrls'

// The metadata extractors need real media decoding, so they stay collaborators;
// storage runs for real against fake-indexeddb.
const { mockProcessMediaFile, mockResolveThumbnailUrl } = vi.hoisted(() => ({
  mockProcessMediaFile: vi.fn(),
  mockResolveThumbnailUrl: vi.fn<(id: string) => Promise<string | undefined>>(),
}))

// ESCSUITE-255: the one entry the uploader decides a media type through.
vi.mock('../core/videoProcessor', () => ({
  processMediaFile: mockProcessMediaFile,
}))

const { mockAnalytics } = vi.hoisted(() => ({
  mockAnalytics: { videoImported: vi.fn() },
}))
vi.mock('../utils/analytics', () => ({ analytics: mockAnalytics }))

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

/** What `App` passes down: the notice-channel report of a Clear All partial failure. */
let showNotification: Mock<ShowNotification>

/**
 * What `App` passes down to both components: the autosave's `clearSession`,
 * which a storage clear calls when it leaves the project holding nothing
 * (ESCSUITE-307). Fresh for every case in the file, whichever describe it is in.
 */
let clearSession: Mock<() => void>
beforeEach(() => {
  clearSession = vi.fn()
})

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
    store().removeSourceVideosPermanently(['video1'])
    scriptStorage(50 * MB, 500 * MB)
    mockProcessMediaFile.mockResolvedValue(videoMeta)
    onProjectFile = vi.fn()
    showNotification = vi.fn()
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
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)
      await act(async () => {
        await Promise.resolve()
      })
    }

    it('invites the user to drop or browse', async () => {
      await renderUploader()

      expect(screen.getByText('Drop media or click to browse')).toBeInTheDocument()
      const input = fileInput()
      expect(input.accept).toBe('video/*,image/*,audio/*,.srt,.vtt,.veditor')
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
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

      expect(await screen.findByText('50.0 MB / 500.0 MB')).toBeInTheDocument()
      const fill = document.querySelector<HTMLElement>(`.${styles.storageProgressFill}`)!
      expect(fill.style.width).toBe('10%')
      expect(document.querySelector(`.${styles.storageBar}`)).not.toHaveClass(styles.storageWarning)
    })

    it('warns when less than 100MB is left', async () => {
      scriptStorage(60 * MB, 100 * MB)
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

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
        render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

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
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)
      const dropped = file('test.mp4', 'video/mp4')

      fireEvent.drop(dropZone(), { dataTransfer: { files: [dropped] } })

      expect(await screen.findByText('Complete')).toBeInTheDocument()
      expect(mockProcessMediaFile).toHaveBeenCalledWith(dropped)
      expect(store().sourceVideos).toEqual([videoMeta])
      // ESCSUITE-31: declared and tested in isolation but never called before.
      expect(mockAnalytics.videoImported).toHaveBeenCalledWith('video')
    })

    // ESCSUITE-244: an import writes bytes to IndexedDB, and undo cannot
    // un-write them. When the add was undoable, undo took the source out of the
    // library, the next edit pruned the redo branch, and the row stayed in the
    // shared `videos` store with nothing in either app able to list or free it.
    // Now the add records nothing: undo has nothing to take back, and the one
    // way out is Remove, which deletes the bytes.
    it('is not undoable: edit, import, undo and another edit leave the tile and its bytes in place, and Remove frees them (ESCSUITE-244)', async () => {
      mockProcessMediaFile.mockImplementation(async (f: File) => {
        await storeVideo(videoMeta.id, f, videoMeta)
        return videoMeta
      })
      // An edit made before the import, so the undo below lands on a real
      // snapshot (one taken before the file existed) rather than doing nothing.
      store().setProjectResolution(1920, 1080)
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)
      const pastBefore = useEditorStore.getState().history.past.length
      expect(pastBefore).toBeGreaterThan(0)

      fireEvent.drop(dropZone(), { dataTransfer: { files: [file('test.mp4', 'video/mp4')] } })
      expect(await screen.findByText('Complete')).toBeInTheDocument()

      // The import itself is not a step...
      expect(useEditorStore.getState().history.past).toHaveLength(pastBefore)
      // ...and the snapshot undo lands on holds the import too, so the probe's
      // sequence (undo, then an edit that prunes the redo branch) cannot orphan
      // anything.
      act(() => useEditorStore.getState().undo())
      expect(useEditorStore.getState().history.past).toHaveLength(pastBefore - 1)
      store().setProjectResolution(1280, 720)
      expect(store().sourceVideos.map((v) => v.id)).toEqual(['video1'])
      expect((await getAllVideoMetadata()).map((v) => v.id)).toEqual(['video1'])

      // Remove is the way out, and it deletes the bytes.
      cleanup()
      render(<VideoLibrary clearSession={clearSession} />)
      fireEvent.click(screen.getByTitle('Remove media'))
      await waitFor(() => expect(store().sourceVideos).toHaveLength(0))
      expect((await getAllVideoMetadata()).map((v) => v.id)).not.toContain('video1')
    })

    // ESCSUITE-255: the uploader no longer branches on file.type — it hands
    // every file to processMediaFile and reports the type that came back.
    it('hands an image to the one media processor and reports an image', async () => {
      mockProcessMediaFile.mockResolvedValue(imageMeta)
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)
      const picked = file('test.png', 'image/png')

      selectFiles([picked])

      await waitFor(() => expect(mockProcessMediaFile).toHaveBeenCalledWith(picked))
      expect(store().sourceVideos).toEqual([imageMeta])
      expect(mockAnalytics.videoImported).toHaveBeenCalledWith('image')
    })

    it('hands audio to the one media processor and reports audio', async () => {
      mockProcessMediaFile.mockResolvedValue(audioMeta)
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

      selectFiles([file('test.mp3', 'audio/mp3')])

      await waitFor(() => expect(mockProcessMediaFile).toHaveBeenCalledTimes(1))
      expect(store().sourceVideos).toEqual([audioMeta])
      expect(mockAnalytics.videoImported).toHaveBeenCalledWith('audio')
    })

    it('stores and reports as audio a video/webm file that decodes no picture (ESCSUITE-255)', async () => {
      const micOnly = { ...audioMeta, id: 'mic1', name: 'take.webm', mimeType: 'video/webm' }
      mockProcessMediaFile.mockResolvedValue(micOnly)
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)
      const picked = file('take.webm', 'video/webm')

      selectFiles([picked])

      await waitFor(() => expect(mockProcessMediaFile).toHaveBeenCalledWith(picked))
      expect(store().sourceVideos).toEqual([micOnly])
      expect(store().sourceVideos[0].mediaType).toBe('audio')
      expect(mockAnalytics.videoImported).toHaveBeenCalledWith('audio')
    })

    it('clears the file input so the same file can be picked again', async () => {
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)
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

      await waitFor(() => expect(mockProcessMediaFile).toHaveBeenCalled())
      expect(valueWrites).toEqual([''])
    })

    it('drops the finished upload from the list after a moment, fading first (ESCSUITE-4)', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

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

      // The removal is a fade, not a pop: the row is still there, marked for
      // the transition, until the fade itself has had time to run.
      const row = screen.getByText('Complete').closest(`.${styles.uploadItem}`)
      expect(row).toHaveClass(styles.uploadItemRemoving)

      act(() => {
        vi.advanceTimersByTime(200)
      })

      expect(screen.queryByText('Complete')).not.toBeInTheDocument()
    })

    // Coverage round: the fade-start map's `: u` arm — the sibling row left
    // alone — was unreached, because every other case fades a lone upload.
    // Stagger two uploads' own 2000ms timers (drop the second only after
    // advancing partway through the first's) so the first's timer fires
    // while the second's is still pending, and prove the second is both
    // untouched (no `.uploadItemRemoving`) and still listed — then that both
    // still leave on their own schedules.
    it('fades only the upload whose own timer has fired, leaving a sibling untouched (ESCSUITE-4)', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

      fireEvent.drop(dropZone(), { dataTransfer: { files: [file('first.mp4', 'video/mp4')] } })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(screen.getAllByText('Complete')).toHaveLength(1)

      // 500ms into first.mp4's 2000ms removal timer before second.mp4 even
      // arrives, so the two timers land 500ms apart rather than the same tick.
      act(() => {
        vi.advanceTimersByTime(500)
      })

      fireEvent.drop(dropZone(), { dataTransfer: { files: [file('second.mp4', 'video/mp4')] } })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(screen.getAllByText('Complete')).toHaveLength(2)

      // first.mp4's timer reaches its 2000ms mark; second.mp4's (armed 500ms
      // later) still has 500ms left.
      act(() => {
        vi.advanceTimersByTime(1500)
      })

      expect(screen.getByText('first.mp4').closest(`.${styles.uploadItem}`)).toHaveClass(
        styles.uploadItemRemoving
      )
      const secondRow = screen.getByText('second.mp4').closest(`.${styles.uploadItem}`)
      expect(secondRow).not.toHaveClass(styles.uploadItemRemoving)
      expect(screen.getByText('second.mp4')).toBeInTheDocument()

      // first.mp4's fade completes and it leaves; second.mp4 is still
      // untouched — its own timer has not reached 2000ms yet.
      act(() => {
        vi.advanceTimersByTime(200)
      })
      expect(screen.queryByText('first.mp4')).not.toBeInTheDocument()
      expect(screen.getByText('second.mp4').closest(`.${styles.uploadItem}`)).not.toHaveClass(
        styles.uploadItemRemoving
      )

      // second.mp4 now reaches its own 2000ms mark and fades, independently.
      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(screen.getByText('second.mp4').closest(`.${styles.uploadItem}`)).toHaveClass(
        styles.uploadItemRemoving
      )

      act(() => {
        vi.advanceTimersByTime(200)
      })
      expect(screen.queryByText('second.mp4')).not.toBeInTheDocument()
    })

    // ESCSUITE-120: the 2 s "remove from the list" timer used to outlive the
    // component. A test that finished inside two seconds left it armed, and
    // when the file's jsdom was torn down before it fired, react-dom threw
    // `window is not defined` from inside the callback — an unhandled error
    // that failed CI with every assertion green.
    it('arms no timer past its own unmount (ESCSUITE-120)', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
      const { unmount } = render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

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

    // ESCSUITE-4: the status text had no accessible announcement at all — a
    // screen reader heard nothing as an upload moved from processing to
    // complete. role="status" carries an implicit aria-live="polite", so no
    // separate aria-live attribute is needed alongside it.
    it('announces the upload status to assistive tech (ESCSUITE-4)', async () => {
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

      fireEvent.drop(dropZone(), { dataTransfer: { files: [file('test.mp4', 'video/mp4')] } })

      expect(await screen.findByText('Complete')).toHaveAttribute('role', 'status')
    })

    it('rejects files that are not media at all', async () => {
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

      selectFiles([file('notes.txt', 'text/plain')])

      await waitFor(() =>
        expect(showNotification).toHaveBeenCalledWith(
          'Only video, image, audio, caption (.srt / .vtt) and .veditor files can be imported.',
          'error'
        )
      )
      // ESCSUITE-249: the one blocking alert() left in the app is gone.
      expect(globalThis.alert).not.toHaveBeenCalled()
      expect(mockProcessMediaFile).not.toHaveBeenCalled()
    })

    it('says nothing about a file it accepts', async () => {
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

      selectFiles([file('test.mp4', 'video/mp4')])

      await screen.findByText('Complete')
      expect(showNotification).not.toHaveBeenCalled()
      expect(globalThis.alert).not.toHaveBeenCalled()
    })

    // ESCSUITE-249: upload rows were matched by file name, so two drops of
    // `clip.mp4` shared one row's progress, one row's error and one Dismiss.
    describe('two files with the same name (ESCSUITE-249)', () => {
      it('gives each its own row, and Dismiss removes only the one it sits on', async () => {
        let finishSecond: (value: typeof videoMeta) => void = () => {}
        mockProcessMediaFile
          .mockRejectedValueOnce(new Error('Unsupported codec'))
          .mockImplementationOnce(() => new Promise((resolve) => { finishSecond = resolve }))
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
          render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

          selectFiles([file('clip.mp4', 'video/mp4'), file('clip.mp4', 'video/mp4')])

          expect(await screen.findByText('Unsupported codec')).toBeInTheDocument()
          expect(await screen.findByText('Processing...')).toBeInTheDocument()
          expect(screen.getAllByText('clip.mp4')).toHaveLength(2)

          fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

          expect(screen.queryByText('Unsupported codec')).not.toBeInTheDocument()
          expect(screen.getByText('Processing...')).toBeInTheDocument()
          expect(screen.getAllByText('clip.mp4')).toHaveLength(1)

          await act(async () => finishSecond(videoMeta))
          expect(await screen.findByText('Complete')).toBeInTheDocument()
        } finally {
          errorLog.mockRestore()
        }
      })

      it('keeps two failures apart, each with its own Dismiss', async () => {
        mockProcessMediaFile
          .mockRejectedValueOnce(new Error('first failed'))
          .mockRejectedValueOnce(new Error('second failed'))
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
          render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

          selectFiles([file('clip.mp4', 'video/mp4'), file('clip.mp4', 'video/mp4')])

          expect(await screen.findByText('first failed')).toBeInTheDocument()
          expect(await screen.findByText('second failed')).toBeInTheDocument()
          const dismissals = screen.getAllByRole('button', { name: 'Dismiss' })
          expect(dismissals).toHaveLength(2)

          fireEvent.click(dismissals[0])

          expect(screen.queryByText('first failed')).not.toBeInTheDocument()
          expect(screen.getByText('second failed')).toBeInTheDocument()
        } finally {
          errorLog.mockRestore()
        }
      })

      it('fades and removes a finished row without touching its namesake', async () => {
        vi.useFakeTimers()
        let finishSecond: (value: typeof videoMeta) => void = () => {}
        mockProcessMediaFile
          .mockResolvedValueOnce(videoMeta)
          .mockImplementationOnce(() => new Promise((resolve) => { finishSecond = resolve }))
        render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

        selectFiles([file('clip.mp4', 'video/mp4'), file('clip.mp4', 'video/mp4')])
        await act(async () => { await vi.advanceTimersByTimeAsync(0) })
        expect(screen.getByText('Complete')).toBeInTheDocument()
        expect(screen.getByText('Processing...')).toBeInTheDocument()

        await act(async () => { await vi.advanceTimersByTimeAsync(2000 + 200) })

        expect(screen.queryByText('Complete')).not.toBeInTheDocument()
        expect(screen.getByText('Processing...')).toBeInTheDocument()
        await act(async () => finishSecond(videoMeta))
      })
    })

    it('refuses a file that would not fit in the remaining quota', async () => {
      scriptStorage(10 * MB, 15 * MB)
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

      selectFiles([file('big.mp4', 'video/mp4', 'x'.repeat(2048))])

      expect(
        await screen.findByText(
          'Not enough storage space. Need 2.0 KB, only 5.0 MB available. Remove some media to free up space.'
        )
      ).toBeInTheDocument()
      expect(mockProcessMediaFile).not.toHaveBeenCalled()
    })

    it('reports a processing failure against the file and lets it be dismissed', async () => {
      mockProcessMediaFile.mockRejectedValue(new Error('Unsupported codec'))
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

        selectFiles([file('test.mp4', 'video/mp4')])

        expect(await screen.findByText('Unsupported codec')).toBeInTheDocument()
        expect(errorLog).toHaveBeenCalledWith('Failed to process media:', expect.any(Error))
        expect(mockAnalytics.videoImported).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

        expect(screen.queryByText('Unsupported codec')).not.toBeInTheDocument()
      } finally {
        errorLog.mockRestore()
      }
    })

    it('translates a quota failure into advice about freeing space', async () => {
      mockProcessMediaFile.mockRejectedValue(new Error('QuotaExceededError: no room'))
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

        selectFiles([file('test.mp4', 'video/mp4')])

        expect(
          await screen.findByText('Storage quota exceeded. Remove some media to free up space.')
        ).toBeInTheDocument()
      } finally {
        errorLog.mockRestore()
      }
    })

    it('describes a thrown non-Error as an unknown failure', async () => {
      mockProcessMediaFile.mockRejectedValue('kaboom')
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

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
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)
      const projectFile = file('my.veditor', '')

      fireEvent.drop(dropZone(), { dataTransfer: { files: [projectFile] } })

      await waitFor(() => expect(onProjectFile).toHaveBeenCalledWith(projectFile))
      expect(screen.queryByTestId('project-load-dialog')).not.toBeInTheDocument()
    })

    it('hands a picked project file up the same way', async () => {
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)
      const projectFile = file('my.veditor', '')

      selectFiles([projectFile])

      await waitFor(() => expect(onProjectFile).toHaveBeenCalledWith(projectFile))
    })

    it('hands it up whatever is on the timeline — the caller decides what to ask', async () => {
      addClip('clip1', 0, 2)
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

      selectFiles([file('my.veditor', '')])

      await waitFor(() => expect(onProjectFile).toHaveBeenCalledTimes(1))
      expect(screen.queryByTestId('project-load-dialog')).not.toBeInTheDocument()
      expect(store().project.timeline.clips).toHaveLength(1)
    })

    it('ignores the media alongside a project file', async () => {
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

      selectFiles([file('my.veditor', ''), file('test.mp4', 'video/mp4')])

      await waitFor(() => expect(onProjectFile).toHaveBeenCalledTimes(1))
      expect(mockProcessMediaFile).not.toHaveBeenCalled()
    })

    // ESCSUITE-249: the test was case-sensitive, so a project saved or renamed
    // in upper case fell through to the "not media" refusal.
    it('recognises the extension in any case', async () => {
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)
      const projectFile = file('PROJECT.VEDITOR', '')

      selectFiles([projectFile])

      await waitFor(() => expect(onProjectFile).toHaveBeenCalledWith(projectFile))
      expect(showNotification).not.toHaveBeenCalled()
      expect(globalThis.alert).not.toHaveBeenCalled()
      expect(mockProcessMediaFile).not.toHaveBeenCalled()
    })

    it('leaves a file that is not a project to the media path', async () => {
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

      selectFiles([file('test.mp4', 'video/mp4')])

      await waitFor(() => expect(mockProcessMediaFile).toHaveBeenCalledTimes(1))
      expect(onProjectFile).not.toHaveBeenCalled()
    })
  })

  // ESCSUITE-293: a dropped or picked .srt / .vtt becomes text clips on the
  // Captions track. Told apart by extension, in any case — a browser reports
  // `.srt` with no MIME type at all.
  describe('importing captions (ESCSUITE-293)', () => {
    const SRT = '1\n00:00:01,000 --> 00:00:02,000\nHello there.\n\n2\n00:00:03,000 --> 00:00:04,000\nGoodbye.\n'
    const VTT = 'WEBVTT\n\n00:01.000 --> 00:02.000 align:start\n<v Ann>Hi</v>\n'

    const captionTrack = () => store().project.timeline.tracks.find((track) => track.kind === 'captions')
    const captionTexts = () => store().project.timeline.clips.map((clip) => clip.textData?.text)

    function renderUploader() {
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)
    }

    it('puts a dropped .srt on the Captions track and says how many', async () => {
      renderUploader()

      fireEvent.drop(dropZone(), { dataTransfer: { files: [file('talk.srt', '', SRT)] } })

      await waitFor(() =>
        expect(showNotification).toHaveBeenCalledWith('Imported 2 captions onto the Captions track.', 'success')
      )
      expect(captionTrack()?.name).toBe('Captions')
      expect(captionTexts()).toEqual(['Hello there.', 'Goodbye.'])
      expect(store().project.timeline.clips.map((clip) => [clip.timelinePosition, clip.duration])).toEqual([[1, 1], [3, 1]])
      expect(showNotification).toHaveBeenCalledTimes(1)
      expect(mockProcessMediaFile).not.toHaveBeenCalled()
      expect(onProjectFile).not.toHaveBeenCalled()
    })

    it('reads a picked .VTT in upper case, and says once what it did not import', async () => {
      renderUploader()

      selectFiles([file('TALK.VTT', 'text/vtt', VTT)])

      await waitFor(() =>
        expect(showNotification).toHaveBeenCalledWith('Imported 1 caption onto the Captions track.', 'success')
      )
      expect(showNotification).toHaveBeenCalledWith('Positioning and speaker names were not imported.', 'info')
      expect(showNotification).toHaveBeenCalledTimes(2)
      expect(captionTexts()).toEqual(['Hi'])
    })

    it('styles captions for the project, and wraps a long line at word boundaries', async () => {
      store().setProjectResolution(1280, 720)
      renderUploader()
      const long = 'This caption is far too long to sit on one line of a video frame'

      selectFiles([file('long.srt', '', `00:00:01,000 --> 00:00:02,000\n${long}\n`)])

      await waitFor(() => expect(captionTexts()).toEqual(['This caption is far too long to sit on one\nline of a video frame']))
      expect(store().project.timeline.clips[0].textData).toMatchObject({ fontSize: 32, y: 0.88, backgroundColor: '#000000b3' })
    })

    it('refuses a file it cannot read, saying why, and adds nothing', async () => {
      renderUploader()

      selectFiles([file('broken.vtt', 'text/vtt', '00:01.000 --> 00:02.000\nNo header\n')])

      await waitFor(() =>
        expect(showNotification).toHaveBeenCalledWith('Line 1: a WebVTT file must start with "WEBVTT".', 'error')
      )
      expect(store().project.timeline.clips).toHaveLength(0)
      expect(captionTrack()).toBeUndefined()
    })

    it('says so when the file itself cannot be read', async () => {
      renderUploader()
      const unreadable = file('gone.srt', '', SRT)
      vi.spyOn(unreadable, 'text').mockRejectedValue(new DOMException('The file could not be read.', 'NotReadableError'))
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        selectFiles([unreadable])

        await waitFor(() => expect(showNotification).toHaveBeenCalledWith('Could not read gone.srt.', 'error'))
        expect(errorLog).toHaveBeenCalled()
        expect(store().project.timeline.clips).toHaveLength(0)
      } finally {
        errorLog.mockRestore()
      }
    })

    // Review M3: imported onto a hidden track, nothing appears in the picture;
    // the one notice says why rather than a second one.
    it('says the Captions track is hidden, in the same notice, when it is', async () => {
      renderUploader()
      selectFiles([file('first.srt', '', SRT)])
      await waitFor(() => expect(captionTrack()).toBeDefined())
      store().updateTrack(captionTrack()!.id, { visible: false })
      showNotification.mockClear()

      selectFiles([file('second.srt', '', SRT)])

      await waitFor(() =>
        expect(showNotification).toHaveBeenCalledWith(
          'Imported 2 captions onto the Captions track. The Captions track is hidden.',
          'success'
        )
      )
      expect(showNotification).toHaveBeenCalledTimes(1)
    })

    it('refuses while the Captions track is locked', async () => {
      renderUploader()
      selectFiles([file('first.srt', '', SRT)])
      await waitFor(() => expect(captionTrack()).toBeDefined())
      store().updateTrack(captionTrack()!.id, { locked: true })
      showNotification.mockClear()

      selectFiles([file('second.srt', '', SRT)])

      await waitFor(() =>
        expect(showNotification).toHaveBeenCalledWith('The Captions track is locked, so no captions were imported.', 'error')
      )
      expect(store().project.timeline.clips).toHaveLength(2)
    })

    it('imports captions and media dropped together', async () => {
      renderUploader()

      fireEvent.drop(dropZone(), {
        dataTransfer: { files: [file('talk.srt', '', SRT), file('test.mp4', 'video/mp4')] },
      })

      await screen.findByText('Complete')
      expect(captionTexts()).toEqual(['Hello there.', 'Goodbye.'])
      expect(mockProcessMediaFile).toHaveBeenCalledTimes(1)
      expect(store().sourceVideos.map((v) => v.id)).toEqual(['video1'])
    })

    it('leaves captions alone beside a project file, which still wins', async () => {
      renderUploader()

      selectFiles([file('talk.srt', '', SRT), file('my.veditor', '')])

      await waitFor(() => expect(onProjectFile).toHaveBeenCalledTimes(1))
      expect(store().project.timeline.clips).toHaveLength(0)
      expect(showNotification).not.toHaveBeenCalled()
    })
  })

  describe('freeing space', () => {
    // Two of this describe's cases spy on the real `deleteVideo` (imported
    // as `* as storageModule` above) to make one id fail, or to react mid-loop
    // to a specific id. `vi.clearAllMocks()` in the outer `beforeEach` clears
    // call history but does not undo a `mockImplementation` — only
    // `mockRestore` does — so left alone, either spy would keep intercepting
    // every later test's `deleteVideo` calls in this file, CRAFT-shaped id
    // checks and locked-track locking included.
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('clears every stored video once confirmed', async () => {
      await storeVideo('video1', new Blob(['bytes']), videoMeta)
      store().addSourceVideo(videoMeta)
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

      fireEvent.click(await screen.findByRole('button', { name: 'Clear All' }))

      await waitFor(() => expect(store().sourceVideos).toHaveLength(0))
      expect(globalThis.confirm).toHaveBeenCalledWith(
        'Remove every file this project imported, including any clip that still uses it? Files on a locked track stay. This cannot be undone.'
      )
      // Not `toHaveLength(0)`: this describe's rows accumulate in the real
      // fake-indexeddb across its tests (no per-test reset — see the
      // ESCSUITE-142 review's finding on this file), so an exact length here
      // would only be safe by being first. `not.toContain` stays true
      // regardless of what a test inserted above this one (NIT 3).
      expect((await getAllVideoMetadata()).map((v) => v.id)).not.toContain('video1')
    })

    // ESCSUITE-149: Clear All deletes the bytes from IndexedDB itself, so it
    // must not be undoable — an undo that handed a `SourceVideo` back
    // afterwards would restore a tile nothing can play, place or export, and
    // (since a clip on the timeline can reference the cleared source) could
    // bring a clip back pointing at nothing. `useEditorStore.getState()`
    // reaches past this file's `store()` wrapper for `undo`/`canUndo`, which
    // have nothing mounted to flush.
    it('is not undoable: undo after Clear All brings back neither the source nor its clip', async () => {
      await storeVideo('video1', new Blob(['bytes']), videoMeta)
      store().addSourceVideo(videoMeta)
      const trackId = store().project.timeline.tracks[0].id
      store().addClipToTimeline(
        { id: 'clip-cleared', sourceVideoId: 'video1', name: 'Clip', startTime: 0, endTime: 5, duration: 5 },
        trackId, 0
      )
      const pastLengthBeforeClear = useEditorStore.getState().history.past.length
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

      fireEvent.click(await screen.findByRole('button', { name: 'Clear All' }))

      await waitFor(() => expect(store().sourceVideos).toHaveLength(0))
      expect(store().project.timeline.clips).toHaveLength(0)
      // No new undo entry: canUndo() reflects the history exactly as it stood
      // before the clear.
      expect(useEditorStore.getState().history.past).toHaveLength(pastLengthBeforeClear)
      expect(useEditorStore.getState().canUndo()).toBe(true)

      useEditorStore.getState().undo()

      expect(useEditorStore.getState().sourceVideos.map((v) => v.id)).not.toContain('video1')
      expect(
        useEditorStore.getState().project.timeline.clips.some((c) => c.sourceVideoId === 'video1')
      ).toBe(false)
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
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

      fireEvent.click(await screen.findByRole('button', { name: 'Clear All' }))

      await waitFor(() => expect(store().sourceVideos).toHaveLength(0))
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:thumb-1')
    })

    it('keeps everything when the confirmation is declined', async () => {
      vi.mocked(globalThis.confirm).mockReturnValue(false)
      await storeVideo('kept', new Blob(['bytes']), { ...videoMeta, id: 'kept' })
      store().addSourceVideo(videoMeta)
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

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
      // The reported defect was `db.clear('videos')` *and* `db.clear('thumbnails')`
      // — pin the other half of the loss too (NIT 1).
      await storeThumbnail('craft-take', new Blob(['thumb']))
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

      fireEvent.click(await screen.findByRole('button', { name: 'Clear All' }))

      await waitFor(() => expect(store().sourceVideos).toHaveLength(0))
      // Both halves of the ticket's contract: CRAFT's row survives (MINOR 6
      // adds the second half — video1, which the library DOES own, is
      // actually gone rather than only dropped from the store).
      const remainingIds = (await getAllVideoMetadata()).map((v) => v.id)
      expect(remainingIds).toContain('craft-take')
      expect(remainingIds).not.toContain('video1')
      expect(await getThumbnail('craft-take')).toBeDefined()
    })

    // ESCSUITE-84 + ESCSUITE-142: a source a clip on a locked track uses is
    // skipped, exactly as Clear Unused already skips it (it is never counted
    // "unused"). Deleting per id means there is no longer a blob-before-store
    // ordering problem, so this is no longer all-or-nothing: the unlocked
    // source still clears.
    it('clears everything except media a clip on a locked track uses', async () => {
      await storeVideo('video1', new Blob(['bytes']), videoMeta)
      store().addSourceVideo(videoMeta)
      const clip = addClip('clip1', 0, 4)
      store().updateTrack(clip.trackId, { locked: true })
      await storeVideo('video2', new Blob(['bytes']), { ...videoMeta, id: 'video2', name: 'other.mp4' })
      store().addSourceVideo({ ...videoMeta, id: 'video2', name: 'other.mp4' })
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

      fireEvent.click(await screen.findByRole('button', { name: 'Clear All' }))

      await waitFor(() => expect(store().sourceVideos.map((v) => v.id)).toEqual(['video1']))
      const remainingIds = (await getAllVideoMetadata()).map((v) => v.id)
      expect(remainingIds).toContain('video1')
      expect(remainingIds).not.toContain('video2')
    })

    // MINOR 2 (ESCSUITE-142 review): a delete failing partway through must
    // not be console-only, and must not leave the meter reporting the
    // pre-clear figure. The loop also does not abort on the first failure —
    // it catches each id on its own, so a bad id does not strand every id
    // after it.
    it('reports how many files it could not remove, and still clears the rest', async () => {
      await storeVideo('video1', new Blob(['bytes']), videoMeta)
      store().addSourceVideo(videoMeta)
      await storeVideo('video2', new Blob(['bytes']), { ...videoMeta, id: 'video2', name: 'two.mp4' })
      store().addSourceVideo({ ...videoMeta, id: 'video2', name: 'two.mp4' })
      await storeVideo('video3', new Blob(['bytes']), { ...videoMeta, id: 'video3', name: 'three.mp4' })
      store().addSourceVideo({ ...videoMeta, id: 'video3', name: 'three.mp4' })

      const realDeleteVideo = storageModule.deleteVideo
      vi.spyOn(storageModule, 'deleteVideo').mockImplementation(async (id: string) => {
        if (id === 'video2') throw new Error('disk full')
        return realDeleteVideo(id)
      })
      const estimate = vi.fn(() => Promise.resolve({ usage: 50 * MB, quota: 500 * MB }))
      Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate } })

      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)
      const callsBeforeClick = estimate.mock.calls.length

      fireEvent.click(await screen.findByRole('button', { name: 'Clear All' }))

      await waitFor(() => expect(store().sourceVideos.map((v) => v.id)).toEqual(['video2']))
      expect(showNotification).toHaveBeenCalledWith('Could not remove 1 file from storage', 'error')
      const remainingIds = (await getAllVideoMetadata()).map((v) => v.id)
      expect(remainingIds).toContain('video2')
      expect(remainingIds).not.toContain('video1')
      expect(remainingIds).not.toContain('video3')
      // The meter refresh ran despite the failure (`finally`, not the end of
      // a successful `try`).
      await waitFor(() => expect(estimate.mock.calls.length).toBeGreaterThan(callsBeforeClick))
    })

    // ESCSUITE-142 review round 2 (coverage): the previous case only ever
    // failed one id, so the notice's plural branch (`failed !== 1 ? 's' :
    // ''`) was never reached. Two failures also exercises "the surviving
    // rows are the failed ones" with more than one survivor.
    it('pluralises the notice when more than one file could not be removed', async () => {
      await storeVideo('video1', new Blob(['bytes']), videoMeta)
      store().addSourceVideo(videoMeta)
      await storeVideo('video2', new Blob(['bytes']), { ...videoMeta, id: 'video2', name: 'two.mp4' })
      store().addSourceVideo({ ...videoMeta, id: 'video2', name: 'two.mp4' })
      await storeVideo('video3', new Blob(['bytes']), { ...videoMeta, id: 'video3', name: 'three.mp4' })
      store().addSourceVideo({ ...videoMeta, id: 'video3', name: 'three.mp4' })

      const realDeleteVideo = storageModule.deleteVideo
      vi.spyOn(storageModule, 'deleteVideo').mockImplementation(async (id: string) => {
        if (id === 'video1' || id === 'video2') throw new Error('disk full')
        return realDeleteVideo(id)
      })

      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

      fireEvent.click(await screen.findByRole('button', { name: 'Clear All' }))

      await waitFor(() =>
        expect(store().sourceVideos.map((v) => v.id).sort()).toEqual(['video1', 'video2'])
      )
      expect(showNotification).toHaveBeenCalledWith('Could not remove 2 files from storage', 'error')
      const remainingIds = (await getAllVideoMetadata()).map((v) => v.id)
      expect(remainingIds).toContain('video1')
      expect(remainingIds).toContain('video2')
      expect(remainingIds).not.toContain('video3')
    })

    // ESCSUITE-149 coverage round: `if (removedIds.length > 0)
    // removeSourceVideosPermanently(removedIds)`'s false arm was unreached —
    // every committed case up to now had at least one delete succeed. When
    // every `deleteVideo` in the batch rejects, `removedIds` stays empty and
    // the permanent-removal write must never run: every source stays in both
    // the store and the database, the notice still names the full count, the
    // meter still refreshes, and — since no store action ran at all — the
    // history is untouched, the exact same object as before the click.
    //
    // Spies directly on the store action rather than only on its
    // consequences: `removeSourceVideosPermanently([])` is itself a no-op
    // (its own `ids.length === 0` guard), so "the library is unchanged"
    // alone cannot tell "never called" apart from "called with nothing to
    // do" — only `not.toHaveBeenCalled()` can.
    it('does not call removeSourceVideosPermanently when every delete in the batch rejects', async () => {
      await storeVideo('video1', new Blob(['bytes']), videoMeta)
      store().addSourceVideo(videoMeta)
      await storeVideo('video2', new Blob(['bytes']), { ...videoMeta, id: 'video2', name: 'two.mp4' })
      store().addSourceVideo({ ...videoMeta, id: 'video2', name: 'two.mp4' })

      vi.spyOn(storageModule, 'deleteVideo').mockRejectedValue(new Error('disk full'))
      const estimate = vi.fn(() => Promise.resolve({ usage: 50 * MB, quota: 500 * MB }))
      Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate } })
      const removeSourceVideosPermanently = vi.spyOn(useEditorStore.getState(), 'removeSourceVideosPermanently')

      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)
      const callsBeforeClick = estimate.mock.calls.length
      const historyBefore = useEditorStore.getState().history

      fireEvent.click(await screen.findByRole('button', { name: 'Clear All' }))

      await waitFor(() =>
        expect(showNotification).toHaveBeenCalledWith('Could not remove 2 files from storage', 'error')
      )
      expect(removeSourceVideosPermanently).not.toHaveBeenCalled()
      expect(store().sourceVideos.map((v) => v.id).sort()).toEqual(['video1', 'video2'])
      const remainingIds = (await getAllVideoMetadata()).map((v) => v.id)
      expect(remainingIds).toContain('video1')
      expect(remainingIds).toContain('video2')
      await waitFor(() => expect(estimate.mock.calls.length).toBeGreaterThan(callsBeforeClick))
      expect(useEditorStore.getState().history).toBe(historyBefore)
    })

    // MINOR 3 (ESCSUITE-142 review): the render-time `lockedMedia` snapshot
    // the button uses to decide what to *offer* is not safe to trust once the
    // loop is `await`ing between ids — a track locked while an earlier id's
    // delete is still in flight must not cost a later id its bytes, which is
    // exactly the hazard the old all-or-nothing design existed to avoid.
    it('does not delete the blob of a source locked while an earlier delete is still in flight', async () => {
      await storeVideo('video1', new Blob(['bytes']), videoMeta)
      store().addSourceVideo(videoMeta)
      await storeVideo('video2', new Blob(['bytes']), { ...videoMeta, id: 'video2', name: 'two.mp4' })
      store().addSourceVideo({ ...videoMeta, id: 'video2', name: 'two.mp4' })
      // video2's own clip, on its own track — unlocked when Clear All is
      // clicked, so video2 starts out clearable.
      store().addClipToTimeline(
        { id: 'clip2', sourceVideoId: 'video2', name: 'clip2', startTime: 0, endTime: 4, duration: 4 },
        undefined,
        10
      )
      const clip2 = store().project.timeline.clips.find((c) => c.id === 'clip2')!

      const realDeleteVideo = storageModule.deleteVideo
      vi.spyOn(storageModule, 'deleteVideo').mockImplementation(async (id: string) => {
        if (id === 'video1') {
          // Lock video2's track while video1's delete is still in flight —
          // between the two awaits the loop takes.
          store().updateTrack(clip2.trackId, { locked: true })
        }
        return realDeleteVideo(id)
      })

      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

      fireEvent.click(await screen.findByRole('button', { name: 'Clear All' }))

      await waitFor(() => expect(store().sourceVideos.map((v) => v.id)).toEqual(['video2']))
      expect((await getAllVideoMetadata()).map((v) => v.id)).toContain('video2')
    })

    // Nothing to clear at all — every source is locked-in-use — is a dead
    // click, and MAJOR 1 (ESCSUITE-142 review) is that a dead click must not
    // look like a live one: the button says why up front instead.
    it('disables Clear All, with a reason, when every stored source is locked in use', async () => {
      await storeVideo('video1', new Blob(['bytes']), videoMeta)
      store().addSourceVideo(videoMeta)
      const clip = addClip('clip1', 0, 4)
      store().updateTrack(clip.trackId, { locked: true })
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

      const button = await screen.findByTitle('Every file is on a locked track')
      expect(button).toBeDisabled()

      fireEvent.click(button)
      await act(async () => { await Promise.resolve() })

      expect(globalThis.confirm).not.toHaveBeenCalled()
      expect(store().sourceVideos).toHaveLength(1)
      expect((await getAllVideoMetadata()).map((v) => v.id)).toContain('video1')
    })

    // The ticket's own trigger, step for step: CRAFT recordings push the
    // origin's storage usage up (so the button's render gate — the meter, not
    // the library — still shows it), while ARTIST's own library is empty.
    // MAJOR 1: this must not be a silent no-op behind a button that looks
    // live — it must say so and refuse to open the confirm at all.
    it('disables Clear All, with a reason, when this library is empty', async () => {
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

      const button = await screen.findByTitle('Nothing to clear')
      expect(button).toBeDisabled()

      fireEvent.click(button)
      await act(async () => { await Promise.resolve() })

      expect(globalThis.confirm).not.toHaveBeenCalled()
    })

    it('hides the clear-all button when almost nothing is stored', async () => {
      scriptStorage(1024, 500 * MB)
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

      await screen.findByText('1.0 KB / 500.0 MB')
      expect(screen.queryByRole('button', { name: 'Clear All' })).not.toBeInTheDocument()
    })

    it('offers to clear only the media no clip uses', async () => {
      await storeVideo('unused', new Blob(['bytes']), { ...videoMeta, id: 'unused' })
      store().addSourceVideo(videoMeta)
      store().addSourceVideo({ ...videoMeta, id: 'unused', name: 'spare.mp4', size: 2048 })
      addClip('clip1', 0, 2) // references video1
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

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
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

      fireEvent.click(await screen.findByRole('button', { name: 'Clear Unused (2.0 KB)' }))

      await waitFor(() => expect(store().sourceVideos.map((v) => v.id)).toEqual(['video1']))
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:unused-thumb')
    })

    // ESCSUITE-149 review, NIT 2: the meter refresh used to be the last
    // statement of the `try`, so a delete that threw partway through the loop
    // skipped it — unlike Clear All, which already refreshed in `finally`.
    // The ids before the failure are still permanently removed (the
    // permanent-removal write already ran in `finally`), so the meter should
    // reflect that even though the whole clear did not finish cleanly.
    it('refreshes the storage meter even when a delete fails partway through', async () => {
      await storeVideo('unused1', new Blob(['bytes']), { ...videoMeta, id: 'unused1' })
      store().addSourceVideo({ ...videoMeta, id: 'unused1', name: 'one.mp4', size: 1024 })
      await storeVideo('unused2', new Blob(['bytes']), { ...videoMeta, id: 'unused2' })
      store().addSourceVideo({ ...videoMeta, id: 'unused2', name: 'two.mp4', size: 1024 })

      const realDeleteVideo = storageModule.deleteVideo
      vi.spyOn(storageModule, 'deleteVideo').mockImplementation(async (id: string) => {
        if (id === 'unused2') throw new Error('disk full')
        return realDeleteVideo(id)
      })
      const estimate = vi.fn(() => Promise.resolve({ usage: 50 * MB, quota: 500 * MB }))
      Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate } })

      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)
      const callsBeforeClick = estimate.mock.calls.length

      fireEvent.click(await screen.findByRole('button', { name: /Clear Unused/ }))

      // 'unused1' (deleted before the throw) is permanently removed; 'unused2'
      // (the one that threw) is left in the library, bytes intact.
      await waitFor(() => expect(store().sourceVideos.map((v) => v.id)).not.toContain('unused1'))
      expect(store().sourceVideos.map((v) => v.id)).toContain('unused2')
      await waitFor(() => expect(estimate.mock.calls.length).toBeGreaterThan(callsBeforeClick))
    })

    // ESCSUITE-149 coverage round: `if (removedIds.length > 0)
    // removeSourceVideosPermanently(removedIds)`'s false arm was unreached
    // here too. Clear Unused's loop has no per-id try/catch, so the very
    // first rejection aborts it — only one `deleteVideo` is ever actually
    // attempted — but every id handed to it rejects, so `removedIds` stays
    // empty throughout and the permanent-removal write must never run: both
    // sources stay in the store and the database, the meter still refreshes,
    // and — since no store action ran at all — the history is untouched, the
    // exact same object as before the click. (Clear Unused has no notice
    // channel of its own on failure — only `console.error` — unlike Clear
    // All's counted notice.)
    //
    // Spies directly on the store action rather than only on its
    // consequences: `removeSourceVideosPermanently([])` is itself a no-op
    // (its own `ids.length === 0` guard), so "the library is unchanged"
    // alone cannot tell "never called" apart from "called with nothing to
    // do" — only `not.toHaveBeenCalled()` can.
    it('does not call removeSourceVideosPermanently when every delete in the batch rejects', async () => {
      await storeVideo('unused1', new Blob(['bytes']), { ...videoMeta, id: 'unused1' })
      store().addSourceVideo({ ...videoMeta, id: 'unused1', name: 'one.mp4', size: 1024 })
      await storeVideo('unused2', new Blob(['bytes']), { ...videoMeta, id: 'unused2' })
      store().addSourceVideo({ ...videoMeta, id: 'unused2', name: 'two.mp4', size: 1024 })

      vi.spyOn(storageModule, 'deleteVideo').mockRejectedValue(new Error('disk full'))
      const estimate = vi.fn(() => Promise.resolve({ usage: 50 * MB, quota: 500 * MB }))
      Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate } })
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const removeSourceVideosPermanently = vi.spyOn(useEditorStore.getState(), 'removeSourceVideosPermanently')

      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)
      const callsBeforeClick = estimate.mock.calls.length
      const historyBefore = useEditorStore.getState().history

      fireEvent.click(await screen.findByRole('button', { name: /Clear Unused/ }))

      await waitFor(() => expect(consoleError).toHaveBeenCalled())
      expect(removeSourceVideosPermanently).not.toHaveBeenCalled()
      expect(store().sourceVideos.map((v) => v.id).sort()).toEqual(['unused1', 'unused2'])
      const remainingIds = (await getAllVideoMetadata()).map((v) => v.id)
      expect(remainingIds).toContain('unused1')
      expect(remainingIds).toContain('unused2')
      await waitFor(() => expect(estimate.mock.calls.length).toBeGreaterThan(callsBeforeClick))
      expect(useEditorStore.getState().history).toBe(historyBefore)
    })

    // ESCSUITE-149: Clear Unused is as non-undoable as Clear All, and —
    // "unused" meaning no clip refers to it — can never remove a clip. The
    // final assertion is that invariant: the clip the library started with
    // is still exactly what it was.
    it('is not undoable: undo after Clear Unused does not restore the source, and removes no clips', async () => {
      await storeVideo('unused', new Blob(['bytes']), { ...videoMeta, id: 'unused' })
      store().addSourceVideo(videoMeta)
      store().addSourceVideo({ ...videoMeta, id: 'unused', name: 'spare.mp4', size: 2048 })
      const usedClip = addClip('clip1', 0, 2) // references video1
      const pastLengthBeforeClear = useEditorStore.getState().history.past.length
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

      fireEvent.click(await screen.findByRole('button', { name: 'Clear Unused (2.0 KB)' }))

      await waitFor(() => expect(store().sourceVideos.map((v) => v.id)).toEqual(['video1']))
      expect(store().project.timeline.clips).toEqual([usedClip])
      expect(useEditorStore.getState().history.past).toHaveLength(pastLengthBeforeClear)
      expect(useEditorStore.getState().canUndo()).toBe(true)

      useEditorStore.getState().undo()

      expect(useEditorStore.getState().sourceVideos.map((v) => v.id)).not.toContain('unused')
    })

    it('hides the clear-unused button when every source is in use', async () => {
      store().addSourceVideo(videoMeta)
      addClip('clip1', 0, 2)
      render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

      await screen.findByText('50.0 MB / 500.0 MB')
      expect(screen.queryByRole('button', { name: /Clear Unused/ })).not.toBeInTheDocument()
    })

    // ESCSUITE-307: the autosave never writes an empty project over this tab's
    // slot (ESCSUITE-227), so a clear that empties the project used to leave
    // the last snapshot that still held the cleared sources — and a reload
    // offered them back, tiles whose bytes this clear had deleted. A clear that
    // leaves nothing at all empties the slot itself; one that leaves anything
    // leaves the slot alone.
    describe('the saved session slot (ESCSUITE-307)', () => {
      it('Clear All on a project of only its own sources empties the slot, once', async () => {
        await storeVideo('video1', new Blob(['bytes']), videoMeta)
        store().addSourceVideo(videoMeta)
        addClip('clip1', 0, 4)
        render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

        fireEvent.click(await screen.findByRole('button', { name: 'Clear All' }))

        await waitFor(() => expect(store().sourceVideos).toHaveLength(0))
        expect(store().project.timeline.clips).toHaveLength(0)
        expect(clearSession).toHaveBeenCalledTimes(1)
      })

      it('Clear All that leaves a source on a locked track leaves the slot alone', async () => {
        await storeVideo('video1', new Blob(['bytes']), videoMeta)
        store().addSourceVideo(videoMeta)
        const clip = addClip('clip1', 0, 4)
        store().updateTrack(clip.trackId, { locked: true })
        await storeVideo('video2', new Blob(['bytes']), { ...videoMeta, id: 'video2', name: 'other.mp4' })
        store().addSourceVideo({ ...videoMeta, id: 'video2', name: 'other.mp4' })
        render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

        fireEvent.click(await screen.findByRole('button', { name: 'Clear All' }))

        await waitFor(() => expect(store().sourceVideos.map((v) => v.id)).toEqual(['video1']))
        expect(clearSession).not.toHaveBeenCalled()
      })

      it('Clear All that leaves a text clip leaves the slot alone: a clip with no source is still work', async () => {
        await storeVideo('video1', new Blob(['bytes']), videoMeta)
        store().addSourceVideo(videoMeta)
        store().addTextOverlayClip()
        render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

        fireEvent.click(await screen.findByRole('button', { name: 'Clear All' }))

        await waitFor(() => expect(store().sourceVideos).toHaveLength(0))
        expect(store().project.timeline.clips).toHaveLength(1)
        expect(clearSession).not.toHaveBeenCalled()
      })

      it('Clear Unused that leaves a used source leaves the slot alone', async () => {
        await storeVideo('unused', new Blob(['bytes']), { ...videoMeta, id: 'unused' })
        store().addSourceVideo(videoMeta)
        store().addSourceVideo({ ...videoMeta, id: 'unused', name: 'spare.mp4', size: 2048 })
        addClip('clip1', 0, 2) // references video1
        render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

        fireEvent.click(await screen.findByRole('button', { name: 'Clear Unused (2.0 KB)' }))

        await waitFor(() => expect(store().sourceVideos.map((v) => v.id)).toEqual(['video1']))
        expect(clearSession).not.toHaveBeenCalled()
      })

      it('Clear Unused that takes every source of a clipless project empties the slot', async () => {
        await storeVideo('video1', new Blob(['bytes']), videoMeta)
        store().addSourceVideo(videoMeta)
        render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)

        fireEvent.click(await screen.findByRole('button', { name: /Clear Unused/ }))

        await waitFor(() => expect(store().sourceVideos).toHaveLength(0))
        expect(clearSession).toHaveBeenCalledTimes(1)
      })
    })
  })
  // ESCSUITE-268: ESCSUITE-244 stopped an undone import orphaning its bytes,
  // but rows orphaned before it are still in the shared `video-editor-db`,
  // listed by neither app. The uploader offers them — on a click, never on
  // load — as "files from earlier sessions": every stored row minus what this
  // editor references (the live library and every undo/redo snapshot) minus
  // everything ESCAPECRAFT owns (a recording, and any row sharing a
  // recording's take).
  describe('files from earlier sessions (ESCSUITE-268)', () => {
    /** Store a row's bytes and thumbnail the way an import would, without telling the store. */
    async function seedStored(id: string, extra: Partial<SourceVideo> = {}): Promise<void> {
      await storeVideo(id, new Blob(['bytes']), { ...videoMeta, id, name: `${id}.mp4`, size: MB, ...extra })
      await storeThumbnail(id, new Blob(['thumb']))
    }

    function renderUploader(): ReturnType<typeof render> {
      return render(<VideoUploader onProjectFile={onProjectFile} showNotification={showNotification} clearSession={clearSession} />)
    }

    /** Its accessible name says what it removes (review L4), not a bare "Remove". */
    const removeButton = (n: number) =>
      screen.findByRole('button', { name: `Remove ${n} file${n !== 1 ? 's' : ''} from earlier sessions` })

    /** An autosaved session that has not been restored — the `?suppressRestore=1` shape. */
    async function saveSessionHolding(sources: SourceVideo[]): Promise<void> {
      await saveSessionState({
        tabId: 'earlier-tab',
        project: store().project,
        sourceVideos: sources,
        currentTime: 0,
        selectedClipId: null,
        zoom: 1,
        timestamp: 1,
      })
    }

    beforeEach(async () => {
      // Rows from earlier describes accumulate in the real fake-indexeddb (no
      // per-test reset), and every one of them would count as an orphan here.
      for (const row of await getAllVideoMetadata()) await storageModule.deleteVideo(row.id)
      await clearSessionState('earlier-tab')
    })

    afterEach(async () => {
      vi.restoreAllMocks()
      await clearSessionState('earlier-tab')
    })

    it('offers an import nothing references, and removes its bytes and thumbnail only when clicked', async () => {
      await seedStored('old', { size: 3 * MB })
      store().addSourceVideo(videoMeta)
      const historyBefore = useEditorStore.getState().history
      renderUploader()

      expect(await screen.findByText('1 file from earlier sessions (3.0 MB)')).toBeInTheDocument()
      // Never on load: listing it deleted nothing.
      expect((await getAllVideoMetadata()).map((v) => v.id)).toContain('old')

      fireEvent.click(await removeButton(1))

      expect(globalThis.confirm).toHaveBeenCalledWith(
        'Remove 1 file imported in earlier sessions (3.0 MB)? Another open editor tab could still be using them.'
      )
      await waitFor(() => expect(screen.queryByText(/from earlier sessions/)).not.toBeInTheDocument())
      expect((await getAllVideoMetadata()).map((v) => v.id)).not.toContain('old')
      expect(await getThumbnail('old')).toBeUndefined()
      // Not an edit: the project and the history are untouched.
      expect(store().sourceVideos.map((v) => v.id)).toEqual(['video1'])
      expect(useEditorStore.getState().history).toBe(historyBefore)
      expect(showNotification).not.toHaveBeenCalled()
    })

    it('keeps everything when the confirmation is declined', async () => {
      vi.mocked(globalThis.confirm).mockReturnValue(false)
      await seedStored('old')
      renderUploader()

      fireEvent.click(await removeButton(1))

      await waitFor(() => expect(globalThis.confirm).toHaveBeenCalledTimes(1))
      expect((await getAllVideoMetadata()).map((v) => v.id)).toContain('old')
      expect(screen.getByText('1 file from earlier sessions (1.0 MB)')).toBeInTheDocument()
    })

    it('never offers an ESCAPECRAFT recording, however old', async () => {
      await seedStored('craft-take', { source: 'recording' })
      await seedStored('old')
      renderUploader()

      expect(await screen.findByText('1 file from earlier sessions (1.0 MB)')).toBeInTheDocument()
      fireEvent.click(await removeButton(1))

      await waitFor(() => expect(screen.queryByText(/from earlier sessions/)).not.toBeInTheDocument())
      const remainingIds = (await getAllVideoMetadata()).map((v) => v.id)
      expect(remainingIds).toContain('craft-take')
      expect(remainingIds).not.toContain('old')
      expect(await getThumbnail('craft-take')).toBeDefined()
    })

    it("never offers a row sharing a recording's take (a companion)", async () => {
      await seedStored('primary', { source: 'recording', takeId: 'primary' })
      await seedStored('companion', { takeId: 'primary', role: 'webcam' })
      await seedStored('old')
      renderUploader()

      expect(await screen.findByText('1 file from earlier sessions (1.0 MB)')).toBeInTheDocument()
      fireEvent.click(await removeButton(1))

      await waitFor(() => expect(screen.queryByText(/from earlier sessions/)).not.toBeInTheDocument())
      expect((await getAllVideoMetadata()).map((v) => v.id)).toContain('companion')
    })

    it('never offers a row this project references', async () => {
      await seedStored('video1')
      store().addSourceVideo(videoMeta)
      await seedStored('old')
      renderUploader()

      expect(await screen.findByText('1 file from earlier sessions (1.0 MB)')).toBeInTheDocument()
      fireEvent.click(await removeButton(1))

      await waitFor(() => expect(screen.queryByText(/from earlier sessions/)).not.toBeInTheDocument())
      expect((await getAllVideoMetadata()).map((v) => v.id)).toContain('video1')
    })

    // New Project is an undoable edit: the project it replaced lives on in
    // `history.past`, and undo hands its sources back — so their bytes are
    // still referenced, by this editor, even though the live library is empty.
    it('never offers a row only an undo snapshot still references', async () => {
      await seedStored('video1')
      store().addSourceVideo(videoMeta)
      store().resetProject()
      await seedStored('old')
      renderUploader()

      expect(await screen.findByText('1 file from earlier sessions (1.0 MB)')).toBeInTheDocument()
      fireEvent.click(await removeButton(1))

      await waitFor(() => expect(screen.queryByText(/from earlier sessions/)).not.toBeInTheDocument())
      expect((await getAllVideoMetadata()).map((v) => v.id)).toContain('video1')
      useEditorStore.getState().undo()
      expect(store().sourceVideos.map((v) => v.id)).toEqual(['video1'])
    })

    it('stops offering a row the project claims after the list was read (a session restore landing)', async () => {
      await seedStored('restored')
      renderUploader()
      expect(await screen.findByText('1 file from earlier sessions (1.0 MB)')).toBeInTheDocument()

      act(() => store().addSourceVideo({ ...videoMeta, id: 'restored', name: 'restored.mp4' }))
      expect(screen.queryByText(/from earlier sessions/)).not.toBeInTheDocument()

      // And stays withdrawn once the project lets go of it again (the per-item
      // Remove deletes the bytes before it does that), until the next read.
      act(() => store().removeSourceVideosPermanently(['restored']))
      expect(screen.queryByText(/from earlier sessions/)).not.toBeInTheDocument()
    })

    it('spares a row the project claims while the removal is in flight', async () => {
      await seedStored('a')
      await seedStored('b')
      const realDeleteVideo = storageModule.deleteVideo
      vi.spyOn(storageModule, 'deleteVideo').mockImplementation(async (id: string) => {
        if (id === 'a') store().addSourceVideo({ ...videoMeta, id: 'b', name: 'b.mp4' })
        return realDeleteVideo(id)
      })
      renderUploader()

      fireEvent.click(await removeButton(2))

      await waitFor(() => expect(screen.queryByText(/from earlier sessions/)).not.toBeInTheDocument())
      const remainingIds = (await getAllVideoMetadata()).map((v) => v.id)
      expect(remainingIds).not.toContain('a')
      expect(remainingIds).toContain('b')
      expect(showNotification).not.toHaveBeenCalled()
    })

    it('removes the rest when one delete fails, and says so once', async () => {
      await seedStored('a', { size: MB })
      await seedStored('b', { size: 2 * MB })
      const realDeleteVideo = storageModule.deleteVideo
      vi.spyOn(storageModule, 'deleteVideo').mockImplementation(async (id: string) => {
        if (id === 'a') throw new Error('disk full')
        return realDeleteVideo(id)
      })
      const estimate = vi.fn(() => Promise.resolve({ usage: 50 * MB, quota: 500 * MB }))
      Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate } })
      renderUploader()

      expect(await screen.findByText('2 files from earlier sessions (3.0 MB)')).toBeInTheDocument()
      const callsBeforeClick = estimate.mock.calls.length
      fireEvent.click(await removeButton(2))

      expect(globalThis.confirm).toHaveBeenCalledWith(
        'Remove 2 files imported in earlier sessions (3.0 MB)? Another open editor tab could still be using them.'
      )
      // The list is read again afterwards: only the one that failed is left.
      expect(await screen.findByText('1 file from earlier sessions (1.0 MB)')).toBeInTheDocument()
      expect(showNotification).toHaveBeenCalledTimes(1)
      expect(showNotification).toHaveBeenCalledWith('Could not remove 1 file from storage', 'error')
      const remainingIds = (await getAllVideoMetadata()).map((v) => v.id)
      expect(remainingIds).toContain('a')
      expect(remainingIds).not.toContain('b')
      await waitFor(() => expect(estimate.mock.calls.length).toBeGreaterThan(callsBeforeClick))
    })

    it('reads the list again after Clear Unused', async () => {
      await seedStored('unused')
      store().addSourceVideo({ ...videoMeta, id: 'unused', name: 'unused.mp4' })
      const read = vi.spyOn(storageModule, 'getAllVideoMetadata')
      renderUploader()
      const clearUnused = await screen.findByRole('button', { name: /Clear Unused/ })
      await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
      await act(async () => { await read.mock.results[0].value })
      // Written after the mount read landed: only a fresh read can see it.
      await seedStored('old')

      fireEvent.click(clearUnused)

      expect(await screen.findByText('1 file from earlier sessions (1.0 MB)')).toBeInTheDocument()
    })

    it('reads the list again after Clear All', async () => {
      await seedStored('video1')
      store().addSourceVideo(videoMeta)
      const read = vi.spyOn(storageModule, 'getAllVideoMetadata')
      renderUploader()
      const clearAll = await screen.findByRole('button', { name: 'Clear All' })
      await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
      await act(async () => { await read.mock.results[0].value })
      await seedStored('old')

      fireEvent.click(clearAll)

      expect(await screen.findByText('1 file from earlier sessions (1.0 MB)')).toBeInTheDocument()
      expect((await getAllVideoMetadata()).map((v) => v.id)).not.toContain('video1')
    })

    it('reads the list once per mount, not once per render', async () => {
      await seedStored('old')
      const read = vi.spyOn(storageModule, 'getAllVideoMetadata')
      renderUploader()
      expect(await screen.findByText('1 file from earlier sessions (1.0 MB)')).toBeInTheDocument()

      fireEvent.dragOver(dropZone())
      fireEvent.dragLeave(dropZone())
      act(() => store().addSourceVideo(videoMeta))
      act(() => store().setCurrentTime(1))
      await act(async () => {})

      expect(read).toHaveBeenCalledTimes(1)
    })

    // Review M1: the autosaved session slot is a reference the app keeps on
    // purpose while the live project does not hold its sources — under
    // `?suppressRestore=1`, or after a restore that failed — and its next
    // restore needs those bytes. No other tab is open, so the confirm's warning
    // would not even be true.
    it('never offers a row the saved session references', async () => {
      await seedStored('saved')
      await saveSessionHolding([{ ...videoMeta, id: 'saved', name: 'saved.mp4' }])
      await seedStored('old')
      renderUploader()

      expect(await screen.findByText('1 file from earlier sessions (1.0 MB)')).toBeInTheDocument()
      fireEvent.click(await removeButton(1))

      await waitFor(() => expect(screen.queryByText(/from earlier sessions/)).not.toBeInTheDocument())
      const remainingIds = (await getAllVideoMetadata()).map((v) => v.id)
      expect(remainingIds).toContain('saved')
      expect(remainingIds).not.toContain('old')
    })

    it('offers the row when the saved session is empty', async () => {
      await seedStored('old')
      await saveSessionHolding([])
      renderUploader()

      expect(await screen.findByText('1 file from earlier sessions (1.0 MB)')).toBeInTheDocument()
    })

    it('offers the row when there is no saved session at all', async () => {
      await seedStored('old')
      renderUploader()

      expect(await screen.findByText('1 file from earlier sessions (1.0 MB)')).toBeInTheDocument()
    })

    it('spares a row the saved session takes up while the removal is in flight (an autosave landing)', async () => {
      await seedStored('a')
      await seedStored('b')
      const realDeleteVideo = storageModule.deleteVideo
      vi.spyOn(storageModule, 'deleteVideo').mockImplementation(async (id: string) => {
        if (id === 'a') await saveSessionHolding([{ ...videoMeta, id: 'b', name: 'b.mp4' }])
        return realDeleteVideo(id)
      })
      renderUploader()

      fireEvent.click(await removeButton(2))

      await waitFor(() => expect(screen.queryByText(/from earlier sessions/)).not.toBeInTheDocument())
      const remainingIds = (await getAllVideoMetadata()).map((v) => v.id)
      expect(remainingIds).not.toContain('a')
      expect(remainingIds).toContain('b')
    })

    // Review L3: a second click while the first removal is still awaiting
    // must not ask again or run a second loop over the same ids.
    it('ignores a second click while a removal is in flight', async () => {
      await seedStored('a')
      await seedStored('b')
      const realDeleteVideo = storageModule.deleteVideo
      let release!: () => void
      const parked = new Promise<void>((resolve) => { release = resolve })
      const deletes = vi.spyOn(storageModule, 'deleteVideo').mockImplementation(async (id: string) => {
        if (id === 'a') await parked
        return realDeleteVideo(id)
      })
      renderUploader()
      const button = await removeButton(2)

      fireEvent.click(button)
      await waitFor(() => expect(deletes).toHaveBeenCalledTimes(1))
      fireEvent.click(button)
      // Stored while the first removal is parked, so the re-read it ends with lists it.
      await seedStored('c')
      await act(async () => { release() })

      expect(await screen.findByText('1 file from earlier sessions (1.0 MB)')).toBeInTheDocument()
      expect(globalThis.confirm).toHaveBeenCalledTimes(1)
      expect(deletes.mock.calls.map(([id]) => id)).toEqual(['a', 'b'])

      // And the guard is released afterwards: the next list can be removed.
      fireEvent.click(await removeButton(1))
      await waitFor(() => expect(screen.queryByText(/from earlier sessions/)).not.toBeInTheDocument())
      expect(globalThis.confirm).toHaveBeenCalledTimes(2)
      expect((await getAllVideoMetadata()).map((v) => v.id)).not.toContain('c')
    })

    it('shows nothing, and does not throw, when the stored rows cannot be read', async () => {
      await seedStored('old')
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.spyOn(storageModule, 'getAllVideoMetadata').mockRejectedValue(new Error('db closed'))
      renderUploader()

      await screen.findByText('50.0 MB / 500.0 MB')
      await waitFor(() => expect(error).toHaveBeenCalledWith('Failed to read stored files:', expect.any(Error)))
      expect(screen.queryByText(/from earlier sessions/)).not.toBeInTheDocument()
    })
  })

})

describe('VideoLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStoreForTest()
    store().removeSourceVideosPermanently(['video1'])
    // The quiet case: nothing stored to rebuild from, so the lazy rebuild
    // (ESCSUITE-117) reads once per thumbnail-less source and sets nothing.
    mockResolveThumbnailUrl.mockReset()
    mockResolveThumbnailUrl.mockResolvedValue(undefined)
    vi.stubGlobal('confirm', vi.fn(() => true))
  })

  it('shows an empty state when nothing has been imported', () => {
    render(<VideoLibrary clearSession={clearSession} />)

    expect(screen.getByText('No media uploaded yet')).toBeInTheDocument()
  })

  it('counts one item and many items', () => {
    store().addSourceVideo(videoMeta)
    const { rerender } = render(<VideoLibrary clearSession={clearSession} />)
    expect(screen.getByText('1 item')).toBeInTheDocument()

    act(() => {
      store().addSourceVideo({ ...videoMeta, id: 'video2', name: 'second.mp4' })
    })
    rerender(<VideoLibrary clearSession={clearSession} />)

    expect(screen.getByText('2 items')).toBeInTheDocument()
  })

  it('describes a video by duration, dimensions and size', () => {
    store().addSourceVideo({ ...videoMeta, name: 'My Test Video.mp4', duration: 65 })

    render(<VideoLibrary clearSession={clearSession} />)

    expect(screen.getByText('My Test Video.mp4')).toBeInTheDocument()
    expect(screen.getByText('1:05 · 1920x1080 · 976.6 KB')).toBeInTheDocument()
  })

  it('describes an image without a duration', () => {
    store().addSourceVideo(imageMeta)

    render(<VideoLibrary clearSession={clearSession} />)

    expect(screen.getByText('Image · 800x600 · 976.6 KB')).toBeInTheDocument()
    expect(screen.getByText('IMG')).toBeInTheDocument()
  })

  it('describes audio without dimensions', () => {
    store().addSourceVideo(audioMeta)

    render(<VideoLibrary clearSession={clearSession} />)

    expect(screen.getByText('2:00 · 976.6 KB')).toBeInTheDocument()
    expect(screen.getByText('AUD')).toBeInTheDocument()
  })

  it('shows the thumbnail when one was generated', () => {
    store().addSourceVideo({ ...videoMeta, thumbnailUrl: 'blob:thumb' })

    render(<VideoLibrary clearSession={clearSession} />)

    const img = screen.getByAltText('test.mp4') as HTMLImageElement
    expect(img.src).toContain('blob:thumb')
  })

  it('adds a video to the timeline at its native scale', () => {
    store().addSourceVideo(videoMeta)
    render(<VideoLibrary clearSession={clearSession} />)

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
    render(<VideoLibrary clearSession={clearSession} />)

    fireEvent.click(screen.getByTitle('Add to timeline'))

    const clip = store().project.timeline.clips[0]
    expect(clip.duration).toBe(DEFAULT_IMAGE_DURATION)
    expect(clip.duration).not.toBe(imageMeta.duration)
    expect(clip.endTime).toBe(DEFAULT_IMAGE_DURATION)
  })

  it('removes a video once confirmed', async () => {
    await storeVideo('video1', new Blob(['bytes']), videoMeta)
    store().addSourceVideo(videoMeta)
    render(<VideoLibrary clearSession={clearSession} />)

    fireEvent.click(screen.getByTitle('Remove media'))

    await waitFor(() => expect(store().sourceVideos).toHaveLength(0))
    expect((await getAllVideoMetadata()).map((v) => v.id)).not.toContain('video1')
  })

  // ESCSUITE-84: removing media takes every clip that uses it, so a clip on a
  // locked track makes its media un-removable. This pins the *disabled
  // button* only — since ESCSUITE-154 deleted the store's own refusal, the
  // handler's `lockedMedia.has(id)` guard ahead of `deleteVideo` is a
  // belt-and-braces check behind this button, not a store-level refusal, and
  // is unreachable from here while the button stays disabled.
  it('refuses to remove media a clip on a locked track uses', async () => {
    await storeVideo('video1', new Blob(['bytes']), videoMeta)
    store().addSourceVideo(videoMeta)
    const clip = addClip('clip1', 0, 4)
    store().updateTrack(clip.trackId, { locked: true })
    render(<VideoLibrary clearSession={clearSession} />)

    const button = screen.getByTitle('Used by a clip on a locked track')
    expect(button).toBeDisabled()
    expect(screen.queryByTitle('Remove media')).not.toBeInTheDocument()
  })

  // ESCSUITE-154 review, MINOR 3: the button being enabled is not the same as
  // a removal actually landing — this also proves one does, with an
  // unrelated track locked, now that the deleted `removeSourceVideo`'s own
  // "still removes a source video only unlocked clips use" no longer exists
  // to pin that at the store level.
  it('still offers to remove media only unlocked clips use, and the removal lands with an unrelated track locked', async () => {
    await storeVideo('video1', new Blob(['bytes']), videoMeta)
    store().addSourceVideo(videoMeta)
    const clip = addClip('clip1', 0, 4)
    store().updateTrack(clip.trackId, { locked: false })
    const otherTrack = store().addTrack('Other')
    store().updateTrack(otherTrack.id, { locked: true })
    render(<VideoLibrary clearSession={clearSession} />)

    expect(screen.getByTitle('Remove media')).toBeEnabled()

    fireEvent.click(screen.getByTitle('Remove media'))

    await waitFor(() => expect(store().sourceVideos).toHaveLength(0))
  })

  it('keeps the video when the confirmation is declined', async () => {
    vi.mocked(globalThis.confirm).mockReturnValue(false)
    await storeVideo('video1', new Blob(['bytes']), videoMeta)
    store().addSourceVideo(videoMeta)
    render(<VideoLibrary clearSession={clearSession} />)

    fireEvent.click(screen.getByTitle('Remove media'))

    await waitFor(() => expect(globalThis.confirm).toHaveBeenCalledTimes(1))
    expect(useEditorStore.getState().sourceVideos).toHaveLength(1)
    expect((await getAllVideoMetadata()).map((v) => v.id)).toContain('video1')
  })

  // ESCSUITE-154: Remove deletes the bytes the same way Clear Unused and
  // Clear All already do (ESCSUITE-149), so it must not be undoable either —
  // an undo that handed a `SourceVideo` back afterwards would restore a tile
  // nothing can play, place or export again.
  it('is not undoable: undo after Remove brings back neither the source nor its bytes', async () => {
    await storeVideo('video1', new Blob(['bytes']), videoMeta)
    store().addSourceVideo(videoMeta)
    // An add records nothing (ESCSUITE-244); an edit gives the stack something
    // for canUndo() to report.
    store().setProjectResolution(1280, 720)
    const pastLengthBeforeRemove = useEditorStore.getState().history.past.length
    render(<VideoLibrary clearSession={clearSession} />)

    fireEvent.click(screen.getByTitle('Remove media'))

    await waitFor(() => expect(store().sourceVideos).toHaveLength(0))
    // No new undo entry: canUndo() reflects the history exactly as it stood
    // before the removal.
    expect(useEditorStore.getState().history.past).toHaveLength(pastLengthBeforeRemove)
    expect(useEditorStore.getState().canUndo()).toBe(true)

    useEditorStore.getState().undo()

    expect(useEditorStore.getState().sourceVideos.map((v) => v.id)).not.toContain('video1')
    expect(await getVideoBlob('video1')).toBeUndefined()
  })

  // The headline case from the ESCSUITE-149 review: a tile with a clip on the
  // timeline. The clip goes with it, the selection is pruned, and undo
  // restores neither.
  it('removing a video with a clip on the timeline removes the clip and prunes the selection, and undo restores neither', async () => {
    await storeVideo('video1', new Blob(['bytes']), videoMeta)
    store().addSourceVideo(videoMeta)
    addClip('clip1', 0, 4)
    useEditorStore.getState().setSelectedClipId('clip1')
    render(<VideoLibrary clearSession={clearSession} />)

    fireEvent.click(screen.getByTitle('Remove media'))

    await waitFor(() => expect(store().sourceVideos).toHaveLength(0))
    expect(store().project.timeline.clips).toHaveLength(0)
    expect(useEditorStore.getState().selectedClipId).toBeNull()

    useEditorStore.getState().undo()

    expect(useEditorStore.getState().sourceVideos.map((v) => v.id)).not.toContain('video1')
    expect(
      useEditorStore.getState().project.timeline.clips.some((c) => c.sourceVideoId === 'video1')
    ).toBe(false)
  })

  // ESCSUITE-154: the confirm copy says how many clips go with it, so the
  // single-item Remove reads the same way Clear All's own clause does.
  //
  // Each case awaits the removal through to completion (`handleRemoveVideo`
  // is async, and confirm defaults to true) rather than leaving the click's
  // promise chain to land during a later test.
  it('asks a plain question when nothing on the timeline uses it', async () => {
    store().addSourceVideo(videoMeta)
    render(<VideoLibrary clearSession={clearSession} />)

    fireEvent.click(screen.getByTitle('Remove media'))

    expect(globalThis.confirm).toHaveBeenCalledWith('Remove this video?')
    await waitFor(() => expect(store().sourceVideos).toHaveLength(0))
  })

  // ESCSUITE-307: the per-item Remove empties this tab's saved session slot
  // when it takes the project's last source and last clip, the way Clear All
  // and Clear Unused do — and leaves it alone otherwise.
  it('removing the last source, whose clip was the last clip, empties the saved session slot', async () => {
    await storeVideo('video1', new Blob(['bytes']), videoMeta)
    store().addSourceVideo(videoMeta)
    addClip('clip1', 0, 4)
    render(<VideoLibrary clearSession={clearSession} />)

    fireEvent.click(screen.getByTitle('Remove media'))

    await waitFor(() => expect(store().sourceVideos).toHaveLength(0))
    expect(store().project.timeline.clips).toHaveLength(0)
    expect(clearSession).toHaveBeenCalledTimes(1)
  })

  it('removing one source while another stays leaves the saved session slot alone', async () => {
    store().addSourceVideo(videoMeta)
    store().addSourceVideo({ ...videoMeta, id: 'video2', name: 'second.mp4' })
    render(<VideoLibrary clearSession={clearSession} />)

    fireEvent.click(screen.getAllByTitle('Remove media')[0])

    await waitFor(() => expect(store().sourceVideos.map((v) => v.id)).toEqual(['video2']))
    expect(clearSession).not.toHaveBeenCalled()
  })

  it('a Remove whose delete rejects leaves the saved session slot alone', async () => {
    store().addSourceVideo(videoMeta)
    vi.spyOn(storageModule, 'deleteVideo').mockRejectedValueOnce(new Error('disk full'))
    render(<VideoLibrary clearSession={clearSession} />)

    fireEvent.click(screen.getByTitle('Remove media'))

    await waitFor(() => expect(storageModule.deleteVideo).toHaveBeenCalledWith('video1'))
    expect(store().sourceVideos).toHaveLength(1)
    expect(clearSession).not.toHaveBeenCalled()
    vi.mocked(storageModule.deleteVideo).mockRestore()
  })

  it('says one clip, singular, when exactly one clip uses it', async () => {
    store().addSourceVideo(videoMeta)
    addClip('clip1', 0, 4)
    render(<VideoLibrary clearSession={clearSession} />)

    fireEvent.click(screen.getByTitle('Remove media'))

    expect(globalThis.confirm).toHaveBeenCalledWith(
      'Remove this video? This will also remove 1 clip that uses it.'
    )
    await waitFor(() => expect(store().sourceVideos).toHaveLength(0))
  })

  it('says how many clips, plural, when more than one clip uses it', async () => {
    store().addSourceVideo(videoMeta)
    addClip('clip1', 0, 4)
    addClip('clip2', 4, 2)
    render(<VideoLibrary clearSession={clearSession} />)

    fireEvent.click(screen.getByTitle('Remove media'))

    expect(globalThis.confirm).toHaveBeenCalledWith(
      'Remove this video? This will also remove 2 clips that use it.'
    )
    await waitFor(() => expect(store().sourceVideos).toHaveLength(0))
  })

  // ESCSUITE-154: the previous behaviour called `removeSourceVideo`
  // regardless of whether `deleteVideo` actually succeeded. Routed through
  // `removeSourceVideosPermanently` instead, a failed delete must not drop
  // the tile from the store — the same shape as Clear Unused and Clear All,
  // which only ever hand over the ids whose bytes are confirmed gone.
  // No `showNotification` prop at all — this is the no-prop arm (ESCSUITE-154
  // review, MINOR 1): the optional call must not throw when the caller never
  // passed one.
  it('leaves the tile in place when deleteVideo rejects', async () => {
    await storeVideo('video1', new Blob(['bytes']), videoMeta)
    store().addSourceVideo(videoMeta)
    vi.spyOn(storageModule, 'deleteVideo').mockRejectedValueOnce(new Error('disk full'))
    const removeSourceVideosPermanently = vi.spyOn(useEditorStore.getState(), 'removeSourceVideosPermanently')
    render(<VideoLibrary clearSession={clearSession} />)

    fireEvent.click(screen.getByTitle('Remove media'))

    await waitFor(() => expect(storageModule.deleteVideo).toHaveBeenCalledWith('video1'))
    expect(removeSourceVideosPermanently).not.toHaveBeenCalled()
    expect(useEditorStore.getState().sourceVideos.map((v) => v.id)).toContain('video1')
    removeSourceVideosPermanently.mockRestore()
    vi.mocked(storageModule.deleteVideo).mockRestore()
  })

  // ESCSUITE-154 review, MINOR 1: before this, a failed delete left the tile
  // in place (good) but told the user nothing beyond a `console.error` — the
  // natural response is clicking Remove again and failing again in silence.
  // The other arm (the case above) proves the call is optional; this one
  // proves it actually fires, with the right message and type, when a caller
  // does pass it.
  it('tells the caller when deleteVideo rejects', async () => {
    await storeVideo('video1', new Blob(['bytes']), videoMeta)
    store().addSourceVideo(videoMeta)
    vi.spyOn(storageModule, 'deleteVideo').mockRejectedValueOnce(new Error('disk full'))
    const onNotification = vi.fn()
    render(<VideoLibrary showNotification={onNotification} clearSession={clearSession} />)

    fireEvent.click(screen.getByTitle('Remove media'))

    await waitFor(() => expect(storageModule.deleteVideo).toHaveBeenCalledWith('video1'))
    expect(onNotification).toHaveBeenCalledWith("Couldn't remove that file from storage.", 'error')
    vi.mocked(storageModule.deleteVideo).mockRestore()
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

      render(<VideoLibrary clearSession={clearSession} />)

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

      render(<VideoLibrary clearSession={clearSession} />)

      await waitFor(() => expect(screen.getByAltText('test.mp4')).toBeInTheDocument())
      expect(mockResolveThumbnailUrl).not.toHaveBeenCalled()
      expect(store().sourceVideos[0].thumbnailUrl).toBe('blob:already-live')
    })

    it('sets nothing and frees nothing when no thumbnail is stored for it', async () => {
      store().addSourceVideo(videoMeta)
      const revokesBefore = vi.mocked(URL.revokeObjectURL).mock.calls.length

      render(<VideoLibrary clearSession={clearSession} />)

      await waitFor(() => expect(mockResolveThumbnailUrl).toHaveBeenCalledWith('video1'))
      expect(store().sourceVideos[0].thumbnailUrl).toBeUndefined()
      expect(screen.queryByAltText('test.mp4')).not.toBeInTheDocument()
      expect(vi.mocked(URL.revokeObjectURL).mock.calls).toHaveLength(revokesBefore)
    })

    // ESCSUITE-148: an audio source (the ESCSUITE-14 companions, and since
    // ESCSUITE-143 a microphone-only take's own primary) never had a picture to
    // begin with — its missing `thumbnailUrl` is not damage ESCSUITE-113 undid,
    // so there is nothing to rebuild and no reason to cost it a storage read.
    it('never asks storage to rebuild a thumbnail for an audio source', async () => {
      store().addSourceVideo(videoMeta)
      store().addSourceVideo(audioMeta)

      render(<VideoLibrary clearSession={clearSession} />)

      await waitFor(() => expect(mockResolveThumbnailUrl).toHaveBeenCalledWith('video1'))
      expect(mockResolveThumbnailUrl).not.toHaveBeenCalledWith('audio1')
    })

    it('frees the handle it minted when the source left the library before the read landed', async () => {
      const land = parkedReads()
      store().addSourceVideo(videoMeta)
      const setSourceThumbnail = vi.spyOn(useEditorStore.getState(), 'setSourceThumbnail')
      render(<VideoLibrary clearSession={clearSession} />)
      await waitFor(() => expect(mockResolveThumbnailUrl).toHaveBeenCalledWith('video1'))

      act(() => { store().removeSourceVideosPermanently(['video1']) })
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
      const { unmount } = render(<VideoLibrary clearSession={clearSession} />)
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
      const { rerender } = render(<VideoLibrary clearSession={clearSession} />)
      await waitFor(() => expect(mockResolveThumbnailUrl).toHaveBeenCalledWith('video1'))

      act(() => {
        store().addSourceVideo({ ...videoMeta, id: 'video2', name: 'second.mp4', thumbnailUrl: 'blob:second' })
      })
      rerender(<VideoLibrary clearSession={clearSession} />)

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
      render(<VideoLibrary clearSession={clearSession} />)
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
      render(<VideoLibrary clearSession={clearSession} />)
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
      render(<VideoLibrary clearSession={clearSession} />)
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

      render(<VideoLibrary clearSession={clearSession} />)

      await waitFor(() =>
        expect(consoleError).toHaveBeenCalledWith('Failed to rebuild thumbnail:', expect.any(Error))
      )
      expect(store().sourceVideos[0].thumbnailUrl).toBeUndefined()
      expect(vi.mocked(URL.revokeObjectURL).mock.calls).toHaveLength(revokesBefore)
      consoleError.mockRestore()
    })
  })
})
