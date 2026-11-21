// "Remove silences" (ESCSUITE-403): the inspector's Find silences action, the
// review dialog and its bands on the timeline, and "Remove all" as one undo step.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClipEditor } from './ClipEditor/ClipEditor'
import { SilenceDialog } from './SilenceDialog'
import { TimelineSilenceBands } from './Timeline/TimelineSilenceBands'
import { resetStoreForTest, store, video } from '../test/fixtures/projectStore'
import { peakSecondsFor, peaksFromPcm } from '../utils/waveformPeaks'
import { captionStyleFor } from '../core/captions'
import { useEditorStore } from '../store/projectStore'
import type { SourceVideo } from '../store/types'

// 48 kHz and not a whole number of 10 ms buckets long, like a real recording.
// Its peaks are exactly 10 ms each (480 samples; ESCSUITE-418, where they were
// 479 before), as detection reads them. A pause is found from the first bucket
// wholly in it to the last, so each edge reads up to one bucket (10 ms) inside
// the true one; 2–3 s sits on bucket edges, so it is found as exactly 2–3 s.
const RATE = 48_000

const MIC_SAMPLES = 7 * RATE + 123

/** Tone 0–2 s, silence 2–3 s, tone 3–5 s, a quiet murmur (−46 dBFS) 5–6 s, tone 6–7 s. */
function micPeaks() {
  const pcm = new Float32Array(MIC_SAMPLES)
  for (let i = 0; i < pcm.length; i++) {
    const t = i / RATE
    const level = t >= 2 && t < 3 ? 0 : t >= 5 && t < 6 ? 0.005 : 0.8
    pcm[i] = level * Math.sin((2 * Math.PI * 440 * i) / RATE)
  }
  return peaksFromPcm(pcm, RATE, 100)
}

const mic: SourceVideo = {
  id: 'mic-src', name: 'mic.webm', duration: 7, width: 0, height: 0, frameRate: 0,
  mimeType: 'audio/webm', size: 1, mediaType: 'audio', hasAudio: true, waveformData: micPeaks(),
  waveformSecondsPerPeak: peakSecondsFor(MIC_SAMPLES, RATE, 100),
}

function placeTake(source: SourceVideo = mic) {
  store().addSourceVideo(source)
  store().placeTakeOnTimeline([
    { sourceVideoId: video.id, name: 'screen', duration: 7, startOffset: 0, width: 1920, height: 1080 },
    { sourceVideoId: mic.id, name: 'mic', duration: 7, startOffset: 0, width: 0, height: 0, mediaType: 'audio' },
  ])
  const clips = store().project.timeline.clips
  return { screen: clips.find((c) => c.name === 'screen')!, mic: clips.find((c) => c.name === 'mic')! }
}

function renderEditor(onRemoved = vi.fn()) {
  const result = render(
    <>
      <ClipEditor />
      <Dialog onRemoved={onRemoved} />
      <TimelineSilenceBands pixelsPerSecond={50} height={100} />
    </>
  )
  return { ...result, onRemoved }
}

/** The dialog as App mounts it: only while the review is open. */
function Dialog({ onRemoved }: { onRemoved: (message: string) => void }) {
  return store().silenceReview ? <SilenceDialog onRemoved={onRemoved} /> : null
}

const pauses = () => screen.queryAllByRole('listitem')

describe('Remove silences', () => {
  beforeEach(() => resetStoreForTest())

  it('is offered on a take\'s silent screen part, because its microphone has sound', () => {
    const { screen: part } = placeTake()
    store().setSelectedClipId(part.id)
    render(<ClipEditor />)
    expect(screen.getByRole('button', { name: 'Find silences' })).toBeEnabled()
  })

  it('is not offered for a clip with no waveform anywhere in its take', () => {
    store().addClipToTimeline({ id: 'v', sourceVideoId: video.id, name: 'v', startTime: 0, endTime: 4, duration: 4 }, undefined, 0)
    store().setSelectedClipId('v')
    render(<ClipEditor />)
    expect(screen.queryByRole('button', { name: 'Find silences' })).not.toBeInTheDocument()
  })

  it('lists the pause it finds with the defaults and draws it on the timeline', async () => {
    const { screen: part } = placeTake()
    store().setSelectedClipId(part.id)
    const user = userEvent.setup()
    const { rerender, onRemoved } = renderEditor()

    await user.click(screen.getByRole('button', { name: 'Find silences' }))
    rerender(
      <>
        <ClipEditor />
        <Dialog onRemoved={onRemoved} />
        <TimelineSilenceBands pixelsPerSecond={50} height={100} />
      </>
    )

    const dialog = screen.getByRole('dialog', { name: 'Remove silences' })
    expect(within(dialog).getByLabelText('Threshold (dBFS)')).toHaveValue(-40)
    expect(within(dialog).getByLabelText('Minimum gap (s)')).toHaveValue(0.7)
    expect(within(dialog).getByLabelText('Padding (s)')).toHaveValue(0.1)
    // 2–3 s less 0.1 s each side; the murmur at 5–6 s
    // is quieter than −40 dBFS too.
    expect(pauses()).toHaveLength(2)
    expect(pauses()[0]).toHaveTextContent('0:02.10 – 0:02.90')
    expect(screen.getByRole('status')).toHaveTextContent('2 pauses found · 1.60 s will be cut')
    const bands = screen.getAllByTestId('silence-band')
    expect(bands).toHaveLength(2)
    expect(parseFloat(bands[0].style.left)).toBeCloseTo(105, 2)
    expect(parseFloat(bands[0].style.width)).toBeCloseTo(40, 2)
  })

  it('says when a waveform predates exact peak timing, and still cuts only inside the pause', async () => {
    // Peaks imported before ESCSUITE-403 carry no length: placed for the worst
    // case, so the cut sits inside the true pause, a little short of it.
    const legacy: SourceVideo = { ...mic }
    delete legacy.waveformSecondsPerPeak
    const { screen: part } = placeTake(legacy)
    store().setSelectedClipId(part.id)
    const user = userEvent.setup()
    const { rerender, onRemoved } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'Find silences' }))
    rerender(<><ClipEditor /><Dialog onRemoved={onRemoved} /></>)

    expect(screen.getByTestId('silence-timing-note')).toHaveTextContent('made by an earlier version of ESCAPEARTIST')
    const [first] = store().silenceReview!.candidates
    expect(first.start).toBeGreaterThanOrEqual(2.1)
    expect(first.end).toBeLessThanOrEqual(2.9)
  })

  it('shows no timing note for peaks that carry their own length', async () => {
    const { screen: part } = placeTake()
    store().setSelectedClipId(part.id)
    const user = userEvent.setup()
    const { rerender, onRemoved } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'Find silences' }))
    rerender(<><ClipEditor /><Dialog onRemoved={onRemoved} /></>)
    expect(screen.queryByTestId('silence-timing-note')).not.toBeInTheDocument()
  })

  it('finds again when a setting changes, and waits while a field does not read', async () => {
    const { screen: part } = placeTake()
    store().setSelectedClipId(part.id)
    const user = userEvent.setup()
    const { rerender, onRemoved } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'Find silences' }))
    rerender(<><ClipEditor /><Dialog onRemoved={onRemoved} /></>)

    const threshold = screen.getByLabelText('Threshold (dBFS)')
    await user.clear(threshold)
    expect(threshold).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter a number from -100 to 0.')).toBeInTheDocument()
    expect(pauses()).toHaveLength(2) // unchanged while the field is empty
    await user.type(threshold, '-50')
    // At −50 dBFS the murmur is sound: only the digital silence is left.
    expect(pauses()).toHaveLength(1)

    const minGap = screen.getByLabelText('Minimum gap (s)')
    await user.clear(minGap)
    await user.type(minGap, '1.5')
    expect(pauses()).toHaveLength(0)
    expect(screen.getByRole('status')).toHaveTextContent('No pauses to cut with these settings.')
    expect(screen.getByRole('button', { name: 'Remove all' })).toBeDisabled()
  })

  it('drops one pause from the list with Keep, and Remove all cuts the rest in one undo step', async () => {
    const { screen: part, mic: micClip } = placeTake()
    store().setSelectedClipId(part.id)
    const user = userEvent.setup()
    const { rerender, onRemoved } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'Find silences' }))
    rerender(<><ClipEditor /><Dialog onRemoved={onRemoved} /></>)

    await user.click(screen.getByRole('button', { name: 'Keep the pause at 0:05.10' }))
    expect(pauses()).toHaveLength(1)
    expect(store().silenceReview!.candidates).toHaveLength(1)

    const before = JSON.stringify(store().project)
    await user.click(screen.getByRole('button', { name: 'Remove all' }))

    expect(store().silenceReview).toBeNull()
    expect(onRemoved).toHaveBeenCalledWith('Removed 1 pause (0.80 s). Ctrl+Z puts it back.')
    const rowOf = (trackId: string) =>
      store().project.timeline.clips.filter((c) => c.trackId === trackId).map((c) => [c.timelinePosition, c.startTime, c.endTime].map((n) => +n.toFixed(6)))
    expect(rowOf(part.trackId)).toEqual([[0, 0, 2.1], [2.1, 2.9, 7]])
    expect(rowOf(micClip.trackId)).toEqual([[0, 0, 2.1], [2.1, 2.9, 7]])
    expect(store().project.timeline.duration).toBeCloseTo(6.2, 9)

    store().undo()
    expect(JSON.stringify(store().project)).toBe(before)
  })

  it('says Ctrl+Z puts them back when it removes more than one pause (ESCSUITE-449)', async () => {
    const { screen: part } = placeTake()
    store().setSelectedClipId(part.id)
    const user = userEvent.setup()
    const { rerender, onRemoved } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'Find silences' }))
    rerender(<><ClipEditor /><Dialog onRemoved={onRemoved} /></>)
    expect(pauses()).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Remove all' }))
    expect(onRemoved).toHaveBeenCalledWith('Removed 2 pauses (1.60 s). Ctrl+Z puts them back.')
  })

  it('says ⌘Z on a Mac, where the chord is Cmd (ESCSUITE-491)', async () => {
    vi.stubGlobal('navigator', { ...navigator, platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })
    try {
      const { screen: part } = placeTake()
      store().setSelectedClipId(part.id)
      const user = userEvent.setup()
      const { rerender, onRemoved } = renderEditor()
      await user.click(screen.getByRole('button', { name: 'Find silences' }))
      rerender(<><ClipEditor /><Dialog onRemoved={onRemoved} /></>)

      await user.click(screen.getByRole('button', { name: 'Remove all' }))
      expect(onRemoved).toHaveBeenCalledWith('Removed 2 pauses (1.60 s). ⌘Z puts them back.')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps keyboard focus in the list after Keep: next row, else previous, else Cancel (ESCSUITE-441)', async () => {
    const { screen: part } = placeTake()
    store().setSelectedClipId(part.id)
    const user = userEvent.setup()
    const { rerender, onRemoved } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'Find silences' }))
    rerender(<><ClipEditor /><Dialog onRemoved={onRemoved} /></>)
    // A third row, so Keep in the middle has a row on each side.
    act(() => store().setSilenceCandidates([{ start: 1, end: 1.5 }, ...store().silenceReview!.candidates]))
    expect(screen.getByRole('status')).toHaveTextContent('3 pauses found · 2.10 s will be cut')

    act(() => screen.getByRole('button', { name: 'Keep the pause at 0:02.10' }).focus())
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Keep the pause at 0:05.10' })).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('2 pauses found · 1.30 s will be cut')

    // The last row: focus goes back to the row before it.
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Keep the pause at 0:01.00' })).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('1 pause found · 0.50 s will be cut')

    // The only row: the list goes, and so does Remove all, so Cancel takes it.
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('No pauses to cut with these settings.')
    expect(store().silenceReview!.candidates).toHaveLength(0)
  })

  it('moves everything after each cut unless the box is cleared (ESCSUITE-434)', async () => {
    const { screen: part } = placeTake()
    const blur = store().addShapeOverlayClip({ type: 'blur' }, undefined, 4, 2)!
    store().addMarker(4)
    store().setSelectedClipId(part.id)
    const user = userEvent.setup()
    const { rerender, onRemoved } = renderEditor()
    const open = async () => {
      await user.click(screen.getByRole('button', { name: 'Find silences' }))
      rerender(<><ClipEditor /><Dialog onRemoved={onRemoved} /></>)
      await user.click(screen.getByRole('button', { name: 'Keep the pause at 0:05.10' }))
    }
    const blurAt = () => store().project.timeline.clips.find((c) => c.id === blur.id)!.timelinePosition

    await open()
    const box = screen.getByRole('checkbox', { name: 'Move everything after each cut' })
    expect(box).toBeChecked()
    expect(box).toHaveAccessibleDescription(/Other tracks, markers and in\/out points close up too/)
    await user.click(screen.getByRole('button', { name: 'Remove all' }))
    expect(blurAt()).toBeCloseTo(3.2, 9)
    expect(store().markers[0].time).toBeCloseTo(3.2, 9)

    store().undo()
    expect(blurAt()).toBe(4)
    expect(store().markers[0].time).toBe(4)
    store().setSelectedClipId(part.id)
    await open()
    await user.click(screen.getByRole('checkbox', { name: 'Move everything after each cut' }))
    expect(screen.getByRole('checkbox', { name: 'Move everything after each cut' })).toHaveAccessibleDescription("Only this take's tracks close up.")
    await user.click(screen.getByRole('button', { name: 'Remove all' }))
    expect(blurAt()).toBe(4)
    expect(store().markers[0].time).toBe(4)
  })

  describe('what the cut leaves behind (ESCSUITE-431)', () => {
    const MOVE = 'Move everything after each cut'
    /** Open the dialog on the take's screen part, with only the pause at 2.1–2.9 s listed. */
    async function openOnTake(part: { id: string }) {
      store().setSelectedClipId(part.id)
      const user = userEvent.setup()
      const { rerender, onRemoved } = renderEditor()
      await user.click(screen.getByRole('button', { name: 'Find silences' }))
      rerender(<><ClipEditor /><Dialog onRemoved={onRemoved} /></>)
      await user.click(screen.getByRole('button', { name: 'Keep the pause at 0:05.10' }))
      return { user, onRemoved }
    }
    const warning = () => screen.queryByTestId('silence-left-behind')

    it('counts each kind on other tracks and the markers with the box cleared, and the notice repeats it', async () => {
      const { screen: part } = placeTake()
      store().addShapeOverlayClip({ type: 'blur' }, undefined, 4, 2)
      store().addShapeOverlayClip({ type: 'rectangle' }, undefined, 1, 2) // overlaps the cut
      store().addTextOverlayClip({ text: 'Title' }, undefined, 5, 1)
      store().addCaptionCues([{ start: 3, end: 4, text: 'Hi' }, { start: 4.5, end: 5, text: 'There' }], captionStyleFor({ width: 1920, height: 1080 }))
      store().addClipToTimeline({ id: 'music', sourceVideoId: mic.id, name: 'music', startTime: 0, endTime: 4, duration: 4 }, undefined, 3)
      store().addShapeOverlayClip({ type: 'blur' }, undefined, 0, 1) // ends before the cut: not counted
      store().addMarker(1) // before the cut: not counted
      store().addMarker(2.5)
      store().addMarker(6)
      const { user, onRemoved } = await openOnTake(part)

      expect(warning()).toBeNull() // the box is on: everything moves
      await user.click(screen.getByRole('checkbox', { name: MOVE }))
      const text = '6 clips on other tracks will not move: 1 blur, 2 captions, 2 texts or shapes, 1 media clip. 2 markers will not move.'
      expect(warning()).toHaveTextContent(text)
      expect(screen.getByRole('dialog')).toHaveAccessibleDescription(`${text} They may fall out of step with the take.`)

      await user.click(screen.getByRole('button', { name: 'Remove all' }))
      expect(onRemoved).toHaveBeenCalledWith(
        'Removed 1 pause (0.80 s). Ctrl+Z puts it back. 6 clips on other tracks did not move: 1 blur, 2 captions, 2 texts or shapes, 1 media clip. 2 markers did not move.'
      )
    })

    it('with the box on, counts only what sits on a locked track', async () => {
      const { screen: part } = placeTake()
      const blur = store().addShapeOverlayClip({ type: 'blur' }, undefined, 4, 2)!
      store().addTextOverlayClip({ text: 'Title' }, undefined, 5, 1)
      store().updateTrack(blur.trackId, { locked: true })
      store().addMarker(6)
      const { user, onRemoved } = await openOnTake(part)

      expect(warning()).toHaveTextContent('1 clip on a locked track will not move: 1 blur.')
      expect(warning()).not.toHaveTextContent('marker')
      await user.click(screen.getByRole('button', { name: 'Remove all' }))
      expect(onRemoved).toHaveBeenCalledWith('Removed 1 pause (0.80 s). Ctrl+Z puts it back. 1 clip on a locked track did not move: 1 blur.')
      expect(store().project.timeline.clips.find((c) => c.id === blur.id)!.timelinePosition).toBe(4)
    })

    it('with the box on, names a clip held back by a link to a locked track', async () => {
      const { screen: part } = placeTake()
      store().addClipToTimeline({ id: 'b-roll', sourceVideoId: video.id, name: 'b-roll', startTime: 0, endTime: 2, duration: 2 }, undefined, 4)
      store().addClipToTimeline({ id: 'b-sound', sourceVideoId: mic.id, name: 'b-sound', startTime: 0, endTime: 2, duration: 2 }, undefined, 4)
      useEditorStore.setState((state) => ({
        project: {
          ...state.project,
          timeline: {
            ...state.project.timeline,
            clips: state.project.timeline.clips.map((c) => (c.name.startsWith('b-') ? { ...c, linkGroupId: 'pair' } : c)),
          },
        },
      }))
      store().updateTrack(store().project.timeline.clips.find((c) => c.id === 'b-sound')!.trackId, { locked: true })
      await openOnTake(part)
      expect(warning()).toHaveTextContent('2 clips on locked tracks or linked to one will not move: 2 media clips.')
    })

    it('shows no warning, and no description, when nothing is left behind', async () => {
      const { screen: part } = placeTake()
      store().addShapeOverlayClip({ type: 'blur' }, undefined, 0, 1)
      store().addMarker(1)
      const { user } = await openOnTake(part)
      await user.click(screen.getByRole('checkbox', { name: MOVE }))
      expect(warning()).toBeNull()
      expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-describedby')
    })
  })

  it('says so on open and disables Remove all when one of the take\'s tracks is locked (ESCSUITE-449)', async () => {
    const { screen: part, mic: micClip } = placeTake()
    store().setSelectedClipId(part.id)
    store().updateTrack(micClip.trackId, { locked: true })
    const user = userEvent.setup()
    const { rerender, onRemoved } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'Find silences' }))
    rerender(<><ClipEditor /><Dialog onRemoved={onRemoved} /></>)

    expect(screen.getByRole('alert')).toHaveTextContent('a track this take sits on is locked')
    expect(screen.getByRole('button', { name: 'Remove all' })).toBeDisabled()
    expect(onRemoved).not.toHaveBeenCalled()
    expect(store().project.timeline.clips).toHaveLength(2)
  })

  it('shows the locked notice when a track is locked while the dialog is open, and clears it on unlock (ESCSUITE-449)', async () => {
    const { screen: part, mic: micClip } = placeTake()
    store().setSelectedClipId(part.id)
    const user = userEvent.setup()
    const { rerender, onRemoved } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'Find silences' }))
    rerender(<><ClipEditor /><Dialog onRemoved={onRemoved} /></>)
    expect(screen.queryByRole('alert')).toBeNull()
    act(() => store().updateTrack(micClip.trackId, { locked: true }))
    expect(screen.getByRole('alert')).toHaveTextContent('is locked')
    expect(screen.getByRole('button', { name: 'Remove all' })).toBeDisabled()
    act(() => store().updateTrack(micClip.trackId, { locked: false }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove all' })).toBeEnabled()
  })

  it('cautions when the cuts would remove 90 % or more of the clip, and not below it (ESCSUITE-449)', async () => {
    const { screen: part } = placeTake()
    store().setSelectedClipId(part.id)
    const user = userEvent.setup()
    const { rerender, onRemoved } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'Find silences' }))
    rerender(<><ClipEditor /><Dialog onRemoved={onRemoved} /></>)
    expect(screen.getByRole('status')).not.toHaveTextContent('90 %')

    const threshold = screen.getByLabelText('Threshold (dBFS)')
    await user.clear(threshold)
    await user.type(threshold, '0')
    expect(pauses()).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('This removes 90 % or more of screen.')
  })

  it('says the clip is gone, and cuts nothing, when the project changed under the dialog', async () => {
    const { screen: part } = placeTake()
    store().setSelectedClipId(part.id)
    const user = userEvent.setup()
    const { rerender, onRemoved } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'Find silences' }))
    rerender(<><ClipEditor /><Dialog onRemoved={onRemoved} /></>)
    // A host page replacing the project (integration API) is not stopped by the modal.
    store().removeClipFromTimeline(part.id)

    await user.click(screen.getByRole('button', { name: 'Remove all' }))
    expect(screen.getByRole('alert')).toHaveTextContent('the clip is no longer on the timeline')
    expect(onRemoved).not.toHaveBeenCalled()
  })

  it('closes on Cancel and on Escape, cutting nothing', async () => {
    const { screen: part } = placeTake()
    store().setSelectedClipId(part.id)
    const user = userEvent.setup()
    const { rerender, onRemoved } = renderEditor()

    await user.click(screen.getByRole('button', { name: 'Find silences' }))
    rerender(<><ClipEditor /><Dialog onRemoved={onRemoved} /></>)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(store().silenceReview).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Find silences' }))
    rerender(<><ClipEditor /><Dialog onRemoved={onRemoved} /></>)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(store().silenceReview).toBeNull()
    expect(store().project.timeline.clips).toHaveLength(2)
  })

  it('opens with the default settings again after Cancel, matching the list they find, even when kept mounted (ESCSUITE-463)', async () => {
    const { screen: part } = placeTake()
    store().setSelectedClipId(part.id)
    const user = userEvent.setup()
    // Mounted for good, not only while the review is open as App mounts it:
    // the dialog itself has to forget a cancelled session's fields.
    render(<><ClipEditor /><SilenceDialog onRemoved={vi.fn()} /></>)
    const field = (label: string) => screen.getByLabelText(label)

    await user.click(screen.getByRole('button', { name: 'Find silences' }))
    // A valid setting finds the pauses again; an out-of-range one is marked.
    await user.clear(field('Padding (s)'))
    await user.type(field('Padding (s)'), '0.3')
    expect(pauses()[0]).toHaveTextContent('0:02.30 – 0:02.70')
    await user.clear(field('Minimum gap (s)'))
    await user.type(field('Minimum gap (s)'), '99')
    expect(field('Minimum gap (s)')).toHaveAttribute('aria-invalid', 'true')
    await user.click(screen.getByRole('checkbox', { name: 'Move everything after each cut' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(store().silenceReview).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Find silences' }))
    // The inspector found this list with the defaults, so the fields read them.
    expect(field('Threshold (dBFS)')).toHaveValue(-40)
    expect(field('Minimum gap (s)')).toHaveValue(0.7)
    expect(field('Minimum gap (s)')).not.toHaveAttribute('aria-invalid')
    expect(field('Padding (s)')).toHaveValue(0.1)
    expect(pauses()).toHaveLength(2)
    expect(pauses()[0]).toHaveTextContent('0:02.10 – 0:02.90')
    expect(screen.getByRole('checkbox', { name: 'Move everything after each cut' })).toBeChecked()
  })

  it('renders nothing while the review is closed', () => {
    const { container } = render(<><SilenceDialog onRemoved={vi.fn()} /><TimelineSilenceBands pixelsPerSecond={50} height={10} /></>)
    expect(container).toBeEmptyDOMElement()
  })

  it('ignores a list of cuts while the review is closed', () => {
    store().setSilenceCandidates([{ start: 1, end: 2 }])
    expect(store().silenceReview).toBeNull()
  })
})

describe('Remove silences: go to and play a pause before cutting it (ESCSUITE-443)', () => {
  // The two pauses the defaults find: 2.10–2.90 s and 5.10–5.90 s. Play runs
  // from 1 s before a pause to 1 s after it: 2.8 s of playback for each.
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    resetStoreForTest()
    useEditorStore.setState({ currentTime: 0, isPlaying: false })
    scrollIntoView.mockClear()
    Element.prototype.scrollIntoView = scrollIntoView
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (Element.prototype as Partial<Element>).scrollIntoView
  })

  /**
   * Open the dialog on the take. With `timers`, setTimeout is faked from then
   * on, and the test clicks with `press` (fireEvent): user-event's async
   * wrapper waits on a real setTimeout, which a faked one never runs.
   */
  async function openDialog(timers = false) {
    const { screen: part } = placeTake()
    store().setSelectedClipId(part.id)
    const user = userEvent.setup()
    const { rerender, onRemoved } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'Find silences' }))
    rerender(<><ClipEditor /><Dialog onRemoved={onRemoved} /></>)
    if (timers) vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    return { user, rerender, onRemoved }
  }

  const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }))

  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))
  const playhead = () => store().currentTime

  it('gives every row Go to and Play, named for the pause, as well as Keep', async () => {
    await openDialog()
    const [first, second] = pauses()
    for (const [row, at] of [[first, '0:02.10'], [second, '0:05.10']] as const) {
      expect(within(row).getByRole('button', { name: `Go to the pause at ${at}` })).toHaveTextContent('Go to')
      expect(within(row).getByRole('button', { name: `Play the pause at ${at}` })).toHaveTextContent('Play')
      expect(within(row).getByRole('button', { name: `Keep the pause at ${at}` })).toBeInTheDocument()
    }
  })

  it('Go to moves the playhead to the pause start from the keyboard, and scrolls its row into view', async () => {
    const { user } = await openDialog()
    act(() => screen.getByRole('button', { name: 'Go to the pause at 0:05.10' }).focus())
    await user.keyboard('{Enter}')

    expect(playhead()).toBeCloseTo(5.1, 6)
    expect(store().isPlaying).toBe(false)
    const row = pauses()[1]
    expect(row).toHaveAttribute('aria-current', 'true')
    expect(pauses()[0]).not.toHaveAttribute('aria-current')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts[0]).toBe(row)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    // The dialog stays open and the list is untouched: nothing is cut.
    expect(pauses()).toHaveLength(2)
  })

  it('Play plays from 1 s before the pause to 1 s after it, then stops there', async () => {
    await openDialog(true)
    press('Play the pause at 0:02.10')

    expect(store().isPlaying).toBe(true)
    expect(playhead()).toBeCloseTo(1.1, 6)
    expect(pauses()[0]).toHaveAttribute('aria-current', 'true')
    advance(2790)
    expect(store().isPlaying).toBe(true)
    advance(10)
    expect(store().isPlaying).toBe(false)
    expect(playhead()).toBeCloseTo(3.9, 6)
  })

  it('starts Play at 0 for a pause less than 1 s in', async () => {
    await openDialog(true)
    act(() => store().setSilenceCandidates([{ start: 0.4, end: 1.2 }]))
    press('Play the pause at 0:00.40')
    expect(playhead()).toBe(0)
    advance(2200)
    expect(store().isPlaying).toBe(false)
    expect(playhead()).toBeCloseTo(2.2, 6)
  })

  it('stops Play at the end of the timeline for a pause less than 1 s from it, never past it (ESCSUITE-462)', async () => {
    await openDialog(true)
    expect(store().project.timeline.duration).toBe(7)
    act(() => store().setSilenceCandidates([{ start: 6.2, end: 6.6 }]))
    press('Play the pause at 0:06.20')
    expect(playhead()).toBeCloseTo(5.2, 6)
    advance(1790)
    expect(store().isPlaying).toBe(true)
    advance(10)
    expect(store().isPlaying).toBe(false)
    expect(playhead()).toBe(7)
    advance(5000)
    expect(playhead()).toBe(7)
  })

  it('plays a pause straight through with loop playback and in/out points set, and leaves both as they were (ESCSUITE-462)', async () => {
    await openDialog(true)
    act(() => {
      store().setLoopPlayback(true)
      store().setInPoint(0.5)
      store().setOutPoint(1.5)
    })
    press('Play the pause at 0:05.10')
    // The pause lies past the out point: the preview plays it where it is,
    // neither jumping back to the in point nor wrapping at the timeline's end.
    expect(store().loopSuspended).toBe(true)
    expect(store().loopPlayback).toBe(true)
    advance(2800)
    expect(store().isPlaying).toBe(false)
    expect(playhead()).toBeCloseTo(6.9, 6)
    expect(store().loopSuspended).toBe(false)
    expect(store().loopPlayback).toBe(true)
    expect([store().inPoint, store().outPoint]).toEqual([0.5, 1.5])
  })

  it.each([
    ['the dialog closing', () => press('Cancel')],
    ['Go to', () => press('Go to the pause at 0:05.10')],
    ['a pause from elsewhere', () => act(() => store().setIsPlaying(false))],
    ['a seek from elsewhere', () => act(() => store().seekTo(0.5))],
  ])('gives the loop back when %s interrupts Play (ESCSUITE-462)', async (_, interrupt) => {
    await openDialog(true)
    act(() => store().setLoopPlayback(true))
    press('Play the pause at 0:02.10')
    advance(1000)
    expect(store().loopSuspended).toBe(true)
    interrupt()
    expect(store().loopSuspended).toBe(false)
    expect(store().loopPlayback).toBe(true)
  })

  it('keeps the loop suspended across a second Play, and gives it back when that one ends (ESCSUITE-462)', async () => {
    await openDialog(true)
    act(() => store().setLoopPlayback(true))
    press('Play the pause at 0:02.10')
    advance(1000)
    press('Play the pause at 0:05.10')
    expect(store().loopSuspended).toBe(true)
    advance(2800)
    expect(store().isPlaying).toBe(false)
    expect(store().loopSuspended).toBe(false)
    expect(store().loopPlayback).toBe(true)
  })

  it('stops as soon as the playhead passes 1 s after the pause, even before the timer', async () => {
    // The preview's loop can get there early (playback started in a gap jumps
    // to the next clip, ESCSUITE-280); its store writes are the backstop.
    await openDialog(true)
    press('Play the pause at 0:02.10')
    act(() => store().setCurrentTime(3))
    expect(store().isPlaying).toBe(true)
    act(() => store().setCurrentTime(3.95))
    expect(store().isPlaying).toBe(false)
    expect(playhead()).toBeCloseTo(3.9, 6)
  })

  it('a second Play replaces the first: it restarts from the new pause and stops at its end', async () => {
    await openDialog(true)
    press('Play the pause at 0:02.10')
    advance(1500)
    press('Play the pause at 0:05.10')
    expect(store().isPlaying).toBe(true)
    expect(playhead()).toBeCloseTo(4.1, 6)
    expect(pauses()[1]).toHaveAttribute('aria-current', 'true')

    advance(1500) // past where the first Play would have stopped
    expect(store().isPlaying).toBe(true)
    expect(playhead()).toBeCloseTo(4.1, 6)
    advance(1300)
    expect(store().isPlaying).toBe(false)
    expect(playhead()).toBeCloseTo(6.9, 6)
  })

  it('Go to during Play stops it at the pause start, and the timer does nothing later', async () => {
    await openDialog(true)
    press('Play the pause at 0:02.10')
    advance(1000)
    press('Go to the pause at 0:05.10')
    expect(store().isPlaying).toBe(false)
    expect(playhead()).toBeCloseTo(5.1, 6)
    advance(5000)
    expect(playhead()).toBeCloseTo(5.1, 6)
    expect(store().isPlaying).toBe(false)
  })

  it('closing the dialog stops a Play, and the timer does nothing later', async () => {
    await openDialog(true)
    press('Play the pause at 0:02.10')
    advance(1000)
    press('Cancel')
    expect(store().silenceReview).toBeNull()
    expect(store().isPlaying).toBe(false)
    act(() => store().seekTo(0.5))
    advance(5000)
    expect(playhead()).toBe(0.5)
  })

  it('lets go of a Play that something else paused or moved', async () => {
    await openDialog(true)
    press('Play the pause at 0:02.10')
    act(() => store().setIsPlaying(false))
    act(() => store().seekTo(0.5))
    act(() => store().setIsPlaying(true))
    advance(5000)
    // Playback the dialog did not start is not stopped or moved by it.
    expect(store().isPlaying).toBe(true)
    expect(playhead()).toBe(0.5)
  })

  it('leaves playback it did not start alone when it closes', async () => {
    const { user } = await openDialog()
    act(() => store().setIsPlaying(true))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(store().isPlaying).toBe(true)
  })

  it('keeps 441\'s focus order: Keep moves focus to the next row\'s Keep, past its Go to and Play', async () => {
    const { user } = await openDialog()
    act(() => screen.getByRole('button', { name: 'Keep the pause at 0:02.10' }).focus())
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Keep the pause at 0:05.10' })).toHaveFocus()
  })
})

describe('Remove silences: muted and hidden rows (ESCSUITE-435)', () => {
  beforeEach(() => resetStoreForTest())

  // A system-audio part with tone throughout, as music under a talk would be.
  const MUSIC_SAMPLES = 7 * RATE
  const music: SourceVideo = (() => {
    const pcm = new Float32Array(MUSIC_SAMPLES)
    for (let i = 0; i < pcm.length; i++) pcm[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / RATE)
    return {
      id: 'music-src', name: 'system.webm', duration: 7, width: 0, height: 0, frameRate: 0,
      mimeType: 'audio/webm', size: 1, mediaType: 'audio', hasAudio: true, waveformData: peaksFromPcm(pcm, RATE, 100),
      waveformSecondsPerPeak: peakSecondsFor(MUSIC_SAMPLES, RATE, 100),
    }
  })()

  /** Screen, microphone and system audio, linked, each on its own row. */
  function placeThreePartTake() {
    store().addSourceVideo(mic)
    store().addSourceVideo(music)
    store().placeTakeOnTimeline([
      { sourceVideoId: video.id, name: 'screen', duration: 7, startOffset: 0, width: 1920, height: 1080 },
      { sourceVideoId: mic.id, name: 'mic', duration: 7, startOffset: 0, width: 0, height: 0, mediaType: 'audio' },
      { sourceVideoId: music.id, name: 'system', duration: 7, startOffset: 0, width: 0, height: 0, mediaType: 'audio' },
    ])
    const clips = store().project.timeline.clips
    const named = (name: string) => clips.find((c) => c.name === name)!
    return { screen: named('screen'), mic: named('mic'), system: named('system') }
  }

  async function openDialog(clipId: string) {
    store().setSelectedClipId(clipId)
    const user = userEvent.setup()
    const { rerender, onRemoved } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'Find silences' }))
    rerender(<><ClipEditor /><Dialog onRemoved={onRemoved} /></>)
    return { user, onRemoved }
  }

  it('hears the system audio while its row plays, so the microphone\'s pauses are kept', async () => {
    const { screen: part } = placeThreePartTake()
    await openDialog(part.id)
    expect(pauses()).toHaveLength(0)
    expect(screen.getByRole('status')).toHaveTextContent('No pauses to cut with these settings.')
  })

  it('does not listen to a muted row, and still cuts it in step with the take', async () => {
    const { screen: part, mic: micClip, system } = placeThreePartTake()
    store().updateTrack(system.trackId, { muted: true })
    const { user, onRemoved } = await openDialog(part.id)
    expect(pauses()).toHaveLength(2)
    expect(pauses()[0]).toHaveTextContent('0:02.10 – 0:02.90')

    await user.click(screen.getByRole('button', { name: 'Keep the pause at 0:05.10' }))
    await user.click(screen.getByRole('button', { name: 'Remove all' }))
    expect(onRemoved).toHaveBeenCalledWith('Removed 1 pause (0.80 s). Ctrl+Z puts it back.')
    const rowOf = (trackId: string) =>
      store().project.timeline.clips.filter((c) => c.trackId === trackId).map((c) => [c.timelinePosition, c.startTime, c.endTime].map((n) => +n.toFixed(6)))
    for (const clip of [part, micClip, system]) expect(rowOf(clip.trackId)).toEqual([[0, 0, 2.1], [2.1, 2.9, 7]])
  })

  it('does not listen to a hidden row either', async () => {
    const { screen: part, system } = placeThreePartTake()
    store().updateTrack(system.trackId, { visible: false })
    await openDialog(part.id)
    expect(pauses()).toHaveLength(2)
  })

  it('says there is no audible sound to judge when every row with sound is muted', async () => {
    const { screen: part, mic: micClip, system } = placeThreePartTake()
    store().updateTrack(micClip.trackId, { muted: true })
    store().updateTrack(system.trackId, { muted: true })
    await openDialog(part.id)
    expect(pauses()).toHaveLength(0)
    expect(screen.getByRole('status')).toHaveTextContent('No audible sound to judge: every track with sound here is muted or hidden.')
    expect(screen.getByRole('button', { name: 'Remove all' })).toBeDisabled()
  })
})

describe('Remove silences: a floor on the minimum gap and a cap on the list (ESCSUITE-487)', () => {
  beforeEach(() => resetStoreForTest())

  async function openDialog(clipId: string, bands = false) {
    store().setSelectedClipId(clipId)
    const user = userEvent.setup()
    const { rerender, onRemoved } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'Find silences' }))
    const redraw = () =>
      rerender(
        <>
          <ClipEditor />
          <Dialog onRemoved={onRemoved} />
          {bands && <TimelineSilenceBands pixelsPerSecond={50} height={100} />}
        </>
      )
    redraw()
    return { user, onRemoved, redraw }
  }

  const showMore = () => screen.queryByRole('button', { name: /^Show \d+ more pauses?$/ })

  it('refuses a minimum gap under 0.1 s with the invalid-field hint, and Remove all waits for it', async () => {
    const { screen: part } = placeTake()
    const { user } = await openDialog(part.id)
    const minGap = screen.getByLabelText('Minimum gap (s)')
    expect(minGap).toHaveAttribute('min', '0.1')
    const removeAll = screen.getByRole('button', { name: 'Remove all' })

    for (const tooShort of ['0', '0.05', '-1']) {
      await user.clear(minGap)
      await user.type(minGap, tooShort)
      expect(minGap).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByText('Enter a number from 0.1 to 60.')).toBeInTheDocument()
      // Not found again with it, and nothing can be cut while the fields do
      // not show the settings the list was found with.
      expect(pauses()).toHaveLength(2)
      expect(removeAll).toBeDisabled()
    }

    await user.clear(minGap)
    await user.type(minGap, '0.1')
    expect(minGap).not.toHaveAttribute('aria-invalid')
    expect(screen.getByText('Shorter pauses are left alone.')).toBeInTheDocument()
    expect(removeAll).toBeEnabled()
  })

  it('also disables Remove all while another field does not read', async () => {
    const { screen: part } = placeTake()
    const { user } = await openDialog(part.id)
    await user.clear(screen.getByLabelText('Threshold (dBFS)'))
    expect(screen.getByRole('button', { name: 'Remove all' })).toBeDisabled()
  })

  /**
   * `seconds` of choppy talk: every second, 0.8 s of silence then 0.2 s of
   * tone, so the defaults find one pause of 0.6 s a second.
   */
  function placeChoppy(seconds: number) {
    const choppy: SourceVideo = {
      id: 'choppy-src', name: 'choppy.webm', duration: seconds, width: 0, height: 0, frameRate: 0,
      mimeType: 'audio/webm', size: 1, mediaType: 'audio', hasAudio: true, waveformSecondsPerPeak: 0.01,
      waveformData: Array.from({ length: seconds * 100 }, (_, i) => (i % 100 < 80 ? { min: 0, max: 0 } : { min: -0.8, max: 0.8 })),
    }
    store().addSourceVideo(choppy)
    store().placeTakeOnTimeline([{ sourceVideoId: choppy.id, name: 'choppy', duration: seconds, startOffset: 0, width: 0, height: 0, mediaType: 'audio' }])
    return store().project.timeline.clips.find((c) => c.name === 'choppy')!
  }

  it('lists only the first 500 of more pauses, says how many it found, and Remove all cuts every one', async () => {
    // Ten minutes are enough to pass the cap; the hour is measured in the docs.
    const take = placeChoppy(600)
    const { user, onRemoved } = await openDialog(take.id, true)

    expect(store().silenceReview!.candidates).toHaveLength(600)
    expect(screen.getByRole('status')).toHaveTextContent(
      '600 pauses found · 360.00 s will be cut. The list shows the first 500 of 600; Remove all cuts all 600.'
    )
    expect(pauses()).toHaveLength(500)
    expect(pauses()[499]).toHaveTextContent('8:19.10 – 8:19.70')
    // The bands are where the cuts go, so every one is drawn.
    expect(screen.getAllByTestId('silence-band')).toHaveLength(600)
    expect(showMore()).toHaveTextContent('Show 100 more pauses')

    // Keep still drops the row pressed, and the next one moves up into the list.
    await user.click(screen.getByRole('button', { name: 'Keep the pause at 0:00.10' }))
    expect(store().silenceReview!.candidates).toHaveLength(599)
    expect(pauses()).toHaveLength(500)
    expect(screen.getByRole('status')).toHaveTextContent('Remove all cuts all 599.')

    await user.click(screen.getByRole('button', { name: 'Remove all' }))
    expect(onRemoved).toHaveBeenCalledWith('Removed 599 pauses (359.40 s). Ctrl+Z puts them back.')
    // 599 cuts leave 600 pieces: every pause found was cut, not only the listed ones.
    expect(store().project.timeline.clips.filter((c) => c.trackId === take.trackId)).toHaveLength(600)
    // 500 rows of three buttons: about a second alone, several under the full suite's load.
  }, 20_000)

  it('draws pauses less than a pixel apart on the timeline as one band, and every band once zoomed in', () => {
    const { screen: part } = placeTake()
    store().setSilenceReviewClip(part.id)
    store().setSilenceCandidates([{ start: 0, end: 1 }, { start: 1.01, end: 2 }, { start: 3, end: 4 }])
    const bandBox = () => screen.getAllByTestId('silence-band').map((b) => [parseFloat(b.style.left), parseFloat(b.style.width)])
    // At 50 px/s the 10 ms between the first two is half a pixel.
    const { rerender } = render(<TimelineSilenceBands pixelsPerSecond={50} height={100} />)
    expect(bandBox()).toEqual([[0, 100], [150, 50]])
    rerender(<TimelineSilenceBands pixelsPerSecond={500} height={100} />)
    expect(bandBox().map(([left, width]) => [+left.toFixed(6), +width.toFixed(6)])).toEqual([[0, 500], [505, 495], [1500, 500]])
  })

  it('lists every pause up to 500 and says nothing about a cap', async () => {
    await openDialog(placeChoppy(500).id)
    expect(store().silenceReview!.candidates).toHaveLength(500)
    expect(pauses()).toHaveLength(500)
    expect(screen.getByRole('status')).toHaveTextContent(/^500 pauses found · 300\.00 s will be cut$/)
    expect(showMore()).toBeNull()
  }, 20_000)

  it('shows 500 more pauses at a time, then the rest, moving focus to the first new row, and Keep works past 500', async () => {
    const { user } = await openDialog(placeChoppy(1100).id)
    expect(pauses()).toHaveLength(500)
    expect(showMore()).toHaveTextContent('Show 500 more pauses')

    await user.click(showMore()!)
    expect(pauses()).toHaveLength(1000)
    expect(screen.getByRole('button', { name: 'Go to the pause at 8:20.10' })).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('The list shows the first 1000 of 1100; Remove all cuts all 1100.')

    await user.click(showMore()!)
    expect(pauses()).toHaveLength(1100)
    expect(showMore()).toBeNull()
    expect(screen.getByRole('button', { name: 'Go to the pause at 16:40.10' })).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent(/^1100 pauses found · 660\.00 s will be cut$/)

    // A pause the first page never listed can be kept.
    await user.click(screen.getByRole('button', { name: 'Keep the pause at 16:40.10' }))
    expect(store().silenceReview!.candidates).toHaveLength(1099)
    expect(store().silenceReview!.candidates.some((r) => Math.abs(r.start - 1000.1) < 1e-6)).toBe(false)
    expect(pauses()).toHaveLength(1099)
    expect(screen.getByRole('button', { name: 'Keep the pause at 16:41.10' })).toHaveFocus()
  }, 30_000)

  it('starts again from 500 rows when the pauses are found again, or the dialog is opened again', async () => {
    const { user, redraw } = await openDialog(placeChoppy(1100).id)
    await user.click(showMore()!)
    expect(pauses()).toHaveLength(1000)

    const padding = screen.getByLabelText('Padding (s)')
    await user.clear(padding)
    await user.type(padding, '0.2')
    expect(store().silenceReview!.candidates).toHaveLength(1100)
    expect(pauses()).toHaveLength(500)
    expect(showMore()).toHaveTextContent('Show 500 more pauses')

    await user.click(showMore()!)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    redraw()
    await user.click(screen.getByRole('button', { name: 'Find silences' }))
    redraw()
    expect(pauses()).toHaveLength(500)
  }, 30_000)
})
