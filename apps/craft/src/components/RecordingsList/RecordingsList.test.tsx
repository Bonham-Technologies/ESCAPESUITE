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

function renderList(recordings: Recording[] = [makeRecording()]) {
  const calls = {
    onPlay: vi.fn<(id: string, name: string) => void>(),
    onDownload: vi.fn<(id: string, name: string) => void>(),
    onSendToEditor: vi.fn<(id: string) => void>(),
    onDelete: vi.fn<(id: string) => void>(),
  }
  const { container } = render(<RecordingsList recordings={recordings} {...calls} />)
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
