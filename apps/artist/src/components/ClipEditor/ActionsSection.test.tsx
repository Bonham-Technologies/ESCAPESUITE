// The "Actions" section of the clip inspector, rendered on its own so the
// Split button's visibility and disabled rule can be read directly.
//
// The section takes the clip's position and duration, not a `timeInClip`: the
// playhead reaches the Split button through its own store subscription
// (`SplitButton`), so these tests move the store's playhead rather than a prop.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActionsSection } from './ActionsSection'
import { resetStoreForTest, store } from '../../test/fixtures/projectStore'

type Props = React.ComponentProps<typeof ActionsSection>

/** The section for a clip running 3–5 s, with the playhead at `playhead`. */
function renderSection(overrides: Partial<Props> = {}, playhead = 4) {
  store().setCurrentTime(playhead)
  const handlers = {
    onGoToClip: vi.fn(),
    onDuplicate: vi.fn(),
    onSplit: vi.fn(),
  }
  render(
    <ActionsSection
      isVideo
      isAudio={false}
      clipPosition={3}
      clipDuration={2}
      {...handlers}
      {...overrides}
    />
  )
  return handlers
}

const split = () => screen.getByRole('button', { name: 'Split' })

describe('ActionsSection', () => {
  beforeEach(() => {
    resetStoreForTest()
  })

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
      renderSection({}, 9)

      expect(split()).toBeDisabled()
    })

    it('is disabled on the clip start itself, where a split would make an empty half', () => {
      renderSection({}, 3)

      expect(split()).toBeDisabled()
    })

    it('is enabled one frame in', () => {
      renderSection({}, 3.04)

      expect(split()).toBeEnabled()
    })

    it('is disabled on a locked track wherever the playhead is', () => {
      renderSection({ disabled: true }, 4)

      expect(split()).toBeDisabled()
    })
  })

  // ESCSUITE-84: the two editing actions go, "Go to" stays — it moves the
  // playhead and touches no clip, so this section disables its own buttons
  // rather than handing the flag to CollapsibleSection.
  describe('on a locked track', () => {
    it('disables Duplicate and leaves "Go to" working', async () => {
      const user = userEvent.setup()
      const { onGoToClip } = renderSection({ disabled: true })

      expect(screen.getByRole('button', { name: 'Duplicate' })).toBeDisabled()

      const goTo = screen.getByRole('button', { name: 'Go to' })
      expect(goTo).toBeEnabled()
      await user.click(goTo)

      expect(onGoToClip).toHaveBeenCalledTimes(1)
    })
  })
})
