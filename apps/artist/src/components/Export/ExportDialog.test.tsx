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

// Mock the exporter - use vi.hoisted for variables referenced in vi.mock
const { mockExportToWebM, mockExportToMP4, MockExportAbortedError } = vi.hoisted(() => {
  // Define mock class inside hoisted block
  class MockExportAbortedError extends Error {
    constructor() {
      super('Export was cancelled')
      this.name = 'ExportAbortedError'
    }
  }
  return {
    mockExportToWebM: vi.fn(() => Promise.resolve(new Blob())),
    mockExportToMP4: vi.fn(() => Promise.resolve(new Blob())),
    MockExportAbortedError,
  }
})

vi.mock('../../core/exporter', () => ({
  exportToWebM: (...args: unknown[]) => mockExportToWebM(...args),
  exportToMP4: (...args: unknown[]) => mockExportToMP4(...args),
  isMP4ExportSupported: vi.fn(() => true),
  ExportAbortedError: MockExportAbortedError,
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

  it('passes AbortSignal to export function when exporting', async () => {
    // Create a long-running export that we can inspect
    let capturedSignal: AbortSignal | undefined
    mockExportToWebM.mockImplementation((...args: unknown[]) => {
      // The signal is the 7th argument (index 6)
      capturedSignal = args[6] as AbortSignal | undefined
      return Promise.resolve(new Blob())
    })

    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    const exportButton = screen.getByRole('button', { name: /export/i })
    fireEvent.click(exportButton)

    // Wait for the export to be called
    await vi.waitFor(() => {
      expect(mockExportToWebM).toHaveBeenCalled()
    })

    // Verify AbortSignal was passed
    expect(capturedSignal).toBeDefined()
    expect(capturedSignal).toBeInstanceOf(AbortSignal)
  })

  it('does not show error message when export is cancelled by user', async () => {
    // Simulate export being cancelled
    mockExportToWebM.mockImplementation(() => {
      return Promise.reject(new MockExportAbortedError())
    })

    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    const exportButton = screen.getByRole('button', { name: /export/i })
    fireEvent.click(exportButton)

    // Wait for the export to be called and rejected
    await vi.waitFor(() => {
      expect(mockExportToWebM).toHaveBeenCalled()
    })

    // Wait a tick for error handling
    await new Promise(resolve => setTimeout(resolve, 0))

    // Should NOT show error message for user-initiated cancellation
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument()
  })

  it('shows error message for non-cancellation errors', async () => {
    // Simulate a real error (not cancellation)
    mockExportToWebM.mockImplementation(() => {
      return Promise.reject(new Error('Encoding failed'))
    })

    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    const exportButton = screen.getByRole('button', { name: /export/i })
    fireEvent.click(exportButton)

    // Wait for error to be displayed
    await vi.waitFor(() => {
      expect(screen.getByText(/encoding failed/i)).toBeInTheDocument()
    })
  })
})
