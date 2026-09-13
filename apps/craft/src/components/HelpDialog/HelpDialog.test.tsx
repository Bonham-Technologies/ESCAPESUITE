// The Recording Tips modal, driven by props only.
//
// The copy is static, so the tests pin the shape rather than every sentence:
// the accessible name the App suite queries, the four sections in order, and
// the three dismissal paths — backdrop yes, close button yes, a click inside
// the panel no.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HelpDialog } from './HelpDialog'
import styles from '../../App.module.css'

function renderDialog() {
  const onClose = vi.fn()
  const { container } = render(<HelpDialog onClose={onClose} />)
  return { onClose, container }
}

describe('HelpDialog framing', () => {
  it('is a modal dialog named by its own heading', () => {
    renderDialog()

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('Recording Tips')

    const title = document.getElementById('help-title') as HTMLElement
    expect(title.tagName).toBe('H2')
    expect(title).toHaveClass(styles.helpTitle)
  })

  it('covers what to capture, how, the modes and the formats — in that order', () => {
    renderDialog()

    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Choosing What to Record',
      'Best Practices',
      'Recording Modes',
      'Download Formats',
    ])
  })

  it('recommends whole-screen capture and names the six recording modes', () => {
    const { container } = renderDialog()

    expect(screen.getAllByText('Entire Screen')[0]).toBeInTheDocument()
    expect(container).toHaveTextContent('(Recommended)')
    expect(screen.getByText('Picture-in-Picture')).toBeInTheDocument()
    expect(screen.getByText('WebM')).toBeInTheDocument()
    expect(screen.getByText('MP4')).toBeInTheDocument()
  })

  it('repeats the keyboard shortcuts as keycaps', () => {
    const { container } = renderDialog()

    expect([...container.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual([
      'R',
      'P',
      'S',
      'Esc',
    ])
  })
})

describe('HelpDialog dismissal', () => {
  it('closes when the backdrop is clicked', async () => {
    const user = userEvent.setup()
    const { onClose } = renderDialog()

    await user.click(screen.getByRole('dialog'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stays open when the click lands inside the panel', async () => {
    const user = userEvent.setup()
    const { onClose, container } = renderDialog()

    await user.click(container.querySelector(`.${styles.helpContent}`) as HTMLElement)
    await user.click(screen.getByRole('heading', { name: 'Recording Tips' }))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes from its own close button', async () => {
    const user = userEvent.setup()
    const { onClose } = renderDialog()

    const close = screen.getByRole('button', { name: 'Close help' })
    expect(close).toHaveAttribute('title', 'Close')

    await user.click(close)

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
