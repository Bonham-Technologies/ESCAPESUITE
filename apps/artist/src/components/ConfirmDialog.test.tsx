import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from './ConfirmDialog'
import { answerConfirm, confirmAction } from '../app/confirmAction'
import { pretendElementsAreVisible } from '../test/doubles/layout'

const MESSAGE = 'Delete clip "Intro"?'

/** Ask a question with the dialog already mounted, and hand back its answer. */
function ask(message = MESSAGE, label = 'Delete'): Promise<boolean> {
  let answer!: Promise<boolean>
  act(() => {
    answer = confirmAction(message, label)
  })
  return answer
}

afterEach(() => {
  act(() => answerConfirm(false))
})

describe('ConfirmDialog (ESCSUITE-448)', () => {
  it('renders nothing while nothing is asked', () => {
    render(<ConfirmDialog />)

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('is a modal alert dialog labelled by the question, word for word', () => {
    render(<ConfirmDialog />)
    void ask()

    const dialog = screen.getByRole('alertdialog', { name: MESSAGE })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('answers yes from the destructive button, and closes', async () => {
    const user = userEvent.setup()
    render(<ConfirmDialog />)
    const answer = ask('Remove this video?', 'Remove')

    await user.click(screen.getByRole('button', { name: 'Remove' }))

    await expect(answer).resolves.toBe(true)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('answers no from Cancel, and closes', async () => {
    const user = userEvent.setup()
    render(<ConfirmDialog />)
    const answer = ask()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await expect(answer).resolves.toBe(false)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('answers no when the editor goes away with the question up', async () => {
    const { unmount } = render(<ConfirmDialog />)
    const answer = ask()

    unmount()

    await expect(answer).resolves.toBe(false)
  })

  describe('modal keyboard behaviour', () => {
    let restoreVisibility: () => void

    beforeEach(() => {
      restoreVisibility = pretendElementsAreVisible()
    })

    afterEach(() => {
      restoreVisibility()
    })

    it('focuses Cancel when it opens and gives focus back to the opener when it closes', async () => {
      const opener = document.createElement('button')
      document.body.appendChild(opener)
      opener.focus()
      render(<ConfirmDialog />)
      const answer = ask()

      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
      act(() => screen.getByRole('button', { name: 'Delete' }).click())

      await expect(answer).resolves.toBe(true)
      expect(opener).toHaveFocus()
      opener.remove()
    })

    it('answers no on Escape', async () => {
      render(<ConfirmDialog />)
      const answer = ask()

      fireEvent.keyDown(document, { key: 'Escape' })

      await expect(answer).resolves.toBe(false)
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it('keeps Tab inside the dialog', () => {
      render(<ConfirmDialog />)
      void ask()
      screen.getByRole('button', { name: 'Delete' }).focus()

      fireEvent.keyDown(document, { key: 'Tab' })

      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    })
  })
})
