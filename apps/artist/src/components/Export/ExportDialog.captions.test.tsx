// The export dialog's caption sidecar (ESCSUITE-293): when the Captions track
// holds captions, a "Captions" row offers them as an .srt or a .vtt beside the
// video. Kept in its own file so the dialog's main suite is not touched.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ExportDialog } from './ExportDialog'
import { resetStoreForTest, store, addClip } from '../../test/fixtures/projectStore'
import { captionStyleFor } from '../../core/captions'

vi.mock('../../core/exporter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/exporter')>()),
  exportToWebM: vi.fn(),
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

const style = captionStyleFor({ width: 1920, height: 1080 })

const captionsRow = () => screen.queryByRole('group', { name: 'Captions' })

/** The file the last download handed over: its bytes as text, its type and its name. */
async function lastDownload(clicked: HTMLAnchorElement[]) {
  const calls = vi.mocked(URL.createObjectURL).mock.calls
  const blob = calls[calls.length - 1][0] as Blob
  return { text: await blob.text(), type: blob.type, name: clicked[clicked.length - 1].download }
}

describe('ExportDialog — caption sidecar (ESCSUITE-293)', () => {
  let clicked: HTMLAnchorElement[]
  let originalClick: () => void

  beforeEach(() => {
    vi.clearAllMocks()
    clicked = []
    originalClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicked.push(this)
    }
    resetStoreForTest()
    store().setProject({ ...store().project, name: 'Talk' })
    addClip('clip1', 0, 5)
  })

  afterEach(() => {
    HTMLAnchorElement.prototype.click = originalClick
  })

  it('offers no captions row when the project has no caption track', () => {
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />)

    expect(captionsRow()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Download .srt' })).toBeNull()
  })

  it('offers none for a caption track with nothing on it', () => {
    const { trackId } = store().addCaptionCues([{ start: 6, end: 7, text: 'Gone' }], style)!
    const [caption] = store().project.timeline.clips.filter((clip) => clip.trackId === trackId)
    store().removeClipFromTimeline(caption.id)

    render(<ExportDialog isOpen={true} onClose={vi.fn()} />)

    expect(captionsRow()).toBeNull()
  })

  it('downloads the Captions track as an .srt, in timeline order, named for the project', async () => {
    store().addCaptionCues(
      [
        { start: 8, end: 9.5, text: 'Second.' },
        { start: 6, end: 7, text: 'First,\non two lines.' },
      ],
      style
    )
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />)

    fireEvent.click(within(captionsRow()!).getByRole('button', { name: 'Download .srt' }))

    expect(await lastDownload(clicked)).toEqual({
      text: '1\n00:00:06,000 --> 00:00:07,000\nFirst,\non two lines.\n\n2\n00:00:08,000 --> 00:00:09,500\nSecond.\n',
      type: 'application/x-subrip',
      name: 'Talk.srt',
    })
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('downloads it as a .vtt the same way', async () => {
    store().addCaptionCues([{ start: 6, end: 7, text: 'Tom & Jerry' }], style)
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Download .vtt' }))

    expect(await lastDownload(clicked)).toEqual({
      text: 'WEBVTT\n\n00:00:06.000 --> 00:00:07.000\nTom & Jerry\n',
      type: 'text/vtt',
      name: 'Talk.vtt',
    })
  })

  it('writes what is on the caption track as it stands, edits included, and nothing from any other track', async () => {
    const { trackId } = store().addCaptionCues([{ start: 6, end: 7, text: 'Imported' }], style)!
    const [caption] = store().project.timeline.clips.filter((clip) => clip.trackId === trackId)
    store().updateTextOverlayData(caption.id, { text: 'Edited' })
    store().setClipTimelinePosition(caption.id, 10)
    // A text clip elsewhere is a title, not a caption.
    store().addTextOverlayClip({ text: 'A title' }, undefined, 0, 2)
    // A media clip dragged onto the caption track has no words to write.
    expect(store().moveClipToTrack('clip1', trackId)).toBe(true)
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Download .srt' }))

    expect((await lastDownload(clicked)).text).toBe('1\n00:00:10,000 --> 00:00:11,000\nEdited\n')
  })

  it('still offers a hidden caption track — kept off the picture, wanted as a sidecar', () => {
    const { trackId } = store().addCaptionCues([{ start: 6, end: 7, text: 'Quiet' }], style)!
    store().updateTrack(trackId, { visible: false })

    render(<ExportDialog isOpen={true} onClose={vi.fn()} />)

    expect(captionsRow()).not.toBeNull()
  })

  // Review I1: the dialog is always mounted, so a damaged clip that
  // parseProject lets through must not take the editor down while it is shut.
  it('survives a caption-track text clip with no text, closed or open, and leaves it out of the sidecar', async () => {
    const { trackId } = store().addCaptionCues([{ start: 6, end: 7, text: 'Kept' }], style)!
    const project = store().project
    const [kept] = project.timeline.clips.filter((clip) => clip.trackId === trackId)
    const noTextData = { ...kept, id: 'no-text-data', timelinePosition: 1, textData: undefined }
    const numericText = { ...kept, id: 'numeric-text', timelinePosition: 2, textData: { ...kept.textData!, text: 42 as unknown as string } }
    store().setProject({ ...project, timeline: { ...project.timeline, clips: [...project.timeline.clips, noTextData, numericText] } })

    const { rerender } = render(<ExportDialog isOpen={false} onClose={vi.fn()} />)
    rerender(<ExportDialog isOpen={true} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Download .srt' }))

    expect((await lastDownload(clicked)).text).toBe('1\n00:00:06,000 --> 00:00:07,000\nKept\n')
  })

  it('names the files "export" for a project with no name, as the video is', async () => {
    store().setProject({ ...store().project, name: '' })
    store().addCaptionCues([{ start: 6, end: 7, text: 'Hi' }], style)
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Download .vtt' }))

    expect((await lastDownload(clicked)).name).toBe('export.vtt')
  })
})
