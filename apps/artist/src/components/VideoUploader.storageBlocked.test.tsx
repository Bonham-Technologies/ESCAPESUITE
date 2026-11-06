import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { VideoUploader } from './VideoUploader'
import { storeVideo } from '../core/storage'
import { resetStoreForTest } from '../test/fixtures/projectStore'
import type { SourceVideo } from '../store/types'

/**
 * ESCSUITE-414: a browser that will not open IndexedDB at all — Firefox with
 * site data blocked or "Never remember history", storage denied by policy or
 * to an embed. Storage runs for real; only `indexedDB.open` is made to throw,
 * the way Firefox's does. Its own file, because the real `getDB` caches an
 * open that succeeded, and `VideoUploader.test.tsx` opens the database.
 */

// The import stores the file through the real storage layer, as the real
// processors do once they have read the media; only the decoding is left out.
const { mockProcessMediaFile } = vi.hoisted(() => ({ mockProcessMediaFile: vi.fn() }))
vi.mock('../core/videoProcessor', () => ({ processMediaFile: mockProcessMediaFile }))
vi.mock('../utils/analytics', () => ({ analytics: { videoImported: vi.fn() } }))

const NOTICE =
  'Your media library could not be opened — storage may be blocked in this browser. Allow this site to store data, then reload.'
const IMPORT_ROW =
  'Storage is blocked in this browser, so this file could not be imported. Allow this site to store data, then reload.'

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

let blockStorage = true

beforeEach(() => {
  resetStoreForTest()
  blockStorage = true
  const open = indexedDB.open.bind(indexedDB)
  vi.spyOn(indexedDB, 'open').mockImplementation((name: string, version?: number) => {
    if (blockStorage) throw new DOMException('The operation is insecure.', 'SecurityError')
    return open(name, version)
  })
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { estimate: () => Promise.resolve({ usage: 0, quota: 500 * 1024 * 1024 }) },
  })
  mockProcessMediaFile.mockImplementation(async (file: File) => {
    const metadata = metadataOf(file)
    await storeVideo(metadata.id, file, metadata)
    return metadata
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'storage')
})

describe('VideoUploader where the browser will not open storage', () => {
  it('says so at load, puts plain words on the import row, and logs it once', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<VideoUploader onProjectFile={vi.fn()} showNotification={vi.fn()} clearSession={vi.fn()} />)

    const notice = await screen.findByText(NOTICE)
    expect(notice).toHaveAttribute('role', 'status')

    selectFiles([new File(['a'], 'first.wav', { type: 'audio/wav' })])
    expect(await screen.findByText(IMPORT_ROW)).toBeInTheDocument()
    selectFiles([new File(['b'], 'second.wav', { type: 'audio/wav' })])
    await waitFor(() => expect(screen.getAllByText(IMPORT_ROW)).toHaveLength(2))

    // Not the browser's own sentence anywhere.
    expect(screen.queryByText(/insecure/)).not.toBeInTheDocument()
    // The notice is still up.
    expect(screen.getByText(NOTICE)).toBeInTheDocument()
    // The load's read and both imports all failed; the console heard of it once.
    expect(mockProcessMediaFile).toHaveBeenCalledTimes(2)
    expect(consoleError).toHaveBeenCalledTimes(1)
  })

  it('takes the notice down once an import gets through', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<VideoUploader onProjectFile={vi.fn()} showNotification={vi.fn()} clearSession={vi.fn()} />)
    await screen.findByText(NOTICE)

    blockStorage = false
    selectFiles([new File(['a'], 'allowed.wav', { type: 'audio/wav' })])

    expect(await screen.findByText('Complete')).toBeInTheDocument()
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument()
    await act(async () => {
      await Promise.resolve()
    })
  })
})
