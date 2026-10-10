import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { installFocusModalityTracker, wasFocusedByPointer } from './focusModality'

describe('focus modality tracker (ESCSUITE-270)', () => {
  let uninstall: () => void
  let button: HTMLButtonElement
  const fire = (target: EventTarget, type: string, init: object = {}) =>
    target.dispatchEvent(new Event(type, { bubbles: true, ...init }))

  beforeEach(() => {
    uninstall = installFocusModalityTracker()
    button = document.createElement('button')
    document.body.appendChild(button)
  })
  afterEach(() => {
    // settle the module state for the next case, then tear down
    fire(document.body, 'keydown')
    fire(button, 'focusin')
    uninstall()
    button.remove()
  })

  it('records pointerdown then focusin as pointer focus', () => {
    fire(button, 'pointerdown')
    fire(button, 'focusin')
    expect(wasFocusedByPointer()).toBe(true)
  })

  it('records keydown(Tab) then focusin as keyboard focus', () => {
    fire(button, 'pointerdown')
    fire(button, 'focusin')
    fire(button, 'keydown')
    fire(button, 'focusin')
    expect(wasFocusedByPointer()).toBe(false)
  })

  it('clears a click that focused nothing when the next key moves focus', () => {
    fire(document.body, 'pointerdown')
    fire(document.body, 'keydown')
    fire(button, 'focusin')
    expect(wasFocusedByPointer()).toBe(false)
  })

  it('a Space keydown after the click does not flip the recorded value', () => {
    fire(button, 'pointerdown')
    fire(button, 'focusin')
    fire(button, 'keydown')
    expect(wasFocusedByPointer()).toBe(true)
  })

  it('uninstall removes all three listeners', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    uninstall()
    expect(remove.mock.calls.map((c) => c[0]).sort()).toEqual(['focusin', 'keydown', 'pointerdown'])
    remove.mockRestore()
    fire(button, 'pointerdown')
    fire(button, 'focusin')
    expect(wasFocusedByPointer()).toBe(false)
    uninstall = installFocusModalityTracker()
  })
})
