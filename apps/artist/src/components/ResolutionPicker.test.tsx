import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResolutionPicker } from './ResolutionPicker'
import { resetStoreForTest, store } from '../test/fixtures/projectStore'

const select = () => screen.getByLabelText('Resolution') as HTMLSelectElement

describe('ResolutionPicker', () => {
  beforeEach(() => {
    resetStoreForTest()
  })

  it('shows the preset matching the project resolution', () => {
    render(<ResolutionPicker />)

    // The default project is 1080p.
    expect(store().project.resolution).toEqual({ width: 1920, height: 1080 })
    expect(select().value).toBe('1080p')
    expect(screen.queryByRole('option', { name: /^Custom/ })).not.toBeInTheDocument()
  })

  it('offers a custom entry describing a resolution no preset matches', () => {
    store().setProjectResolution(1234, 567)

    render(<ResolutionPicker />)

    expect(select().value).toBe('custom')
    expect(screen.getByRole('option', { name: 'Custom (1234x567)' })).toBeInTheDocument()
  })

  it('lists every preset with its pixel dimensions', () => {
    render(<ResolutionPicker />)

    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      '720p (1280x720)',
      '1080p (1920x1080)',
      '1440p (2560x1440)',
      '4K (3840x2160)',
    ])
  })

  it('asks for confirmation before changing the project resolution', async () => {
    const user = userEvent.setup()
    render(<ResolutionPicker />)

    await user.selectOptions(select(), '4K')

    expect(screen.getByTestId('resolution-change-confirm')).toBeInTheDocument()
    expect(screen.getByText('1920x1080 → 3840x2160')).toBeInTheDocument()
    // Nothing is committed until the confirm button is used.
    expect(store().project.resolution).toEqual({ width: 1920, height: 1080 })
  })

  it('applies the pending resolution to the store when confirmed', async () => {
    const user = userEvent.setup()
    render(<ResolutionPicker />)

    await user.selectOptions(select(), '720p')
    await user.click(screen.getByRole('button', { name: 'Change Resolution' }))

    expect(store().project.resolution).toEqual({ width: 1280, height: 720 })
    expect(screen.queryByTestId('resolution-change-confirm')).not.toBeInTheDocument()
    expect(select().value).toBe('720p')
  })

  it('leaves the resolution alone when the change is cancelled', async () => {
    const user = userEvent.setup()
    render(<ResolutionPicker />)

    await user.selectOptions(select(), '1440p')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(store().project.resolution).toEqual({ width: 1920, height: 1080 })
    expect(screen.queryByTestId('resolution-change-confirm')).not.toBeInTheDocument()
    expect(select().value).toBe('1080p')
  })

  it('does not prompt when the chosen preset is already the project resolution', async () => {
    const user = userEvent.setup()
    render(<ResolutionPicker />)

    await user.selectOptions(select(), '1080p')

    expect(screen.queryByTestId('resolution-change-confirm')).not.toBeInTheDocument()
  })

  it('ignores a selection of the custom entry itself', async () => {
    const user = userEvent.setup()
    store().setProjectResolution(1234, 567)
    render(<ResolutionPicker />)

    await user.selectOptions(select(), 'custom')

    expect(screen.queryByTestId('resolution-change-confirm')).not.toBeInTheDocument()
    expect(store().project.resolution).toEqual({ width: 1234, height: 567 })
  })
})
