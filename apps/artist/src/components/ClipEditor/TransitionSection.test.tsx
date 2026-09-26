// The "Transition Out" section of the clip inspector, rendered on its own.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransitionSection } from './TransitionSection'
import { TRANSITION_TYPES } from './clipEditorOptions'
import { rowControl, rowSelect } from '../../test/domQueries'
import { inertSliderGesture } from '../../test/fixtures/clipFixtures'

type Props = React.ComponentProps<typeof TransitionSection>

async function renderOpen(overrides: Partial<Props> = {}) {
  const user = userEvent.setup()
  const onTypeChange = vi.fn()
  const onDurationChange = vi.fn()
  render(
    <TransitionSection
      transition={{ type: 'none', duration: 0.5 }}
      clipDuration={10}
      onTypeChange={onTypeChange}
      onDurationChange={onDurationChange}
      sliderGesture={inertSliderGesture}
      {...overrides}
    />
  )
  await user.click(screen.getByRole('button', { name: 'Transition Out' }))
  return { user, onTypeChange, onDurationChange }
}

describe('TransitionSection', () => {
  it('starts collapsed', () => {
    render(
      <TransitionSection
        transition={{ type: 'none', duration: 0.5 }}
        clipDuration={10}
        onTypeChange={vi.fn()}
        onDurationChange={vi.fn()}
        sliderGesture={inertSliderGesture}
      />
    )

    expect(screen.getByText('Transition Out')).toBeInTheDocument()
    expect(screen.queryByText('Type')).not.toBeInTheDocument()
  })

  it('offers every transition, in the table order', async () => {
    await renderOpen()

    const select = rowSelect('Type')
    expect(select).toHaveValue('none')
    expect(Array.from(select.querySelectorAll('option')).map((o) => o.textContent)).toEqual(
      TRANSITION_TYPES.map((t) => t.label)
    )
  })

  it('hides the duration for a clip carrying no transition at all', async () => {
    // An older clip saved without a transition object reads as `none` in the
    // select, and must read the same way to the guard below it: no duration row.
    await renderOpen({ transition: undefined })

    expect(rowSelect('Type')).toHaveValue('none')
    expect(screen.queryByText('Duration')).not.toBeInTheDocument()
  })

  it('reports a chosen transition', async () => {
    const { user, onTypeChange } = await renderOpen()

    await user.selectOptions(rowSelect('Type'), 'wipe-left')

    expect(onTypeChange).toHaveBeenCalledWith('wipe-left')
  })

  it('hides the duration while the transition is none', async () => {
    await renderOpen()

    expect(screen.queryByText('Duration')).not.toBeInTheDocument()
  })

  it('shows the duration once a transition is chosen, capped at half the clip', async () => {
    await renderOpen({ transition: { type: 'fade', duration: 0.8 }, clipDuration: 3 })

    const duration = rowControl('Duration')
    expect(duration).toHaveValue('0.8')
    expect(duration).toHaveAttribute('min', '0.1')
    expect(duration).toHaveAttribute('max', '1.5')
    expect(screen.getByText('0.8s')).toBeInTheDocument()
  })

  it('caps the duration at two seconds however long the clip is', async () => {
    await renderOpen({ transition: { type: 'fade', duration: 0.5 }, clipDuration: 60 })

    expect(rowControl('Duration')).toHaveAttribute('max', '2')
  })

  it('reports a new duration', async () => {
    const { onDurationChange } = await renderOpen({ transition: { type: 'fade', duration: 0.5 } })

    fireEvent.change(rowControl('Duration'), { target: { value: '1.4' } })

    expect(onDurationChange).toHaveBeenCalledWith(1.4)
  })
})
