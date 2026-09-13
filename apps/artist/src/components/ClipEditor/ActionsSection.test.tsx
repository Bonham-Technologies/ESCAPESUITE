// The "Actions" section of the clip inspector, rendered on its own so the
// Split button's visibility and disabled rule can be read directly.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActionsSection } from './ActionsSection'

type Props = React.ComponentProps<typeof ActionsSection>

function renderSection(overrides: Partial<Props> = {}) {
  const handlers = {
    onGoToClip: vi.fn(),
    onDuplicate: vi.fn(),
    onSplit: vi.fn(),
  }
  render(
    <ActionsSection isVideo isAudio={false} timeInClip={1} {...handlers} {...overrides} />
  )
  return handlers
}

const split = () => screen.getByRole('button', { name: 'Split' })

describe('ActionsSection', () => {
  it('is open, and moves the playhead to the clip start', async () => {
    const user = userEvent.setup()
    const { onGoToClip } = renderSection()

    await user.click(screen.getByRole('button', { name: 'Go to' }))

    expect(onGoToClip).toHaveBeenCalledTimes(1)
  })

  it('duplicates the clip', async () => {
    const user = userEvent.setup()
    const { onDuplicate } = renderSection()

    await user.click(screen.getByRole('button', { name: 'Duplicate' }))

    expect(onDuplicate).toHaveBeenCalledTimes(1)
  })

  describe('Split', () => {
    it('splits a video clip at the playhead', async () => {
      const user = userEvent.setup()
      const { onSplit } = renderSection()

      expect(split()).toBeEnabled()

      await user.click(split())

      expect(onSplit).toHaveBeenCalledTimes(1)
    })

    it('is offered for an audio clip too', () => {
      renderSection({ isVideo: false, isAudio: true })

      expect(split()).toBeEnabled()
    })

    it('is absent for anything else, such as an overlay', () => {
      renderSection({ isVideo: false, isAudio: false })

      expect(screen.queryByRole('button', { name: 'Split' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Go to' })).toBeInTheDocument()
    })

    it('is disabled while the playhead sits outside the clip', () => {
      renderSection({ timeInClip: null })

      expect(split()).toBeDisabled()
    })

    it('is disabled on the clip start itself, where a split would make an empty half', () => {
      renderSection({ timeInClip: 0 })

      expect(split()).toBeDisabled()
    })

    it('is enabled one frame in', () => {
      renderSection({ timeInClip: 0.04 })

      expect(split()).toBeEnabled()
    })
  })
})
