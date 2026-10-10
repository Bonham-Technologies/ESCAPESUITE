// The typing-burst / picker-sweep gesture's contract, read directly (ESCSUITE-242).
//
// `TextContentSection.test.tsx`, `ShapeSection.test.tsx` and `MaskSection.test.tsx`
// prove the rule end to end through the real store. This file states it as the
// hook's own contract: which writes are told to skip history for a given run of
// edits, pauses, blurs and unmounts. The shared mechanism's own contract — what a
// refused or throwing write does to the flag — is `hooks/useGestureHistory.test.ts`.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useBurstGesture, BURST_PAUSE_MS } from './useBurstGesture'

/** The hook, plus a shorthand for "what would the next write be told?". */
function gesture() {
  const hook = renderHook(() => useBurstGesture())
  return {
    on: () => hook.result.current.handlers,
    /** One write that lands: the `skipHistory` flag it is handed. */
    write: () => {
      let seen = false
      hook.result.current.commit((skipHistory) => {
        seen = skipHistory
        return true
      })
      return seen
    },
    unmount: hook.unmount,
    rerender: hook.rerender,
    result: hook.result,
  }
}

describe('useBurstGesture', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('pauses for 600 ms', () => {
    expect(BURST_PAUSE_MS).toBe(600)
  })

  it('tells a write outside any burst to push its own entry', () => {
    const { write } = gesture()

    expect(write()).toBe(false)
    expect(write()).toBe(false)
  })

  it('opens on the first edit: that write pushes, every later one in the burst skips', () => {
    const { on, write } = gesture()

    on().onEdit()
    expect(write()).toBe(false)
    on().onEdit()
    expect(write()).toBe(true)
    on().onEdit()
    expect(write()).toBe(true)
  })

  it('does not reopen on a repeat edit — the pushed mark survives it', () => {
    const { on, write } = gesture()

    on().onEdit()
    expect(write()).toBe(false)
    // A second edit before any pause: still the same burst, so the write after
    // it must not be handed `false` again.
    on().onEdit()
    on().onEdit()
    expect(write()).toBe(true)
  })

  it('closes after a pause of BURST_PAUSE_MS with no edit', () => {
    const { on, write } = gesture()

    on().onEdit()
    expect(write()).toBe(false)
    vi.advanceTimersByTime(BURST_PAUSE_MS)

    // Closed: a write now belongs to no burst...
    expect(write()).toBe(false)
    // ...and the next edit opens a fresh one, which pushes its own entry.
    on().onEdit()
    expect(write()).toBe(false)
    on().onEdit()
    expect(write()).toBe(true)
  })

  it('stays open one millisecond short of the pause', () => {
    const { on, write } = gesture()

    on().onEdit()
    write()
    vi.advanceTimersByTime(BURST_PAUSE_MS - 1)
    on().onEdit()

    expect(write()).toBe(true)
  })

  it('restarts the pause on every edit, so a steady run of edits is one burst', () => {
    const { on, write } = gesture()

    on().onEdit()
    expect(write()).toBe(false)
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(BURST_PAUSE_MS - 100)
      on().onEdit()
      expect(write()).toBe(true)
    }
  })

  it('keeps exactly one pending timer however many edits arrive', () => {
    const { on } = gesture()

    on().onEdit()
    on().onEdit()
    on().onEdit()

    expect(vi.getTimerCount()).toBe(1)
  })

  it('closes on blur, and clears its timer', () => {
    const { on, write } = gesture()

    on().onEdit()
    expect(write()).toBe(false)
    on().onBlur()

    expect(vi.getTimerCount()).toBe(0)
    expect(write()).toBe(false)
    on().onEdit()
    expect(write()).toBe(false)
  })

  it('treats a blur with no burst open as a no-op', () => {
    const { on, write } = gesture()

    on().onBlur()

    expect(vi.getTimerCount()).toBe(0)
    expect(write()).toBe(false)
  })

  it('closes and clears its timer on unmount (ESCSUITE-120)', () => {
    const { on, write, unmount } = gesture()

    on().onEdit()
    expect(write()).toBe(false)
    on().onEdit()
    unmount()

    expect(vi.getTimerCount()).toBe(0)
    // The scope ended too: a write through the same `commit` is no longer
    // inside a burst.
    expect(write()).toBe(false)
  })

  it('keeps its handler and commit identities across renders', () => {
    const { result, rerender } = gesture()
    const first = result.current

    rerender()

    expect(result.current.handlers).toBe(first.handlers)
    expect(result.current.commit).toBe(first.commit)
  })
})
