import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { resetStoreForTest } from '../test/fixtures/projectStore'
import type { SourceVideo } from '../store/types'
import styles from './VideoUploader.module.css'

/**
 * ESCSUITE-468: the media library asks the browser to keep imported files
 * (`navigator.storage.persist()`) after the first import of the session, never
 * on load, and says beside the storage figure what `persisted()` answers. Its
 * own file, and a fresh copy of the modules per case, because "at most once
 * per session" is module state in the shared persistence module.
 */

const { mockProcessMediaFile } = vi.hoisted(() => ({ mockProcessMediaFile: vi.fn() }))
vi.mock('../core/videoProcessor', () => ({ processMediaFile: mockProcessMediaFile }))
vi.mock('../utils/analytics', () => ({ analytics: { videoImported: vi.fn() } }))

const PROTECTED = 'Protected from automatic clean-up'
const MAY_DELETE = 'Your browser may delete these if it runs low on space; download what you want to keep.'

const metadataOf = (file: File): SourceVideo => ({
  id: file.name,
  name: file.name,
  duration: 1,
  width: 0,
  height: 0,
  frameRate: 30,
  mimeType: file.type,
  size: file.size,
  mediaType: 'audio',
})

function selectFiles(files: File[]): void {
  const input = screen.getByLabelText('Add media files') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  fireEvent.change(input)
}

const estimate = () => Promise.resolve({ usage: 0, quota: 500 * 1024 * 1024 })

/** A Storage API whose `persist()` answers `grant`, as a browser's does. */
function installStorage(grant: () => Promise<boolean>, initiallyPersisted = false) {
  let persisted = initiallyPersisted
  const storage = {
    estimate,
    persist: vi.fn(async () => {
      const answer = await grant()
      if (answer) persisted = true
      return answer
    }),
    persisted: vi.fn(async () => persisted),
  }
  Object.defineProperty(navigator, 'storage', { configurable: true, value: storage })
  return storage
}

async function renderUploader() {
  const { VideoUploader } = await import('./VideoUploader')
  return render(<VideoUploader onProjectFile={vi.fn()} showNotification={vi.fn()} clearSession={vi.fn()} />)
}

beforeEach(() => {
  vi.resetModules()
  resetStoreForTest()
  mockProcessMediaFile.mockReset()
  mockProcessMediaFile.mockImplementation(async (file: File) => metadataOf(file))
})

describe('VideoUploader storage persistence', () => {
  it('reads the state on mount without asking, asks after the first import only, and shows the answer', async () => {
    const storage = installStorage(async () => true)
    await renderUploader()

    const line = await screen.findByText(MAY_DELETE)
    expect(line).toHaveClass(styles.storagePersistence)
    expect(line.closest(`.${styles.storageBar}`)).not.toBeNull()
    expect(storage.persist).not.toHaveBeenCalled()

    selectFiles([new File(['a'], 'one.wav', { type: 'audio/wav' })])
    expect(await screen.findByText(PROTECTED)).toBeInTheDocument()
    expect(storage.persist).toHaveBeenCalledTimes(1)

    selectFiles([new File(['b'], 'two.wav', { type: 'audio/wav' })])
    await waitFor(() => expect(mockProcessMediaFile).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(storage.persisted.mock.calls.length).toBeGreaterThanOrEqual(3))
    expect(storage.persist).toHaveBeenCalledTimes(1)
  })

  it('keeps saying the browser may delete them when it refuses', async () => {
    const storage = installStorage(async () => false)
    await renderUploader()

    selectFiles([new File(['a'], 'one.wav', { type: 'audio/wav' })])
    await waitFor(() => expect(storage.persist).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(MAY_DELETE)).toBeInTheDocument()
    expect(screen.queryByText(PROTECTED)).not.toBeInTheDocument()
  })

  it('imports as usual, and says the browser may delete them, when persist() throws', async () => {
    installStorage(() => {
      throw new TypeError('Illegal invocation')
    })
    await renderUploader()

    selectFiles([new File(['a'], 'one.wav', { type: 'audio/wav' })])
    expect(await screen.findByText('Complete')).toBeInTheDocument()
    expect(screen.getByText(MAY_DELETE)).toBeInTheDocument()
  })

  it('says the browser may delete them where there is no persistence API at all', async () => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate } })
    await renderUploader()

    expect(await screen.findByText(MAY_DELETE)).toBeInTheDocument()
    selectFiles([new File(['a'], 'one.wav', { type: 'audio/wav' })])
    expect(await screen.findByText('Complete')).toBeInTheDocument()
  })

  it('says they are protected when the browser already agreed, without asking', async () => {
    const storage = installStorage(async () => true, true)
    await renderUploader()

    expect(await screen.findByText(PROTECTED)).toBeInTheDocument()
    expect(storage.persist).not.toHaveBeenCalled()
  })

  it('does not ask when the import fails', async () => {
    const storage = installStorage(async () => true)
    mockProcessMediaFile.mockRejectedValue(new Error('cannot decode'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await renderUploader()

    selectFiles([new File(['a'], 'one.wav', { type: 'audio/wav' })])
    await waitFor(() => expect(mockProcessMediaFile).toHaveBeenCalledTimes(1))
    await screen.findByText(MAY_DELETE)
    expect(storage.persist).not.toHaveBeenCalled()
  })
})
