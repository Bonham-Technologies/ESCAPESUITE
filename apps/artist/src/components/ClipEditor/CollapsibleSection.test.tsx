// The inspector's collapsible block. Its open/closed flag is its own state,
// seeded once from `defaultOpen`, which is why ClipEditor keeps the conditions
// that show and hide these sections in a fixed order — see the note on the
// component itself.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollapsibleSection } from './CollapsibleSection'
import styles from './ClipEditor.module.css'

describe('CollapsibleSection', () => {
  it('shows its title and children, open by default', () => {
    render(
      <CollapsibleSection title="Transform">
        <p>inside</p>
      </CollapsibleSection>
    )

    expect(screen.getByText('Transform')).toBeInTheDocument()
    expect(screen.getByText('inside')).toBeInTheDocument()
  })

  it('starts closed when told to, hiding the children entirely', () => {
    render(
      <CollapsibleSection title="Effects" defaultOpen={false}>
        <p>inside</p>
      </CollapsibleSection>
    )

    expect(screen.getByText('Effects')).toBeInTheDocument()
    expect(screen.queryByText('inside')).not.toBeInTheDocument()
  })

  it('toggles the children on every click of the header button', async () => {
    const user = userEvent.setup()
    render(
      <CollapsibleSection title="Effects">
        <p>inside</p>
      </CollapsibleSection>
    )

    await user.click(screen.getByRole('button'))
    expect(screen.queryByText('inside')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button'))
    expect(screen.getByText('inside')).toBeInTheDocument()
  })

  it('marks the chevron open only while the section is open', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <CollapsibleSection title="Effects">
        <p>inside</p>
      </CollapsibleSection>
    )
    const icon = container.querySelector('svg')!

    expect(icon).toHaveClass(styles.open)

    await user.click(screen.getByRole('button'))

    expect(icon).not.toHaveClass(styles.open)
  })

  it('renders a badge inside the header button', () => {
    render(
      <CollapsibleSection title="Animation" badge={<span>Active</span>}>
        <p>inside</p>
      </CollapsibleSection>
    )

    expect(screen.getByRole('button')).toHaveTextContent('AnimationActive')
  })

  it('renders headerRight beside the button, and nothing when there is none', async () => {
    const onReset = vi.fn()
    const user = userEvent.setup()
    const { container, rerender } = render(
      <CollapsibleSection title="Transform" headerRight={<button onClick={onReset}>Reset</button>}>
        <p>inside</p>
      </CollapsibleSection>
    )

    expect(container.querySelector(`.${styles.headerRightContent}`)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(onReset).toHaveBeenCalledTimes(1)

    rerender(
      <CollapsibleSection title="Transform">
        <p>inside</p>
      </CollapsibleSection>
    )

    expect(container.querySelector(`.${styles.headerRightContent}`)).not.toBeInTheDocument()
  })

  it('does not submit a surrounding form when toggled', () => {
    render(
      <CollapsibleSection title="Transform">
        <p>inside</p>
      </CollapsibleSection>
    )

    expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
  })

  // ESCSUITE-84: a locked track freezes its clips' controls, and the inspector
  // disables each section's *contents* rather than the whole panel — reading a
  // locked clip has to keep working, so the header toggle is deliberately
  // outside the fieldset and a footer is outside it too.
  describe('disabled', () => {
    it('adds no fieldset at all while it is not disabled', () => {
      const { container } = render(
        <CollapsibleSection title="Transform">
          <input aria-label="Pos X" />
        </CollapsibleSection>
      )

      expect(container.querySelector('fieldset')).toBeNull()
      expect(screen.getByLabelText('Pos X')).toBeEnabled()
    })

    it('disables its children and still opens and closes', async () => {
      const user = userEvent.setup()
      const { container } = render(
        <CollapsibleSection title="Transform" disabled>
          <input aria-label="Pos X" />
        </CollapsibleSection>
      )

      expect(container.querySelector('fieldset')).toBeInTheDocument()
      expect(screen.getByLabelText('Pos X')).toBeDisabled()

      const toggle = screen.getByRole('button', { name: 'Transform' })
      expect(toggle).toBeEnabled()

      await user.click(toggle)
      expect(screen.queryByLabelText('Pos X')).not.toBeInTheDocument()

      await user.click(toggle)
      expect(screen.getByLabelText('Pos X')).toBeDisabled()
    })

    it('leaves a footer out of the fieldset, enabled either way', () => {
      const { rerender } = render(
        <CollapsibleSection
          title="Animation"
          disabled
          footer={<button>Open Keyframe Editor</button>}
        >
          <input aria-label="Animate In" />
        </CollapsibleSection>
      )

      expect(screen.getByLabelText('Animate In')).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Open Keyframe Editor' })).toBeEnabled()

      rerender(
        <CollapsibleSection title="Animation" footer={<button>Open Keyframe Editor</button>}>
          <input aria-label="Animate In" />
        </CollapsibleSection>
      )

      expect(screen.getByLabelText('Animate In')).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Open Keyframe Editor' })).toBeEnabled()
    })
  })
})
