// The shared modal keyboard behaviour, driven directly rather than through any
// of the three dialogs that use it, so the edges each of them only has one of
// are covered here: a dialog with nothing focusable in it, a dialog whose ref
// was never attached, a dialog that opens and closes without unmounting, focus
// parked outside the trap, and an opener that has gone away.
//
// Nothing is mocked. The one stand-in is `installGetClientRectsStub`, because
// jsdom performs no layout and would otherwise report every element unrendered.
//
// ESCSUITE-208 (I-U3): this used to be `installOffsetParentStub`, lying about
// `offsetParent` instead — which is exactly the bug. A real `position: fixed`
// control's `offsetParent` is `null` in a real browser, so the trap's old
// `offsetParent !== null` filter dropped it; jsdom's `offsetParent` happens to
// be `null` for *every* element regardless of position (no layout engine at
// all), which is honest about what a fixed control looks like but would have
// made every other test here fail too without a lying stub. The fix moved the
// trap onto `getClientRects().length > 0`, so the double moved onto it as
// well — and no longer needs to lie: jsdom's `getClientRects()` is genuinely
// empty for every element by default (same root cause, no layout), so this
// stub reports a non-empty one, exactly as a real rendered element would.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook, fireEvent } from '@testing-library/react'
import { useDialogBehaviour } from './useDialogBehaviour'

function installGetClientRectsStub(): () => void {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getClientRects')
  Object.defineProperty(HTMLElement.prototype, 'getClientRects', {
    configurable: true,
    value: () => [{} as DOMRect],
  })
  return () => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'getClientRects', original)
    else Reflect.deleteProperty(HTMLElement.prototype, 'getClientRects')
  }
}

let restoreGetClientRects: () => void

beforeEach(() => {
  restoreGetClientRects = installGetClientRectsStub()
})

afterEach(() => {
  restoreGetClientRects()
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

// ESCSUITE-208 (I-U3): `getFocusable()` used to filter on
// `el.offsetParent !== null`. In a real browser that is `null` for any
// `position: fixed` element, so a pinned control was dropped from the trap
// entirely — not merely treated as hidden, but never found at all. The fix
// reads `getClientRects().length > 0` instead, which answers "is this element
// actually rendered" without caring what positioning scheme put it there.
describe('useDialogBehaviour focus trap finds controls regardless of offsetParent (I-U3)', () => {
  it('finds and focuses a control whose offsetParent is null — what a position: fixed control reports', () => {
    const { buttons } = renderDialog()

    // jsdom never computes layout, so every element's offsetParent is null —
    // which is also exactly what a real position: fixed control's offsetParent
    // is. Nothing here lies about that (unlike the getClientRects stub, which
    // jsdom also reports empty for everything and which this suite does stub —
    // see the file header). The trap must not depend on offsetParent at all.
    expect(buttons[0].offsetParent).toBeNull()
    expect(document.activeElement).toBe(buttons[0])
  })

  it('still wraps Tab forward onto the first control from a last control whose offsetParent is null', () => {
    const { buttons } = renderDialog()
    expect(buttons[2].offsetParent).toBeNull()
    buttons[2].focus()

    fireEvent.keyDown(document, { key: 'Tab' })

    expect(document.activeElement).toBe(buttons[0])
  })
})

// ESCSUITE-208 (I-U2): FOCUSABLE_SELECTOR only named the control types the
// seven existing dialogs happen to use, so a tabbable element of a type it
// has no arm for was invisible to the trap — Tab from it walked straight out
// of an aria-modal dialog instead of wrapping. One test per added arm: the
// element is found by getFocusable() (it becomes "last"), and Tab from it
// wraps to "first".
//
// jsdom's own focus() implementation
// (lib/jsdom/living/helpers/focusing.js, isFocusableAreaElement) has no case
// at all for <audio>, <video> or <area> — a deliberate, documented gap
// (https://github.com/whatwg/html/issues/5490), not something this project's
// test doubles can paper over the way the layout-related ones do. Real
// browsers do move focus onto them (confirmed for audio/area by hunt-i's
// Playwright probe against Chromium and WebKit). Giving just the element
// under test an explicit tabindex is enough for jsdom's own algorithm to
// treat it as a focusable area and actually move document.activeElement —
// it does not also make `[tabindex]:not([tabindex="-1"])` match it, since
// that arm explicitly excludes -1.
function makeFocusableUnderJsdom(el: HTMLElement): void {
  el.tabIndex = -1
}

describe('useDialogBehaviour focus trap selector arms (I-U2)', () => {
  it('[contenteditable] is found and Tab from it as the last control wraps to the first', () => {
    const { view, buttons } = renderDialog()
    const dialog = view.container.querySelector('[role="dialog"]') as HTMLElement
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    dialog.appendChild(editable)

    editable.focus()
    expect(document.activeElement).toBe(editable)

    fireEvent.keyDown(document, { key: 'Tab' })

    expect(document.activeElement).toBe(buttons[0])
  })

  it('a [contenteditable="false"] element is NOT matched, and is left out of the trap', () => {
    const { view, buttons } = renderDialog()
    const dialog = view.container.querySelector('[role="dialog"]') as HTMLElement
    const notEditable = document.createElement('div')
    notEditable.setAttribute('contenteditable', 'false')
    notEditable.tabIndex = -1
    dialog.appendChild(notEditable)

    // Shift+Tab from the first control still wraps to the real last control
    // (buttons[2]), not to the excluded element.
    buttons[0].focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })

    expect(document.activeElement).toBe(buttons[2])
  })

  it('audio[controls] is found and Tab from it as the last control wraps to the first', () => {
    const { view, buttons } = renderDialog()
    const dialog = view.container.querySelector('[role="dialog"]') as HTMLElement
    const audio = document.createElement('audio')
    audio.controls = true
    makeFocusableUnderJsdom(audio)
    dialog.appendChild(audio)

    audio.focus()
    expect(document.activeElement).toBe(audio)

    fireEvent.keyDown(document, { key: 'Tab' })

    expect(document.activeElement).toBe(buttons[0])
  })

  it('video[controls] is found and Tab from it as the last control wraps to the first', () => {
    const { view, buttons } = renderDialog()
    const dialog = view.container.querySelector('[role="dialog"]') as HTMLElement
    const video = document.createElement('video')
    video.controls = true
    makeFocusableUnderJsdom(video)
    dialog.appendChild(video)

    video.focus()
    expect(document.activeElement).toBe(video)

    fireEvent.keyDown(document, { key: 'Tab' })

    expect(document.activeElement).toBe(buttons[0])
  })

  it('iframe is found and Tab from it as the last control wraps to the first', () => {
    const { view, buttons } = renderDialog()
    const dialog = view.container.querySelector('[role="dialog"]') as HTMLElement
    const iframe = document.createElement('iframe')
    dialog.appendChild(iframe)

    iframe.focus()
    expect(document.activeElement).toBe(iframe)

    fireEvent.keyDown(document, { key: 'Tab' })

    expect(document.activeElement).toBe(buttons[0])
  })

  it('summary (as a details element\'s first summary) is found and Tab from it wraps to the first control', () => {
    const { view, buttons } = renderDialog()
    const dialog = view.container.querySelector('[role="dialog"]') as HTMLElement
    const details = document.createElement('details')
    const summary = document.createElement('summary')
    summary.textContent = 'more'
    details.appendChild(summary)
    dialog.appendChild(details)

    summary.focus()
    expect(document.activeElement).toBe(summary)

    fireEvent.keyDown(document, { key: 'Tab' })

    expect(document.activeElement).toBe(buttons[0])
  })

  it('area[href] is found and Tab from it as the last control wraps to the first', () => {
    const { view, buttons } = renderDialog()
    const dialog = view.container.querySelector('[role="dialog"]') as HTMLElement
    const map = document.createElement('map')
    const area = document.createElement('area')
    area.setAttribute('href', '#')
    makeFocusableUnderJsdom(area)
    map.appendChild(area)
    dialog.appendChild(map)

    area.focus()
    expect(document.activeElement).toBe(area)

    fireEvent.keyDown(document, { key: 'Tab' })

    expect(document.activeElement).toBe(buttons[0])
  })
})

// ESCSUITE-208 (I-U1): every open dialog binds its own capture-phase keydown
// listener on `document`, and `stopPropagation()` does nothing for a second
// listener bound to the *same* node — so a second dialog's Escape used to run
// the first dialog's onClose too. No dialog in either app can reach a
// two-open state today (every overlay is position: fixed; inset: 0, and every
// keyboard trigger is gated behind the same "a modal is open" flag), so this
// is hardening, not a reachable-today defect.
describe('useDialogBehaviour Escape with more than one dialog open (I-U1)', () => {
  it('closes only the most recently opened (topmost) dialog, not every open one', () => {
    const outerClose = vi.fn()
    const innerClose = vi.fn()

    render(<Dialog onClose={outerClose} />)
    render(<Dialog onClose={innerClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(innerClose).toHaveBeenCalledTimes(1)
    expect(outerClose).not.toHaveBeenCalled()
  })

  it('keeps acting on the new topmost dialog once the previous one closes', () => {
    const outerClose = vi.fn()
    const innerClose = vi.fn()

    const outer = render(<Dialog onClose={outerClose} />)
    const inner = render(<Dialog onClose={innerClose} />)

    inner.unmount()
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(outerClose).toHaveBeenCalledTimes(1)
    expect(innerClose).not.toHaveBeenCalled()

    outer.unmount()
  })
})
