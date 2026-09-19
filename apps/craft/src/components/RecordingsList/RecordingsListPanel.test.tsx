// Who decides whether a recording can be handed to a host.
//
// `RecordingsList` is props-only and cannot ask — so the question is asked
// here, once per render, and the answer is the presence or absence of one
// prop. This file pins the three things that follow from that: the button is
// there inside a frame, it is not there outside one, and what happens when
// the blob the host asked for is no longer in storage.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecordingsListPanel } from './RecordingsListPanel'
import { useRecorderStore } from '../../store/recorderStore'
import { uploadToHost } from '../../utils/uploadToHost'
import { UPLOAD_UNAVAILABLE } from '../../utils/notices'
import type { Recording } from '../../store/types'

const { isEmbedded } = vi.hoisted(() => ({ isEmbedded: vi.fn(() => false) }))
vi.mock('@escapesuite/shared/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@escapesuite/shared/config')>()),
  isEmbedded,
}))

vi.mock('../../utils/uploadToHost', () => ({ uploadToHost: vi.fn() }))

const uploadToHostMock = vi.mocked(uploadToHost)

const recording: Recording = {
  id: 'r7',
  name: 'Take Seven',
  duration: 5,
  createdAt: 1_700_000_000_000,
  size: 2048,
  thumbnailUrl: undefined,
  hasWebcam: false,
  hasAudio: true,
}

function renderPanel() {
  return render(
    <RecordingsListPanel
      recordings={[recording]}
      onPlay={vi.fn()}
      onDownload={vi.fn()}
      onSendToEditor={vi.fn()}
      onDelete={vi.fn()}
    />
  )
}

beforeEach(() => {
  isEmbedded.mockReturnValue(false)
  uploadToHostMock.mockResolvedValue('posted')
  useRecorderStore.setState({ notice: null })
})

afterEach(() => {
  vi.clearAllMocks()
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
})
