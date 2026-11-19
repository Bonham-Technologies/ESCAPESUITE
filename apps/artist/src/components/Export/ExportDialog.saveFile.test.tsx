import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ExportDialog } from './ExportDialog'
import { ExportAbortedError, ExportError } from '../../core/exporter'
import type { ExportSink } from '../../core/saveFile'
import { resetStoreForTest, store, addClip } from '../../test/fixtures/projectStore'
import { domError, fakeFileHandle, installSavePicker, type FakeFileHandle } from '../../test/doubles/fileHandle'

/**
 * ESCSUITE-470: where the browser has the save picker, the export dialog asks
 * for the file first and the exporter writes into it. The exporters are
 * scripted here, as in `ExportDialog.test.tsx`; the sink is the real one, over
 * an in-memory handle.
 */
const { mockExportToWebM, mockExportToMP4, mockExportToGIF } = vi.hoisted(() => ({
  mockExportToWebM: vi.fn(),
  mockExportToMP4: vi.fn(),
  mockExportToGIF: vi.fn(),
}))

vi.mock('../../core/exporter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/exporter')>()),
  exportToWebM: mockExportToWebM,
  exportToMP4: mockExportToMP4,
  exportToGIF: mockExportToGIF,
  isMP4ExportSupported: () => Promise.resolve({ video: true, audio: true }),
  isWebMExportSupported: () => Promise.resolve({ video: true, audio: true }),
}))
vi.mock('../../core/storage', () => ({
  getSetting: () => Promise.resolve(undefined),
  setSetting: () => Promise.resolve(),
  revokeSourceThumbnails: vi.fn(),
}))
const { mockSendMessage } = vi.hoisted(() => ({ mockSendMessage: vi.fn() }))
vi.mock('../../utils/integration', () => ({ sendMessage: mockSendMessage }))
const { mockAnalytics } = vi.hoisted(() => ({
  mockAnalytics: { exportStarted: vi.fn(), exportCompleted: vi.fn(), exportFailed: vi.fn() },
}))
vi.mock('../../utils/analytics', () => ({ analytics: mockAnalytics }))

const primaryExport = () => screen.getByRole('button', { name: /download webm/i })
const picker = () => (window as unknown as { showSaveFilePicker: ReturnType<typeof vi.fn> }).showSaveFilePicker

/** An exporter that writes `bytes` through the sink it is handed, as the muxer does. */
const writesThroughSink = (bytes: number[]) => async (...args: unknown[]) => {
  const sink = args[7] as ExportSink
  const writer = sink.writable.getWriter()
  await writer.write({ type: 'write', data: new Uint8Array(bytes), position: 0 })
  await writer.close()
  return { blob: await sink.finish('video/webm'), audio: true }
}

/** An exporter that runs until its signal is aborted, writing once first. */
const runsUntilAborted = async (...args: unknown[]) => {
  const signal = args[5] as AbortSignal
  const sink = args[7] as ExportSink
  const writer = sink.writable.getWriter()
  await writer.write({ type: 'write', data: new Uint8Array([1]), position: 0 })
  writer.releaseLock()
  await new Promise((resolve) => signal.addEventListener('abort', resolve))
  throw new ExportAbortedError()
}

describe('ExportDialog: saving to a picked file (ESCSUITE-470)', () => {
  let file: FakeFileHandle
  let uninstall: () => void
  let clickedLinks: HTMLAnchorElement[]
  let originalAnchorClick: () => void

  beforeEach(() => {
    vi.clearAllMocks()
    file = fakeFileHandle('Test Project.webm')
    uninstall = installSavePicker(async () => file.handle)
    clickedLinks = []
    originalAnchorClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clickedLinks.push(this)
    }
    mockExportToWebM.mockReset()
    mockExportToMP4.mockReset()
    mockExportToGIF.mockReset()
    resetStoreForTest()
    store().setProject({ ...store().project, name: 'Test Project' })
    addClip('clip1', 0, 5)
  })

  afterEach(() => {
    uninstall()
    HTMLAnchorElement.prototype.click = originalAnchorClick
  })

  it('asks for the file first, streams the export into it and downloads nothing', async () => {
    mockExportToWebM.mockImplementation(writesThroughSink([1, 2, 3]))
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />)

    fireEvent.click(primaryExport())

    expect(picker()).toHaveBeenCalledWith({
      suggestedName: 'Test Project.webm',
      types: [{ description: 'WebM video', accept: { 'video/webm': ['.webm'] } }],
    })
    await waitFor(() => expect(screen.getAllByText(/Export complete! Saved to Test Project\.webm\./).length).toBeGreaterThan(0))
    expect(file.bytes()).toEqual([1, 2, 3])
    expect(clickedLinks).toHaveLength(0)
    // A host still gets the finished file: the one on disk.
    const payload = mockSendMessage.mock.calls[0][0].payload
    expect(payload.name).toBe('Test Project.webm')
    expect([...new Uint8Array(await payload.blob.arrayBuffer())]).toEqual([1, 2, 3])
  })

  it('starts nothing when the picker is cancelled', async () => {
    uninstall()
    uninstall = installSavePicker(() => Promise.reject(domError('AbortError')))
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />)

    fireEvent.click(primaryExport())

    await waitFor(() => expect(picker()).toHaveBeenCalled())
    await Promise.resolve()
    expect(mockExportToWebM).not.toHaveBeenCalled()
    expect(mockAnalytics.exportStarted).not.toHaveBeenCalled()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says so when the picker fails, and starts nothing', async () => {
    uninstall()
    uninstall = installSavePicker(() => Promise.reject(domError('NotAllowedError', 'File picker already active.')))
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />)

    fireEvent.click(primaryExport())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Export failed: Could not choose where to save: File picker already active.'
    )
    expect(mockExportToWebM).not.toHaveBeenCalled()
  })

  it('downloads as before where the page may not open the picker', async () => {
    uninstall()
    uninstall = installSavePicker(() => Promise.reject(domError('SecurityError')))
    mockExportToWebM.mockResolvedValue({ blob: new Blob([new Uint8Array([5])]), audio: true })
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />)

    fireEvent.click(primaryExport())

    await waitFor(() => expect(clickedLinks).toHaveLength(1))
    expect(clickedLinks[0].download).toBe('Test Project.webm')
    expect(mockExportToWebM.mock.calls[0][7]).toBeUndefined()
  })

  it('stops the export on a full disk, says so, and leaves no file', async () => {
    mockExportToWebM.mockImplementation(runsUntilAborted)
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />)
    fireEvent.click(primaryExport())
    await waitFor(() => expect(file.streams).toHaveLength(1))
    file.streams[0].write.mockRejectedValueOnce(domError('QuotaExceededError'))

    // The next write the muxer makes is refused.
    const sink = mockExportToWebM.mock.calls[0][7] as ExportSink
    await sink.writable.getWriter().write({ type: 'write', data: new Uint8Array([2]), position: 1 })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Export failed: Could not write "Test Project.webm": the disk is full.'
    )
    // Not a codec problem: MP4 would go to the same disk.
    expect(screen.queryByRole('button', { name: /try mp4/i })).not.toBeInTheDocument()
    expect(file.remove).toHaveBeenCalled()
    expect(file.bytes()).toBeNull()
    expect(mockAnalytics.exportFailed).toHaveBeenCalledWith('webm', 'FileWriteError', expect.any(Number))
  })

  it('shows a failed MP4 write as the error it is, not as a reason to try WebM', async () => {
    mockExportToMP4.mockImplementation(async (...args: unknown[]) => {
      const sink = args[7] as ExportSink
      await sink.writable.getWriter().write({ type: 'write', data: new Uint8Array([1]), position: 0 })
      ;(file.streams[0].close as ReturnType<typeof vi.fn>).mockRejectedValueOnce(domError('NotAllowedError'))
      try {
        return { blob: await sink.finish('video/mp4'), audio: true }
      } catch (error) {
        // As the exporter does: anything that is not its own error is wrapped.
        throw new ExportError((error as Error).message, [])
      }
    })
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /advanced options/i }))
    fireEvent.click(screen.getByRole('radio', { name: /mp4/i }))
    const buttons = screen.getAllByRole('button', { name: /download mp4/i })
    fireEvent.click(buttons[buttons.length - 1])

    expect(await screen.findByRole('alert')).toHaveTextContent('permission to write to it was taken away')
    expect(screen.queryByRole('button', { name: /try webm/i })).not.toBeInTheDocument()
  })

  it('throws the bytes away when the user cancels mid-export', async () => {
    const onClose = vi.fn()
    mockExportToWebM.mockImplementation(runsUntilAborted)
    render(<ExportDialog isOpen={true} onClose={onClose} />)
    fireEvent.click(primaryExport())
    await waitFor(() => expect(file.streams[0]?.write).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(file.remove).toHaveBeenCalled())
    expect(file.streams[0].abort).toHaveBeenCalled()
    expect(file.bytes()).toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onClose).toHaveBeenCalled()
  })

  it('writes a GIF, which cannot stream, to the file once it is encoded', async () => {
    file = fakeFileHandle('Test Project.gif')
    mockExportToGIF.mockResolvedValue({ blob: new Blob([new Uint8Array([7, 7])], { type: 'image/gif' }), audio: false })
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /advanced options/i }))
    fireEvent.click(screen.getByRole('radio', { name: /gif/i }))
    const buttons = screen.getAllByRole('button', { name: /download gif/i })
    fireEvent.click(buttons[buttons.length - 1])

    await waitFor(() => expect(file.bytes()).toEqual([7, 7]))
    expect(picker().mock.calls[0][0].suggestedName).toBe('Test Project.gif')
    expect(clickedLinks).toHaveLength(0)
  })

  it('reports a file it cannot open for writing', async () => {
    ;(file.handle as unknown as { createWritable: () => Promise<never> }).createWritable = () =>
      Promise.reject(domError('NotAllowedError'))
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />)

    fireEvent.click(primaryExport())

    expect(await screen.findByRole('alert')).toHaveTextContent('permission to write to it was taken away')
    expect(mockExportToWebM).not.toHaveBeenCalled()
  })
})
