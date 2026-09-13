// The inspector's title block and the read-only rows under it.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { ClipEditorHeader } from './ClipEditorHeader'
import type { Track } from '../../store/types'

const track: Track = {
  id: 'track-1',
  name: 'Track 2',
  index: 1,
  visible: true,
  locked: false,
  muted: false,
  volume: 1,
  height: 60,
}

function renderHeader(overrides: Partial<ComponentProps<typeof ClipEditorHeader>> = {}) {
  const onDelete = vi.fn()
  render(
    <ClipEditorHeader
      clipTypeLabel="Video Clip"
      name="intro.mp4"
      duration={5.5}
      position={12.25}
      track={track}
      onDelete={onDelete}
      {...overrides}
    />
  )
  return { onDelete }
}

describe('ClipEditorHeader', () => {
  it('names the clip and its type', () => {
    renderHeader()

    expect(screen.getByText('Video Clip')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'intro.mp4' })).toBeInTheDocument()
  })

  it('shows duration and position as timecodes', () => {
    renderHeader()

    expect(screen.getByText('00:05.500')).toBeInTheDocument()
    expect(screen.getByText('00:12.250')).toBeInTheDocument()
  })

  it('names the track the clip sits on', () => {
    renderHeader()

    expect(screen.getByText('Track:')).toBeInTheDocument()
    expect(screen.getByText('Track 2')).toBeInTheDocument()
  })

  it('drops the track row when the track is unknown', () => {
    renderHeader({ track: null })

    expect(screen.queryByText('Track:')).not.toBeInTheDocument()
    expect(screen.getByText('Duration:')).toBeInTheDocument()
  })

  it('drops the track row when no track was passed at all', () => {
    renderHeader({ track: undefined })

    expect(screen.queryByText('Track:')).not.toBeInTheDocument()
  })

  it('asks its caller to delete the clip', async () => {
    const user = userEvent.setup()
    const { onDelete } = renderHeader()

    await user.click(screen.getByTitle('Delete clip'))

    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})
