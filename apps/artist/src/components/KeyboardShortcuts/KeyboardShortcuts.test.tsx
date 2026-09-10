import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KeyboardShortcuts } from './KeyboardShortcuts'
import styles from './KeyboardShortcuts.module.css'

describe('KeyboardShortcuts', () => {
  it('renders nothing while closed', () => {
    render(<KeyboardShortcuts isOpen={false} onClose={vi.fn()} />)

    expect(screen.queryByRole('heading', { name: 'Keyboard Shortcuts' })).not.toBeInTheDocument()
  })

  it('lists every shortcut group', () => {
    render(<KeyboardShortcuts isOpen={true} onClose={vi.fn()} />)

    for (const group of ['Tools', 'Playback', 'Editing', 'Timeline', 'Panels', 'File']) {
      expect(screen.getByRole('heading', { name: group, level: 3 })).toBeInTheDocument()
    }
  })

  it('renders a multi-key shortcut as separate keys joined by a plus', () => {
    const { container } = render(<KeyboardShortcuts isOpen={true} onClose={vi.fn()} />)

    const undoRow = screen.getByText('Undo').closest(`.${styles.shortcutRow}`)!
    const keys = Array.from(undoRow.querySelectorAll('kbd')).map((k) => k.textContent)
    expect(keys).toEqual(['Ctrl', 'Z'])
    expect(undoRow.querySelectorAll(`.${styles.plus}`)).toHaveLength(1)

    // A single-key shortcut gets no separator at all.
    const splitRow = screen.getByText('Selection Tool').closest(`.${styles.shortcutRow}`)!
    expect(Array.from(splitRow.querySelectorAll('kbd')).map((k) => k.textContent)).toEqual(['V'])
    expect(splitRow.querySelectorAll(`.${styles.plus}`)).toHaveLength(0)
    expect(container.querySelectorAll(`.${styles.group}`)).toHaveLength(6)
  })

  it('closes when the close button is used', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<KeyboardShortcuts isOpen={true} onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: /close/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes when the backdrop is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { container } = render(<KeyboardShortcuts isOpen={true} onClose={onClose} />)

    await user.click(container.querySelector<HTMLElement>(`.${styles.overlay}`)!)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stays open when a click lands inside the panel', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<KeyboardShortcuts isOpen={true} onClose={onClose} />)

    await user.click(screen.getByRole('heading', { name: 'Keyboard Shortcuts' }))

    expect(onClose).not.toHaveBeenCalled()
  })
})
