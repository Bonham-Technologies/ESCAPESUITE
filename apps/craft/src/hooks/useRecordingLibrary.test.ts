// The recordings already in storage: playing one back, downloading it, handing
// it to the editor, deleting it.
//
// Storage is real (fake-indexeddb) and so are the object-URL helpers — the URL
// stubs in src/test/setup.ts count what was created and revoked, which is the
// point of most of these tests. Only the editor handoff and analytics delivery
// are doubled, the way the App tests double them.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { act, renderHook } from '@testing-library/react'
import { useRecordingLibrary } from './useRecordingLibrary'
import { storeVideo, getVideoBlob } from '../core/storage'
import { clearAllRecordings } from '../test/recordingsDb'
import { analyticsModule, sendToEditorModule, resetAppDoubles } from '../test/appDoubles'
import type { Recording, SourceVideo } from '../store/types'

vi.mock('../utils/sendToEditor', async () => (await import('../test/appDoubles')).sendToEditorModule)
vi.mock('@vercel/analytics', async () => (await import('../test/appDoubles')).analyticsModule)

let removeRecording: ReturnType<typeof vi.fn<(id: string) => void>>
let refreshStorageSpace: ReturnType<typeof vi.fn>
let clicks: Array<{ href: string; download: string }>

function listed(id: string, name: string, duration: number): Recording {
  return { id, name, duration, createdAt: 1_000, size: 1024, hasWebcam: false, hasAudio: true }
}

function metadata(id: string, name: string): SourceVideo {
  return {
    id,
    name,
    duration: 30,
    width: 1920,
    height: 1080,
    frameRate: 30,
    mimeType: 'video/webm',
    size: 1024,
    mediaType: 'video',
    source: 'recording',
    recordedAt: 1_000,
  }
}

async function seed(id: string, name: string): Promise<void> {
  await storeVideo(id, new Blob(['video-bytes'], { type: 'video/webm' }), metadata(id, name))
}

beforeEach(async () => {
  resetAppDoubles()
  removeRecording = vi.fn<(id: string) => void>()
  refreshStorageSpace = vi.fn(async () => {})
  clicks = []
  vi.mocked(URL.createObjectURL).mockClear()
  vi.mocked(URL.revokeObjectURL).mockClear()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ href: this.getAttribute('href') ?? '', download: this.download })
  })
  await clearAllRecordings()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function mountLibrary(recordings: Recording[] = []) {
  return renderHook(() =>
    useRecordingLibrary({
      recordings,
      removeRecording,
      refreshStorageSpace: refreshStorageSpace as unknown as () => Promise<void>,
    })
  )
}

describe('useRecordingLibrary playback', () => {
  it('opens the chosen recording with its name and its known duration', async () => {
    await seed('take-1', 'Standup Demo')
    const { result } = mountLibrary([listed('take-1', 'Standup Demo', 65)])

    await act(async () => {
      await result.current.handlePlayRecording('take-1', 'Standup Demo')
    })

    expect(result.current.playbackUrl).toBe('blob:mock-url')
    expect(result.current.playbackName).toBe('Standup Demo')
    expect(result.current.playbackDuration).toBe(65)
  })

  it('falls back to no known duration when the list has forgotten the recording', async () => {
    await seed('take-1', 'Orphan')
    const { result } = mountLibrary([])

    await act(async () => {
      await result.current.handlePlayRecording('take-1', 'Orphan')
    })

    expect(result.current.playbackDuration).toBe(0)
  })

  it('revokes the previous object URL before opening the next recording', async () => {
    await seed('take-1', 'First')
    await seed('take-2', 'Second')
    const { result } = mountLibrary([listed('take-1', 'First', 10), listed('take-2', 'Second', 20)])

    await act(async () => {
      await result.current.handlePlayRecording('take-1', 'First')
    })
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.handlePlayRecording('take-2', 'Second')
    })

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(result.current.playbackName).toBe('Second')
  })

  it('opens nothing when the blob has gone missing', async () => {
    const { result } = mountLibrary([listed('gone', 'Gone', 10)])

    await act(async () => {
      await result.current.handlePlayRecording('gone', 'Gone')
    })

    expect(result.current.playbackUrl).toBeNull()
    expect(result.current.playbackName).toBe('')
  })

  // Changed assertion: closing used to leave playbackDuration standing, so a
  // recording opened straight afterwards whose own duration could not be found
  // was handed the *previous* one's.
  it('revokes and clears all three of url, name and duration on close', async () => {
    await seed('take-1', 'First')
    const { result } = mountLibrary([listed('take-1', 'First', 42)])
    await act(async () => {
      await result.current.handlePlayRecording('take-1', 'First')
    })

    act(() => {
      result.current.handleClosePlayback()
    })

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(result.current.playbackUrl).toBeNull()
    expect(result.current.playbackName).toBe('')
    expect(result.current.playbackDuration).toBe(0)
  })

  it('has nothing to revoke when closing a dialog that was never opened', () => {
    const { result } = mountLibrary()

    act(() => {
      result.current.handleClosePlayback()
    })

    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    expect(result.current.playbackUrl).toBeNull()
  })
})

describe('useRecordingLibrary downloading', () => {
  // Changed assertion: the revoke used to happen in the same tick as click(),
  // which cancels the download outside Chrome. It is deferred by one turn now,
  // so this test has to let that turn run.
  it('clicks an anchor with a file-safe name and cleans the URL up after it', async () => {
    await seed('take-1', 'Standup Demo: 9/9')
    const { result } = mountLibrary([listed('take-1', 'Standup Demo: 9/9', 12)])

    await act(async () => {
      await result.current.handleDownload('take-1', 'Standup Demo: 9/9')
    })

    expect(clicks).toEqual([{ href: 'blob:mock-url', download: 'standup_demo__9_9.webm' }])
    expect(analyticsModule.track).toHaveBeenCalledWith('Recording Downloaded', undefined)
    expect(document.querySelector('a[download]')).toBeNull()
    // The browser has not necessarily started reading the blob yet, so the URL
    // must still be live when click() returns.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()

    // Timers stay real here: fake-indexeddb is what getVideoBlob runs on, and
    // the App suites fake setInterval only for exactly that reason. One
    // macrotask is all the deferred revoke needs.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })

  it('downloads nothing when the blob has gone missing', async () => {
    const { result } = mountLibrary([listed('gone', 'Gone', 10)])

    await act(async () => {
      await result.current.handleDownload('gone', 'Gone')
    })

    expect(clicks).toEqual([])
    expect(analyticsModule.track).not.toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
})

describe('useRecordingLibrary list actions', () => {
  it('deletes the stored video and takes the row out of the list', async () => {
    await seed('take-1', 'First')
    const { result } = mountLibrary([listed('take-1', 'First', 10)])

    await act(async () => {
      await result.current.handleDeleteRecording('take-1')
    })

    await expect(getVideoBlob('take-1')).resolves.toBeUndefined()
    expect(removeRecording).toHaveBeenCalledWith('take-1')
    // Deleting is the remedy the blocked Record button recommends, so the
    // headroom has to be re-read or the button stays disabled afterwards.
    expect(refreshStorageSpace).toHaveBeenCalledTimes(1)
  })

  it('hands a recording to the editor by id', () => {
    const { result } = mountLibrary([listed('take-1', 'First', 10)])

    act(() => {
      result.current.handleSendToEditor('take-1')
    })

    expect(sendToEditorModule.sendToEditor).toHaveBeenCalledWith('take-1')
  })
})
