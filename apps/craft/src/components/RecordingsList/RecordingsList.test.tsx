// The library panel, driven by props only.
//
// A row is a thumbnail, a name, a formatted duration and size, and four
// buttons. What is asserted is the text the App suite reads back out of
// `recordingItem`, the fallback for a recording that never got a thumbnail,
// and that each of the four buttons hands the caller the right recording —
// with its name where the caller needs one and without it where it does not.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecordingsList } from './RecordingsList'
import type { Mp4Conversion } from '../../hooks/useMp4Download'
import type { Recording } from '../../store/types'
import styles from '../../App.module.css'

function makeRecording(overrides: Partial<Recording> = {}): Recording {
  return {
    id: 'r1',
    name: 'Standup Demo',
    duration: 65.9,
    createdAt: 1_700_000_000_000,
    size: 1_572_864,
    thumbnailUrl: 'blob:thumb-1',
    hasWebcam: false,
    hasAudio: true,
    ...overrides,
  }
}

function renderList(
  recordings: Recording[] = [makeRecording()],
  mp4: {
    mp4Converting?: Mp4Conversion | null
    mp4BlockedReason?: string | null
    m4aBlockedReason?: string | null
    mp4Note?: string | null
  } = {},
  // Absent by default, because that is what standalone CRAFT passes: no host,
  // no button. The panel is what decides; this component only draws.
  onUploadToHost?: (id: string, name: string) => void
) {
  const calls = {
    onPlay: vi.fn<(id: string, name: string) => void>(),
    onDownload: vi.fn<(id: string, name: string) => void>(),
    onDownloadMp4: vi.fn<(id: string, name: string) => void>(),
    onDownloadM4a: vi.fn<(id: string, name: string) => void>(),
    onCancelMp4: vi.fn<() => void>(),
    onSendToEditor: vi.fn<(id: string) => void>(),
    onDelete: vi.fn<(id: string) => void>(),
  }
  const { container } = render(
    <RecordingsList
      recordings={recordings}
      mp4Converting={mp4.mp4Converting ?? null}
      mp4BlockedReason={mp4.mp4BlockedReason ?? null}
      m4aBlockedReason={mp4.m4aBlockedReason ?? null}
      mp4Note={mp4.mp4Note ?? null}
      onUploadToHost={onUploadToHost}
      {...calls}
    />
  )
  return { calls, container }
}

function items(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(`.${styles.recordingItem}`)]
}

describe('RecordingsList empty state', () => {
  it('says there is nothing yet, under the Recordings heading', () => {
    const { container } = renderList([])

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Recordings')
    expect(screen.getByText('No recordings yet')).toBeInTheDocument()
    expect(items(container)).toHaveLength(0)
    expect(container.querySelector(`.${styles.emptyIcon}`)).toBeInTheDocument()
  })
})

describe('RecordingsList rows', () => {
  it('keeps the order it is given', () => {
    const { container } = renderList([
      makeRecording({ id: 'r1', name: 'First' }),
      makeRecording({ id: 'r2', name: 'Second' }),
    ])

    expect(items(container).map((item) => item.textContent)).toEqual([
      expect.stringContaining('First'),
      expect.stringContaining('Second'),
    ])
  })

  it('shows the duration as mm:ss and the size in whole tenths of a megabyte', () => {
    const { container } = renderList([makeRecording({ duration: 65.9, size: 1_572_864 })])

    expect(items(container)[0]).toHaveTextContent('01:05 • 1.5 MB')
  })

  it('shows the stored thumbnail as decorative artwork', () => {
    renderList([makeRecording({ thumbnailUrl: 'blob:thumb-1' })])

    const image = screen.getByRole('presentation', { hidden: true }) as HTMLImageElement
    expect(image.tagName).toBe('IMG')
    expect(image).toHaveAttribute('src', 'blob:thumb-1')
    expect(image).toHaveClass(styles.recordingThumbnail)
  })

  it('falls back to an empty tile when a recording has no thumbnail', () => {
    const { container } = renderList([makeRecording({ thumbnailUrl: undefined })])

    expect(container.querySelector('img')).toBeNull()
    const tile = container.querySelector(`.${styles.recordingThumbnail}`) as HTMLElement
    expect(tile.tagName).toBe('DIV')
    expect(tile).toBeEmptyDOMElement()
  })
})

describe('RecordingsList actions', () => {
  it('names every button after its recording', () => {
    renderList([makeRecording({ name: 'Standup Demo' })])

    expect(screen.getByRole('button', { name: 'Play Standup Demo' })).toHaveAttribute('title', 'Play')
    expect(screen.getByRole('button', { name: 'Download Standup Demo' })).toHaveAttribute('title', 'Download WebM')
    expect(screen.getByRole('button', { name: 'Open Standup Demo in Editor' })).toHaveAttribute('title', 'Open in Editor')
    expect(screen.getByRole('button', { name: 'Delete Standup Demo' })).toHaveAttribute('title', 'Delete')
  })

  it('plays the recording it was clicked on, by id and name', async () => {
    const user = userEvent.setup()
    const { calls } = renderList([makeRecording({ id: 'r7', name: 'Take Seven' })])

    await user.click(screen.getByRole('button', { name: 'Play Take Seven' }))

    expect(calls.onPlay).toHaveBeenCalledWith('r7', 'Take Seven')
  })

  it('downloads by id and name, so the file can be named after the take', async () => {
    const user = userEvent.setup()
    const { calls } = renderList([makeRecording({ id: 'r7', name: 'Take Seven' })])

    await user.click(screen.getByRole('button', { name: 'Download Take Seven' }))

    expect(calls.onDownload).toHaveBeenCalledWith('r7', 'Take Seven')
  })

  it('hands the editor only an id — the editor reads the rest from storage', async () => {
    const user = userEvent.setup()
    const { calls } = renderList([makeRecording({ id: 'r7', name: 'Take Seven' })])

    await user.click(screen.getByRole('button', { name: 'Open Take Seven in Editor' }))

    expect(calls.onSendToEditor).toHaveBeenCalledWith('r7')
  })

  it('deletes by id', async () => {
    const user = userEvent.setup()
    const { calls } = renderList([makeRecording({ id: 'r7', name: 'Take Seven' })])

    await user.click(screen.getByRole('button', { name: 'Delete Take Seven' }))

    expect(calls.onDelete).toHaveBeenCalledWith('r7')
  })

  it('acts on the row that was clicked, not the first one', async () => {
    const user = userEvent.setup()
    const { calls } = renderList([
      makeRecording({ id: 'r1', name: 'First' }),
      makeRecording({ id: 'r2', name: 'Second' }),
    ])

    await user.click(screen.getByRole('button', { name: 'Delete Second' }))

    expect(calls.onDelete).toHaveBeenCalledWith('r2')
  })
})

describe('RecordingsList MP4 downloads', () => {
  it('offers MP4 beside WebM, named after its recording', () => {
    renderList([makeRecording({ name: 'Standup Demo' })])

    const mp4 = screen.getByRole('button', { name: 'Download Standup Demo as MP4' })
    expect(mp4).toHaveAttribute('title', 'Download MP4')
    expect(mp4).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Download Standup Demo' })).toHaveAttribute(
      'title',
      'Download WebM'
    )
  })

  it('converts by id and name, so the file can be named after the take', async () => {
    const user = userEvent.setup()
    const { calls } = renderList([makeRecording({ id: 'r7', name: 'Take Seven' })])

    await user.click(screen.getByRole('button', { name: 'Download Take Seven as MP4' }))

    expect(calls.onDownloadMp4).toHaveBeenCalledWith('r7', 'Take Seven')
  })

  it('says why MP4 is unavailable rather than hiding the button', () => {
    const reason = 'This browser cannot convert to MP4.'
    const { container } = renderList([makeRecording({ id: 'r7', name: 'Take Seven' })], {
      mp4BlockedReason: reason,
      mp4Note: reason,
    })

    const mp4 = screen.getByRole('button', { name: 'Download Take Seven as MP4' })
    expect(mp4).toBeDisabled()
    expect(mp4).toHaveAttribute('title', reason)
    const describedBy = mp4.getAttribute('aria-describedby')!
    expect(container.querySelector(`#${describedBy}`)).toHaveTextContent(reason)
    // The WebM download is never affected by an MP4 problem.
    expect(screen.getByRole('button', { name: 'Download Take Seven' })).toBeEnabled()
  })

  it('keeps a reason with no note to the button itself', () => {
    // "Checking what this browser can convert…" is true for a moment on every
    // load. Said out loud under the library it would appear and vanish each
    // time, moving the page; the button still carries it.
    const checking = 'Checking what this browser can convert…'
    const { container } = renderList([makeRecording({ id: 'r7', name: 'Take Seven' })], {
      mp4BlockedReason: checking,
    })

    const mp4 = screen.getByRole('button', { name: 'Download Take Seven as MP4' })
    expect(mp4).toBeDisabled()
    expect(mp4).toHaveAttribute('title', checking)
    expect(mp4).not.toHaveAttribute('aria-describedby')
    expect(container.querySelector(`.${styles.mp4BlockedReason}`)).toBeNull()
    expect(screen.queryByText(checking)).toBeNull()
  })

  it('offers the conversion with a note where the MP4 will be silent', () => {
    // Not a blocked reason: nothing is disabled, but the row says what the
    // file will be missing before the user spends the minutes on it.
    const silent = 'MP4 will have no audio in this browser (no AAC encoder)'
    const { container } = renderList([makeRecording({ id: 'r7', name: 'Take Seven' })], {
      mp4Note: silent,
    })

    const mp4 = screen.getByRole('button', { name: 'Download Take Seven as MP4' })
    expect(mp4).toBeEnabled()
    expect(mp4).toHaveAttribute('title', 'Download MP4')
    const describedBy = mp4.getAttribute('aria-describedby')!
    expect(container.querySelector(`#${describedBy}`)).toHaveTextContent(silent)
  })

  it('shows what the converter is doing, and how far, on the row being converted', () => {
    const { container } = renderList([makeRecording({ id: 'r7', name: 'Take Seven' })], {
      mp4Converting: {
        id: 'r7',
        format: 'mp4',
        message: 'Encoding frames (playing video)...',
        progress: 42,
      },
    })

    const progress = screen.getByRole('progressbar', { name: 'Converting Take Seven to MP4' })
    expect(progress).toHaveAttribute('aria-valuenow', '42')
    // The converter's own sentence, not its coarser lower-case phase name.
    expect(container.querySelector(`.${styles.conversionProgress}`)).toHaveTextContent(
      'Encoding frames (playing video)...'
    )
    expect(container.querySelector(`.${styles.conversionProgress}`)).toHaveTextContent('42%')
    expect(container.querySelector<HTMLElement>(`.${styles.conversionProgressFill}`)).toHaveStyle({
      width: '42%',
    })
  })

  it('cancels the conversion from the row it is running on', async () => {
    const user = userEvent.setup()
    const { calls } = renderList([makeRecording({ id: 'r7', name: 'Take Seven' })], {
      mp4Converting: { id: 'r7', format: 'mp4', message: 'Encoding frames...', progress: 42 },
    })

    await user.click(screen.getByRole('button', { name: 'Cancel MP4 conversion of Take Seven' }))

    expect(calls.onCancelMp4).toHaveBeenCalledTimes(1)
  })

  it('blocks the other rows while one conversion runs, and shows no progress on them', () => {
    const busy = 'One conversion at a time.'
    const { container } = renderList(
      [makeRecording({ id: 'r1', name: 'First' }), makeRecording({ id: 'r2', name: 'Second' })],
      {
        mp4Converting: { id: 'r1', format: 'mp4', message: 'Preparing conversion...', progress: 0 },
        mp4BlockedReason: busy,
        mp4Note: busy,
      }
    )

    expect(container.querySelectorAll(`.${styles.conversionProgress}`)).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Download Second as MP4' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Download Second as MP4' })).toHaveAttribute(
      'title',
      busy
    )
    // The converting row's own button is disabled too — it is already running.
    expect(screen.getByRole('button', { name: 'Download First as MP4' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Download First as MP4' })).toHaveAttribute(
      'title',
      'Converting to MP4…'
    )
  })
})

describe('RecordingsList M4A downloads', () => {
  it('offers M4A beside MP4, named after its recording', () => {
    renderList([makeRecording({ name: 'Standup Demo' })])

    const m4a = screen.getByRole('button', { name: 'Download Standup Demo as audio (M4A)' })
    expect(m4a).toHaveAttribute('title', 'Download audio only (M4A)')
    expect(m4a).toBeEnabled()
    expect(m4a).toHaveTextContent('M4A')
  })

  it('converts by id and name, so the file can be named after the take', async () => {
    const user = userEvent.setup()
    const { calls } = renderList([makeRecording({ id: 'r7', name: 'Take Seven' })])

    await user.click(screen.getByRole('button', { name: 'Download Take Seven as audio (M4A)' }))

    expect(calls.onDownloadM4a).toHaveBeenCalledWith('r7', 'Take Seven')
    expect(calls.onDownloadMp4).not.toHaveBeenCalled()
  })

  it('says a take has no audio rather than offering an empty file', () => {
    // A screen-only take. The reason is about this row, not about the browser,
    // so it is the one gate `RecordingsList` decides for itself.
    renderList([makeRecording({ id: 'r7', name: 'Take Seven', hasAudio: false })])

    const m4a = screen.getByRole('button', { name: 'Download Take Seven as audio (M4A)' })
    expect(m4a).toBeDisabled()
    expect(m4a).toHaveAttribute('title', 'This recording has no audio')
    // The take is still a video, so both of the other downloads are untouched.
    expect(screen.getByRole('button', { name: 'Download Take Seven as MP4' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Download Take Seven' })).toBeEnabled()
  })

  it('says why M4A is unavailable while MP4 stays offered', () => {
    // A browser with no AAC encoder: the MP4 is silent, the M4A is nothing.
    const silent = 'MP4 will have no audio in this browser (no AAC encoder)'
    const { container } = renderList([makeRecording({ id: 'r7', name: 'Take Seven' })], {
      m4aBlockedReason: silent,
      mp4Note: silent,
    })

    const m4a = screen.getByRole('button', { name: 'Download Take Seven as audio (M4A)' })
    expect(m4a).toBeDisabled()
    expect(m4a).toHaveAttribute('title', silent)
    const describedBy = m4a.getAttribute('aria-describedby')!
    expect(container.querySelector(`#${describedBy}`)).toHaveTextContent(silent)
    expect(screen.getByRole('button', { name: 'Download Take Seven as MP4' })).toBeEnabled()
  })

  it('names the format on the row being converted, and on the way out of it', () => {
    const { container } = renderList([makeRecording({ id: 'r7', name: 'Take Seven' })], {
      mp4Converting: { id: 'r7', format: 'm4a', message: 'Encoding audio…', progress: 42 },
    })

    // The progress row is the same row; what it says is not the same thing.
    expect(
      screen.getByRole('progressbar', { name: 'Converting Take Seven to M4A' })
    ).toHaveAttribute('aria-valuenow', '42')
    expect(
      screen.getByRole('button', { name: 'Cancel M4A conversion of Take Seven' })
    ).toBeInTheDocument()
    expect(container.querySelector(`.${styles.conversionProgress}`)).toHaveTextContent(
      'Encoding audio…'
    )
    // Both downloads are disabled while it runs, and both say which conversion
    // is holding the processor.
    for (const name of ['Download Take Seven as MP4', 'Download Take Seven as audio (M4A)']) {
      const button = screen.getByRole('button', { name })
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('title', 'Converting to M4A…')
    }
  })

  it('blocks the other rows while an audio conversion runs', () => {
    const busy = 'One conversion at a time.'
    renderList(
      [makeRecording({ id: 'r1', name: 'First' }), makeRecording({ id: 'r2', name: 'Second' })],
      {
        mp4Converting: { id: 'r1', format: 'm4a', message: 'Encoding audio…', progress: 10 },
        mp4BlockedReason: busy,
        m4aBlockedReason: busy,
        mp4Note: busy,
      }
    )

    const other = screen.getByRole('button', { name: 'Download Second as audio (M4A)' })
    expect(other).toBeDisabled()
    expect(other).toHaveAttribute('title', busy)
  })
})

describe('RecordingsList upload to host', () => {
  const onUploadToHost = vi.fn<(id: string, name: string) => void>()

  it('offers no upload button when it is given no handler', () => {
    // Standalone CRAFT: there is no host to post to, so the action does not
    // exist. This component never asks whether it is embedded — the absence
    // of the prop IS the answer, and that is the whole props-only contract.
    renderList([makeRecording({ name: 'Standup Demo' })])

    expect(screen.queryByRole('button', { name: /to host$/ })).toBeNull()
  })

  it('offers the upload named after its recording when it is given a handler', () => {
    renderList([makeRecording({ name: 'Standup Demo' })], {}, onUploadToHost)

    const upload = screen.getByRole('button', { name: 'Upload Standup Demo to host' })
    expect(upload).toHaveAttribute('title', 'Upload to host')
    expect(upload).toHaveClass(styles.iconButton)
  })

  it('uploads by id and name, so the host can name the file it receives', async () => {
    const user = userEvent.setup()
    renderList([makeRecording({ id: 'r7', name: 'Take Seven' })], {}, onUploadToHost)

    await user.click(screen.getByRole('button', { name: 'Upload Take Seven to host' }))

    expect(onUploadToHost).toHaveBeenCalledWith('r7', 'Take Seven')
  })

  it('sits between the MP4 download and the editor handoff', async () => {
    // The three downloads first, then the two ways out of CRAFT (host,
    // editor), then delete. The order is what a keyboard user tabs through.
    const { container } = renderList(
      [makeRecording({ name: 'Take Seven' })],
      {},
      onUploadToHost
    )

    const labels = [
      ...container.querySelectorAll<HTMLElement>(`.${styles.recordingActions} button`),
    ].map((button) => button.getAttribute('aria-label'))
    expect(labels).toEqual([
      'Play Take Seven',
      'Download Take Seven',
      'Download Take Seven as MP4',
      'Download Take Seven as audio (M4A)',
      'Upload Take Seven to host',
      'Open Take Seven in Editor',
      'Delete Take Seven',
    ])
  })
})
