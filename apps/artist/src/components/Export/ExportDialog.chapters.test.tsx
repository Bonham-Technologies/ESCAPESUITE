// The export dialog's Chapters row (ESCSUITE-472): the timeline's markers as a
// YouTube chapter list, copied or saved as a .txt, timed from the start of the
// file the user exports. Kept in its own file so the dialog's main suite is
// not touched.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { ExportDialog } from './ExportDialog'
import { resetStoreForTest, store, addClip } from '../../test/fixtures/projectStore'
import { useEditorStore } from '../../store/projectStore'

const { mockExportToWebM } = vi.hoisted(() => ({ mockExportToWebM: vi.fn() }))

vi.mock('../../core/exporter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/exporter')>()),
  exportToWebM: mockExportToWebM,
  exportToMP4: vi.fn(),
  exportToGIF: vi.fn(),
  isMP4ExportSupported: vi.fn(() => Promise.resolve({ video: true, audio: true })),
  isWebMExportSupported: vi.fn(() => Promise.resolve({ video: true, audio: true })),
}))

vi.mock('../../core/storage', () => ({
  getSetting: vi.fn(() => Promise.resolve(undefined)),
  setSetting: vi.fn(() => Promise.resolve()),
  revokeSourceThumbnails: vi.fn(),
}))

vi.mock('../../utils/integration', () => ({ sendMessage: vi.fn() }))
vi.mock('../../utils/analytics', () => ({
  analytics: { exportStarted: vi.fn(), exportCompleted: vi.fn(), exportFailed: vi.fn() },
}))

const chaptersRow = () => screen.queryByRole('group', { name: 'Chapters' })
const row = () => within(screen.getByRole('group', { name: 'Chapters' }))

describe('ExportDialog — Chapters row (ESCSUITE-472)', () => {
  let writeText: ReturnType<typeof vi.fn>
  let clicked: HTMLAnchorElement[]
  let originalClick: () => void

  beforeEach(() => {
    vi.clearAllMocks()
    writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    clicked = []
    originalClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicked.push(this)
    }
    resetStoreForTest()
    store().setProject({ ...store().project, name: 'Talk' })
    addClip('clip1', 0, 30)
    addClip('clip2', 30, 30)
  })

  afterEach(() => {
    HTMLAnchorElement.prototype.click = originalClick
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('offers no row without markers', () => {
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />)
    expect(chaptersRow()).toBeNull()
  })

  it('copies the whole timeline as chapters and says so, with no range choice and no warning', async () => {
    store().addMarker(15, 'Setup')
    store().addMarker(40)
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />)

    expect(row().queryByRole('radiogroup')).toBeNull()
    expect(row().queryAllByRole('status').filter((s) => s.textContent)).toHaveLength(0)
    fireEvent.click(row().getByRole('button', { name: 'Copy chapters' }))

    expect(writeText).toHaveBeenCalledWith('0:00 Intro\n0:15 Setup\n0:40 Chapter 2')
    expect(await row().findByText('Chapters copied')).toBeInTheDocument()
  })

  it('says when the clipboard refuses', async () => {
    store().addMarker(15, 'Setup')
    writeText.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />)

    fireEvent.click(row().getByRole('button', { name: 'Copy chapters' }))

    expect(await row().findByText('Could not copy chapters')).toBeInTheDocument()
  })

  it('saves the same list as a .txt named for the project', async () => {
    store().addMarker(15, 'Setup')
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />)

    fireEvent.click(row().getByRole('button', { name: 'Download chapters .txt' }))

    const calls = vi.mocked(URL.createObjectURL).mock.calls
    const blob = calls[calls.length - 1][0] as Blob
    expect(await blob.text()).toBe('0:00 Intro\n0:15 Setup\n')
    expect(blob.type).toBe('text/plain')
    expect(clicked[clicked.length - 1].download).toBe('Talk-chapters.txt')
  })

  it('warns, naming the rule, without blocking the copy', () => {
    store().addMarker(5, 'Setup')
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />)

    expect(row().getByText(/at least 3 chapters/)).toHaveAttribute('role', 'status')
    expect(row().getByText(/at least 10 seconds/)).toHaveAttribute('role', 'status')
    expect(row().getByRole('button', { name: 'Copy chapters' })).toBeEnabled()
  })

  it('times the list from the section by default, and from 0:00 when Full video is picked', () => {
    store().addMarker(10, 'Before')
    store().addMarker(25, 'Inside')
    store().setInPoint(20)
    store().setOutPoint(50)
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />)

    const section = row().getByRole('radio', { name: /^Section/ })
    expect(section).toBeChecked()
    fireEvent.click(row().getByRole('button', { name: 'Copy chapters' }))
    expect(writeText).toHaveBeenLastCalledWith('0:00 Intro\n0:05 Inside')

    fireEvent.click(row().getByRole('radio', { name: 'Full video' }))
    fireEvent.click(row().getByRole('button', { name: 'Copy chapters' }))
    expect(writeText).toHaveBeenLastCalledWith('0:00 Intro\n0:10 Before\n0:25 Inside')

    fireEvent.click(section)
    expect(section).toBeChecked()
    fireEvent.click(row().getByRole('button', { name: 'Copy chapters' }))
    expect(writeText).toHaveBeenLastCalledWith('0:00 Intro\n0:05 Inside')
  })

  // ESCSUITE-519: a shortened timeline leaves in/out points (and markers)
  // behind; the section's list stops at the timeline's end, as the export does.
  it('drops markers at or past the end of the timeline from a section that straddles it', () => {
    store().addMarker(45, 'Inside')
    store().addMarker(60, 'At the end')
    store().addMarker(75, 'Past the end')
    useEditorStore.setState({ inPoint: 40, outPoint: 90 })
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />)

    expect(row().getByRole('radio', { name: 'Section (0:40 - 1:00)' })).toBeChecked()
    fireEvent.click(row().getByRole('button', { name: 'Copy chapters' }))
    expect(writeText).toHaveBeenLastCalledWith('0:00 Intro\n0:05 Inside')
    // Nor does a warning name a chapter the export will not hold.
    expect(row().queryByText(/At the end|Past the end/)).toBeNull()

    fireEvent.click(row().getByRole('radio', { name: 'Full video' }))
    fireEvent.click(row().getByRole('button', { name: 'Copy chapters' }))
    expect(writeText).toHaveBeenLastCalledWith('0:00 Intro\n0:45 Inside')
  })

  it('lists no section chapters for a section wholly past the end', () => {
    store().addMarker(10, 'Before')
    store().addMarker(70, 'Past the end')
    useEditorStore.setState({ inPoint: 65, outPoint: 90 })
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />)

    const copy = row().getByRole('button', { name: 'Copy chapters' })
    expect(copy).toBeDisabled()
    expect(document.getElementById(copy.getAttribute('aria-describedby')!)).toHaveTextContent('No markers in the section.')
  })

  it('keeps the row when only the full video has markers, with the copy off until Full video is picked', () => {
    store().addMarker(10, 'Before')
    store().setInPoint(20)
    store().setOutPoint(50)
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />)

    const copy = row().getByRole('button', { name: 'Copy chapters' })
    expect(copy).toBeDisabled()
    expect(document.getElementById(copy.getAttribute('aria-describedby')!)).toHaveTextContent('No markers in the section.')
    expect(row().getByRole('button', { name: 'Download chapters .txt' })).toBeDisabled()

    fireEvent.click(row().getByRole('radio', { name: 'Full video' }))
    expect(copy).toBeEnabled()
    expect(copy).not.toHaveAttribute('aria-describedby')
  })

  it('follows Export Full Video: after that export the list is timed from 0:00', async () => {
    mockExportToWebM.mockRejectedValue(new Error('stop here'))
    store().addMarker(10, 'Before')
    store().addMarker(25, 'Inside')
    store().setInPoint(20)
    store().setOutPoint(50)
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />)

    const full = screen.getByRole('button', { name: 'Export Full Video' })
    await waitFor(() => expect(full).toBeEnabled())
    fireEvent.click(full)
    await waitFor(() => expect(mockExportToWebM).toHaveBeenCalled())

    expect(await row().findByRole('radio', { name: 'Full video' })).toBeChecked()
    fireEvent.click(row().getByRole('button', { name: 'Copy chapters' }))
    expect(writeText).toHaveBeenLastCalledWith('0:00 Intro\n0:10 Before\n0:25 Inside')
  })
})
