// The prompt for a take that never finished (ESCSUITE-466), driven by props.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecoverTakeDialog } from './RecoverTakeDialog'
import { installGetClientRectsStub } from '../../test/doubles/browser'

let restoreGetClientRects: () => void

beforeEach(() => {
  restoreGetClientRects = installGetClientRectsStub()
})

afterEach(() => {
  restoreGetClientRects()
  document.body.innerHTML = ''
})

function renderDialog(size = 12_345_678) {
  const handlers = { onRecover: vi.fn(), onDiscard: vi.fn(), onClose: vi.fn() }
  render(<RecoverTakeDialog startedAt={Date.UTC(2026, 10, 16, 9, 30)} size={size} {...handlers} />)
  return handlers
}

describe('RecoverTakeDialog', () => {
  it('is an alert dialog that says when the take started and how much was kept', () => {
    renderDialog()
    const dialog = screen.getByRole('alertdialog', { name: 'Recover unfinished recording?' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription(/never reached your library/)
    expect(dialog).toHaveAccessibleDescription(/\(12\.3 MB\)/)
    expect(dialog).toHaveAccessibleDescription(/2026/)
  })

  it('gives sizes under a megabyte in kilobytes, never zero', () => {
    renderDialog(456_789)
    expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription(/\(457 KB\)/)
    document.body.innerHTML = ''
    renderDialog(10)
    expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription(/\(1 KB\)/)
  })

  it('opens with Recover focused, and each button does what it says', async () => {
    const handlers = renderDialog()
    const recover = screen.getByRole('button', { name: 'Recover' })
    expect(recover).toHaveFocus()
    await userEvent.click(recover)
    expect(handlers.onRecover).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(handlers.onDiscard).toHaveBeenCalledTimes(1)
    expect(handlers.onClose).not.toHaveBeenCalled()
  })

  it('Escape and the backdrop set it aside; a click inside the panel does not', async () => {
    const handlers = renderDialog()
    fireEvent.click(screen.getByText(/never reached your library/))
    expect(handlers.onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('alertdialog'))
    expect(handlers.onClose).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{Escape}')
    expect(handlers.onClose).toHaveBeenCalledTimes(2)
  })
})
