// The window-level shortcuts: which handler each key reaches, in which state,
// and when the listener is bound and unbound.
//
// Nothing here is mocked — the hook takes its handlers as arguments, so the
// tests hand it counted stand-ins and drive real keydown events.
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useKeyboardShortcuts, type KeyboardShortcutsDeps } from './useKeyboardShortcuts'
import type { RecordingState } from '../store/types'

function makeHandlers() {
  return {
    handleStartRecording: vi.fn<() => void>(),
    handlePauseRecording: vi.fn<() => void>(),
    handleResumeRecording: vi.fn<() => void>(),
    handleStopRecording: vi.fn<() => void>(),
    cancelCountdown: vi.fn<() => void>(),
    handleCancelRecording: vi.fn<() => void>(),
  }
}

let handlers: ReturnType<typeof makeHandlers>
let addListener: MockInstance
let removeListener: MockInstance

beforeEach(() => {
  handlers = makeHandlers()
  addListener = vi.spyOn(window, 'addEventListener')
  removeListener = vi.spyOn(window, 'removeEventListener')
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

function deps(state: RecordingState, canRecord = true, modalOpen = false): KeyboardShortcutsDeps {
  return { state, canRecord, modalOpen, ...handlers }
}

function mountShortcuts(state: RecordingState, canRecord = true, modalOpen = false) {
  return renderHook((props: KeyboardShortcutsDeps) => useKeyboardShortcuts(props), {
    initialProps: deps(state, canRecord, modalOpen),
  })
}

function press(key: string, target: EventTarget = window): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}

/** How many keydown listeners the hook currently holds on the window. */
function keydownBindings(): number {
  const added = addListener.mock.calls.filter(([type]) => type === 'keydown').length
  const removed = removeListener.mock.calls.filter(([type]) => type === 'keydown').length
  return added - removed
}

describe('useKeyboardShortcuts R', () => {
  it('starts a recording when idle', () => {
    mountShortcuts('idle')

    press('r')

    expect(handlers.handleStartRecording).toHaveBeenCalledTimes(1)
  })

  it('accepts the shifted key as well', () => {
    mountShortcuts('idle')

    press('R')

    expect(handlers.handleStartRecording).toHaveBeenCalledTimes(1)
  })

  it('does nothing while a recording is already running', () => {
    mountShortcuts('recording')

    press('r')

    expect(handlers.handleStartRecording).not.toHaveBeenCalled()
  })

  it('does nothing while the record button itself is blocked', () => {
    mountShortcuts('idle', false)

    press('r')

    expect(handlers.handleStartRecording).not.toHaveBeenCalled()
  })
})

describe('useKeyboardShortcuts P and S', () => {
  it('pauses a running recording and resumes a paused one', () => {
    const { rerender } = mountShortcuts('recording')

    press('p')
    expect(handlers.handlePauseRecording).toHaveBeenCalledTimes(1)

    rerender(deps('paused'))
    press('P')
    expect(handlers.handleResumeRecording).toHaveBeenCalledTimes(1)
  })

  it('ignores P when there is nothing to pause', () => {
    mountShortcuts('idle')

    press('p')

    expect(handlers.handlePauseRecording).not.toHaveBeenCalled()
    expect(handlers.handleResumeRecording).not.toHaveBeenCalled()
  })

  it('stops a running or paused recording', () => {
    const { rerender } = mountShortcuts('recording')

    press('s')
    rerender(deps('paused'))
    press('s')

    expect(handlers.handleStopRecording).toHaveBeenCalledTimes(2)
  })

  it('ignores S when idle', () => {
    mountShortcuts('idle')

    press('s')

    expect(handlers.handleStopRecording).not.toHaveBeenCalled()
  })
})

describe('useKeyboardShortcuts Escape', () => {
  it('cancels a countdown', () => {
    mountShortcuts('countdown')

    press('Escape')

    expect(handlers.cancelCountdown).toHaveBeenCalledTimes(1)
    expect(handlers.handleCancelRecording).not.toHaveBeenCalled()
  })

  it('cancels anything else that is not idle', () => {
    const { rerender } = mountShortcuts('recording')

    press('Escape')
    rerender(deps('saving'))
    press('Escape')

    expect(handlers.handleCancelRecording).toHaveBeenCalledTimes(2)
    expect(handlers.cancelCountdown).not.toHaveBeenCalled()
  })

  it('does nothing when idle', () => {
    mountShortcuts('idle')

    press('Escape')

    expect(handlers.cancelCountdown).not.toHaveBeenCalled()
    expect(handlers.handleCancelRecording).not.toHaveBeenCalled()
  })
})

describe('useKeyboardShortcuts binding', () => {
  it('ignores keys it has no shortcut for', () => {
    mountShortcuts('idle')

    press('x')

    expect(handlers.handleStartRecording).not.toHaveBeenCalled()
  })

  it('stays out of the way while the user is typing', () => {
    mountShortcuts('idle')
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    document.body.append(input, textarea)

    press('r', input)
    press('r', textarea)

    expect(handlers.handleStartRecording).not.toHaveBeenCalled()
  })

  it('stops listening once the screen goes away', () => {
    const { unmount } = mountShortcuts('idle')

    unmount()
    press('r')

    expect(keydownBindings()).toBe(0)
    expect(handlers.handleStartRecording).not.toHaveBeenCalled()
  })

  it('re-binds when a handler changes identity, holding one listener at a time', () => {
    const { rerender } = mountShortcuts('idle')
    expect(keydownBindings()).toBe(1)

    // handleStartRecording is rebuilt on every config change; the listener
    // follows it rather than keeping the stale closure.
    const replacement = vi.fn<() => void>()
    rerender({ ...deps('idle'), handleStartRecording: replacement })

    expect(keydownBindings()).toBe(1)
    press('r')
    expect(replacement).toHaveBeenCalledTimes(1)
    expect(handlers.handleStartRecording).not.toHaveBeenCalled()
  })
})

describe('useKeyboardShortcuts while a modal is open', () => {
  it('lets no shortcut through', () => {
    const { rerender } = mountShortcuts('idle', true, true)

    press('r')
    rerender(deps('recording', true, true))
    press('p')
    press('s')
    press('Escape')
    rerender(deps('countdown', true, true))
    press('Escape')

    expect(handlers.handleStartRecording).not.toHaveBeenCalled()
    expect(handlers.handlePauseRecording).not.toHaveBeenCalled()
    expect(handlers.handleStopRecording).not.toHaveBeenCalled()
    expect(handlers.handleCancelRecording).not.toHaveBeenCalled()
    expect(handlers.cancelCountdown).not.toHaveBeenCalled()
  })

  it('goes back to listening once the modal closes', () => {
    const { rerender } = mountShortcuts('idle', true, true)

    press('r')
    expect(handlers.handleStartRecording).not.toHaveBeenCalled()

    rerender(deps('idle', true, false))
    press('r')

    expect(handlers.handleStartRecording).toHaveBeenCalledTimes(1)
    expect(keydownBindings()).toBe(1)
  })
})
