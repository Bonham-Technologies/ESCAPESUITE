import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResolutionPicker } from './ResolutionPicker'
import { resetStoreForTest, store } from '../test/fixtures/projectStore'
import { pretendElementsAreVisible } from '../test/doubles/layout'

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

  describe('the confirm as a modal dialog', () => {
    // Trap, initial focus, Escape and focus restore all come from the shared
    // `useDialogBehaviour` — the same five things ARTIST's other four modals
    // carry. These pin the wiring, not the mechanics.
    let restoreVisibility: () => void

    beforeEach(() => {
      restoreVisibility = pretendElementsAreVisible()
    })

    afterEach(() => {
      restoreVisibility()
    })

    const openConfirm = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.selectOptions(select(), '4K')
      expect(screen.getByTestId('resolution-change-confirm')).toBeInTheDocument()
    }

    it('is a modal dialog labelled by its own heading', async () => {
      const user = userEvent.setup()
      render(<ResolutionPicker />)

      await openConfirm(user)

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(dialog).toHaveAttribute('aria-labelledby', 'resolution-confirm-title')
      // `<h2>`, like the other four: the page's only `<h1>` is the logo, so an
      // `<h3>` here would skip a level (axe: `heading-order`).
      expect(
        screen.getByRole('heading', { level: 2, name: 'Change Resolution' })
      ).toHaveAttribute('id', 'resolution-confirm-title')
    })

    it('moves focus into the dialog when it opens and back to the select when it closes', async () => {
      const user = userEvent.setup()
      render(<ResolutionPicker />)

      await openConfirm(user)
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()

      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(select()).toHaveFocus()
    })

    it('wraps Tab from the last control back to the first', async () => {
      const user = userEvent.setup()
      render(<ResolutionPicker />)
      await openConfirm(user)
      screen.getByRole('button', { name: 'Change Resolution' }).focus()

      fireEvent.keyDown(document, { key: 'Tab' })

      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    })

    it('cancels on Escape, leaving the resolution and the select as they were', async () => {
      // The ruling: Escape means Cancel. Confirming is the only other answer and
      // it rewrites the project's resolution, which a dismissal key must never
      // do. Cancelling costs nothing — the select is controlled by the store's
      // resolution, so it snaps back to the preset that is still in force.
      const user = userEvent.setup()
      render(<ResolutionPicker />)
      await openConfirm(user)

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(screen.queryByTestId('resolution-change-confirm')).not.toBeInTheDocument()
      expect(store().project.resolution).toEqual({ width: 1920, height: 1080 })
      expect(select().value).toBe('1080p')
    })

    it('keeps Escape from reaching the editor behind it', async () => {
      const user = userEvent.setup()
      render(<ResolutionPicker />)
      await openConfirm(user)
      const behind = vi.fn()
      window.addEventListener('keydown', behind)

      try {
        fireEvent.keyDown(document, { key: 'Escape' })

        expect(behind).not.toHaveBeenCalled()
      } finally {
        window.removeEventListener('keydown', behind)
      }
    })

    it('tells its caller when the confirm opens and when it closes', async () => {
      const user = userEvent.setup()
      const onConfirmOpenChange = vi.fn()
      render(<ResolutionPicker onConfirmOpenChange={onConfirmOpenChange} />)

      await openConfirm(user)
      expect(onConfirmOpenChange.mock.calls).toEqual([[true]])

      await user.click(screen.getByRole('button', { name: 'Change Resolution' }))

      expect(onConfirmOpenChange.mock.calls).toEqual([[true], [false]])
    })

    it('tells its caller the confirm is gone when the picker unmounts with it open', async () => {
      // Collapsing the sidebar unmounts the picker. Nothing can reach the
      // collapse control from behind the overlay today, but `App` counts this
      // flag in `modalOpen` — a flag left true would leave the editor deaf.
      const user = userEvent.setup()
      const onConfirmOpenChange = vi.fn()
      const { unmount } = render(<ResolutionPicker onConfirmOpenChange={onConfirmOpenChange} />)
      await openConfirm(user)

      unmount()

      expect(onConfirmOpenChange.mock.calls).toEqual([[true], [false]])
    })
  })
})
