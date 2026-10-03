// Who decides whether a recording can be handed to a host.
//
// `RecordingsList` is props-only and cannot ask — so the question is asked
// here, once per render, and the answer is the presence or absence of one
// prop. This file pins what follows from that: the button is there inside a
// frame, it is not there outside one, a posted upload says nothing, a second
// click during a read does not read twice, and what happens when the blob the
// host asked for is no longer in storage or cannot be read at all.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecordingsListPanel } from './RecordingsListPanel'
import { useRecorderStore } from '../../store/recorderStore'
import { uploadToHost } from '../../utils/uploadToHost'
import { UPLOAD_UNAVAILABLE, UPLOAD_NO_HOST_ORIGIN } from '../../utils/notices'
import { converterModule, resetAppDoubles } from '../../test/appDoubles'
import type { ConversionProgressLike } from '../../test/appDoubles'
import { storeVideo } from '../../core/storage'
import { clearAllRecordings } from '../../test/recordingsDb'
import type { Recording } from '../../store/types'

const { isEmbedded } = vi.hoisted(() => ({ isEmbedded: vi.fn(() => false) }))
vi.mock('@escapesuite/shared/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@escapesuite/shared/config')>()),
  isEmbedded,
}))

vi.mock('../../utils/uploadToHost', () => ({ uploadToHost: vi.fn() }))

// The converter is a boundary the browser owns (WebCodecs, Mediabunny); what
// is under test is which of its two entry points the panel reaches for.
vi.mock('../../core/converter', async () => (await import('../../test/appDoubles')).converterModule)

const uploadToHostMock = vi.mocked(uploadToHost)
const { convertToMP4, convertToM4A } = converterModule

const baseRecording: Recording = {
  id: 'r7',
  name: 'Take Seven',
  duration: 5,
  createdAt: 1_700_000_000_000,
  size: 2048,
  thumbnailUrl: undefined,
  hasWebcam: false,
  hasAudio: true,
}

function renderPanel(recordings: Recording[] = [baseRecording]) {
  return render(
    <RecordingsListPanel
      recordings={recordings}
      onPlay={vi.fn()}
      onDownload={vi.fn()}
      onSendToEditor={vi.fn()}
      onDelete={vi.fn()}
    />
  )
}

beforeEach(async () => {
  resetAppDoubles()
  isEmbedded.mockReturnValue(false)
  uploadToHostMock.mockResolvedValue('posted')
  useRecorderStore.setState({
    notice: null,
    mp4Support: { state: 'ready', supported: true, audio: true },
  })
  await clearAllRecordings()
  await storeVideo('r7', new Blob(['video-bytes'], { type: 'video/webm' }), {
    id: 'r7',
    name: 'Take Seven',
    duration: 5,
    width: 1920,
    height: 1080,
    frameRate: 30,
    mimeType: 'video/webm',
    size: 2048,
    mediaType: 'video',
    source: 'recording',
    recordedAt: 1_000,
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('RecordingsListPanel downloads', () => {
  it('wires the M4A button to an audio-only conversion of that recording', async () => {
    // The panel is where the format is chosen: `RecordingsList` has two
    // handlers and no idea what either converts to.
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Download Take Seven as audio (M4A)' }))

    expect(convertToM4A).toHaveBeenCalledTimes(1)
    expect(convertToMP4).not.toHaveBeenCalled()
  })

  it('offers both downloads while the codec probe says the browser can encode them', () => {
    renderPanel()

    expect(screen.getByRole('button', { name: 'Download Take Seven as MP4' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Download Take Seven as audio (M4A)' })).toBeEnabled()
  })

  it('hands the M4A gate down, so a browser with no AAC encoder cannot start one', () => {
    useRecorderStore.setState({
      mp4Support: {
        state: 'ready',
        supported: true,
        audio: false,
        audioReason: 'MP4 will have no audio in this browser (no AAC encoder)',
      },
    })
    renderPanel()

    const m4a = screen.getByRole('button', { name: 'Download Take Seven as audio (M4A)' })
    expect(m4a).toBeDisabled()
    expect(m4a).toHaveAttribute(
      'title',
      'MP4 will have no audio in this browser (no AAC encoder)'
    )
    // …while the MP4 it can still write stays on offer.
    expect(screen.getByRole('button', { name: 'Download Take Seven as MP4' })).toBeEnabled()
  })
})

describe('RecordingsListPanel upload to host', () => {
  it('offers no upload outside a frame — there is no one to post to', () => {
    renderPanel()

    expect(screen.queryByRole('button', { name: 'Upload Take Seven to host' })).toBeNull()
  })

  it('offers the upload inside a frame, and posts the recording when it is clicked', async () => {
    const user = userEvent.setup()
    isEmbedded.mockReturnValue(true)
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Upload Take Seven to host' }))

    expect(uploadToHostMock).toHaveBeenCalledWith('r7', 'Take Seven')
    expect(useRecorderStore.getState().notice).toBeNull()
  })

  it('says the same thing when the read itself throws', async () => {
    // `getVideoBlob` reaches `getDB()`, which throws outright where IndexedDB
    // is blocked or unreadable — the one case where the user would otherwise
    // get an unhandled rejection and no feedback at all.
    const user = userEvent.setup()
    isEmbedded.mockReturnValue(true)
    uploadToHostMock.mockRejectedValue(new Error('storage blocked'))
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Upload Take Seven to host' }))

    expect(useRecorderStore.getState().notice).toBe(UPLOAD_UNAVAILABLE)
  })

  it('reads the recording once per click, however fast the clicks are', async () => {
    // A take can be a gigabyte. Two clicks before the first read comes back
    // would read it twice and post the host two copies of the same id.
    const user = userEvent.setup()
    isEmbedded.mockReturnValue(true)
    let release: (value: 'posted') => void = () => {}
    uploadToHostMock.mockReturnValue(
      new Promise<'posted'>((resolve) => {
        release = resolve
      })
    )
    renderPanel()

    const upload = screen.getByRole('button', { name: 'Upload Take Seven to host' })
    await user.click(upload)
    await user.click(upload)
    expect(uploadToHostMock).toHaveBeenCalledTimes(1)

    // …and the row is uploadable again once the first one is done.
    await act(async () => {
      release('posted')
    })
    await user.click(upload)
    expect(uploadToHostMock).toHaveBeenCalledTimes(2)
  })

  it('says so through the one notice channel when the blob is gone', async () => {
    // The row is drawn from metadata the store still holds; the bytes it names
    // may not be there any more. Silence would look like a successful upload.
    const user = userEvent.setup()
    isEmbedded.mockReturnValue(true)
    uploadToHostMock.mockResolvedValue('missing')
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Upload Take Seven to host' }))

    expect(useRecorderStore.getState().notice).toBe(UPLOAD_UNAVAILABLE)
  })

  // ESCSUITE-176. `uploadToHost` never broadcasts a recording's bytes to '*'
  // — without a hostOrigin it can parse, it posts nothing and says so with
  // 'refused', which is a different fact from the blob being gone.
  it('says so through the one notice channel when there is no valid hostOrigin to send to', async () => {
    const user = userEvent.setup()
    isEmbedded.mockReturnValue(true)
    uploadToHostMock.mockResolvedValue('refused')
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Upload Take Seven to host' }))

    expect(useRecorderStore.getState().notice).toBe(UPLOAD_NO_HOST_ORIGIN)
  })

  it('hands the host the part it clicked, named', async () => {
    const user = userEvent.setup()
    isEmbedded.mockReturnValue(true)
    const companion = { ...baseRecording, id: 'part-2', name: 'Take — webcam', takeId: 'take-1', role: 'webcam' as const }
    renderPanel([{ ...baseRecording, id: 'take-1', takeId: 'take-1', role: 'screen' as const }, companion])

    await user.click(screen.getByRole('button', { name: 'Upload Take — webcam to host' }))

    expect(uploadToHostMock).toHaveBeenCalledWith('part-2', 'Take — webcam', {
      role: 'webcam',
      takeId: 'take-1',
    })
  })

  it('names the take on the primary row, which is what carries every part', async () => {
    const user = userEvent.setup()
    isEmbedded.mockReturnValue(true)
    renderPanel([
      { ...baseRecording, id: 'take-1', name: 'Standup Demo', takeId: 'take-1', role: 'screen' as const },
      { ...baseRecording, id: 'part-2', name: 'Standup Demo — webcam', takeId: 'take-1', role: 'webcam' as const },
    ])

    await user.click(screen.getByRole('button', { name: 'Upload Standup Demo to host' }))

    // `takeId === id` on the primary row is the whole trigger for
    // `payload.parts` (see `utils/uploadToHost.ts`), so the panel passing the
    // row's own takeId through is load-bearing rather than incidental — it has
    // been true since slice 1 and this is what keeps it true.
    expect(uploadToHostMock).toHaveBeenCalledWith('take-1', 'Standup Demo', {
      role: 'screen',
      takeId: 'take-1',
    })
  })
})

describe('RecordingsListPanel deleting the row that is converting', () => {
  const secondRecording: Recording = { ...baseRecording, id: 'r8', name: 'Take Eight' }

  beforeEach(async () => {
    await storeVideo('r8', new Blob(['video-bytes'], { type: 'video/webm' }), {
      id: 'r8',
      name: 'Take Eight',
      duration: 5,
      width: 1920,
      height: 1080,
      frameRate: 30,
      mimeType: 'video/webm',
      size: 2048,
      mediaType: 'video',
      source: 'recording',
      recordedAt: 1_000,
    })
  })

  /** A conversion the test drives by hand and can watch for its abort signal. */
  function deferConversion() {
    let signal: AbortSignal | undefined
    const started = new Promise<void>((resolveStarted) => {
      convertToMP4.mockImplementation(
        (_blob: Blob, _onProgress: (progress: ConversionProgressLike) => void, abortSignal?: AbortSignal) =>
          new Promise<Blob>((_resolve, reject) => {
            signal = abortSignal
            abortSignal?.addEventListener('abort', () =>
              reject(new converterModule.ConversionAbortedError())
            )
            resolveStarted()
          })
      )
    })
    return { started, get signal() { return signal } }
  }

  it('aborts the conversion in flight, so deleting it frees the slot for other rows', async () => {
    // ESCSUITE-103: the row being deleted is the row holding the one
    // conversion slot. Its progress readout and its Cancel button unmount with
    // it, but `useMp4Download`'s `converting` and `abortRef` used to stay set
    // — every other row's MP4/M4A buttons stayed disabled for however long the
    // orphaned conversion still needed, with nothing left on screen to cancel
    // it.
    const user = userEvent.setup()
    const conversion = deferConversion()
    const onDelete = vi.fn()
    render(
      <RecordingsListPanel
        recordings={[baseRecording, secondRecording]}
        onPlay={vi.fn()}
        onDownload={vi.fn()}
        onSendToEditor={vi.fn()}
        onDelete={onDelete}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Download Take Seven as MP4' }))
    await act(async () => {
      await conversion.started
    })

    // The other row is blocked for as long as the conversion runs.
    expect(screen.getByRole('button', { name: 'Download Take Eight as MP4' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Delete Take Seven' }))

    // The conversion is aborted before the caller's own delete runs — "the
    // user asked for the take to go" is honoured before the row goes.
    expect(conversion.signal?.aborted).toBe(true)
    expect(onDelete).toHaveBeenCalledWith('r7')

    // The slot is freed: the other row's MP4 button re-enables without
    // waiting for the orphaned conversion, and there is no Cancel button left
    // pointing at a conversion nothing can reach any more.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Download Take Eight as MP4' })).toBeEnabled()
    })
    expect(screen.queryByRole('button', { name: /^Cancel .* conversion of/ })).toBeNull()
  })

  it('deletes a row that is not converting without touching the conversion running elsewhere', async () => {
    const user = userEvent.setup()
    const conversion = deferConversion()
    const onDelete = vi.fn()
    render(
      <RecordingsListPanel
        recordings={[baseRecording, secondRecording]}
        onPlay={vi.fn()}
        onDownload={vi.fn()}
        onSendToEditor={vi.fn()}
        onDelete={onDelete}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Download Take Seven as MP4' }))
    await act(async () => {
      await conversion.started
    })

    await user.click(screen.getByRole('button', { name: 'Delete Take Eight' }))

    expect(conversion.signal?.aborted).toBe(false)
    expect(onDelete).toHaveBeenCalledWith('r8')
    expect(
      screen.getByRole('button', { name: 'Cancel MP4 conversion of Take Seven' })
    ).toBeInTheDocument()
  })
})
