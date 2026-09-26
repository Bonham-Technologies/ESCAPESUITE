// The "Effects" section of the clip inspector, rendered on its own.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EffectsSection } from './EffectsSection'
import { inertSliderGesture } from '../../test/fixtures/clipFixtures'
import { rowControl } from '../../test/domQueries'

async function renderOpen(blur = 0) {
  const user = userEvent.setup()
  const onBlurChange = vi.fn()
  render(
    <EffectsSection blur={blur} onBlurChange={onBlurChange} sliderGesture={inertSliderGesture} />
  )
  await user.click(screen.getByRole('button', { name: 'Effects' }))
  return { onBlurChange }
}

describe('EffectsSection', () => {
  it('starts collapsed', () => {
    render(
      <EffectsSection blur={0} onBlurChange={vi.fn()} sliderGesture={inertSliderGesture} />
    )

    expect(screen.getByText('Effects')).toBeInTheDocument()
    expect(screen.queryByText('Blur')).not.toBeInTheDocument()
  })

  it('shows no blur as 0.0px', async () => {
    await renderOpen()

    expect(rowControl('Blur')).toHaveValue('0')
    expect(screen.getByText('0.0px')).toBeInTheDocument()
  })

  it('keeps one decimal place, because the slider steps in halves', async () => {
    await renderOpen(12.5)

    const blur = rowControl('Blur')
    expect(blur).toHaveValue('12.5')
    expect(blur).toHaveAttribute('step', '0.5')
    expect(blur).toHaveAttribute('min', '0')
    expect(blur).toHaveAttribute('max', '50')
    expect(screen.getByText('12.5px')).toBeInTheDocument()
  })

  it('rounds a whole number up to one decimal place rather than dropping it', async () => {
    await renderOpen(8)

    expect(screen.getByText('8.0px')).toBeInTheDocument()
  })

  it('reports a new blur radius as a number', async () => {
    const { onBlurChange } = await renderOpen(0)

    fireEvent.change(rowControl('Blur'), { target: { value: '3.5' } })

    expect(onBlurChange).toHaveBeenCalledWith(3.5)
  })
})
