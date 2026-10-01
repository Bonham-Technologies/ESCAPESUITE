import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { ExportDialog } from './ExportDialog'
import { ExportAbortedError, ExportError } from '../../core/exporter'
import { useEditorStore } from '../../store/projectStore'
import { resetStoreForTest, store, addClip } from '../../test/fixtures/projectStore'
import type { ExportProgress } from '../../store/types'
import styles from './ExportDialog.module.css'
import { lastObjectUrl } from '../../test/objectUrls'

// The exporter itself is driven by its own suite; here it is a scripted
// collaborator. The real error classes come through importOriginal so the
// dialog's instanceof checks are the ones production runs.
const { mockExportToWebM, mockExportToMP4, mockIsMP4ExportSupported, mockIsWebMExportSupported } = vi.hoisted(() => ({
  mockExportToWebM: vi.fn(),
  mockExportToMP4: vi.fn(),
  mockIsMP4ExportSupported: vi.fn(() => true),
  mockIsWebMExportSupported: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('../../core/exporter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/exporter')>()),
  exportToWebM: mockExportToWebM,
  exportToMP4: mockExportToMP4,
  isMP4ExportSupported: mockIsMP4ExportSupported,
  isWebMExportSupported: mockIsWebMExportSupported,
}))

const { mockGetSetting, mockSetSetting } = vi.hoisted(() => ({
  mockGetSetting: vi.fn((): Promise<unknown> => Promise.resolve(undefined)),
  mockSetSetting: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../core/storage', () => ({
  getSetting: mockGetSetting,
  setSetting: mockSetSetting,
  // resetStoreForTest() below drives the real store's resetProject(), which
  // calls this to free a torn-down source's thumbnailUrl (ESCSUITE-113) —
  // nothing here exercises it directly, so a quiet no-op is enough.
  revokeSourceThumbnails: vi.fn(),
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
  // Every successful export clicks a download anchor, which jsdom answers with
  // a "Not implemented: navigation" warning. Record the clicks instead.
  let clickedLinks: HTMLAnchorElement[]
  let originalAnchorClick: () => void

  beforeEach(() => {
    vi.clearAllMocks()
    onClose = vi.fn()
    clickedLinks = []
    originalAnchorClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clickedLinks.push(this)
    }
    mockExportToWebM.mockReset()
    mockExportToWebM.mockResolvedValue(new Blob())
    mockExportToMP4.mockReset()
    mockExportToMP4.mockResolvedValue(new Blob())
    mockSendMessage.mockReset()
    mockIsMP4ExportSupported.mockReturnValue(true)
    mockIsWebMExportSupported.mockReset()
    mockIsWebMExportSupported.mockResolvedValue(true)
    mockGetSetting.mockResolvedValue(undefined)

    resetStoreForTest()
    store().setProject({ ...store().project, name: 'Test Project' })
    addClip('clip1', 0, 5)
  })

  afterEach(() => {
    HTMLAnchorElement.prototype.click = originalAnchorClick
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
      expect(screen.getByText('1080p — 1920×1080')).toBeInTheDocument()
      expect(screen.getByText('720p — 1280×720')).toBeInTheDocument()
      expect(screen.getByText('480p — 854×480')).toBeInTheDocument()
    })

    it('offers the project resolution from the store', () => {
      store().setProjectResolution(1280, 720)
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      fireEvent.click(advancedToggle())

      expect(screen.getByText('Project — 1280×720')).toBeInTheDocument()
    })

    it('prints every preset\'s dimensions against the project\'s own aspect, ESCSUITE-111', () => {
      // A preset's width follows the *project's* aspect (ESCSUITE-94), so a
      // portrait project makes "1080p" narrower than 1920 — a bare "1080p"
      // label would be surprising. Printing the dimensions makes the rule
      // self-evident right in the dropdown.
      store().setProjectResolution(1080, 1920)
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      fireEvent.click(advancedToggle())

      expect(screen.getByText('Project — 1080×1920')).toBeInTheDocument()
      expect(screen.getByText('1080p — 608×1080')).toBeInTheDocument()
      expect(screen.getByText('720p — 406×720')).toBeInTheDocument()
      expect(screen.getByText('480p — 270×480')).toBeInTheDocument()
    })

    it('mentions background-tab encoding only where MP4 is available', () => {
      const { unmount } = render(<ExportDialog isOpen={true} onClose={onClose} />)
      // Softened (ESCSUITE-153/29 review, MINOR-4): this is a hedge, not a
      // guarantee — a decode worker that fails to start falls back to the
      // same throttled-in-background element path WebM always uses.
      expect(
        screen.getByText(/MP4 exports keep encoding in a background tab when the decoder is available/)
      ).toBeInTheDocument()
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

    // Coverage round: the test above only ever fires the MP4 radio's own
    // onChange (webm is already selected by default, so switching away from
    // it never exercises webm's). Switching to MP4 and back exercises both,
    // and the Advanced export (effective format, and the setting persisted
    // for next time) confirms the switch actually took, not just the radio's
    // own `checked` state.
    it('switches back to WebM after MP4, and the Advanced export reflects it', async () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      fireEvent.click(advancedToggle())

      const webm = screen.getByRole('radio', { name: /webm/i })
      const mp4 = screen.getByRole('radio', { name: /mp4/i })

      fireEvent.click(mp4)
      expect(mp4).toBeChecked()

      fireEvent.click(webm)
      expect(webm).toBeChecked()
      expect(mp4).not.toBeChecked()

      fireEvent.click(advancedExport())

      await waitFor(() => expect(mockExportToWebM).toHaveBeenCalledTimes(1))
      expect(mockExportToMP4).not.toHaveBeenCalled()
      expect(mockSetSetting).toHaveBeenCalledWith(
        'lastExportSettings',
        expect.objectContaining({ format: 'webm' })
      )
    })
  })

  // ESCSUITE-22/29: isWebMExportSupported() is a real codec probe now, so the
  // dialog has three states — both formats possible (the `rendering` suite
  // above exercises this one throughout), only one, or neither — and each
  // says so before the user can click into a dead end.
  describe('browser support', () => {
    it('offers both formats when both can be exported', async () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()

      expect(primaryExport()).toBeEnabled()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('disables WebM with its own reason when only MP4 can be exported, leaving MP4 reachable', async () => {
      mockIsWebMExportSupported.mockResolvedValue(false)
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()

      expect(primaryExport()).toBeDisabled()
      expect(primaryExport()).toHaveAttribute('title', 'This browser cannot encode WebM video — Chrome or Edge can.')
      expect(
        screen.getByText(/This browser cannot encode WebM video.*Choose MP4 under Advanced options to export anyway\./)
      ).toBeInTheDocument()
      // Not the "neither" sentence — MP4 is still available.
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()

      fireEvent.click(advancedToggle())
      expect(screen.getByRole('radio', { name: /webm/i })).toBeDisabled()
      expect(screen.getByRole('radio', { name: /mp4/i })).toBeEnabled()

      fireEvent.click(screen.getByRole('radio', { name: /mp4/i }))
      fireEvent.click(screen.getByRole('button', { name: /download mp4/i }))

      await waitFor(() => expect(mockExportToMP4).toHaveBeenCalledTimes(1))
    })

    it('disables both formats with one sentence, in the main body, when neither can be exported', async () => {
      mockIsMP4ExportSupported.mockReturnValue(false)
      mockIsWebMExportSupported.mockResolvedValue(false)
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Exporting needs WebCodecs, which this browser does not provide. Chrome or Edge can export this project.'
      )
      expect(primaryExport()).toBeDisabled()

      // Not hidden behind the collapsed Advanced panel.
      expect(advancedToggle()).toHaveAttribute('aria-expanded', 'false')
    })

    // Review round 1, MAJOR 1: the primary buttons were disabled, but the
    // Advanced "Download {format}" button was gated on `clips.length === 0`
    // alone — one click into the panel the dialog itself points you at
    // ("Advanced options") reached a button that still ran the failing
    // export.
    it('disables the Advanced download button too, with the same sentence, when neither format can be exported', async () => {
      mockIsMP4ExportSupported.mockReturnValue(false)
      mockIsWebMExportSupported.mockResolvedValue(false)
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()
      fireEvent.click(advancedToggle())

      const advanced = advancedExport()
      expect(advanced).toBeDisabled()
      expect(advanced).toHaveAttribute(
        'title',
        'Exporting needs WebCodecs, which this browser does not provide. Chrome or Edge can export this project.'
      )
      fireEvent.click(advanced)
      expect(mockExportToWebM).not.toHaveBeenCalled()
    })

    // Review round 2: `effectiveAdvancedFormat`'s `&& mp4Supported` operand is
    // only reached when `advancedOptions.format === 'mp4'` — the test above
    // never selects MP4, so it always short-circuits before touching this
    // operand. A restored `{format:'mp4'}` setting does select it, and in a
    // browser with neither format is exactly the dangerous case: without this
    // operand, `effectiveAdvancedFormat` would read 'mp4' regardless of
    // `mp4Supported`, `advancedBlockedReason` would resolve to `null` (it is
    // only ever `webmBlockedReason`, and only when the effective format is
    // 'webm'), and the dialog would open straight onto an enabled
    // "Download MP4" that `handleExport` itself would still run as WebM
    // (its own, separate fallback) — into `exportWebM.ts`'s
    // "requires WebCodecs API" throw, in the one browser this ticket exists
    // to warn before any click.
    it('disables the Advanced button for a restored MP4 setting when neither format can be exported', async () => {
      mockIsMP4ExportSupported.mockReturnValue(false)
      mockIsWebMExportSupported.mockResolvedValue(false)
      mockGetSetting.mockResolvedValue({ format: 'mp4', quality: 'medium', resolution: 'project' })
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()

      const advanced = await screen.findByRole('button', { name: /download mp4/i })
      expect(advanced).toBeDisabled()
      expect(advanced).toHaveAttribute(
        'title',
        'Exporting needs WebCodecs, which this browser does not provide. Chrome or Edge can export this project.'
      )
      fireEvent.click(advanced)
      expect(mockExportToWebM).not.toHaveBeenCalled()
      expect(mockExportToMP4).not.toHaveBeenCalled()
    })

    it('probes at the resolution the selected preset will actually export, not the raw project size', async () => {
      store().setProjectResolution(1920, 1080)
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()

      expect(mockIsWebMExportSupported).toHaveBeenCalledWith(1920, 1080)
      mockIsWebMExportSupported.mockClear()

      // Switching to the 720p preset re-probes at 720p's own dimensions —
      // the ones `exportToWebM` will actually configure the encoder at —
      // rather than leaving the stale 1080p answer in place.
      fireEvent.click(advancedToggle())
      fireEvent.change(screen.getByDisplayValue('Project — 1920×1080'), { target: { value: '720p' } })
      await settle()

      expect(mockIsWebMExportSupported).toHaveBeenCalledWith(1280, 720)
    })

    it('probes once per dialog open, not once per render', async () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()
      expect(mockIsWebMExportSupported).toHaveBeenCalledTimes(1)

      // Neither toggling the disclosure nor changing quality/format touches
      // the probe's own dependencies (isOpen, project size, resolution
      // preset), so re-rendering for these must not re-probe.
      fireEvent.click(advancedToggle())
      fireEvent.click(screen.getByRole('radio', { name: /mp4/i }))
      fireEvent.change(screen.getByDisplayValue('Medium'), { target: { value: 'high' } })
      await settle()

      expect(mockIsWebMExportSupported).toHaveBeenCalledTimes(1)
    })

    // Review round 1, MAJOR 2(a): the `cancelled` guard in the probe's effect
    // cleanup is the ESCSUITE-98 run-identity shape — without it, a probe
    // started by an earlier open can still overwrite a later one's answer
    // once it finally resolves.
    it('does not let a stale probe from an earlier open overwrite a later one', async () => {
      let resolveStale!: (supported: boolean) => void
      mockIsWebMExportSupported.mockReturnValueOnce(
        new Promise<boolean>((resolve) => {
          resolveStale = resolve
        })
      )
      const { rerender } = render(<ExportDialog isOpen={true} onClose={onClose} />)

      // Close before the first probe ever resolves.
      rerender(<ExportDialog isOpen={false} onClose={onClose} />)

      // Reopen; the second probe (the default mock) resolves true.
      rerender(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()
      expect(primaryExport()).toBeEnabled()

      // The stale first probe now resolves false. It must not undo the
      // current (correct) answer.
      resolveStale(false)
      await settle()

      expect(primaryExport()).toBeEnabled()
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

    it('cycles focus backwards from the dialog container itself', () => {
      // The container is `tabIndex={-1}`: not in the tab order, but a click on
      // the dialog's own padding — or on any of the non-focusable content
      // inside it — parks focus here. Shift+Tab from that position used to fall
      // through every arm of the trap (`active` is neither the first control
      // nor outside the dialog), so the browser walked focus backwards *out* of
      // an `aria-modal` dialog and onto the editor behind it.
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      const dialog = screen.getByRole('dialog')
      dialog.focus()
      expect(dialog).toHaveFocus()

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
      fireEvent.change(screen.getByDisplayValue('Project — 1920×1080'), { target: { value: '720p' } })

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
      expect(screen.getByDisplayValue('720p — 1280×720')).toBeInTheDocument()
      expect(mockGetSetting).toHaveBeenCalledWith('lastExportSettings')
    })

    it('downloads the finished file and tells the host about it', async () => {
      const exported = new Blob(['video-bytes'], { type: 'video/webm' })
      mockExportToWebM.mockResolvedValue(exported)
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      fireEvent.click(primaryExport())

      await waitFor(() => expect(screen.getByText('Export complete!')).toBeInTheDocument())
      expect(clickedLinks).toHaveLength(1)
      expect(clickedLinks[0].download).toBe('Test Project.webm')
      expect(clickedLinks[0].href).toBe(lastObjectUrl())
      expect(URL.createObjectURL).toHaveBeenCalledWith(exported)
      expect(URL.revokeObjectURL).toHaveBeenCalled()
      expect(document.querySelector('a[download]')).toBeNull()
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'EXPORT_COMPLETE',
        payload: { blob: exported, format: 'webm', name: 'Test Project.webm' },
      })
      expect(mockAnalytics.exportCompleted).toHaveBeenCalledWith('webm', 5)
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

    // ESCSUITE-153 / ESCSUITE-29 Mechanism 2 review (MINOR-4): the exporter's
    // own fallback notice (exportMP4.test.ts pins that it is sent) has to
    // actually reach the user through this same generic progress-message
    // rendering — this pins the dialog side of that contract.
    it("shows the exporter's own notice when MP4 has fallen back to in-page decoding", async () => {
      let report: (p: ExportProgress) => void = () => {}
      let rejectExport: (e: unknown) => void = () => {}
      mockExportToMP4.mockImplementation(
        (...args: unknown[]) =>
          new Promise((_resolve, reject) => {
            report = args[3] as (p: ExportProgress) => void
            rejectExport = reject
          })
      )

      render(<ExportDialog isOpen={true} onClose={onClose} />)
      fireEvent.click(advancedToggle())
      fireEvent.click(screen.getByRole('radio', { name: /mp4/i }))
      fireEvent.click(screen.getByRole('button', { name: /download mp4/i }))

      await waitFor(() => expect(mockExportToMP4).toHaveBeenCalledTimes(1))
      await act(async () => report({
        phase: 'preparing',
        progress: 12,
        message: 'Decoding in the page; keep this tab in the foreground',
      }))

      expect(screen.getByText('Decoding in the page; keep this tab in the foreground')).toBeInTheDocument()

      rejectExport(new ExportAbortedError())
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

      // A late progress report from the run Cancel just stopped must not
      // resurrect it: handleCancel clears latestExportRef too, so this
      // solo run's own onProgress is now inert, not just a later run's.
      await scripted.report({ phase: 'encoding', progress: 77, message: 'Should not appear' })
      expect(screen.queryByText('Should not appear')).not.toBeInTheDocument()
      expect(primaryExport()).toBeInTheDocument()

      scripted.rejectExport(new ExportAbortedError())
      await settle()

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(mockSendMessage).not.toHaveBeenCalled()
    })

    /** Like scriptedExport, but tracks every call so two overlapping exports
     * can be driven independently — export A cancelled, then export B
     * started before A's promise actually settles. */
    function scriptedExports() {
      const calls: Array<{
        report: (p: ExportProgress) => void
        resolve: (blob: Blob) => void
        reject: (e: unknown) => void
      }> = []
      mockExportToWebM.mockImplementation(
        (...args: unknown[]) =>
          new Promise((resolve, reject) => {
            calls.push({ report: args[3] as (p: ExportProgress) => void, resolve, reject })
          })
      )
      return calls
    }

    it("does not let export A's late rejection clear export B's abort controller (ESCSUITE-98)", async () => {
      const calls = scriptedExports()
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      // Export A starts, then is cancelled. The dialog stays mounted between
      // opens (as it does in the real app), so its abort controller ref
      // survives past the Cancel click.
      fireEvent.click(primaryExport())
      await waitFor(() => expect(calls).toHaveLength(1))
      const signalA = webmArgs()[5]
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
      expect(signalA.aborted).toBe(true)

      // Export B starts before A's promise has actually settled.
      fireEvent.click(primaryExport())
      await waitFor(() => expect(calls).toHaveLength(2))
      const signalB = mockExportToWebM.mock.calls[1][5] as AbortSignal
      expect(signalB.aborted).toBe(false)

      // A's aborted promise rejects late — its own `finally` runs after B's
      // controller is already sitting in the ref.
      calls[0].reject(new ExportAbortedError())
      await settle()

      // Cancelling now must abort B: the button on screen is for B's export.
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
      expect(signalB.aborted).toBe(true)
    })

    it("keeps export B's progress showing while export A's cancelled promise reports late and then rejects (ESCSUITE-98)", async () => {
      const calls = scriptedExports()
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      fireEvent.click(primaryExport())
      await waitFor(() => expect(calls).toHaveLength(1))
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

      fireEvent.click(primaryExport())
      await waitFor(() => expect(calls).toHaveLength(2))
      await act(async () => calls[1].report({ phase: 'encoding', progress: 55, message: 'Encoding frames' }))
      expect(screen.getByText('55%')).toBeInTheDocument()

      // A keeps reporting progress after being superseded — its own onProgress
      // callback must be inert now, not overwrite B's.
      await act(async () => calls[0].report({ phase: 'encoding', progress: 10, message: 'Stale report' }))
      expect(screen.getByText('55%')).toBeInTheDocument()
      expect(screen.queryByText('Stale report')).not.toBeInTheDocument()

      calls[0].reject(new ExportAbortedError())
      await settle()

      // B is still exporting: its progress is still on screen and Cancel
      // still targets a live export rather than a no-op on a finished dialog.
      expect(screen.getByText('55%')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    })

    it("does not let export A's late (non-abort) success flip export B's dialog to complete, download A's file, or notify a host about it (ESCSUITE-98)", async () => {
      const calls = scriptedExports()
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      fireEvent.click(primaryExport())
      await waitFor(() => expect(calls).toHaveLength(1))
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

      fireEvent.click(primaryExport())
      await waitFor(() => expect(calls).toHaveLength(2))
      await act(async () => calls[1].report({ phase: 'encoding', progress: 40, message: 'Encoding frames' }))
      expect(screen.getByText('40%')).toBeInTheDocument()

      // A actually finishes successfully despite being cancelled — a
      // defensive edge case the exporter's own abort re-check is meant to
      // prevent, but the dialog must not trust it blindly either.
      const staleBlob = new Blob(['stale-a-bytes'])
      await act(async () => {
        calls[0].resolve(staleBlob)
        await Promise.resolve()
        await Promise.resolve()
      })
      await settle()

      // B's progress must still be on screen — A's stale success must not
      // have flipped the dialog to "complete" or scheduled its own close.
      expect(screen.getByText('40%')).toBeInTheDocument()
      expect(screen.queryByText('Export complete!')).not.toBeInTheDocument()

      // Nor must A's stale success have downloaded its file or told an
      // embedding host about it — that side effect belongs only to the
      // export the user is actually looking at.
      expect(clickedLinks).toHaveLength(0)
      expect(URL.createObjectURL).not.toHaveBeenCalledWith(staleBlob)
      expect(mockSendMessage).not.toHaveBeenCalled()
    })

    it("does not let export A's late (non-abort) failure reset export B's progress or show an error (ESCSUITE-98)", async () => {
      const calls = scriptedExports()
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        render(<ExportDialog isOpen={true} onClose={onClose} />)

        fireEvent.click(primaryExport())
        await waitFor(() => expect(calls).toHaveLength(1))
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

        fireEvent.click(primaryExport())
        await waitFor(() => expect(calls).toHaveLength(2))
        await act(async () => calls[1].report({ phase: 'encoding', progress: 60, message: 'Encoding frames' }))
        expect(screen.getByText('60%')).toBeInTheDocument()

        calls[0].reject(new Error('Stale encoder failure'))
        await settle()

        // B's progress must still be on screen and no error banner from A's
        // stale failure should appear over it.
        expect(screen.getByText('60%')).toBeInTheDocument()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      } finally {
        errorLog.mockRestore()
      }
    })

    it("does not let export A's delayed self-close fire once export B is already running (ESCSUITE-98)", async () => {
      // The × renders unconditionally, even while a finished export is
      // sitting in its 2 s "complete" window — so a user can close out of A,
      // start B, and only then have A's pending self-close timer fire.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      // A finishes normally and schedules its own close two seconds out.
      fireEvent.click(primaryExport())
      await settle()
      expect(screen.getByText('Export complete!')).toBeInTheDocument()

      // The user closes via × before that timer fires...
      fireEvent.click(screen.getByTitle('Close'))
      expect(onClose).toHaveBeenCalledTimes(1)

      // ...and starts a second export before A's pending timeout does.
      // (waitFor's own polling relies on real timers, so with fake ones
      // active the mock's synchronous call — it pushes onto `calls` the
      // instant `exportToWebM` runs, before its promise ever resolves — is
      // asserted directly instead.)
      const calls = scriptedExports()
      fireEvent.click(primaryExport())
      expect(calls).toHaveLength(1)
      await act(async () => calls[0].report({ phase: 'encoding', progress: 65, message: 'Encoding frames' }))
      expect(screen.getByText('65%')).toBeInTheDocument()

      // A's 2 s timeout now fires. It must be inert: no second onClose call,
      // and B's progress must be untouched.
      act(() => {
        vi.advanceTimersByTime(2000)
      })

      expect(screen.getByText('65%')).toBeInTheDocument()
      expect(onClose).toHaveBeenCalledTimes(1)
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

    // ESCSUITE-29 Mechanism 1: a WebM ExportError is a diagnosed codec
    // problem (the probe found nothing, or the encoder failed mid-export)
    // rather than a generic crash — mirroring MP4's own "Try WebM Instead",
    // offer MP4 as a one-click alternative when it is actually available.
    it('offers an MP4 retry after a WebM ExportError, with the codec\'s own words', async () => {
      const log = [{ phase: 'codec', detail: 'no supported video codec', timestamp: 1 }]
      mockExportToWebM.mockRejectedValue(
        new ExportError('No supported video codec found. WebM export requires VP9 or VP8 support.', log)
      )
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      const debugLog = vi.spyOn(console, 'debug').mockImplementation(() => {})
      try {
        render(<ExportDialog isOpen={true} onClose={onClose} />)
        fireEvent.click(primaryExport())

        await waitFor(() =>
          expect(screen.getByRole('alert')).toHaveTextContent(
            'Export failed: No supported video codec found. WebM export requires VP9 or VP8 support.'
          )
        )
        expect(debugLog).toHaveBeenCalledWith('[WebM Export] Diagnostic log:', log)

        const retry = screen.getByRole('button', { name: 'Try MP4 Instead' })
        fireEvent.click(retry)

        await waitFor(() => expect(mockExportToMP4).toHaveBeenCalledTimes(1))
        expect(mp4Args()[2]).toEqual({
          format: 'webm',
          quality: 'medium',
          resolution: 'project',
          timeRange: undefined,
        })
      } finally {
        errorLog.mockRestore()
        debugLog.mockRestore()
      }
    })

    it('does not offer an MP4 retry for a plain WebM failure', async () => {
      mockExportToWebM.mockRejectedValue(new Error('Encoding failed'))
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        render(<ExportDialog isOpen={true} onClose={onClose} />)
        fireEvent.click(primaryExport())

        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
        expect(screen.queryByRole('button', { name: 'Try MP4 Instead' })).not.toBeInTheDocument()
      } finally {
        errorLog.mockRestore()
      }
    })

    // Review round 1, MAJOR 2(b): `setOfferMp4Fallback` checks
    // `err instanceof ExportError && mp4Supported` — this is the
    // `&& mp4Supported` half, which the test above never exercised (it used
    // a plain Error, not an ExportError).
    it('does not offer an MP4 retry for a WebM ExportError when MP4 is unsupported', async () => {
      mockIsMP4ExportSupported.mockReturnValue(false)
      const log = [{ phase: 'codec', detail: 'no supported video codec', timestamp: 1 }]
      mockExportToWebM.mockRejectedValue(
        new ExportError('No supported video codec found. WebM export requires VP9 or VP8 support.', log)
      )
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      const debugLog = vi.spyOn(console, 'debug').mockImplementation(() => {})
      try {
        render(<ExportDialog isOpen={true} onClose={onClose} />)
        fireEvent.click(primaryExport())

        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
        expect(screen.queryByRole('button', { name: 'Try MP4 Instead' })).not.toBeInTheDocument()
      } finally {
        errorLog.mockRestore()
        debugLog.mockRestore()
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

    // Review round 1, MINOR 5: the MP4 failure screen's "Try WebM Instead"
    // was gated only on `mp4FailedError` — exactly the browser the WebM
    // probe exists to catch (WebCodecs present, no usable codec) reaches MP4
    // failing with WebM also unsupported, and used to still hand back a
    // recovery button that could not work either.
    it('disables the WebM retry on the MP4 failure screen when WebM is also unsupported', async () => {
      mockIsWebMExportSupported.mockResolvedValue(false)
      mockExportToMP4.mockRejectedValue(new Error('Encoder unavailable'))
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        render(<ExportDialog isOpen={true} onClose={onClose} />)
        await settle()
        fireEvent.click(advancedToggle())
        fireEvent.click(screen.getByRole('radio', { name: /mp4/i }))
        fireEvent.click(screen.getByRole('button', { name: /download mp4/i }))

        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
        const retry = screen.getByRole('button', { name: 'Try WebM Instead' })
        expect(retry).toBeDisabled()
        expect(retry).toHaveAttribute('title', 'This browser cannot encode WebM video — Chrome or Edge can.')
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
