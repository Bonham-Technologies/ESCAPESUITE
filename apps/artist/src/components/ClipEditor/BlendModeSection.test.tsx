// The "Blend Mode" section of the clip inspector, rendered on its own.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlendModeSection } from './BlendModeSection'
import { BLEND_MODES } from './clipEditorOptions'
import type { BlendMode } from '../../store/types'

function renderSection(value: BlendMode = 'normal') {
  const onChange = vi.fn()
  render(<BlendModeSection value={value} onChange={onChange} />)
  return { onChange }
}

describe('BlendModeSection', () => {
  it('starts collapsed, showing only its title', async () => {
    const user = userEvent.setup()
    renderSection()

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Blend Mode' }))

    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('shows the clip mode and reports a new one', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSection('screen')
    await user.click(screen.getByRole('button', { name: 'Blend Mode' }))

    const select = screen.getByRole('combobox')
    expect(select).toHaveValue('screen')

    await user.selectOptions(select, 'multiply')

    expect(onChange).toHaveBeenCalledWith('multiply')
  })

  it('offers every blend mode, in the table order', async () => {
    const user = userEvent.setup()
    renderSection()
    await user.click(screen.getByRole('button', { name: 'Blend Mode' }))

    expect(
      Array.from(screen.getByRole('combobox').querySelectorAll('option')).map((o) => [
        (o as HTMLOptionElement).value,
        o.textContent,
      ])
    ).toEqual(BLEND_MODES.map((m) => [m.value, m.label]))
  })
})
