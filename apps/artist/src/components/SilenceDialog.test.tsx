// "Remove silences" (ESCSUITE-403): the inspector's Find silences action, the
// review dialog and its bands on the timeline, and "Remove all" as one undo step.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClipEditor } from './ClipEditor/ClipEditor'
import { SilenceDialog } from './SilenceDialog'
import { TimelineSilenceBands } from './Timeline/TimelineSilenceBands'
import { resetStoreForTest, store, video } from '../test/fixtures/projectStore'
import { peakSecondsFor, peaksFromPcm } from '../utils/waveformPeaks'
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
    expect(onRemoved).toHaveBeenCalledWith('Removed 1 pause (0.80 s). Ctrl+Z puts them back.')
    const rowOf = (trackId: string) =>
      store().project.timeline.clips.filter((c) => c.trackId === trackId).map((c) => [c.timelinePosition, c.startTime, c.endTime].map((n) => +n.toFixed(6)))
    expect(rowOf(part.trackId)).toEqual([[0, 0, 2.1], [2.1, 2.9, 7]])
    expect(rowOf(micClip.trackId)).toEqual([[0, 0, 2.1], [2.1, 2.9, 7]])
    expect(store().project.timeline.duration).toBeCloseTo(6.2, 9)

    store().undo()
    expect(JSON.stringify(store().project)).toBe(before)
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

  it('says so and cuts nothing when one of the take\'s tracks is locked', async () => {
    const { screen: part, mic: micClip } = placeTake()
    store().setSelectedClipId(part.id)
    const user = userEvent.setup()
    const { rerender, onRemoved } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'Find silences' }))
    rerender(<><ClipEditor /><Dialog onRemoved={onRemoved} /></>)
    store().updateTrack(micClip.trackId, { locked: true })

    await user.click(screen.getByRole('button', { name: 'Remove all' }))
    expect(screen.getByRole('alert')).toHaveTextContent('a track this take sits on is locked')
    expect(onRemoved).not.toHaveBeenCalled()
    expect(store().project.timeline.clips).toHaveLength(2)
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

  it('renders nothing while the review is closed', () => {
    const { container } = render(<><SilenceDialog onRemoved={vi.fn()} /><TimelineSilenceBands pixelsPerSecond={50} height={10} /></>)
    expect(container).toBeEmptyDOMElement()
  })

  it('ignores a list of cuts while the review is closed', () => {
    store().setSilenceCandidates([{ start: 1, end: 2 }])
    expect(store().silenceReview).toBeNull()
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
    expect(onRemoved).toHaveBeenCalledWith('Removed 1 pause (0.80 s). Ctrl+Z puts them back.')
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
