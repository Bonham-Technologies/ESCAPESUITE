import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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

    for (const group of ['Tools', 'Playback', 'Editing', 'Timeline', 'Panels', 'Keyframe Graph', 'File']) {
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
    expect(container.querySelectorAll(`.${styles.group}`)).toHaveLength(7)
  })

  it('lists both keys the keyframe graph deletes with', () => {
    render(<KeyboardShortcuts isOpen={true} onClose={vi.fn()} />)

    // The graph claims Delete *and* Backspace (see apps/artist/CLAUDE.md's key
    // map); a sheet that only names one of them is a sheet that disagrees with
    // the code. Two rows rather than one, because the renderer joins the keys
    // of a row with '+' — these are alternatives, not a chord.
    const rows = screen.getAllByText('Delete Keyframe')
      .map((label) => label.closest(`.${styles.shortcutRow}`)!)
    expect(rows.map((row) => Array.from(row.querySelectorAll('kbd')).map((k) => k.textContent)))
      .toEqual([['Delete'], ['Backspace']])
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

  describe('its own keys', () => {
    // The sheet is a modal, so `useAppKeyboardShortcuts` stops taking keys
    // while it is up (App's `modalOpen`). The two keys that are the sheet's
    // own — Escape and a second `?` — are bound here instead, which is why the
    // global cascade never sees them and the footer's promise still holds.
    it('closes on Escape', () => {
      const onClose = vi.fn()
      render(<KeyboardShortcuts isOpen={true} onClose={onClose} />)

      fireEvent.keyDown(window, { key: 'Escape' })

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('closes on a second ?', () => {
      const onClose = vi.fn()
      render(<KeyboardShortcuts isOpen={true} onClose={onClose} />)

      fireEvent.keyDown(window, { key: '?' })

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('closes on Shift+/ too', () => {
      const onClose = vi.fn()
      render(<KeyboardShortcuts isOpen={true} onClose={onClose} />)

      fireEvent.keyDown(window, { key: '/', shiftKey: true })

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('leaves every other key alone', () => {
      const onClose = vi.fn()
      render(<KeyboardShortcuts isOpen={true} onClose={onClose} />)

      fireEvent.keyDown(window, { key: 'v' })

      expect(onClose).not.toHaveBeenCalled()
    })

    it('leaves a key typed into a field alone', () => {
      // The sheet traps no focus, so the header's project-name input is still
      // Tab-reachable behind it — and a `?` typed into a name is a `?`.
      const onClose = vi.fn()
      const input = document.createElement('input')
      document.body.append(input)
      render(<KeyboardShortcuts isOpen={true} onClose={onClose} />)

      fireEvent.keyDown(input, { key: '?', bubbles: true })
      const textarea = document.createElement('textarea')
      document.body.append(textarea)
      fireEvent.keyDown(textarea, { key: 'Escape', bubbles: true })

      expect(onClose).not.toHaveBeenCalled()
      input.remove()
      textarea.remove()
    })

    it('stops listening once it is closed', () => {
      const onClose = vi.fn()
      const { rerender } = render(<KeyboardShortcuts isOpen={true} onClose={onClose} />)

      rerender(<KeyboardShortcuts isOpen={false} onClose={onClose} />)
      fireEvent.keyDown(window, { key: 'Escape' })

      expect(onClose).not.toHaveBeenCalled()
    })
  })

  it('stays open when a click lands inside the panel', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<KeyboardShortcuts isOpen={true} onClose={onClose} />)

    await user.click(screen.getByRole('heading', { name: 'Keyboard Shortcuts' }))

    expect(onClose).not.toHaveBeenCalled()
  })
})
