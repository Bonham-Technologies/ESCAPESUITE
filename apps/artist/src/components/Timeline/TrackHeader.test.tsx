// One track-headers row, rendered from props alone — no store, no Timeline.
//
// The header is the only place the rename draft lives, so the commit/abandon
// paths are exercised here in full; everything else it does is reported to the
// caller, and what is asserted is that each control reaches the right callback
// with the right arguments, and that the DOM the timeline's own tests query
// (titles, aria labels, the `active` class) is what this component draws.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TrackHeader } from './TrackHeader'
import type { Track } from '../../store/types'
import styles from './Timeline.module.css'

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 't1',
    name: 'Track 1',
    index: 0,
    visible: true,
    locked: false,
    muted: false,
    volume: 1,
    height: 60,
    ...overrides,
  }
}

function makeCallbacks() {
  return {
    onUpdateTrack: vi.fn<(trackId: string, updates: Partial<Track>) => void>(),
    onMoveTrackUp: vi.fn<(trackId: string) => void>(),
    onMoveTrackDown: vi.fn<(trackId: string) => void>(),
    onDeleteTrack: vi.fn<(trackId: string) => void>(),
  }
}

function renderHeader(
  opts: { track?: Track; index?: number; trackCount?: number } = {}
): { root: HTMLElement; calls: ReturnType<typeof makeCallbacks> } {
  const calls = makeCallbacks()
  const { container } = render(
    <TrackHeader
      track={opts.track ?? makeTrack()}
      index={opts.index ?? 0}
      trackCount={opts.trackCount ?? 2}
      {...calls}
    />
  )
  return { root: container.firstElementChild as HTMLElement, calls }
}

describe('TrackHeader layout', () => {
  it('sizes the row to the track height', () => {
    const { root } = renderHeader({ track: makeTrack({ height: 88 }) })

    expect(root).toHaveClass(styles.trackHeader)
    expect(root).toHaveStyle({ height: '88px' })
  })

  it('shows the track name with its rename hint', () => {
    renderHeader({ track: makeTrack({ name: 'Dialogue' }) })

    const name = screen.getByTitle('Double-click to rename')
    expect(name).toHaveTextContent('Dialogue')
    expect(name).toHaveClass(styles.trackName)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})

describe('TrackHeader volume', () => {
  it('shows the track volume as a percentage, labelled by track name', () => {
    renderHeader({ track: makeTrack({ name: 'Music', volume: 0.35 }) })

    const slider = screen.getByLabelText('Music volume')
    expect(slider).toHaveValue('0.35')
    expect(slider).toHaveAttribute('title', 'Volume: 35%')
  })

  it('falls back to full volume when the track has none', () => {
    // `volume` is required by the type, but a project restored from an older
    // save can arrive without it; the slider must still have a position.
    const track = { ...makeTrack(), volume: undefined } as unknown as Track
    renderHeader({ track })

    expect(screen.getByLabelText('Track 1 volume')).toHaveAttribute('title', 'Volume: 100%')
  })

  it('remembers a raised volume as the level to restore on unmute', () => {
    const { calls } = renderHeader()

    fireEvent.change(screen.getByLabelText('Track 1 volume'), { target: { value: '0.6' } })

    expect(calls.onUpdateTrack).toHaveBeenCalledWith('t1', { volume: 0.6, lastVolume: 0.6 })
  })

  it('keeps the remembered level when the slider is dragged to zero', () => {
    const { calls } = renderHeader({ track: makeTrack({ volume: 0.6, lastVolume: 0.4 }) })

    fireEvent.change(screen.getByLabelText('Track 1 volume'), { target: { value: '0' } })

    expect(calls.onUpdateTrack).toHaveBeenCalledWith('t1', { volume: 0, lastVolume: 0.4 })
  })

  it('unmutes the track when a muted slider is raised', () => {
    const { calls } = renderHeader({ track: makeTrack({ muted: true, volume: 0 }) })

    fireEvent.change(screen.getByLabelText('Track 1 volume'), { target: { value: '0.7' } })

    expect(calls.onUpdateTrack).toHaveBeenCalledWith('t1', { volume: 0.7, muted: false })
  })

  it('leaves a muted track muted when its slider is set to zero', () => {
    const { calls } = renderHeader({ track: makeTrack({ muted: true, volume: 0.6, lastVolume: 0.8 }) })

    fireEvent.change(screen.getByLabelText('Track 1 volume'), { target: { value: '0' } })

    expect(calls.onUpdateTrack).toHaveBeenCalledWith('t1', { volume: 0, lastVolume: 0.8 })
  })
})

describe('TrackHeader mute', () => {
  it('mutes by banking the current volume and dropping it to zero', () => {
    const { calls } = renderHeader({ track: makeTrack({ volume: 0.5 }) })

    fireEvent.click(screen.getByTitle('Mute'))

    expect(calls.onUpdateTrack).toHaveBeenCalledWith('t1', {
      muted: true,
      lastVolume: 0.5,
      volume: 0,
    })
  })

  it('unmutes back to the banked volume', () => {
    const { calls } = renderHeader({ track: makeTrack({ muted: true, volume: 0, lastVolume: 0.25 }) })

    fireEvent.click(screen.getByTitle('Unmute'))

    expect(calls.onUpdateTrack).toHaveBeenCalledWith('t1', { muted: false, volume: 0.25 })
  })

  it('unmutes to full volume when nothing was banked', () => {
    const { calls } = renderHeader({ track: makeTrack({ muted: true, volume: 0 }) })

    fireEvent.click(screen.getByTitle('Unmute'))

    expect(calls.onUpdateTrack).toHaveBeenCalledWith('t1', { muted: false, volume: 1 })
  })

  it('leaves the mute button inactive while the track is audible', () => {
    renderHeader()

    expect(screen.getByTitle('Mute')).not.toHaveClass(styles.active)
    expect(screen.queryByTitle('Unmute')).not.toBeInTheDocument()
  })

  it('marks the mute button active while the track is muted', () => {
    renderHeader({ track: makeTrack({ muted: true }) })

    expect(screen.getByTitle('Unmute')).toHaveClass(styles.active)
    expect(screen.queryByTitle('Mute')).not.toBeInTheDocument()
  })
})

describe('TrackHeader renaming', () => {
  it('opens an editor seeded with the current name on double-click', async () => {
    const user = userEvent.setup()
    renderHeader({ track: makeTrack({ name: 'Dialogue' }) })

    await user.dblClick(screen.getByTitle('Double-click to rename'))

    const field = screen.getByRole('textbox')
    expect(field).toHaveClass(styles.trackNameInput)
    expect(field).toHaveValue('Dialogue')
    expect(screen.queryByTitle('Double-click to rename')).not.toBeInTheDocument()
  })

  it('commits a trimmed name on Enter and closes the editor', async () => {
    const user = userEvent.setup()
    const { calls } = renderHeader()

    await user.dblClick(screen.getByTitle('Double-click to rename'))
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), '  Music  {Enter}')

    expect(calls.onUpdateTrack).toHaveBeenCalledWith('t1', { name: 'Music' })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('commits when the editor loses focus', async () => {
    const user = userEvent.setup()
    const { calls } = renderHeader()

    await user.dblClick(screen.getByTitle('Double-click to rename'))
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'Score')
    fireEvent.blur(screen.getByRole('textbox'))

    expect(calls.onUpdateTrack).toHaveBeenCalledWith('t1', { name: 'Score' })
  })

  it('ignores a name that is nothing but blank space', async () => {
    const user = userEvent.setup()
    const { calls } = renderHeader()

    await user.dblClick(screen.getByTitle('Double-click to rename'))
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), '   ')
    fireEvent.blur(screen.getByRole('textbox'))

    expect(calls.onUpdateTrack).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('abandons the draft on Escape', async () => {
    const user = userEvent.setup()
    const { calls } = renderHeader()

    await user.dblClick(screen.getByTitle('Double-click to rename'))
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'Nope{Escape}')

    expect(calls.onUpdateTrack).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('leaves other keys to the field itself', async () => {
    const user = userEvent.setup()
    const { calls } = renderHeader()

    await user.dblClick(screen.getByTitle('Double-click to rename'))
    await user.type(screen.getByRole('textbox'), 'x')

    expect(screen.getByRole('textbox')).toHaveValue('Track 1x')
    expect(calls.onUpdateTrack).not.toHaveBeenCalled()
  })
})

describe('TrackHeader reordering', () => {
  it('asks the caller to move this track, by id', () => {
    const { calls } = renderHeader({ index: 1, trackCount: 3 })

    fireEvent.click(screen.getByTitle('Move track up'))
    fireEvent.click(screen.getByTitle('Move track down'))

    expect(calls.onMoveTrackUp).toHaveBeenCalledWith('t1')
    expect(calls.onMoveTrackDown).toHaveBeenCalledWith('t1')
  })

  it('cannot move the top row up', () => {
    renderHeader({ index: 0, trackCount: 3 })

    expect(screen.getByTitle('Move track up')).toBeDisabled()
    expect(screen.getByTitle('Move track down')).toBeEnabled()
  })

  it('cannot move the bottom row down', () => {
    renderHeader({ index: 2, trackCount: 3 })

    expect(screen.getByTitle('Move track up')).toBeEnabled()
    expect(screen.getByTitle('Move track down')).toBeDisabled()
  })
})

describe('TrackHeader visibility, lock and delete', () => {
  it('offers to hide a visible track and marks nothing active', () => {
    const { root, calls } = renderHeader()

    const button = screen.getByTitle('Hide track')
    expect(button).not.toHaveClass(styles.active)
    fireEvent.click(button)

    expect(calls.onUpdateTrack).toHaveBeenCalledWith('t1', { visible: false })
    expect(root.querySelectorAll(`.${styles.trackControlBtn}`)).toHaveLength(3)
  })

  it('offers to show a hidden track and marks the control active', () => {
    const { calls } = renderHeader({ track: makeTrack({ visible: false }) })

    const button = screen.getByTitle('Show track')
    expect(button).toHaveClass(styles.active)
    fireEvent.click(button)

    expect(calls.onUpdateTrack).toHaveBeenCalledWith('t1', { visible: true })
  })

  it('offers to lock an unlocked track', () => {
    const { calls } = renderHeader()

    const button = screen.getByTitle('Lock track')
    expect(button).not.toHaveClass(styles.active)
    fireEvent.click(button)

    expect(calls.onUpdateTrack).toHaveBeenCalledWith('t1', { locked: true })
  })

  it('offers to unlock a locked track and marks the control active', () => {
    const { calls } = renderHeader({ track: makeTrack({ locked: true }) })

    const button = screen.getByTitle('Unlock track')
    expect(button).toHaveClass(styles.active)
    fireEvent.click(button)

    expect(calls.onUpdateTrack).toHaveBeenCalledWith('t1', { locked: false })
  })

  it('asks the caller to delete the track, by id', () => {
    const { calls } = renderHeader({ trackCount: 2 })

    fireEvent.click(screen.getByTitle('Delete track'))

    expect(calls.onDeleteTrack).toHaveBeenCalledWith('t1')
  })

  it('cannot delete the last remaining track', () => {
    renderHeader({ trackCount: 1 })

    expect(screen.getByTitle('Delete track')).toBeDisabled()
  })
})
