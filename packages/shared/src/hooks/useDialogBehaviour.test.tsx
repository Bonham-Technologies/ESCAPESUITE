// The shared modal keyboard behaviour, driven directly rather than through any
// of the three dialogs that use it, so the edges each of them only has one of
// are covered here: a dialog with nothing focusable in it, a dialog whose ref
// was never attached, a dialog that opens and closes without unmounting, focus
// parked outside the trap, and an opener that has gone away.
//
// Nothing is mocked. The one stand-in is `installOffsetParentStub`, because
// jsdom performs no layout and would otherwise report every element hidden.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook, fireEvent } from '@testing-library/react'
import { useDialogBehaviour } from './useDialogBehaviour'

/**
 * jsdom performs no layout, so `HTMLElement.offsetParent` is `null` on every
 * element — including elements that are plainly on screen. The focus trap uses
 * `offsetParent !== null` to skip controls CSS has hidden, so under jsdom it
 * would otherwise find nothing focusable at all.
 *
 * Report `document.body` for every element instead, which is what a rendered
 * element's offsetParent would be, and hand back the undo.
 */
function installOffsetParentStub(): () => void {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get: () => document.body,
  })
  return () => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'offsetParent', original)
    else Reflect.deleteProperty(HTMLElement.prototype, 'offsetParent')
  }
}

let restoreOffsetParent: () => void

beforeEach(() => {
  restoreOffsetParent = installOffsetParentStub()
})

afterEach(() => {
  restoreOffsetParent()
  document.body.innerHTML = ''
})

/** A dialog with three focusable controls: the shape all three real dialogs have. */
function Dialog({ onClose, empty = false }: { onClose: () => void; empty?: boolean }) {
  const dialogRef = useDialogBehaviour(onClose)
  return (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-label="Test dialog">
      {empty ? (
        <p>Nothing to focus here</p>
      ) : (
        <>
          <button>first</button>
          <button>middle</button>
          <button>last</button>
        </>
      )}
    </div>
  )
}

function renderDialog(options: { empty?: boolean } = {}) {
  const onClose = vi.fn()
  const view = render(<Dialog onClose={onClose} empty={options.empty} />)
  const buttons = [...view.container.querySelectorAll('button')]
  return { onClose, view, buttons }
}

describe('useDialogBehaviour opening', () => {
  it('focuses the first control in the dialog', () => {
    const { buttons } = renderDialog()

    expect(document.activeElement).toBe(buttons[0])
  })

  it('focuses the dialog itself when it holds no controls', () => {
    const { view } = renderDialog({ empty: true })

    expect(document.activeElement).toBe(view.container.querySelector('[role="dialog"]'))
  })

  it('does nothing at all if the ref was never attached', () => {
    const onClose = vi.fn()
    const before = document.activeElement

    renderHook(() => useDialogBehaviour(onClose))

    // No listener was bound, so Escape falls straight through.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(before)
  })
})

describe('useDialogBehaviour Escape', () => {
  it('closes, and keeps the key from the window listeners behind it', () => {
    const behind = vi.fn()
    window.addEventListener('keydown', behind)
    const { onClose } = renderDialog()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(behind).not.toHaveBeenCalled()
    window.removeEventListener('keydown', behind)
  })

  it('reads the latest onClose rather than the one it opened with', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Dialog onClose={first} />)

    rerender(<Dialog onClose={second} />)
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('leaves every other key to the app', () => {
    const behind = vi.fn()
    window.addEventListener('keydown', behind)
    const { onClose } = renderDialog()

    fireEvent.keyDown(document, { key: ' ' })

    expect(onClose).not.toHaveBeenCalled()
    expect(behind).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', behind)
  })
})

describe('useDialogBehaviour focus trap', () => {
  it('wraps forwards from the last control', () => {
    const { buttons } = renderDialog()
    buttons[2].focus()

    fireEvent.keyDown(document, { key: 'Tab' })

    expect(document.activeElement).toBe(buttons[0])
  })

  it('wraps backwards from the first control', () => {
    const { buttons } = renderDialog()
    buttons[0].focus()

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })

    expect(document.activeElement).toBe(buttons[2])
  })

  it('leaves Tab alone in the middle of the dialog', () => {
    const { buttons } = renderDialog()
    buttons[1].focus()

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(buttons[1])

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(buttons[1])
  })

  it('wraps backwards from the dialog container itself', () => {
    // The container is `tabIndex={-1}`, so it is not in the tab order but a
    // click can land on it — which is what clicking the playback dialog's
    // <video> does. Shift+Tab from there used to walk backwards *out* of the
    // modal, onto whatever was behind it.
    const { view, buttons } = renderDialog()
    const dialog = view.container.querySelector('[role="dialog"]') as HTMLElement
    dialog.focus()
    expect(document.activeElement).toBe(dialog)

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })

    expect(document.activeElement).toBe(buttons[2])
  })

  it('pulls focus back in when it has strayed outside', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const { buttons } = renderDialog()

    outside.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(buttons[0])

    outside.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(buttons[2])
  })

  it('swallows Tab when there is nothing to move to', () => {
    const { view } = renderDialog({ empty: true })
    const dialog = view.container.querySelector('[role="dialog"]') as HTMLElement

    const handled = fireEvent.keyDown(document, { key: 'Tab' })

    // `fireEvent` returns false when a handler called preventDefault.
    expect(handled).toBe(false)
    expect(document.activeElement).toBe(dialog)
  })
})

describe('useDialogBehaviour closing', () => {
  it('gives focus back to whatever opened it', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()

    const { view, buttons } = renderDialog()
    expect(document.activeElement).toBe(buttons[0])

    view.unmount()

    expect(document.activeElement).toBe(opener)
  })

  it('stops listening once it is gone', () => {
    const { view, onClose } = renderDialog()

    view.unmount()
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
  })

  it('copes with there having been nothing focused when it opened', () => {
    // A dialog opened from a click has document.body focused; one opened by
    // script in a page the user has not touched can have nothing at all.
    const activeElement = Object.getOwnPropertyDescriptor(Document.prototype, 'activeElement')
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => null })

    const { view } = renderDialog()
    expect(() => view.unmount()).not.toThrow()

    Reflect.deleteProperty(document, 'activeElement')
    expect(activeElement).toBeDefined()
  })
})

describe('useDialogBehaviour on an always-mounted dialog', () => {
  // ARTIST's export dialog is mounted for the life of the editor and returns
  // null when closed, so it passes `isOpen` and the effect opens and closes
  // with the flag rather than with the component.
  function ToggleDialog({ onClose, isOpen }: { onClose: () => void; isOpen: boolean }) {
    const dialogRef = useDialogBehaviour(onClose, isOpen)
    if (!isOpen) return null
    return (
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-label="Toggle dialog">
        <button>first</button>
        <button>last</button>
      </div>
    )
  }

  it('does nothing while it is closed', () => {
    const onClose = vi.fn()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()

    render(<ToggleDialog onClose={onClose} isOpen={false} />)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(outside)
  })

  it('takes focus when it opens and gives it back when it closes', () => {
    const onClose = vi.fn()
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()

    const { rerender, container } = render(<ToggleDialog onClose={onClose} isOpen={false} />)
    expect(document.activeElement).toBe(opener)

    rerender(<ToggleDialog onClose={onClose} isOpen={true} />)
    expect(document.activeElement).toBe(container.querySelector('button'))

    // Still trapping while open.
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(container.querySelectorAll('button')[1])

    rerender(<ToggleDialog onClose={onClose} isOpen={false} />)
    expect(document.activeElement).toBe(opener)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})
