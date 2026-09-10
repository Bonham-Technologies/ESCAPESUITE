import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { ExportDialog } from './ExportDialog'
import { ExportAbortedError, ExportError } from '../../core/exporter'
import { useEditorStore } from '../../store/projectStore'
import { resetStoreForTest, store, addClip } from '../../test/fixtures/projectStore'
import type { ExportProgress } from '../../store/types'
import styles from './ExportDialog.module.css'

// The exporter itself is driven by its own suite; here it is a scripted
// collaborator. The real error classes come through importOriginal so the
// dialog's instanceof checks are the ones production runs.
const { mockExportToWebM, mockExportToMP4, mockIsMP4ExportSupported } = vi.hoisted(() => ({
  mockExportToWebM: vi.fn(),
  mockExportToMP4: vi.fn(),
  mockIsMP4ExportSupported: vi.fn(() => true),
}))

vi.mock('../../core/exporter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/exporter')>()),
  exportToWebM: mockExportToWebM,
  exportToMP4: mockExportToMP4,
  isMP4ExportSupported: mockIsMP4ExportSupported,
}))

const { mockGetSetting, mockSetSetting } = vi.hoisted(() => ({
  mockGetSetting: vi.fn((): Promise<unknown> => Promise.resolve(undefined)),
  mockSetSetting: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../core/storage', () => ({
  getSetting: mockGetSetting,
  setSetting: mockSetSetting,
}))

const { mockSendMessage } = vi.hoisted(() => ({ mockSendMessage: vi.fn() }))
vi.mock('../../utils/integration', () => ({ sendMessage: mockSendMessage }))

const { mockAnalytics } = vi.hoisted(() => ({
  mockAnalytics: {
    exportStarted: vi.fn(),
    exportCompleted: vi.fn(),
    exportFailed: vi.fn(),
  },
}))
vi.mock('../../utils/analytics', () => ({ analytics: mockAnalytics }))

type ExportArgs = [
  unknown, // clips
  unknown, // sourceVideos
  { format: string; quality: string; resolution: string; timeRange?: { start: number; end: number } },
  (p: ExportProgress) => void,
  unknown, // tracks
  AbortSignal,
  { width: number; height: number },
]

const webmArgs = () => mockExportToWebM.mock.calls[0] as unknown as ExportArgs
const mp4Args = () => mockExportToMP4.mock.calls[0] as unknown as ExportArgs

const advancedToggle = () => screen.getByRole('button', { name: /advanced options/i })
const primaryExport = () => screen.getByRole('button', { name: /download webm/i })
const advancedExport = () => {
  const buttons = screen.getAllByRole('button', { name: /download (webm|mp4)/i })
  return buttons[buttons.length - 1]
}

/** Let the export promise chain settle without waiting on a real timer. */
async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

/**
 * jsdom leaves offsetParent null on every element, which the dialog's focus
 * trap reads as "not visible". Make the tree look laid out.
 */
function pretendElementsAreVisible(): () => void {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get: () => document.body,
  })
  return () => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'offsetParent', original)
    else Reflect.deleteProperty(HTMLElement.prototype, 'offsetParent')
  }
}

describe('ExportDialog', () => {
  // A completed export schedules its own close two seconds later. Those timers
  // outlive the test that started them, so every test gets a fresh spy rather
  // than sharing one a stale timer could fire.
  let onClose: () => void

  beforeEach(() => {
    vi.clearAllMocks()
    onClose = vi.fn()
    mockExportToWebM.mockReset()
    mockExportToWebM.mockResolvedValue(new Blob())
    mockExportToMP4.mockReset()
    mockExportToMP4.mockResolvedValue(new Blob())
    mockSendMessage.mockReset()
    mockIsMP4ExportSupported.mockReturnValue(true)
    mockGetSetting.mockResolvedValue(undefined)

    resetStoreForTest()
    store().setProject({ ...store().project, name: 'Test Project' })
    addClip('clip1', 0, 5)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('rendering', () => {
    it('does not render when isOpen is false', () => {
      render(<ExportDialog isOpen={false} onClose={onClose} />)

      expect(screen.queryByText('Export Video')).not.toBeInTheDocument()
    })

    it('renders a modal dialog when isOpen is true', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
      expect(screen.getByText('Export Video')).toBeInTheDocument()
      expect(primaryExport()).toBeEnabled()
    })

    it('keeps the format, quality and resolution controls behind the advanced toggle', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      expect(advancedToggle()).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByText('WebM (VP9 + Opus)')).not.toBeInTheDocument()
      expect(screen.queryByText('MP4 (H.264 + AAC)')).not.toBeInTheDocument()

      fireEvent.click(advancedToggle())

      expect(advancedToggle()).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText('WebM (VP9 + Opus)')).toBeInTheDocument()
      expect(screen.getByText('MP4 (H.264 + AAC)')).toBeInTheDocument()
      expect(screen.getByText('Low (faster export)')).toBeInTheDocument()
      expect(screen.getByText('Medium')).toBeInTheDocument()
      expect(screen.getByText('High (slower export)')).toBeInTheDocument()
      expect(screen.getByText('1080p')).toBeInTheDocument()
      expect(screen.getByText('720p')).toBeInTheDocument()
      expect(screen.getByText('480p')).toBeInTheDocument()
    })

    it('offers the project resolution from the store', () => {
      store().setProjectResolution(1280, 720)
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      fireEvent.click(advancedToggle())

      expect(screen.getByText('Project (1280x720)')).toBeInTheDocument()
    })

    it('mentions background-tab encoding only where MP4 is available', () => {
      const { unmount } = render(<ExportDialog isOpen={true} onClose={onClose} />)
      expect(screen.getByText(/MP4 exports keep encoding in a background tab/)).toBeInTheDocument()
      unmount()

      mockIsMP4ExportSupported.mockReturnValue(false)
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      expect(screen.queryByText(/MP4 exports keep encoding/)).not.toBeInTheDocument()
    })

    it('disables the MP4 choice in a browser that cannot encode it', () => {
      mockIsMP4ExportSupported.mockReturnValue(false)
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      fireEvent.click(advancedToggle())

      expect(screen.getByRole('radio', { name: /mp4/i })).toBeDisabled()
      expect(screen.getByText('Not supported in this browser')).toBeInTheDocument()
    })

    it('switches the advanced button label with the chosen format', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      fireEvent.click(advancedToggle())

      expect(screen.getAllByRole('button', { name: /download webm/i })).toHaveLength(2)

      fireEvent.click(screen.getByRole('radio', { name: /mp4/i }))

      expect(screen.getByRole('button', { name: /download mp4/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /download webm/i })).toBeInTheDocument()
    })

    it('moves the selection between the format radios', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      fireEvent.click(advancedToggle())

      const webm = screen.getByRole('radio', { name: /webm/i })
      const mp4 = screen.getByRole('radio', { name: /mp4/i })
      expect(webm).toBeChecked()

      fireEvent.click(mp4)
      expect(mp4).toBeChecked()
      expect(webm).not.toBeChecked()
    })
  })

  describe('closing', () => {
    it('closes from the Cancel button', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('closes from the × button', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      fireEvent.click(screen.getByRole('button', { name: '×' }))

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('closes when the backdrop is clicked but not the dialog itself', () => {
      const { container } = render(<ExportDialog isOpen={true} onClose={onClose} />)

      fireEvent.click(screen.getByRole('dialog'))
      expect(onClose).not.toHaveBeenCalled()

      fireEvent.click(container.querySelector(`.${styles.overlay}`)!)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('closes on Escape without letting the editor shortcuts see the key', () => {
      const editorShortcuts = vi.fn()
      document.addEventListener('keydown', editorShortcuts)
      try {
        render(<ExportDialog isOpen={true} onClose={onClose} />)

        fireEvent.keyDown(document, { key: 'Escape' })

        expect(onClose).toHaveBeenCalledTimes(1)
        expect(editorShortcuts).not.toHaveBeenCalled()
      } finally {
        document.removeEventListener('keydown', editorShortcuts)
      }
    })
  })

  describe('focus handling', () => {
    let restoreVisibility: () => void

    beforeEach(() => {
      restoreVisibility = pretendElementsAreVisible()
    })

    afterEach(() => {
      restoreVisibility()
    })

    it('moves focus into the dialog when it opens and back out when it closes', () => {
      const opener = document.createElement('button')
      document.body.appendChild(opener)
      opener.focus()

      const { rerender } = render(<ExportDialog isOpen={true} onClose={onClose} />)
      expect(screen.getByRole('button', { name: '×' })).toHaveFocus()

      rerender(<ExportDialog isOpen={false} onClose={onClose} />)
      expect(opener).toHaveFocus()

      opener.remove()
    })

    it('cycles focus forwards at the end of the dialog', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      const cancel = screen.getByRole('button', { name: /cancel/i })
      cancel.focus()

      fireEvent.keyDown(document, { key: 'Tab' })

      expect(screen.getByRole('button', { name: '×' })).toHaveFocus()
    })

    it('cycles focus backwards at the start of the dialog', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      screen.getByRole('button', { name: '×' }).focus()

      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })

      expect(screen.getByRole('button', { name: /cancel/i })).toHaveFocus()
    })

    it('leaves Tab alone in the middle of the dialog', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      const middle = primaryExport()
      middle.focus()

      fireEvent.keyDown(document, { key: 'Tab' })

      expect(middle).toHaveFocus()
    })

    it('ignores keys other than Tab and Escape', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      const middle = primaryExport()
      middle.focus()

      fireEvent.keyDown(document, { key: 'a' })

      expect(middle).toHaveFocus()
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('running an export', () => {
    it('exports the timeline with the default settings from the primary button', async () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      fireEvent.click(primaryExport())

      await waitFor(() => expect(mockExportToWebM).toHaveBeenCalledTimes(1))
      const [clips, sourceVideos, options, , tracks, signal, resolution] = webmArgs()
      expect(clips).toBe(store().project.timeline.clips)
      expect(sourceVideos).toBe(store().sourceVideos)
      expect(tracks).toBe(store().project.timeline.tracks)
      expect(resolution).toEqual({ width: 1920, height: 1080 })
      expect(options).toEqual({
        format: 'webm',
        quality: 'medium',
        resolution: 'project',
        timeRange: undefined,
      })
      expect(signal).toBeInstanceOf(AbortSignal)
      expect(mockSetSetting).not.toHaveBeenCalled()
    })

    it('exports with the configured settings from the advanced button', async () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      fireEvent.click(advancedToggle())
      fireEvent.change(screen.getByDisplayValue('Medium'), { target: { value: 'high' } })
      fireEvent.change(screen.getByDisplayValue('Project (1920x1080)'), { target: { value: '720p' } })

      fireEvent.click(advancedExport())

      await waitFor(() => expect(mockExportToWebM).toHaveBeenCalledTimes(1))
      expect(webmArgs()[2]).toEqual({
        format: 'webm',
        quality: 'high',
        resolution: '720p',
        timeRange: undefined,
      })
      expect(mockSetSetting).toHaveBeenCalledWith('lastExportSettings', {
        format: 'webm',
        quality: 'high',
        resolution: '720p',
      })
    })

    it('runs the MP4 encoder when MP4 is chosen', async () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      fireEvent.click(advancedToggle())
      fireEvent.click(screen.getByRole('radio', { name: /mp4/i }))

      fireEvent.click(screen.getByRole('button', { name: /download mp4/i }))

      await waitFor(() => expect(mockExportToMP4).toHaveBeenCalledTimes(1))
      expect(mockExportToWebM).not.toHaveBeenCalled()
      expect(mp4Args()[2].format).toBe('mp4')
      expect(mockAnalytics.exportStarted).toHaveBeenCalledWith('mp4')
    })

    it('falls back to WebM when MP4 is chosen in a browser without MP4 support', async () => {
      // The radio is disabled here, but a restored setting still asks for mp4.
      mockIsMP4ExportSupported.mockReturnValue(false)
      mockGetSetting.mockResolvedValue({ format: 'mp4', quality: 'medium', resolution: 'project' })
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      fireEvent.click(await screen.findByRole('button', { name: /download mp4/i }))

      await waitFor(() => expect(mockExportToWebM).toHaveBeenCalledTimes(1))
      expect(mockExportToMP4).not.toHaveBeenCalled()
      expect(webmArgs()[2].format).toBe('mp4')
      expect(mockAnalytics.exportStarted).toHaveBeenCalledWith('webm')
    })

    it('restores the last used settings and opens the advanced section', async () => {
      mockGetSetting.mockResolvedValue({ format: 'webm', quality: 'high', resolution: '720p' })

      render(<ExportDialog isOpen={true} onClose={onClose} />)

      expect(await screen.findByDisplayValue('High (slower export)')).toBeInTheDocument()
      expect(screen.getByDisplayValue('720p')).toBeInTheDocument()
      expect(mockGetSetting).toHaveBeenCalledWith('lastExportSettings')
    })

    it('downloads the finished file and tells the host about it', async () => {
      const exported = new Blob(['video-bytes'], { type: 'video/webm' })
      mockExportToWebM.mockResolvedValue(exported)
      const clickedLinks: HTMLAnchorElement[] = []
      const originalClick = HTMLAnchorElement.prototype.click
      HTMLAnchorElement.prototype.click = function () {
        clickedLinks.push(this as HTMLAnchorElement)
      }
      try {
        render(<ExportDialog isOpen={true} onClose={onClose} />)

        fireEvent.click(primaryExport())

        await waitFor(() => expect(screen.getByText('Export complete!')).toBeInTheDocument())
        expect(clickedLinks).toHaveLength(1)
        expect(clickedLinks[0].download).toBe('Test Project.webm')
        expect(URL.createObjectURL).toHaveBeenCalledWith(exported)
        expect(URL.revokeObjectURL).toHaveBeenCalled()
        expect(document.querySelector('a[download]')).toBeNull()
        expect(mockSendMessage).toHaveBeenCalledWith({
          type: 'EXPORT_COMPLETE',
          payload: { blob: exported, format: 'webm', name: 'Test Project.webm' },
        })
        expect(mockAnalytics.exportCompleted).toHaveBeenCalledWith('webm', 5)
      } finally {
        HTMLAnchorElement.prototype.click = originalClick
      }
    })

    it('names the file after the mp4 extension when exporting MP4', async () => {
      const exported = new Blob(['mp4-bytes'], { type: 'video/mp4' })
      mockExportToMP4.mockResolvedValue(exported)
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      fireEvent.click(advancedToggle())
      fireEvent.click(screen.getByRole('radio', { name: /mp4/i }))

      fireEvent.click(screen.getByRole('button', { name: /download mp4/i }))

      await waitFor(() => expect(mockSendMessage).toHaveBeenCalledTimes(1))
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'EXPORT_COMPLETE',
        payload: { blob: exported, format: 'mp4', name: 'Test Project.mp4' },
      })
    })

    it('falls back to a generic file name for an unnamed project', async () => {
      store().setProject({ ...store().project, name: '' })
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      fireEvent.click(primaryExport())

      await waitFor(() => expect(mockSendMessage).toHaveBeenCalledTimes(1))
      expect(mockSendMessage.mock.calls[0][0].payload.name).toBe('export.webm')
    })

    it('still completes the export when the host channel throws', async () => {
      mockExportToWebM.mockResolvedValue(new Blob(['video-bytes'], { type: 'video/webm' }))
      mockSendMessage.mockImplementation(() => {
        throw new Error('host channel is gone')
      })
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        render(<ExportDialog isOpen={true} onClose={onClose} />)

        fireEvent.click(primaryExport())

        await waitFor(() => expect(screen.getByText('Export complete!')).toBeInTheDocument())
        expect(screen.queryByText(/host channel is gone/i)).not.toBeInTheDocument()
        expect(errorLog).toHaveBeenCalledWith(
          'Failed to notify host of completed export:',
          expect.any(Error)
        )
      } finally {
        errorLog.mockRestore()
      }
    })

    it('closes itself a couple of seconds after finishing', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      fireEvent.click(primaryExport())
      await settle()
      expect(screen.getByText('Export complete!')).toBeInTheDocument()
      expect(onClose).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(2000)
      })

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('disables both export buttons for an empty timeline', () => {
      store().removeClipFromTimeline('clip1')
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      expect(screen.getByRole('button', { name: /download webm/i })).toBeDisabled()
      fireEvent.click(advancedToggle())
      expect(advancedExport()).toBeDisabled()
    })

    it('refuses to export once the timeline has been emptied underneath it', async () => {
      // The buttons disable themselves, but the WebM fallback offered after an
      // MP4 failure does not, so it is the one route back into handleExport.
      mockExportToMP4.mockRejectedValue(new Error('Encoder unavailable'))
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        render(<ExportDialog isOpen={true} onClose={onClose} />)
        fireEvent.click(advancedToggle())
        fireEvent.click(screen.getByRole('radio', { name: /mp4/i }))
        fireEvent.click(screen.getByRole('button', { name: /download mp4/i }))
        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())

        act(() => {
          store().removeClipFromTimeline('clip1')
        })
        fireEvent.click(screen.getByRole('button', { name: 'Try WebM Instead' }))
        await settle()

        expect(mockExportToWebM).not.toHaveBeenCalled()
      } finally {
        errorLog.mockRestore()
      }
    })
  })

  describe('progress and cancellation', () => {
    function scriptedExport() {
      let report: (p: ExportProgress) => void = () => {}
      let rejectExport: (e: unknown) => void = () => {}
      mockExportToWebM.mockImplementation(
        (...args: unknown[]) =>
          new Promise((_resolve, reject) => {
            report = args[3] as (p: ExportProgress) => void
            rejectExport = reject
          })
      )
      return {
        report: (p: ExportProgress) => act(() => report(p)),
        rejectExport: (e: unknown) => rejectExport(e),
      }
    }

    it('shows the phase, message and percentage the exporter reports', async () => {
      const scripted = scriptedExport()
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      fireEvent.click(primaryExport())
      expect(screen.getByText('preparing')).toBeInTheDocument()
      expect(screen.getByText('Preparing export...')).toBeInTheDocument()

      await scripted.report({ phase: 'encoding', progress: 42.4, message: 'Encoding frames' })

      expect(screen.getByText('encoding')).toBeInTheDocument()
      expect(screen.getByText('Encoding frames')).toBeInTheDocument()
      expect(screen.getByText('42%')).toBeInTheDocument()
      expect(
        document.querySelector<HTMLElement>(`.${styles.progressFill}`)!.style.width
      ).toBe('42.4%')
      // The export controls give way to a single Cancel button.
      expect(screen.queryByRole('button', { name: /download webm/i })).not.toBeInTheDocument()

      scripted.rejectExport(new ExportAbortedError())
      await settle()
    })

    it('aborts the running export when cancelled and reports no error', async () => {
      const scripted = scriptedExport()
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      fireEvent.click(primaryExport())
      await waitFor(() => expect(mockExportToWebM).toHaveBeenCalled())
      const signal = webmArgs()[5]
      expect(signal.aborted).toBe(false)

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

      expect(signal.aborted).toBe(true)
      expect(onClose).toHaveBeenCalledTimes(1)

      scripted.rejectExport(new ExportAbortedError())
      await settle()

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(mockSendMessage).not.toHaveBeenCalled()
    })

    it('hides the Cancel button once the export is complete', async () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      fireEvent.click(primaryExport())

      await waitFor(() => expect(screen.getByText('Export complete!')).toBeInTheDocument())
      expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument()
    })
  })

  describe('failures', () => {
    it('reports a WebM failure and keeps the export controls available', async () => {
      mockExportToWebM.mockRejectedValue(new Error('Encoding failed'))
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        render(<ExportDialog isOpen={true} onClose={onClose} />)

        fireEvent.click(primaryExport())

        await waitFor(() =>
          expect(screen.getByRole('alert')).toHaveTextContent('Export failed: Encoding failed')
        )
        expect(primaryExport()).toBeInTheDocument()
        expect(mockSendMessage).not.toHaveBeenCalled()
        expect(mockAnalytics.exportFailed).toHaveBeenCalledWith('webm', 'Error', 0)
      } finally {
        errorLog.mockRestore()
      }
    })

    it('describes a thrown non-Error as a plain export failure', async () => {
      mockExportToWebM.mockRejectedValue('kaboom')
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        render(<ExportDialog isOpen={true} onClose={onClose} />)

        fireEvent.click(primaryExport())

        await waitFor(() =>
          expect(screen.getByRole('alert')).toHaveTextContent('Export failed: Export failed')
        )
        expect(mockAnalytics.exportFailed).toHaveBeenCalledWith('webm', 'unknown', 0)
      } finally {
        errorLog.mockRestore()
      }
    })

    it('offers a WebM retry after an MP4 failure and logs the diagnostic trail', async () => {
      const log = [{ phase: 'encode', detail: 'encoder died', timestamp: 1 }]
      mockExportToMP4.mockRejectedValue(new ExportError('Encoder unavailable', log))
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      const debugLog = vi.spyOn(console, 'debug').mockImplementation(() => {})
      try {
        render(<ExportDialog isOpen={true} onClose={onClose} />)
        fireEvent.click(advancedToggle())
        fireEvent.click(screen.getByRole('radio', { name: /mp4/i }))
        fireEvent.click(screen.getByRole('button', { name: /download mp4/i }))

        await waitFor(() =>
          expect(screen.getByRole('alert')).toHaveTextContent(
            'MP4 export failed: Encoder unavailable'
          )
        )
        expect(debugLog).toHaveBeenCalledWith('[MP4 Export] Diagnostic log:', log)
        expect(mockAnalytics.exportFailed).toHaveBeenCalledWith('mp4', 'ExportError', 0)

        // The retry runs the WebM encoder with the same advanced settings.
        fireEvent.click(screen.getByRole('button', { name: 'Try WebM Instead' }))

        await waitFor(() => expect(mockExportToWebM).toHaveBeenCalledTimes(1))
        expect(webmArgs()[2]).toEqual({
          format: 'mp4',
          quality: 'medium',
          resolution: 'project',
          timeRange: undefined,
        })
      } finally {
        errorLog.mockRestore()
        debugLog.mockRestore()
      }
    })

    it('closes from the MP4 failure screen', async () => {
      mockExportToMP4.mockRejectedValue(new Error('Encoder unavailable'))
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        render(<ExportDialog isOpen={true} onClose={onClose} />)
        fireEvent.click(advancedToggle())
        fireEvent.click(screen.getByRole('radio', { name: /mp4/i }))
        fireEvent.click(screen.getByRole('button', { name: /download mp4/i }))

        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
        fireEvent.click(screen.getByRole('button', { name: 'Close' }))

        expect(onClose).toHaveBeenCalledTimes(1)
      } finally {
        errorLog.mockRestore()
      }
    })

    it('drops a stale error when the dialog is closed and reopened', async () => {
      mockExportToWebM.mockRejectedValue(new Error('Encoding failed'))
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const { rerender } = render(<ExportDialog isOpen={true} onClose={onClose} />)
        fireEvent.click(primaryExport())
        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())

        fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
        rerender(<ExportDialog isOpen={false} onClose={onClose} />)
        rerender(<ExportDialog isOpen={true} onClose={onClose} />)

        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      } finally {
        errorLog.mockRestore()
      }
    })
  })

  describe('exporting a section', () => {
    it('offers section and full-video buttons once in and out points are set', async () => {
      store().setInPoint(1)
      store().setOutPoint(4)
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      fireEvent.click(screen.getByRole('button', { name: /Export Section \(0:01 - 0:04\)/ }))

      await waitFor(() => expect(mockExportToWebM).toHaveBeenCalledTimes(1))
      expect(webmArgs()[2].timeRange).toEqual({ start: 1, end: 4 })
    })

    it('exports the whole timeline from the full-video button', async () => {
      store().setInPoint(1)
      store().setOutPoint(4)
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      fireEvent.click(screen.getByRole('button', { name: 'Export Full Video' }))

      await waitFor(() => expect(mockExportToWebM).toHaveBeenCalledTimes(1))
      expect(webmArgs()[2].timeRange).toBeUndefined()
    })

    it('orders a reversed in/out pair', () => {
      // The store's own setters swap a reversed pair, so drive the reversed
      // state in directly to prove the dialog orders it too.
      useEditorStore.setState({ inPoint: 4, outPoint: 1 })
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      expect(
        screen.getByRole('button', { name: /Export Section \(0:01 - 0:04\)/ })
      ).toBeInTheDocument()
    })

    it('prefers an explicit time range prop over the in/out points', async () => {
      store().setInPoint(1)
      store().setOutPoint(4)
      render(
        <ExportDialog isOpen={true} onClose={onClose} timeRange={{ start: 2, end: 3 }} />
      )

      fireEvent.click(screen.getByRole('button', { name: /Export Section \(0:02 - 0:03\)/ }))

      await waitFor(() => expect(mockExportToWebM).toHaveBeenCalledTimes(1))
      expect(webmArgs()[2].timeRange).toEqual({ start: 2, end: 3 })
    })

    it('keeps the single download button when only one point is set', () => {
      store().setInPoint(1)
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      expect(screen.getByRole('button', { name: /download webm/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Export Section/ })).not.toBeInTheDocument()
    })
  })
})
