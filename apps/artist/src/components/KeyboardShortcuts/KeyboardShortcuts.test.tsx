import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KeyboardShortcuts } from './KeyboardShortcuts'
import { pretendElementsAreVisible } from '../../test/doubles/layout'
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
    // while it is up (App's `modalOpen`). The key that is still the sheet's
    // own — a second `?` — is bound here, which is why the global cascade
    // never sees it and the footer's promise still holds.
    //
    // Escape used to be bound here too and is not any more: it belongs to
    // `useDialogBehaviour` now, so there is exactly one Escape path for the
    // sheet, the same one every other dialog in the suite uses. It is pinned
    // under 'modal keyboard behaviour' below.
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

    it('leaves a `?` typed into a field alone', () => {
      // The guard the `?` listener opens with. The sheet traps focus now, so no
      // field inside it can take a keystroke and the header's project-name
      // input is no longer Tab-reachable behind it — but `?` is bound on
      // `window`, where any field in the document reaches it, so the guard is
      // still what keeps a typed `?` a `?`. Escape has no such guard and needs
      // none: it is the shared hook's, and every dialog in the suite closes on
      // it unconditionally.
      const onClose = vi.fn()
      const input = document.createElement('input')
      const textarea = document.createElement('textarea')
      document.body.append(input, textarea)
      render(<KeyboardShortcuts isOpen={true} onClose={onClose} />)

      fireEvent.keyDown(input, { key: '?', bubbles: true })
      fireEvent.keyDown(textarea, { key: '/', shiftKey: true, bubbles: true })

      expect(onClose).not.toHaveBeenCalled()
      input.remove()
      textarea.remove()
    })

    it('stops listening once it is closed', () => {
      const onClose = vi.fn()
      const { rerender } = render(<KeyboardShortcuts isOpen={true} onClose={onClose} />)

      rerender(<KeyboardShortcuts isOpen={false} onClose={onClose} />)
      fireEvent.keyDown(window, { key: '?' })
      // ...and so does the hook's, which is bound on `document` in the capture
      // phase rather than on `window`.
      fireEvent.keyDown(document, { key: 'Escape' })

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

  describe('modal keyboard behaviour', () => {
    // The sheet's trap, initial focus, Escape and focus restore all come from
    // the shared `useDialogBehaviour`. These pin the wiring; the mechanics are
    // the hook's own suite's job.
    let restoreVisibility: () => void

    beforeEach(() => {
      restoreVisibility = pretendElementsAreVisible()
    })

    afterEach(() => {
      restoreVisibility()
    })

    it('is a modal dialog labelled by its own heading', () => {
      render(<KeyboardShortcuts isOpen={true} onClose={vi.fn()} />)

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(dialog).toHaveAttribute('aria-labelledby', 'keyboard-shortcuts-title')
      expect(screen.getByRole('heading', { name: 'Keyboard Shortcuts' })).toHaveAttribute(
        'id',
        'keyboard-shortcuts-title'
      )
    })

    it('moves focus into the sheet when it opens and back to the opener when it closes', () => {
      const opener = document.createElement('button')
      document.body.appendChild(opener)
      opener.focus()

      const { rerender } = render(<KeyboardShortcuts isOpen={true} onClose={vi.fn()} />)
      expect(screen.getByRole('button', { name: /close/i })).toHaveFocus()

      rerender(<KeyboardShortcuts isOpen={false} onClose={vi.fn()} />)

      expect(opener).toHaveFocus()
      opener.remove()
    })

    it('wraps Tab from the last focusable back to the first', () => {
      const { container } = render(<KeyboardShortcuts isOpen={true} onClose={vi.fn()} />)
      // The scrolling body is the sheet's second and last focusable: it holds
      // no controls of its own, so it carries tabIndex={0} for a keyboard to
      // scroll it (axe: scrollable-region-focusable).
      const content = container.querySelector<HTMLElement>(`.${styles.content}`)!
      expect(content).toHaveAttribute('tabindex', '0')
      content.focus()

      fireEvent.keyDown(document, { key: 'Tab' })

      expect(screen.getByRole('button', { name: /close/i })).toHaveFocus()
    })

    it('wraps Shift+Tab from the first focusable round to the last', () => {
      const { container } = render(<KeyboardShortcuts isOpen={true} onClose={vi.fn()} />)
      screen.getByRole('button', { name: /close/i }).focus()

      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })

      expect(container.querySelector(`.${styles.content}`)).toHaveFocus()
    })

    it('closes on Escape, through the shared hook rather than its own listener', () => {
      // The ruling: Escape closes the sheet, which it always did — the sheet
      // holds nothing and destroys nothing, so dismissing it is free. What
      // changed is the route: one `document` capture listener in the hook,
      // which also `stopPropagation()`s the key, instead of a second `window`
      // listener here.
      const onClose = vi.fn()
      render(<KeyboardShortcuts isOpen={true} onClose={onClose} />)

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
