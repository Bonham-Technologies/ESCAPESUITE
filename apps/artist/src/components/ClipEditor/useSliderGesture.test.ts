// The slider gesture's contract, read directly (ESCSUITE-75).
//
// `ClipEditor.sliderHistory.test.tsx` proves the rule end to end, through the
// real panel and the real store. This file states it as the hook's own contract,
// so the answer for a given event sequence can be read without a DOM: which
// writes are told to skip history, and which are not.
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSliderGesture } from './useSliderGesture'

/** The hook, plus a shorthand for "what would the next write be told?". */
function gesture() {
  const { result } = renderHook(() => useSliderGesture())
  return {
    /** The listeners a slider would carry. */
    on: () => result.current.handlers,
    /** One write: the `skipHistory` flag it is handed. */
    write: () => result.current.skipHistoryForWrite(),
  }
}

describe('useSliderGesture', () => {
  it('tells a write outside any gesture to push its own entry', () => {
    const { write } = gesture()

    expect(write()).toBe(false)
    expect(write()).toBe(false)
  })

  it('pushes on the first write of a pointer drag and skips the rest', () => {
    const { on, write } = gesture()

    on().onPointerDown()

    expect(write()).toBe(false)
    expect(write()).toBe(true)
    expect(write()).toBe(true)
  })

  it('starts a new entry for the next drag, after the release', () => {
    const { on, write } = gesture()

    on().onPointerDown()
    write()
    write()
    on().onPointerUp()
    on().onPointerDown()

    expect(write()).toBe(false)
  })

  it('leaves the gesture closed after a release, so a stray write still pushes', () => {
    const { on, write } = gesture()

    on().onPointerDown()
    write()
    on().onPointerUp()

    expect(write()).toBe(false)
  })

  it('treats a key press and its repetitions as one gesture', () => {
    const { on, write } = gesture()

    on().onKeyDown({ repeat: false })
    expect(write()).toBe(false)

    // The browser fires keydown again for every repetition while the key is
    // held. Each brings one more input event, and all of them belong to the
    // entry the first write pushed.
    on().onKeyDown({ repeat: true })
    expect(write()).toBe(true)
    on().onKeyDown({ repeat: true })
    expect(write()).toBe(true)
  })

  it('opens a gesture on a repeat whose first press it never saw', () => {
    const { on, write } = gesture()

    // Focus can arrive mid-hold, so a repeat is also a valid way to start: it
    // opens the gesture and the first write still pushes.
    on().onKeyDown({ repeat: true })

    expect(write()).toBe(false)
    expect(write()).toBe(true)
  })

  it('ends the gesture on keyup', () => {
    const { on, write } = gesture()

    on().onKeyDown({ repeat: false })
    write()
    on().onKeyUp()

    expect(write()).toBe(false)
  })

  it('ends the gesture when the pointer is cancelled', () => {
    const { on, write } = gesture()

    on().onPointerDown()
    write()
    // A cancelled touch or pen gesture gets no `pointerup` at all. Without
    // this the gesture stayed open with its entry already pushed, and the next
    // write — which reaches a handler with no press of its own — was told to
    // skip, losing its undo entry.
    on().onPointerCancel()

    expect(write()).toBe(false)
  })

  it('ends the gesture on blur, for a press whose release never arrives', () => {
    const { on, write } = gesture()

    on().onPointerDown()
    write()
    on().onBlur()

    expect(write()).toBe(false)
  })

  it('keeps one identity for the listeners across renders', () => {
    const { result, rerender } = renderHook(() => useSliderGesture())
    const first = result.current

    rerender()

    // The sections spread these onto their inputs; a fresh object per render
    // would make every slider's props change on every render of the panel.
    expect(result.current.handlers).toBe(first.handlers)
    expect(result.current.skipHistoryForWrite).toBe(first.skipHistoryForWrite)
  })
})
