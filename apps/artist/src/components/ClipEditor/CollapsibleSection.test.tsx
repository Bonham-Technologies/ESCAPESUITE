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
})
