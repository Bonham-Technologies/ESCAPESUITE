import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectLoadDialog } from './ProjectLoadDialog'
import { pretendElementsAreVisible } from '../test/doubles/layout'

function handlers() {
  return {
    onCancel: vi.fn(),
    onSaveAndLoad: vi.fn(),
    onDiscardAndLoad: vi.fn(),
  }
}

describe('ProjectLoadDialog', () => {
  it('renders nothing while closed', () => {
    render(<ProjectLoadDialog isOpen={false} {...handlers()} />)

    expect(screen.queryByTestId('project-load-dialog')).not.toBeInTheDocument()
  })

  it('warns that loading replaces the current work', () => {
    render(<ProjectLoadDialog isOpen={true} {...handlers()} />)

    expect(screen.getByRole('heading', { name: 'Load Project' })).toBeInTheDocument()
    expect(
      screen.getByText('Loading a project will replace your current work.')
    ).toBeInTheDocument()
  })

  it('reports a cancel and nothing else', async () => {
    const user = userEvent.setup()
    const spies = handlers()
    render(<ProjectLoadDialog isOpen={true} {...spies} />)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(spies.onCancel).toHaveBeenCalledTimes(1)
    expect(spies.onSaveAndLoad).not.toHaveBeenCalled()
    expect(spies.onDiscardAndLoad).not.toHaveBeenCalled()
  })

  it('reports save-and-load and nothing else', async () => {
    const user = userEvent.setup()
    const spies = handlers()
    render(<ProjectLoadDialog isOpen={true} {...spies} />)

    await user.click(screen.getByRole('button', { name: 'Save & Load' }))

    expect(spies.onSaveAndLoad).toHaveBeenCalledTimes(1)
    expect(spies.onCancel).not.toHaveBeenCalled()
    expect(spies.onDiscardAndLoad).not.toHaveBeenCalled()
  })

  it('reports discard-and-load and nothing else', async () => {
    const user = userEvent.setup()
    const spies = handlers()
    render(<ProjectLoadDialog isOpen={true} {...spies} />)

    await user.click(screen.getByRole('button', { name: 'Discard & Load' }))

    expect(spies.onDiscardAndLoad).toHaveBeenCalledTimes(1)
    expect(spies.onCancel).not.toHaveBeenCalled()
    expect(spies.onSaveAndLoad).not.toHaveBeenCalled()
  })

  it('is a modal dialog labelled by its own heading', () => {
    render(<ProjectLoadDialog isOpen={true} {...handlers()} />)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', 'project-load-title')
    expect(screen.getByRole('heading', { name: 'Load Project' })).toHaveAttribute(
      'id',
      'project-load-title'
    )
  })

  describe('modal keyboard behaviour', () => {
    // Trap, initial focus and focus restore come from the shared
    // `useDialogBehaviour`; these pin the wiring, not the mechanics.
    let restoreVisibility: () => void

    beforeEach(() => {
      restoreVisibility = pretendElementsAreVisible()
    })

    afterEach(() => {
      restoreVisibility()
    })

    it('moves focus into the dialog when it opens and back to the opener when it closes', () => {
      const opener = document.createElement('button')
      document.body.appendChild(opener)
      opener.focus()

      const { rerender } = render(<ProjectLoadDialog isOpen={true} {...handlers()} />)
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()

      rerender(<ProjectLoadDialog isOpen={false} {...handlers()} />)

      expect(opener).toHaveFocus()
      opener.remove()
    })

    it('wraps Tab from the last control back to the first', () => {
      render(<ProjectLoadDialog isOpen={true} {...handlers()} />)
      screen.getByRole('button', { name: 'Discard & Load' }).focus()

      fireEvent.keyDown(document, { key: 'Tab' })

      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    })

    it('wraps Shift+Tab from the first control round to the last', () => {
      render(<ProjectLoadDialog isOpen={true} {...handlers()} />)
      screen.getByRole('button', { name: 'Cancel' }).focus()

      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })

      expect(screen.getByRole('button', { name: 'Discard & Load' })).toHaveFocus()
    })

    it('cancels on Escape, and loads nothing', () => {
      // The ruling: Escape means Cancel here, the same path as the Cancel
      // button. Both of the other two answers replace the current work, so
      // neither can be what a dismissal key does.
      const spies = handlers()
      render(<ProjectLoadDialog isOpen={true} {...spies} />)

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(spies.onCancel).toHaveBeenCalledTimes(1)
      expect(spies.onSaveAndLoad).not.toHaveBeenCalled()
      expect(spies.onDiscardAndLoad).not.toHaveBeenCalled()
    })
  })
})
