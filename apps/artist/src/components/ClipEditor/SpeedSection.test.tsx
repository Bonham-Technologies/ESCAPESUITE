// The "Speed" section of the clip inspector (ESCSUITE-471), rendered on its own.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SpeedSection } from './SpeedSection'

type Props = React.ComponentProps<typeof SpeedSection>

async function renderOpen(overrides: Partial<Props> = {}) {
  const user = userEvent.setup()
  const onSpeedChange = vi.fn((): boolean => true)
  const view = render(<SpeedSection speed={1} onSpeedChange={onSpeedChange} linked={false} hasPicture {...overrides} />)
  await user.click(screen.getByRole('button', { name: /^Speed/ }))
  return { user, onSpeedChange, view }
}

describe('SpeedSection', () => {
  it('starts collapsed, and names a speed other than 1× on its header', () => {
    const { rerender } = render(<SpeedSection speed={1} onSpeedChange={vi.fn()} linked={false} hasPicture />)
    expect(screen.queryByRole('group', { name: 'Speed presets' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Speed' })).toBeTruthy()
    rerender(<SpeedSection speed={2} onSpeedChange={vi.fn()} linked={false} hasPicture />)
    expect(screen.getByRole('button', { name: /^Speed\s*2×$/ })).toBeTruthy()
  })

  it('offers 0.25× to 4× and presses the current one', async () => {
    await renderOpen({ speed: 2 })
    const presets = within(screen.getByRole('group', { name: 'Speed presets' })).getAllByRole('button')
    expect(presets.map((b) => b.textContent)).toEqual(['0.25×', '0.5×', '1×', '1.5×', '2×', '4×'])
    expect(screen.getByRole('button', { name: '2×', pressed: true })).toBeTruthy()
    expect(screen.getByRole('button', { name: '1×', pressed: false })).toBeTruthy()
  })

  it('sets a preset in one click', async () => {
    const { user, onSpeedChange } = await renderOpen()
    await user.click(screen.getByRole('button', { name: '4×' }))
    expect(onSpeedChange).toHaveBeenCalledWith(4)
  })

  it('sets a typed speed on Enter, clamped to 0.25 to 4', async () => {
    const { user, onSpeedChange } = await renderOpen()
    const field = screen.getByRole('spinbutton', { name: 'Speed' })
    await user.clear(field)
    await user.type(field, '1.25{Enter}')
    expect(onSpeedChange).toHaveBeenLastCalledWith(1.25)
    await user.clear(field)
    await user.type(field, '9{Enter}')
    expect(onSpeedChange).toHaveBeenLastCalledWith(4)
  })

  it('says what happens to the sound', async () => {
    const { view } = await renderOpen({ speed: 1 })
    expect(screen.queryByText(/sound/)).toBeNull()
    view.rerender(<SpeedSection speed={2} onSpeedChange={vi.fn()} linked={false} hasPicture />)
    expect(screen.getByText('The sound plays higher, in step with the picture.')).toBeTruthy()
    view.rerender(<SpeedSection speed={0.5} onSpeedChange={vi.fn()} linked={false} hasPicture={false} />)
    expect(screen.getByText('The sound plays lower, in step with the clip.')).toBeTruthy()
    view.rerender(<SpeedSection speed={4} onSpeedChange={vi.fn()} linked={false} hasPicture />)
    expect(screen.getByText('Silent: sound plays up to 2×.')).toBeTruthy()
  })

  it('says a linked clip takes its parts with it', async () => {
    await renderOpen({ linked: true })
    expect(screen.getByText('Its linked parts change speed with it.')).toBeTruthy()
  })

  it('says why when the change is refused, until one lands', async () => {
    const { user, onSpeedChange } = await renderOpen()
    onSpeedChange.mockReturnValueOnce(false)
    await user.click(screen.getByRole('button', { name: '0.25×' }))
    expect(screen.getByRole('status').textContent).toMatch(/^Not changed/)
    await user.click(screen.getByRole('button', { name: '2×' }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('freezes its controls on a locked track', async () => {
    await renderOpen({ disabled: true })
    expect(screen.getByRole('button', { name: '2×' }).matches(':disabled')).toBe(true)
    expect(screen.getByRole('spinbutton', { name: 'Speed' }).matches(':disabled')).toBe(true)
  })
})
