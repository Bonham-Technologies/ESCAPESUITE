import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { ExportDialog } from './ExportDialog'
import { ExportAbortedError, ExportError } from '../../core/exporter'
import {
  EXPORT_NO_VIDEO_CODEC_REASON,
  MP4_NO_CODEC_REASON,
  exportedWithoutSoundReason,
  noAudioNote,
} from '../../core/exportTypes'
import { installWebCodecsDoubles } from '../../test/doubles/webcodecs'
import { pretendElementsAreVisible } from '../../test/doubles/layout'
import { useEditorStore } from '../../store/projectStore'
import { resetStoreForTest, store, addClip } from '../../test/fixtures/projectStore'
import type { ExportProgress } from '../../store/types'
import styles from './ExportDialog.module.css'
import { lastObjectUrl } from '../../test/objectUrls'

// The exporter itself is driven by its own suite; here it is a scripted
// collaborator. The real error classes come through importOriginal so the
// dialog's instanceof checks are the ones production runs.
const { mockExportToWebM, mockExportToMP4, mockExportToGIF, mockIsMP4ExportSupported, mockIsWebMExportSupported } = vi.hoisted(() => ({
  mockExportToWebM: vi.fn(),
  mockExportToMP4: vi.fn(),
  mockExportToGIF: vi.fn(),
  // ESCSUITE-175: a real asynchronous probe answering two questions, the shape
  // WebM's has had since ESCSUITE-22/29.
  mockIsMP4ExportSupported: vi.fn(() => Promise.resolve({ video: true, audio: true })),
  mockIsWebMExportSupported: vi.fn(() => Promise.resolve({ video: true, audio: true })),
}))

vi.mock('../../core/exporter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/exporter')>()),
  exportToWebM: mockExportToWebM,
  exportToMP4: mockExportToMP4,
  exportToGIF: mockExportToGIF,
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
  { format: string; quality: string; resolution: string; fps?: number; timeRange?: { start: number; end: number } },
  (p: ExportProgress) => void,
  unknown, // tracks
  AbortSignal,
  { width: number; height: number },
]

/** What the three exporters resolve with since ESCSUITE-175. */
const exported = (blob: Blob, audio = true) => ({ blob, audio })

const webmArgs = () => mockExportToWebM.mock.calls[0] as unknown as ExportArgs
const mp4Args = () => mockExportToMP4.mock.calls[0] as unknown as ExportArgs
const gifArgs = () => mockExportToGIF.mock.calls[0] as unknown as ExportArgs

const advancedToggle = () => screen.getByRole('button', { name: /advanced options/i })
const primaryExport = () => screen.getByRole('button', { name: /download webm/i })
const advancedExport = () => {
  const buttons = screen.getAllByRole('button', { name: /download (webm|mp4|gif)/i })
  return buttons[buttons.length - 1]
}
const gifRadio = () => screen.getByRole('radio', { name: /gif/i })
const fpsSelect = () => screen.getByLabelText(/frames per second/i)
/**
 * Replace the default media clip with one whose source is an image, so the
 * timeline has nothing that could carry sound.
 */
const useImageOnlyTimeline = () => {
  store().removeClipFromTimeline('clip1')
  store().addSourceVideo({
    id: 'image1',
    name: 'still.png',
    duration: 5,
    width: 640,
    height: 360,
    frameRate: 0,
    mimeType: 'image/png',
    size: 100,
    mediaType: 'image',
  })
  store().addClipToTimeline(
    { id: 'imageClip', sourceVideoId: 'image1', name: 'imageClip', startTime: 0, endTime: 5, duration: 5 },
    undefined,
    0
  )
}

/** Open Advanced options and choose GIF. */
const chooseGif = () => {
  fireEvent.click(advancedToggle())
  fireEvent.click(gifRadio())
}

/** Let the export promise chain settle without waiting on a real timer. */
async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
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
    mockExportToWebM.mockResolvedValue(exported(new Blob()))
    mockExportToMP4.mockReset()
    mockExportToMP4.mockResolvedValue(exported(new Blob()))
    mockExportToGIF.mockReset()
    mockExportToGIF.mockResolvedValue(
      exported(new Blob([new Uint8Array(1234)], { type: 'image/gif' }), false)
    )
    mockSendMessage.mockReset()
    mockIsMP4ExportSupported.mockReset()
    mockIsMP4ExportSupported.mockResolvedValue({ video: true, audio: true })
    mockIsWebMExportSupported.mockReset()
    mockIsWebMExportSupported.mockResolvedValue({ video: true, audio: true })
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
      expect(screen.queryByText('GIF (256 colours, no audio)')).not.toBeInTheDocument()

      fireEvent.click(advancedToggle())

      expect(advancedToggle()).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText('WebM (VP9 + Opus)')).toBeInTheDocument()
      expect(screen.getByText('MP4 (H.264 + AAC)')).toBeInTheDocument()
      expect(screen.getByText('GIF (256 colours, no audio)')).toBeInTheDocument()
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

    it('mentions background-tab encoding only where MP4 is available', async () => {
      const { unmount } = render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()
      // Softened (ESCSUITE-153/29 review, MINOR-4): this is a hedge, not a
      // guarantee — a decode worker that fails to start falls back to the
      // same throttled-in-background element path WebM always uses.
      expect(
        screen.getByText(/MP4 exports keep encoding in a background tab when the decoder is available/)
      ).toBeInTheDocument()
      unmount()

      mockIsMP4ExportSupported.mockResolvedValue({ video: false, audio: true })
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()

      expect(screen.queryByText(/MP4 exports keep encoding/)).not.toBeInTheDocument()
    })

    it('disables the MP4 choice in a browser that cannot encode it', async () => {
      mockIsMP4ExportSupported.mockResolvedValue({ video: false, audio: true })
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()

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
      mockIsWebMExportSupported.mockResolvedValue({ video: false, audio: true })
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
      mockIsMP4ExportSupported.mockResolvedValue({ video: false, audio: true })
      mockIsWebMExportSupported.mockResolvedValue({ video: false, audio: true })
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
      mockIsMP4ExportSupported.mockResolvedValue({ video: false, audio: true })
      mockIsWebMExportSupported.mockResolvedValue({ video: false, audio: true })
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
      mockIsMP4ExportSupported.mockResolvedValue({ video: false, audio: true })
      mockIsWebMExportSupported.mockResolvedValue({ video: false, audio: true })
      mockGetSetting.mockResolvedValue({ format: 'mp4', quality: 'medium', resolution: 'project' })
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()

      // Labelled from the effective format, 'webm' — the primary button
      // reads "Download WebM" too, so `advancedExport()` picks this one
      // specifically (ESCSUITE-182).
      await waitFor(() => expect(advancedExport()).toHaveTextContent('Download WebM'))
      const advanced = advancedExport()
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

    // ESCSUITE-175: MP4's own probe. Everything below is the MP4 half of the
    // three states above — before this ticket `isMP4ExportSupported()` was a
    // synchronous globals read, so a browser with WebCodecs and no H.264
    // encoder was offered MP4 and discovered the truth mid-export, and a
    // browser with no AAC encoder (Firefox 155) exported a silent file with
    // nothing but a console.warn to show for it.
    it('refuses MP4 with its own reason when this browser cannot encode H.264', async () => {
      mockIsMP4ExportSupported.mockResolvedValue({ video: false, audio: true })
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()

      // Said in the main body, before the Advanced disclosure is opened — the
      // ESCSUITE-22 shape, now for MP4 too.
      expect(screen.getByText(MP4_NO_CODEC_REASON)).toBeInTheDocument()
      expect(advancedToggle()).toHaveAttribute('aria-expanded', 'false')
      // WebM still works, which is what the sentence promises.
      expect(primaryExport()).toBeEnabled()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()

      fireEvent.click(advancedToggle())
      expect(screen.getByRole('radio', { name: /mp4/i })).toBeDisabled()
      expect(screen.getByRole('radio', { name: /webm/i })).toBeEnabled()
    })

    it('says MP4 will have no sound, up front, when this browser has no AAC encoder', async () => {
      mockIsMP4ExportSupported.mockResolvedValue({ video: true, audio: false })
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()

      expect(screen.getByText(noAudioNote('mp4'))).toBeInTheDocument()
      // Still offered: a silent MP4 is a legitimate thing to want, and the
      // note says what the trade is.
      expect(screen.queryByText(MP4_NO_CODEC_REASON)).not.toBeInTheDocument()
      fireEvent.click(advancedToggle())
      expect(screen.getByRole('radio', { name: /mp4/i })).toBeEnabled()
      fireEvent.click(screen.getByRole('radio', { name: /mp4/i }))
      expect(screen.getByRole('button', { name: /download mp4/i })).toBeEnabled()
    })

    it('drops the no-sound note while GIF is selected — GIF has its own', async () => {
      mockIsMP4ExportSupported.mockResolvedValue({ video: true, audio: false })
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()
      expect(screen.getByText(noAudioNote('mp4'))).toBeInTheDocument()

      chooseGif()

      // Two sentences about sound, one of which is about a format that is not
      // being exported, is one too many.
      expect(screen.queryByText(noAudioNote('mp4'))).not.toBeInTheDocument()
      expect(
        screen.getByText(/GIF export needs this tab visible and has no sound/)
      ).toBeInTheDocument()
    })

    it('says nothing about sound when this browser can encode AAC', async () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()

      expect(screen.queryByText(noAudioNote('mp4'))).not.toBeInTheDocument()
    })

    // ESCSUITE-175 fix round: WebM gets the same up-front note MP4 does, for the
    // same reason — a browser with VP9 and no Opus encoder exports a silent
    // WebM, and WebM is the dialog's *default* format.
    it('says WebM will have no sound, up front, when this browser has no Opus encoder', async () => {
      mockIsWebMExportSupported.mockResolvedValue({ video: true, audio: false })
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()

      expect(screen.getByText(noAudioNote('webm'))).toBeInTheDocument()
      expect(screen.queryByText(noAudioNote('mp4'))).not.toBeInTheDocument()
      // Still offered — it is the primary button.
      expect(primaryExport()).toBeEnabled()
    })

    it('says nothing about WebM sound when this browser can encode Opus', async () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()

      expect(screen.queryByText(noAudioNote('webm'))).not.toBeInTheDocument()
    })

    // A browser with no AudioEncoder at all: both notes appear, and neither
    // claims the other format keeps the sound, because neither does.
    it('drops the way-out clause from both notes when no format has sound', async () => {
      mockIsMP4ExportSupported.mockResolvedValue({ video: true, audio: false })
      mockIsWebMExportSupported.mockResolvedValue({ video: true, audio: false })
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()

      expect(screen.getByText(noAudioNote('mp4', false))).toBeInTheDocument()
      expect(screen.getByText(noAudioNote('webm', false))).toBeInTheDocument()
      expect(screen.queryByText(noAudioNote('mp4'))).not.toBeInTheDocument()
      expect(screen.queryByText(noAudioNote('webm'))).not.toBeInTheDocument()
    })

    it('keeps no silent-format note at all while GIF is selected', async () => {
      mockIsWebMExportSupported.mockResolvedValue({ video: true, audio: false })
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()
      expect(screen.getByText(noAudioNote('webm'))).toBeInTheDocument()

      chooseGif()

      expect(screen.queryByText(noAudioNote('webm'))).not.toBeInTheDocument()
    })

    it('says neither video format can be encoded when WebCodecs is present but its codecs are not', async () => {
      // Distinct from the "no WebCodecs at all" alert above: the globals are
      // here, so that sentence would be a lie. The e2e `Codec Not Supported`
      // fixture is exactly this browser.
      const codecs = installWebCodecsDoubles()
      try {
        mockIsMP4ExportSupported.mockResolvedValue({ video: false, audio: true })
        mockIsWebMExportSupported.mockResolvedValue({ video: false, audio: true })
        render(<ExportDialog isOpen={true} onClose={onClose} />)
        await settle()

        expect(screen.getByRole('alert')).toHaveTextContent(EXPORT_NO_VIDEO_CODEC_REASON)
        expect(screen.getByRole('alert')).not.toHaveTextContent(
          'Exporting needs WebCodecs, which this browser does not provide'
        )
        // One sentence, not two per-format ones.
        expect(screen.queryByText(MP4_NO_CODEC_REASON)).not.toBeInTheDocument()
        expect(primaryExport()).toBeDisabled()
      } finally {
        codecs.uninstall()
      }
    })

    it('probes MP4 at the resolution the selected preset will actually export', async () => {
      store().setProjectResolution(1920, 1080)
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()

      expect(mockIsMP4ExportSupported).toHaveBeenCalledWith(1920, 1080)
      expect(mockIsMP4ExportSupported).toHaveBeenCalledTimes(1)
      mockIsMP4ExportSupported.mockClear()

      fireEvent.click(advancedToggle())
      fireEvent.change(screen.getByDisplayValue('Project — 1920×1080'), { target: { value: '720p' } })
      await settle()

      expect(mockIsMP4ExportSupported).toHaveBeenCalledWith(1280, 720)
    })

    it('does not let a stale MP4 probe from an earlier open overwrite a later one', async () => {
      let resolveStale!: (support: { video: boolean; audio: boolean }) => void
      mockIsMP4ExportSupported.mockReturnValueOnce(
        new Promise<{ video: boolean; audio: boolean }>((resolve) => {
          resolveStale = resolve
        })
      )
      const { rerender } = render(<ExportDialog isOpen={true} onClose={onClose} />)

      rerender(<ExportDialog isOpen={false} onClose={onClose} />)
      rerender(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()
      expect(screen.queryByText(noAudioNote('mp4'))).not.toBeInTheDocument()

      resolveStale({ video: false, audio: false })
      await settle()

      expect(screen.queryByText(noAudioNote('mp4'))).not.toBeInTheDocument()
      expect(screen.queryByText(MP4_NO_CODEC_REASON)).not.toBeInTheDocument()
    })

    // Review round 1, MAJOR 2(a): the `cancelled` guard in the probe's effect
    // cleanup is the ESCSUITE-98 run-identity shape — without it, a probe
    // started by an earlier open can still overwrite a later one's answer
    // once it finally resolves.
    it('does not let a stale probe from an earlier open overwrite a later one', async () => {
      let resolveStale!: (support: { video: boolean; audio: boolean }) => void
      mockIsWebMExportSupported.mockReturnValueOnce(
        new Promise<{ video: boolean; audio: boolean }>((resolve) => {
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
      resolveStale({ video: false, audio: true })
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
      // `fps` rides along on every advanced export and every saved setting
      // since ESCSUITE-34 — the two video formats ignore it, GIF reads it.
      expect(webmArgs()[2]).toEqual({
        format: 'webm',
        quality: 'high',
        resolution: '720p',
        fps: 15,
        timeRange: undefined,
      })
      expect(mockSetSetting).toHaveBeenCalledWith('lastExportSettings', {
        format: 'webm',
        quality: 'high',
        resolution: '720p',
        fps: 15,
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
      mockIsMP4ExportSupported.mockResolvedValue({ video: false, audio: true })
      mockGetSetting.mockResolvedValue({ format: 'mp4', quality: 'medium', resolution: 'project' })
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()
      await waitFor(() => expect(screen.getByRole('radio', { name: /mp4/i })).toBeChecked())

      // The button is labelled from the EFFECTIVE format — the one the click
      // will actually run — not the selected radio (ESCSUITE-182): a restored
      // `{ format: 'mp4' }` in a browser whose H.264 probe says no must read
      // "Download WebM", not an enabled "Download MP4" that silently writes
      // a .webm. `advancedExport()` picks the Advanced button specifically;
      // the primary button reads "Download WebM" too, by construction.
      const button = advancedExport()
      expect(button).toHaveTextContent('Download WebM')

      fireEvent.click(button)

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
      const bytes = new Blob(['video-bytes'], { type: 'video/webm' })
      mockExportToWebM.mockResolvedValue(exported(bytes))
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      fireEvent.click(primaryExport())

      await waitFor(() => expect(screen.getByText('Export complete!')).toBeInTheDocument())
      expect(clickedLinks).toHaveLength(1)
      expect(clickedLinks[0].download).toBe('Test Project.webm')
      expect(clickedLinks[0].href).toBe(lastObjectUrl())
      expect(URL.createObjectURL).toHaveBeenCalledWith(bytes)
      expect(URL.revokeObjectURL).toHaveBeenCalled()
      expect(document.querySelector('a[download]')).toBeNull()
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'EXPORT_COMPLETE',
        payload: { blob: bytes, format: 'webm', name: 'Test Project.webm', audio: true },
      })
      expect(mockAnalytics.exportCompleted).toHaveBeenCalledWith('webm', 5)
    })

    it('names the file after the mp4 extension when exporting MP4', async () => {
      const bytes = new Blob(['mp4-bytes'], { type: 'video/mp4' })
      mockExportToMP4.mockResolvedValue(exported(bytes))
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      fireEvent.click(advancedToggle())
      fireEvent.click(screen.getByRole('radio', { name: /mp4/i }))

      fireEvent.click(screen.getByRole('button', { name: /download mp4/i }))

      await waitFor(() => expect(mockSendMessage).toHaveBeenCalledTimes(1))
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'EXPORT_COMPLETE',
        payload: { blob: bytes, format: 'mp4', name: 'Test Project.mp4', audio: true },
      })
    })

    // ESCSUITE-175: the after-the-fact half. The exporter's result says whether
    // the project's sound was dropped; the dialog says so on the completion
    // screen and passes it on to an embedding host.
    it('says the MP4 came out silent when the exporter dropped its sound', async () => {
      const bytes = new Blob(['mp4-bytes'], { type: 'video/mp4' })
      mockExportToMP4.mockResolvedValue(exported(bytes, false))
      mockIsMP4ExportSupported.mockResolvedValue({ video: true, audio: false })
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()
      fireEvent.click(advancedToggle())
      fireEvent.click(screen.getByRole('radio', { name: /mp4/i }))

      fireEvent.click(screen.getByRole('button', { name: /download mp4/i }))

      await waitFor(() => expect(screen.getByText('Export complete!')).toBeInTheDocument())
      expect(screen.getByText(exportedWithoutSoundReason('mp4'))).toBeInTheDocument()
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'EXPORT_COMPLETE',
        payload: { blob: bytes, format: 'mp4', name: 'Test Project.mp4', audio: false },
      })
    })

    // ESCSUITE-175 fix round, MAJOR 1: the sentence asserts a *loss*, so a
    // project that had no sound to lose must not see it. The predicate is the
    // audio mixer's own skip clause minus the per-blob decode, so a timeline of
    // images (or one whose every track is muted) is known to be silent without
    // the dialog decoding anything.
    it('says nothing when the project had no sound to lose', async () => {
      mockExportToMP4.mockResolvedValue(exported(new Blob(['mp4'], { type: 'video/mp4' }), false))
      mockIsMP4ExportSupported.mockResolvedValue({ video: true, audio: false })
      useImageOnlyTimeline()
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()
      fireEvent.click(advancedToggle())
      fireEvent.click(screen.getByRole('radio', { name: /mp4/i }))

      fireEvent.click(screen.getByRole('button', { name: /download mp4/i }))

      await waitFor(() => expect(screen.getByText('Export complete!')).toBeInTheDocument())
      expect(screen.queryByText(exportedWithoutSoundReason('mp4'))).not.toBeInTheDocument()
    })

    it('says nothing when every track that could carry sound is muted', async () => {
      mockExportToMP4.mockResolvedValue(exported(new Blob(['mp4'], { type: 'video/mp4' }), false))
      mockIsMP4ExportSupported.mockResolvedValue({ video: true, audio: false })
      for (const track of store().project.timeline.tracks) {
        store().updateTrack(track.id, { muted: true })
      }
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()
      fireEvent.click(advancedToggle())
      fireEvent.click(screen.getByRole('radio', { name: /mp4/i }))

      fireEvent.click(screen.getByRole('button', { name: /download mp4/i }))

      await waitFor(() => expect(screen.getByText('Export complete!')).toBeInTheDocument())
      expect(screen.queryByText(exportedWithoutSoundReason('mp4'))).not.toBeInTheDocument()
    })

    // The up-front note is *not* gated the same way (ruling 2): "will have no
    // sound" is a true and harmless thing to say about a silent project, and
    // the note is rendered before the dialog knows which range will be exported.
    it('still shows the up-front note for a project with no sound in it', async () => {
      mockIsMP4ExportSupported.mockResolvedValue({ video: true, audio: false })
      useImageOnlyTimeline()
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()

      expect(screen.getByText(noAudioNote('mp4'))).toBeInTheDocument()
    })

    // ESCSUITE-175 fix round: the WebM half, with the codec its own sentence names.
    it('says the WebM came out silent, naming Opus', async () => {
      const bytes = new Blob(['webm'], { type: 'video/webm' })
      mockExportToWebM.mockResolvedValue(exported(bytes, false))
      mockIsWebMExportSupported.mockResolvedValue({ video: true, audio: false })
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()

      fireEvent.click(primaryExport())

      await waitFor(() => expect(screen.getByText('Export complete!')).toBeInTheDocument())
      expect(screen.getByText(exportedWithoutSoundReason('webm'))).toBeInTheDocument()
      expect(screen.queryByText(exportedWithoutSoundReason('mp4'))).not.toBeInTheDocument()
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'EXPORT_COMPLETE',
        payload: { blob: bytes, format: 'webm', name: 'Test Project.webm', audio: false },
      })
    })

    it('says nothing of the kind when the MP4 kept its sound', async () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()
      fireEvent.click(advancedToggle())
      fireEvent.click(screen.getByRole('radio', { name: /mp4/i }))

      fireEvent.click(screen.getByRole('button', { name: /download mp4/i }))

      await waitFor(() => expect(screen.getByText('Export complete!')).toBeInTheDocument())
      expect(screen.queryByText(exportedWithoutSoundReason('mp4'))).not.toBeInTheDocument()
    })

    // A GIF result always carries `audio: false` — the container has nowhere to
    // put sound — and the dialog already says so before the export. Blaming the
    // browser's AAC encoder for it would be wrong, so the sentence is MP4's
    // alone.
    it('does not blame AAC for a GIF having no sound', async () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await settle()
      chooseGif()

      fireEvent.click(advancedExport())

      await waitFor(() => expect(screen.getByText('Export complete!')).toBeInTheDocument())
      expect(screen.queryByText(exportedWithoutSoundReason('mp4'))).not.toBeInTheDocument()
      expect(mockSendMessage.mock.calls[0][0].payload.audio).toBe(false)
    })

    it('falls back to a generic file name for an unnamed project', async () => {
      store().setProject({ ...store().project, name: '' })
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      fireEvent.click(primaryExport())

      await waitFor(() => expect(mockSendMessage).toHaveBeenCalledTimes(1))
      expect(mockSendMessage.mock.calls[0][0].payload.name).toBe('export.webm')
    })

    it('still completes the export when the host channel throws', async () => {
      mockExportToWebM.mockResolvedValue(exported(new Blob(['video-bytes'], { type: 'video/webm' })))
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

    // ESCSUITE-215: the bar was a styled <div> with a width on it and nothing
    // else — no role, no value — so an export that can run for minutes was
    // visual only.
    it('gives the bar a progressbar role whose value follows the exporter', async () => {
      const scripted = scriptedExport()
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      fireEvent.click(primaryExport())

      const bar = screen.getByRole('progressbar')
      expect(bar).toHaveAttribute('aria-label', 'Export progress')
      expect(bar).toHaveAttribute('aria-valuemin', '0')
      expect(bar).toHaveAttribute('aria-valuemax', '100')
      expect(bar).toHaveAttribute('aria-valuenow', '0')

      await scripted.report({ phase: 'encoding', progress: 42.4, message: 'Encoding frame 42/100' })

      // Rounded, like the percentage printed beside it: a fractional
      // aria-valuenow is read out digit by digit.
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')

      await scripted.report({ phase: 'encoding', progress: 80, message: 'Encoding frame 80/100' })

      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '80')

      scripted.rejectExport(new ExportAbortedError())
      await settle()
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
          fps: 15,
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
      mockIsMP4ExportSupported.mockResolvedValue({ video: false, audio: true })
      const log = [{ phase: 'codec', detail: 'no supported video codec', timestamp: 1 }]
      mockExportToWebM.mockRejectedValue(
        new ExportError('No supported video codec found. WebM export requires VP9 or VP8 support.', log)
      )
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      const debugLog = vi.spyOn(console, 'debug').mockImplementation(() => {})
      try {
        render(<ExportDialog isOpen={true} onClose={onClose} />)
        await settle()
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
          fps: 15,
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
      mockIsWebMExportSupported.mockResolvedValue({ video: false, audio: true })
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

  describe('GIF export', () => {
    it('offers GIF as a third format under Advanced options', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      fireEvent.click(advancedToggle())

      expect(gifRadio()).toBeEnabled()
      expect(screen.getByText('GIF (256 colours, no audio)')).toBeInTheDocument()
      // The other two radios must still be findable by name — the GIF label and
      // hint deliberately contain neither "WebM" nor "MP4".
      expect(screen.getByRole('radio', { name: /webm/i })).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: /mp4/i })).toBeInTheDocument()
    })

    it('keeps the frame-rate control hidden until GIF is chosen', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      fireEvent.click(advancedToggle())

      expect(screen.queryByLabelText(/frames per second/i)).not.toBeInTheDocument()

      fireEvent.click(gifRadio())

      expect(fpsSelect()).toHaveValue('15')
      expect(screen.getByText('10 fps (smallest file)')).toBeInTheDocument()
      expect(screen.getByText('15 fps')).toBeInTheDocument()
      expect(screen.getByText('20 fps (smoothest)')).toBeInTheDocument()
    })

    it('hides the Quality control for GIF, which cannot act on it', () => {
      // `exportGIF.ts` never reads `options.quality` — it is a video/audio
      // bitrate knob — so offering a select whose own labels promise "faster
      // export" / "slower export" would promise a trade-off that does not
      // exist. Hidden the same way the frame-rate select is shown: on the
      // selected format, with the value left in `advancedOptions` and in
      // `lastExportSettings` so switching back restores it.
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      fireEvent.click(advancedToggle())

      expect(screen.getByText('Quality')).toBeInTheDocument()
      expect(screen.getByText('Low (faster export)')).toBeInTheDocument()

      fireEvent.click(gifRadio())

      expect(screen.queryByText('Quality')).not.toBeInTheDocument()
      expect(screen.queryByText('Low (faster export)')).not.toBeInTheDocument()
      expect(screen.queryByText('Medium')).not.toBeInTheDocument()
      expect(screen.queryByText('High (slower export)')).not.toBeInTheDocument()

      // And back: MP4 is a video format, so the control returns.
      fireEvent.click(screen.getByRole('radio', { name: /mp4/i }))

      expect(screen.getByText('Quality')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Medium')).toBeInTheDocument()
    })

    it('offers only 720p, 480p and 360p for GIF, defaulting to 480p', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()

      // The project is 1920x1080 (the store's default), so the three widths
      // follow its 16:9 aspect — the same `getResolution` rule every format uses.
      expect(screen.getByText('720p — 1280×720')).toBeInTheDocument()
      expect(screen.getByText('480p — 854×480')).toBeInTheDocument()
      expect(screen.getByText('360p — 640×360')).toBeInTheDocument()
      expect(screen.queryByText(/^Project —/)).not.toBeInTheDocument()
      expect(screen.queryByText(/^1080p —/)).not.toBeInTheDocument()
      // A GIF at the project's own resolution is unpredictable and one at 1080p
      // is enormous, so neither is offered — and choosing GIF while 1080p was
      // selected lands on the spec's default rather than leaving the select on a
      // value it no longer lists.
      expect(screen.getByDisplayValue('480p — 854×480')).toBeInTheDocument()
    })

    it('moves a 1080p selection to 480p on the way into GIF', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      fireEvent.click(advancedToggle())
      fireEvent.change(screen.getByDisplayValue(/^Project —/), { target: { value: '1080p' } })
      fireEvent.click(gifRadio())

      expect(screen.getByDisplayValue('480p — 854×480')).toBeInTheDocument()
    })

    it('moves a 360p selection to 480p on the way back to WebM', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()
      fireEvent.change(screen.getByDisplayValue('480p — 854×480'), { target: { value: '360p' } })
      expect(screen.getByDisplayValue('360p — 640×360')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('radio', { name: /webm/i }))

      // 360p is GIF-only; no video preset is 360p, so the selection has to move.
      expect(screen.getByDisplayValue('480p — 854×480')).toBeInTheDocument()
      expect(screen.queryByText('360p — 640×360')).not.toBeInTheDocument()
    })

    it('runs exportToGIF with the chosen fps, preset and range', async () => {
      store().setInPoint(1)
      store().setOutPoint(3)
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()
      fireEvent.change(fpsSelect(), { target: { value: '20' } })
      fireEvent.click(advancedExport())
      await settle()

      expect(mockExportToGIF).toHaveBeenCalledTimes(1)
      expect(mockExportToWebM).not.toHaveBeenCalled()
      expect(mockExportToMP4).not.toHaveBeenCalled()
      expect(gifArgs()[2]).toMatchObject({
        format: 'gif',
        resolution: '480p',
        fps: 20,
        timeRange: { start: 1, end: 3 },
      })
    })

    it('downloads the GIF as <project name>.gif and tells the host so', async () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()
      fireEvent.click(advancedExport())
      await settle()

      expect(clickedLinks[0].download).toBe('Test Project.gif')
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'EXPORT_COMPLETE',
          payload: expect.objectContaining({ format: 'gif', name: 'Test Project.gif' }),
        })
      )
      expect(mockAnalytics.exportStarted).toHaveBeenCalledWith('gif')
      expect(mockAnalytics.exportCompleted).toHaveBeenCalledWith('gif', expect.any(Number))
    })

    it('labels the Advanced button for GIF', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()

      expect(screen.getByRole('button', { name: /download gif/i })).toBeEnabled()
    })

    it('estimates the size before the export starts', () => {
      // 5 seconds of clip (the suite's own fixture), 480p of a 16:9 project is
      // 854x480, 15 fps -> 75 frames, at the pixels x frames x 0.3 heuristic.
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()

      expect(screen.getByText(/Estimated size/)).toBeInTheDocument()
      expect(screen.getByText(/75 frames/)).toBeInTheDocument()
    })

    it('re-estimates when the frame rate changes', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()
      const before = screen.getByText(/Estimated size/).textContent

      fireEvent.change(fpsSelect(), { target: { value: '10' } })

      expect(screen.getByText(/50 frames/)).toBeInTheDocument()
      expect(screen.getByText(/Estimated size/).textContent).not.toBe(before)
    })

    it('shows the live estimate the exporter reports while it runs', async () => {
      let report: ((p: ExportProgress) => void) | undefined
      mockExportToGIF.mockImplementation((...args: unknown[]) => {
        report = args[3] as (p: ExportProgress) => void
        return new Promise(() => {}) // never settles: the dialog stays on the progress view
      })
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()
      fireEvent.click(advancedExport())
      await settle()

      act(() => {
        report!({ phase: 'encoding', progress: 40, message: 'Encoding frame 30/75...', estimatedBytes: 2_621_440 })
      })

      // Rendered through the same formatFileSize the media library uses, so one
      // formatter covers the whole app.
      expect(screen.getByText(/2\.5 MB/)).toBeInTheDocument()
    })

    it('warns past 30 seconds without refusing the export', () => {
      resetStoreForTest()
      store().setProject({ ...store().project, name: 'Test Project' })
      addClip('long', 0, 45)
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()

      expect(screen.getByText(/GIFs above 30 seconds get large/)).toBeInTheDocument()
      // A warning, not a gate.
      expect(screen.getByRole('button', { name: /download gif/i })).toBeEnabled()
    })

    it('does not warn for an export inside 30 seconds', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()

      expect(screen.queryByText(/GIFs above 30 seconds get large/)).not.toBeInTheDocument()
    })

    it('warns on the range, not the timeline, when in/out points are set', () => {
      resetStoreForTest()
      store().setProject({ ...store().project, name: 'Test Project' })
      addClip('long', 0, 45)
      store().setInPoint(0)
      store().setOutPoint(5)
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()

      // 45 seconds of timeline but a 5-second section: the warning is about what
      // will actually be encoded.
      expect(screen.queryByText(/GIFs above 30 seconds get large/)).not.toBeInTheDocument()
    })

    it('hides the background-tab note for GIF and says what GIF needs instead', () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      fireEvent.click(advancedToggle())
      expect(
        screen.getByText(/MP4 exports keep encoding in a background tab/)
      ).toBeInTheDocument()

      fireEvent.click(gifRadio())

      // That note is about the two video formats' decoders; GIF has none.
      expect(
        screen.queryByText(/MP4 exports keep encoding in a background tab/)
      ).not.toBeInTheDocument()
      expect(screen.getByText(/GIF export needs this tab visible and has no sound/)).toBeInTheDocument()
    })

    it('still says WebM needs the tab visible when the browser has no MP4 support (ESCSUITE-173)', async () => {
      // WebM drives the same `elementFrames.ts` rAF readiness poll GIF does —
      // the browser throttles it once the tab is hidden — but the note used to
      // be bundled with MP4's own "keeps encoding in a background tab"
      // sentence and hidden entirely whenever `mp4Supported` was false, taking
      // the equally-true WebM fact down with it.
      //
      // Both probes are async since ESCSUITE-175 and `mp4Supported` starts
      // optimistically `true`, so the note is not there until the probe
      // actually resolves `video: false` — `waitFor` rather than a bare
      // `getByText` right after render.
      mockIsMP4ExportSupported.mockResolvedValue({ video: false, audio: true })
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      await waitFor(() => expect(screen.getByText(/WebM needs this tab visible/)).toBeInTheDocument())

      // The third operand's false side (rereview MINOR a / ESCSUITE-173):
      // `effectiveAdvancedFormat === 'webm'` must actually gate the note off
      // when GIF is selected instead, with MP4 unsupported but WebM itself
      // still fine — the old gate's only reacher for this side selected
      // 'mp4' (the fallback case below), whose effective format is now
      // 'webm' too, so nothing was left covering a GIF selection here.
      chooseGif()
      expect(screen.queryByText(/WebM needs this tab visible/)).not.toBeInTheDocument()
    })

    it('still says it for a restored MP4 preference the browser cannot honour (MEDIUM 3 / ESCSUITE-173)', async () => {
      // `advancedOptions.format` stays the SAVED 'mp4' here (ESCSUITE-22's own
      // "falls back to WebM when MP4 is chosen" case) — the dialog's own
      // `effectiveAdvancedFormat` is what actually exports, and is 'webm'.
      // Gating the note on the selected format rather than the effective one
      // missed exactly this case.
      mockIsMP4ExportSupported.mockResolvedValue({ video: false, audio: true })
      mockGetSetting.mockResolvedValue({ format: 'mp4', quality: 'medium', resolution: 'project' })
      render(<ExportDialog isOpen={true} onClose={onClose} />)

      // Wait for the restored setting to actually land — `advancedOptions`
      // starts at the default 'webm', so checking the note right away would
      // pass before the race this test is about even runs.
      await waitFor(() => expect(screen.getByRole('radio', { name: /mp4/i })).toBeChecked())

      // And wait for the (also async, ESCSUITE-175) MP4 probe to actually
      // resolve `video: false`, same reasoning as the case above.
      await waitFor(() => expect(screen.getByText(/WebM needs this tab visible/)).toBeInTheDocument())
    })

    it('says nothing about WebM when neither video format is supported (MEDIUM 3 / ESCSUITE-173)', async () => {
      // `advancedOptions.format` defaults to 'webm', so gating on the selected
      // format alone showed the WebM tab-visibility note right beside the
      // "Exporting needs WebCodecs" alert — advertising a requirement of a
      // format the dialog has just disabled.
      mockIsMP4ExportSupported.mockResolvedValue({ video: false, audio: true })
      mockIsWebMExportSupported.mockResolvedValue({ video: false, audio: true })
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await waitFor(() => expect(primaryExport()).toBeDisabled())

      expect(screen.queryByText(/WebM needs this tab visible/)).not.toBeInTheDocument()
    })

    it('leaves GIF enabled, and says so, when the browser has no WebCodecs', async () => {
      mockIsMP4ExportSupported.mockResolvedValue({ video: false, audio: true })
      mockIsWebMExportSupported.mockResolvedValue({ video: false, audio: true })
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await waitFor(() => expect(primaryExport()).toBeDisabled())
      await settle()

      // The ESCSUITE-22 alert is still there, and now carries the sentence that
      // stops it being a dead end.
      expect(
        screen.getByText(/Exporting needs WebCodecs, which this browser does not provide/)
      ).toBeInTheDocument()
      expect(screen.getByText(/GIF export needs no WebCodecs/)).toBeInTheDocument()

      fireEvent.click(advancedToggle())
      expect(gifRadio()).toBeEnabled()
      expect(screen.getByRole('radio', { name: /webm/i })).toBeDisabled()
      expect(screen.getByRole('radio', { name: /mp4/i })).toBeDisabled()

      fireEvent.click(gifRadio())
      const button = screen.getByRole('button', { name: /download gif/i })
      expect(button).toBeEnabled()
      expect(button).not.toHaveAttribute('title')
    })

    it('exports GIF in a browser with no WebCodecs', async () => {
      mockIsMP4ExportSupported.mockResolvedValue({ video: false, audio: true })
      mockIsWebMExportSupported.mockResolvedValue({ video: false, audio: true })
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await waitFor(() => expect(primaryExport()).toBeDisabled())
      await settle()
      chooseGif()
      fireEvent.click(screen.getByRole('button', { name: /download gif/i }))
      await settle()

      expect(mockExportToGIF).toHaveBeenCalledTimes(1)
    })

    it('remembers the frame rate with the rest of the advanced settings', async () => {
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()
      fireEvent.change(fpsSelect(), { target: { value: '10' } })
      fireEvent.click(advancedExport())
      await settle()

      expect(mockSetSetting).toHaveBeenCalledWith('lastExportSettings', {
        format: 'gif',
        quality: 'medium',
        resolution: '480p',
        fps: 10,
      })
    })

    it('restores a saved setting that predates the frame rate at the default', async () => {
      mockGetSetting.mockResolvedValue({ format: 'gif', quality: 'high', resolution: '480p' })
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      await waitFor(() => expect(gifRadio()).toBeChecked())

      // A setting saved before this ticket carries no fps at all.
      expect(fpsSelect()).toHaveValue('15')
    })

    it('surfaces a failed GIF export inline, with no format fallback offered', async () => {
      mockExportToGIF.mockRejectedValue(new ExportError('quantiser gave up', []))
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      const debugLog = vi.spyOn(console, 'debug').mockImplementation(() => {})
      try {
        render(<ExportDialog isOpen={true} onClose={onClose} />)
        chooseGif()
        fireEvent.click(advancedExport())
        await settle()

        expect(screen.getByRole('alert')).toHaveTextContent('Export failed: quantiser gave up')
        // "Try MP4 Instead" is WebM's own recovery (ESCSUITE-29 Mechanism 1): a
        // GIF failure is not a codec problem another codec would solve.
        expect(screen.queryByRole('button', { name: /try mp4 instead/i })).not.toBeInTheDocument()
        expect(mockAnalytics.exportFailed).toHaveBeenCalledWith('gif', 'ExportError', expect.any(Number))
        // The diagnostic trail is labelled for the format that actually ran.
        expect(debugLog).toHaveBeenCalledWith('[GIF Export] Diagnostic log:', [])
      } finally {
        errorLog.mockRestore()
        debugLog.mockRestore()
      }
    })

    it('stops a GIF export when Cancel is clicked', async () => {
      let signal: AbortSignal | undefined
      mockExportToGIF.mockImplementation((...args: unknown[]) => {
        signal = args[5] as AbortSignal
        return new Promise(() => {})
      })
      render(<ExportDialog isOpen={true} onClose={onClose} />)
      chooseGif()
      fireEvent.click(advancedExport())
      await settle()

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

      expect(signal!.aborted).toBe(true)
      expect(onClose).toHaveBeenCalled()
    })
  })
})
