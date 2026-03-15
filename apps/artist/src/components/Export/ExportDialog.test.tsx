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
        resolution: { width: 1920, height: 1080 },
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
const { mockExportToWebM, mockExportToMP4, MockExportAbortedError, MockExportError } = vi.hoisted(() => {
  // Define mock classes inside hoisted block
  class MockExportAbortedError extends Error {
    constructor() {
      super('Export was cancelled')
      this.name = 'ExportAbortedError'
    }
  }
  class MockExportError extends Error {
    public readonly exportLog: Array<{ phase: string; detail: string; timestamp: number }>;
    constructor(message: string, exportLog: Array<{ phase: string; detail: string; timestamp: number }>) {
      super(message)
      this.name = 'ExportError'
      this.exportLog = exportLog
    }
  }
  return {
    mockExportToWebM: vi.fn(() => Promise.resolve(new Blob())),
    mockExportToMP4: vi.fn(() => Promise.resolve(new Blob())),
    MockExportAbortedError,
    MockExportError,
  }
})

vi.mock('../../core/exporter', () => ({
  exportToWebM: mockExportToWebM,
  exportToMP4: mockExportToMP4,
  isMP4ExportSupported: vi.fn(() => true),
  ExportAbortedError: MockExportAbortedError,
  ExportError: MockExportError,
}))

// Mock storage for settings persistence
const { mockGetSetting, mockSetSetting } = vi.hoisted(() => ({
  mockGetSetting: vi.fn((): Promise<unknown> => Promise.resolve(undefined)),
  mockSetSetting: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../core/storage', () => ({
  getSetting: mockGetSetting,
  setSetting: mockSetSetting,
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
    primarySection: 'primarySection',
    primaryExportButton: 'primaryExportButton',
    advancedSection: 'advancedSection',
    advancedToggle: 'advancedToggle',
    advancedChevron: 'advancedChevron',
    advancedChevronOpen: 'advancedChevronOpen',
    advancedContent: 'advancedContent',
    advancedExportButton: 'advancedExportButton',
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
    mockGetSetting.mockResolvedValue(undefined)
  })

  it('does not render when isOpen is false', () => {
    render(<ExportDialog isOpen={false} onClose={mockOnClose} />)
    expect(screen.queryByText('Export Video')).not.toBeInTheDocument()
  })

  it('renders when isOpen is true', () => {
    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)
    expect(screen.getByText('Export Video')).toBeInTheDocument()
  })

  it('shows primary Download WebM button', () => {
    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)
    expect(screen.getByRole('button', { name: /download webm/i })).toBeInTheDocument()
  })

  it('shows Advanced options toggle', () => {
    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)
    expect(screen.getByRole('button', { name: /advanced options/i })).toBeInTheDocument()
  })

  it('does not show format options by default', () => {
    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)
    expect(screen.queryByText('WebM (VP9 + Opus)')).not.toBeInTheDocument()
    expect(screen.queryByText('MP4 (H.264 + AAC)')).not.toBeInTheDocument()
  })

  it('shows format/quality/resolution options when Advanced options is clicked', () => {
    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    const advancedToggle = screen.getByRole('button', { name: /advanced options/i })
    fireEvent.click(advancedToggle)

    expect(screen.getByText('WebM (VP9 + Opus)')).toBeInTheDocument()
    expect(screen.getByText('MP4 (H.264 + AAC)')).toBeInTheDocument()
    expect(screen.getByText('Quality')).toBeInTheDocument()
    expect(screen.getByText('Resolution')).toBeInTheDocument()
  })

  it('displays quality options in advanced section', () => {
    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    fireEvent.click(screen.getByRole('button', { name: /advanced options/i }))

    expect(screen.getByText('Low (faster export)')).toBeInTheDocument()
    expect(screen.getByText('Medium')).toBeInTheDocument()
    expect(screen.getByText('High (slower export)')).toBeInTheDocument()
  })

  it('displays resolution options with project resolution', () => {
    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    fireEvent.click(screen.getByRole('button', { name: /advanced options/i }))

    expect(screen.getByText('Project (1920x1080)')).toBeInTheDocument()
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

  it('allows changing format selection in advanced options', () => {
    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    fireEvent.click(screen.getByRole('button', { name: /advanced options/i }))

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

  it('allows changing quality selection in advanced options', () => {
    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    fireEvent.click(screen.getByRole('button', { name: /advanced options/i }))

    const qualitySelect = screen.getByDisplayValue('Medium')
    fireEvent.change(qualitySelect, { target: { value: 'low' } })

    expect(qualitySelect).toHaveValue('low')
  })

  it('allows changing resolution selection in advanced options', () => {
    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    fireEvent.click(screen.getByRole('button', { name: /advanced options/i }))

    const resolutionSelect = screen.getByDisplayValue('Project (1920x1080)')
    fireEvent.change(resolutionSelect, { target: { value: '720p' } })

    expect(resolutionSelect).toHaveValue('720p')
  })

  it('has an enabled primary export button when clips exist', () => {
    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    const exportButton = screen.getByRole('button', { name: /download webm/i })
    expect(exportButton).not.toBeDisabled()
  })

  it('advanced export button label changes based on format', () => {
    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    fireEvent.click(screen.getByRole('button', { name: /advanced options/i }))

    // Default format is WebM - there should be two "Download WebM" buttons (primary + advanced)
    const webmButtons = screen.getAllByRole('button', { name: /download webm/i })
    expect(webmButtons).toHaveLength(2)

    // Change to MP4
    fireEvent.click(screen.getByRole('radio', { name: /mp4/i }))

    // Advanced button should update to Download MP4
    expect(screen.getByRole('button', { name: /download mp4/i })).toBeInTheDocument()
    // Primary button should still say Download WebM
    expect(screen.getByRole('button', { name: /download webm/i })).toBeInTheDocument()
  })

  it('primary button exports with default settings (WebM, medium, project)', async () => {
    let capturedOptions: unknown
    mockExportToWebM.mockImplementation((...args: unknown[]) => {
      capturedOptions = args[2]
      return Promise.resolve(new Blob())
    })

    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    const primaryButton = screen.getByRole('button', { name: /download webm/i })
    fireEvent.click(primaryButton)

    await vi.waitFor(() => {
      expect(mockExportToWebM).toHaveBeenCalled()
    })

    expect(capturedOptions).toEqual({
      format: 'webm',
      quality: 'medium',
      resolution: 'project',
    })
  })

  it('advanced export button uses configured settings', async () => {
    let capturedOptions: unknown
    mockExportToWebM.mockImplementation((...args: unknown[]) => {
      capturedOptions = args[2]
      return Promise.resolve(new Blob())
    })

    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    // Open advanced options
    fireEvent.click(screen.getByRole('button', { name: /advanced options/i }))

    // Change quality to high
    const qualitySelect = screen.getByDisplayValue('Medium')
    fireEvent.change(qualitySelect, { target: { value: 'high' } })

    // Change resolution to 720p
    const resolutionSelect = screen.getByDisplayValue('Project (1920x1080)')
    fireEvent.change(resolutionSelect, { target: { value: '720p' } })

    // Click the advanced download button (the second "Download WebM" button)
    const buttons = screen.getAllByRole('button', { name: /download webm/i })
    const advancedButton = buttons[buttons.length - 1] // The one inside advanced section
    fireEvent.click(advancedButton)

    await vi.waitFor(() => {
      expect(mockExportToWebM).toHaveBeenCalled()
    })

    expect(capturedOptions).toEqual({
      format: 'webm',
      quality: 'high',
      resolution: '720p',
    })
  })

  it('saves settings to IndexedDB when using advanced export', async () => {
    mockExportToWebM.mockResolvedValue(new Blob())

    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    // Open advanced and change settings
    fireEvent.click(screen.getByRole('button', { name: /advanced options/i }))
    const qualitySelect = screen.getByDisplayValue('Medium')
    fireEvent.change(qualitySelect, { target: { value: 'high' } })

    // Click advanced download button
    const buttons = screen.getAllByRole('button', { name: /download webm/i })
    fireEvent.click(buttons[buttons.length - 1])

    await vi.waitFor(() => {
      expect(mockSetSetting).toHaveBeenCalledWith('lastExportSettings', {
        format: 'webm',
        quality: 'high',
        resolution: 'project',
      })
    })
  })

  it('loads saved settings and expands advanced on open', async () => {
    mockGetSetting.mockResolvedValue({
      format: 'webm',
      quality: 'high',
      resolution: '720p',
    })

    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    // Wait for settings to load and advanced to expand
    await vi.waitFor(() => {
      expect(screen.getByText('Quality')).toBeInTheDocument()
    })

    // Verify settings are populated
    expect(screen.getByDisplayValue('High (slower export)')).toBeInTheDocument()
    expect(screen.getByDisplayValue('720p')).toBeInTheDocument()
  })

  it('passes AbortSignal to export function when exporting', async () => {
    let capturedSignal: AbortSignal | undefined
    mockExportToWebM.mockImplementation((...args: unknown[]) => {
      // The signal is the 7th argument (index 6)
      capturedSignal = args[6] as AbortSignal | undefined
      return Promise.resolve(new Blob())
    })

    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    const exportButton = screen.getByRole('button', { name: /download webm/i })
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

    const exportButton = screen.getByRole('button', { name: /download webm/i })
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

    // Open advanced to see error display
    fireEvent.click(screen.getByRole('button', { name: /advanced options/i }))

    // Click the advanced download button
    const buttons = screen.getAllByRole('button', { name: /download webm/i })
    fireEvent.click(buttons[buttons.length - 1])

    // Wait for error to be displayed
    await vi.waitFor(() => {
      expect(screen.getByText(/encoding failed/i)).toBeInTheDocument()
    })
  })

  it('does not save settings when using primary export button', async () => {
    mockExportToWebM.mockResolvedValue(new Blob())

    render(<ExportDialog isOpen={true} onClose={mockOnClose} />)

    // Click primary download button directly
    fireEvent.click(screen.getByRole('button', { name: /download webm/i }))

    await vi.waitFor(() => {
      expect(mockExportToWebM).toHaveBeenCalled()
    })

    expect(mockSetSetting).not.toHaveBeenCalled()
  })
})
