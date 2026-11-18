// CRAFT's confirm dialog (ESCSUITE-483), driven through `confirmAction` the
// way the library panel drives it, mounted once as `App` mounts it.
//
// Pinned: the framing (an alertdialog named by its title, described by its
// message), the one way to a yes and the four ways to a no, where focus goes,
// and that a dialog that goes away unanswered answers no.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { StrictMode } from 'react'
import { act, render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from './ConfirmDialog'
import { confirmAction, type ConfirmRequest } from '../../utils/confirmAction'
import { installGetClientRectsStub } from '../../test/doubles/browser'
import styles from '../../App.module.css'

let restoreGetClientRects: () => void

beforeEach(() => {
  restoreGetClientRects = installGetClientRectsStub()
})

afterEach(() => {
  restoreGetClientRects()
  document.body.innerHTML = ''
})

const QUESTION: ConfirmRequest = {
  title: 'Delete "Take Seven"?',
  message: "This can't be undone.",
  confirmLabel: 'Delete',
}

/** Render the host, then ask; hands back the answer still to come. */
function ask(request: ConfirmRequest = QUESTION) {
  // StrictMode, as the app runs in development: it mounts, unmounts and
  // remounts the dialog once, which must not answer anything.
  const view = render(
    <StrictMode>
      <ConfirmDialog />
    </StrictMode>
  )
  let answer!: Promise<boolean>
  act(() => {
    answer = confirmAction(request)
  })
  return { answer, ...view }
}

describe('ConfirmDialog framing', () => {
  it('draws nothing while no question is up', () => {
    const { container } = render(<ConfirmDialog />)
    expect(container).toBeEmptyDOMElement()
  })

  it('stays up under StrictMode until it is answered', async () => {
    // The first cut rendered it per question with an unmount effect that
    // answers no — StrictMode's remount answered every question at once.
    const { answer } = ask()
    let settled = false
    void answer.then(() => (settled = true))
    await act(async () => {})

    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(settled).toBe(false)
  })

  it('is a modal alertdialog named by its title and described by its message', () => {
    ask()

    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('Delete "Take Seven"?')
    expect(dialog).toHaveAccessibleDescription("This can't be undone.")
    expect(dialog).toHaveClass(styles.confirmModal)
    expect(screen.getByRole('heading', { level: 2 })).toHaveClass(styles.confirmTitle)
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass(styles.confirmDanger)
  })

  it('starts on Cancel, so Enter straight away is a no', () => {
    ask()

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  })
})

describe('ConfirmDialog answers', () => {
  it('answers yes only from its own destructive button', async () => {
    const { answer } = ask()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Delete' }))

    await expect(answer).resolves.toBe(true)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('answers no on Cancel', async () => {
    const { answer } = ask()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }))

    await expect(answer).resolves.toBe(false)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('answers no on Escape', async () => {
    const { answer } = ask()

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })

    await expect(answer).resolves.toBe(false)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('answers no on a click on the backdrop, and not on a click inside the panel', async () => {
    const { answer } = ask()
    const user = userEvent.setup()

    await user.click(screen.getByText("This can't be undone."))
    expect(screen.getByRole('alertdialog')).toBeTruthy()

    await user.click(screen.getByRole('alertdialog'))

    await expect(answer).resolves.toBe(false)
  })

  it('answers no when it goes away unanswered', async () => {
    const { answer, unmount } = ask()

    unmount()

    await expect(answer).resolves.toBe(false)
  })

  it('answers an earlier question no when a second one replaces it', async () => {
    const { answer: first } = ask()
    let second!: Promise<boolean>
    act(() => {
      second = confirmAction({ ...QUESTION, title: 'Delete "Take Eight"?' })
    })

    await expect(first).resolves.toBe(false)
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Delete "Take Eight"?')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Delete' }))
    await expect(second).resolves.toBe(true)
  })
})

describe('ConfirmDialog focus', () => {
  it('hands focus to returnFocus when it closes, over whatever was focused before', async () => {
    // WebKit does not focus a button on click, so what was focused when the
    // dialog opened can be the body; the row's Delete button is passed instead.
    const trigger = document.createElement('button')
    document.body.append(trigger)
    const { answer } = ask({ ...QUESTION, returnFocus: trigger })
    expect(document.activeElement).not.toBe(trigger)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }))
    await answer

    expect(document.activeElement).toBe(trigger)
  })

  it('leaves focus alone when returnFocus is no longer in the page', async () => {
    const trigger = document.createElement('button')
    const { answer } = ask({ ...QUESTION, returnFocus: trigger })

    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }))
    await answer

    expect(document.activeElement).not.toBe(trigger)
  })
})
