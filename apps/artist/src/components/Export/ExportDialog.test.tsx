import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ExportDialog } from './ExportDialog'

// Mock the store
const mockClips = [
  { id: 'clip1', sourceVideoId: 'video1', timelinePosition: 0, duration: 5 },
]

const mockSourceVideos = [
  { id: 'video1', name: 'test.mp4', duration: 10 },
]

vi.mock('../../store/projectStore', () => ({
  useEditorStore: vi.fn((selector) => {
    const state = {
      project: {
        name: 'Test Project',
        timeline: {
          clips: mockClips,
          tracks: [{ id: 'track1', name: 'Track 1', index: 0 }],
        },
      },
      sourceVideos: mockSourceVideos,
    }
    return selector(state)
  }),
}))

// Mock the exporter
vi.mock('../../core/exporter', () => ({
  exportToWebM: vi.fn(() => Promise.resolve(new Blob())),
  exportToMP4: vi.fn(() => Promise.resolve(new Blob())),
  isMP4ExportSupported: vi.fn(() => true),
}))

// Mock CSS modules
vi.mock('./ExportDialog.module.css', () => ({
  default: {
    overlay: 'overlay',
    dialog: 'dialog',
    header: 'header',
    title: 'title',
    closeButton: 'closeButton',
    body: 'body',
    section: 'section',
    label: 'label',
    radioGroup: 'radioGroup',
    radio: 'radio',
    radioHint: 'radioHint',
    radioDisabled: 'radioDisabled',
    select: 'select',
    error: 'error',
    summary: 'summary',
    footer: 'footer',
    cancelButton: 'cancelButton',
    exportButton: 'exportButton',
    progressSection: 'progressSection',
    progressInfo: 'progressInfo',
    progressPhase: 'progressPhase',
    progressMessage: 'progressMessage',
    progressBar: 'progressBar',
    progressFill: 'progressFill',
    progressPercent: 'progressPercent',
  },
}))

describe('ExportDialog', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not render when isOpen is false', () => {
    render(<ExportDialog isOpen={false} onClose={mockOnClose} />)
    expect(screen.queryByText('Export Video')).not.toBeInTheDocument()
  })

  it('renders when isOpen is true', () => {
    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)
    expect(screen.getByText('Export Video')).toBeInTheDocument()
  })

  it('displays format options', () => {
    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    expect(screen.getByText('WebM (VP9 + Opus)')).toBeInTheDocument()
    expect(screen.getByText('MP4 (H.264 + AAC)')).toBeInTheDocument()
  })

  it('displays quality options', () => {
    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    // Quality label and options
    expect(screen.getByText('Quality')).toBeInTheDocument()
    expect(screen.getByText('Low (faster export)')).toBeInTheDocument()
    expect(screen.getByText('Medium')).toBeInTheDocument()
    expect(screen.getByText('High (slower export)')).toBeInTheDocument()
  })

  it('displays resolution options', () => {
    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    expect(screen.getByText('Original')).toBeInTheDocument()
    expect(screen.getByText('1080p')).toBeInTheDocument()
    expect(screen.getByText('720p')).toBeInTheDocument()
    expect(screen.getByText('480p')).toBeInTheDocument()
  })

  it('displays clip count in summary', () => {
    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)
    expect(screen.getByText('1 clip')).toBeInTheDocument()
  })

  it('calls onClose when cancel button is clicked', () => {
    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelButton)

    expect(mockOnClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when close button (x) is clicked', () => {
    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    const closeButton = screen.getByRole('button', { name: /×/i })
    fireEvent.click(closeButton)

    expect(mockOnClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when overlay is clicked', () => {
    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    const overlay = screen.getByText('Export Video').closest('.overlay')
    if (overlay) {
      fireEvent.click(overlay)
    }

    expect(mockOnClose).toHaveBeenCalledTimes(1)
  })

  it('allows changing format selection', () => {
    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    const webmRadio = screen.getByRole('radio', { name: /webm/i })
    const mp4Radio = screen.getByRole('radio', { name: /mp4/i })

    // WebM should be selected by default
    expect(webmRadio).toBeChecked()
    expect(mp4Radio).not.toBeChecked()

    // Click MP4
    fireEvent.click(mp4Radio)
    expect(mp4Radio).toBeChecked()
    expect(webmRadio).not.toBeChecked()
  })

  it('allows changing quality selection', () => {
    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    const qualitySelect = screen.getByDisplayValue('High (slower export)')
    fireEvent.change(qualitySelect, { target: { value: 'low' } })

    expect(qualitySelect).toHaveValue('low')
  })

  it('allows changing resolution selection', () => {
    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    const resolutionSelect = screen.getByDisplayValue('Original')
    fireEvent.change(resolutionSelect, { target: { value: '720p' } })

    expect(resolutionSelect).toHaveValue('720p')
  })

  it('has an enabled export button when clips exist', () => {
    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    const exportButton = screen.getByRole('button', { name: /export/i })
    expect(exportButton).not.toBeDisabled()
  })
})
