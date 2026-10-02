// The slider gesture's contract, read directly (ESCSUITE-75, ESCSUITE-87).
//
// `ClipEditor.sliderHistory.test.tsx` proves the rule end to end, through the
// real panel and the real store. This file states it as the hook's own contract,
// so the answer for a given event sequence can be read without a DOM: which
// writes are told to skip history, and which are not.
//
// The shared mechanism's own contract — what a *refused* write does to the flag
// — is `hooks/useGestureHistory.test.ts`. What this file adds is the mapping
// from DOM events to `begin`/`resume`/`end`, and one refusal case to prove the
// hook really delegates rather than keeping a flag of its own.
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSliderGesture } from './useSliderGesture'

/** The hook, plus a shorthand for "what would the next write be told?". */
function gesture() {
  const { result } = renderHook(() => useSliderGesture())
  return {
    /** The listeners a slider would carry. */
    on: () => result.current.handlers,
    /** One write that lands: the `skipHistory` flag it is handed. */
    write: () => {
      let seen = false
      result.current.commit((skipHistory) => {
        seen = skipHistory
        return true
      })
      return seen
    },
    /** One write the store refused: the flag it was handed. */
    refusedWrite: () => {
      let seen = false
      result.current.commit((skipHistory) => {
        seen = skipHistory
        return false
      })
      return seen
    },
    /** `commit`'s own return value, for a write that answers `answer`. */
    commit: (answer: boolean) => result.current.commit(() => answer),
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

  it('gives the next write the push when the first one was refused', () => {
    const { on, write, refusedWrite } = gesture()

    on().onPointerDown()

    // The clip's track was locked when this write reached the store, so it
    // wrote nothing and pushed nothing — the gesture still owes an entry
    // (ESCSUITE-87).
    expect(refusedWrite()).toBe(false)
    expect(write()).toBe(false)
    expect(write()).toBe(true)
  })

  it('hands the answer of the write back to the caller', () => {
    const { on, commit } = gesture()

    on().onPointerDown()

    expect(commit(true)).toBe(true)
    expect(commit(false)).toBe(false)
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

    on().onKeyDown({ repeat: false, key: 'ArrowRight' })
    expect(write()).toBe(false)

    // The browser fires keydown again for every repetition while the key is
    // held. Each brings one more input event, and all of them belong to the
    // entry the first write pushed.
    on().onKeyDown({ repeat: true, key: 'ArrowRight' })
    expect(write()).toBe(true)
    on().onKeyDown({ repeat: true, key: 'ArrowRight' })
    expect(write()).toBe(true)
  })

  it('opens a gesture on a repeat whose first press it never saw', () => {
    const { on, write } = gesture()

    // Focus can arrive mid-hold, so a repeat is also a valid way to start: it
    // opens the gesture and the first write still pushes.
    on().onKeyDown({ repeat: true, key: 'ArrowRight' })

    expect(write()).toBe(false)
    expect(write()).toBe(true)
  })

  it('ends the gesture on keyup', () => {
    const { on, write } = gesture()

    on().onKeyDown({ repeat: false, key: 'ArrowRight' })
    write()
    on().onKeyUp({ key: 'ArrowRight' })

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

  it('does not begin a gesture for a key the range input does not act on (ESCSUITE-169)', () => {
    // Shift reaches the input too, but a range input does nothing with it on
    // its own; treating it as the start of a gesture is the bug this fixes —
    // in the full sequence below it reset the "have I pushed?" flag mid an
    // already-open pointer drag.
    const { on, write } = gesture()

    on().onKeyDown({ repeat: false, key: 'Shift' })

    expect(write()).toBe(false)
  })

  it('does not end a keyboard gesture on a key the range input does not act on (ESCSUITE-169)', () => {
    const { on, write } = gesture()

    on().onKeyDown({ repeat: false, key: 'ArrowRight' })
    write()
    on().onKeyUp({ key: 'Shift' })

    // Still part of the arrow key's gesture: Shift's keyup must not have
    // closed it.
    expect(write()).toBe(true)
  })

  it('still ends the gesture on the arrow key that opened it', () => {
    const { on, write } = gesture()

    on().onKeyDown({ repeat: false, key: 'ArrowRight' })
    write()
    on().onKeyUp({ key: 'ArrowRight' })

    expect(write()).toBe(false)
  })

  it('ignores a keydown while a pointer drag owns the gesture (ESCSUITE-169)', () => {
    const { on, write } = gesture()

    on().onPointerDown()
    write()
    // A real arrow key reaching the input while the mouse is still dragging
    // it must not reopen the "have I pushed?" flag the pointer drag is
    // already carrying.
    on().onKeyDown({ repeat: false, key: 'ArrowRight' })

    expect(write()).toBe(true)
  })

  it('ignores a keyup while a pointer drag owns the gesture (ESCSUITE-169)', () => {
    const { on, write } = gesture()

    on().onPointerDown()
    write()
    on().onKeyUp({ key: 'ArrowRight' })

    expect(write()).toBe(true)
  })

  it('leaves a pointer drag open through a full Shift tap mid-drag (ESCSUITE-169)', () => {
    // The exact reported shape: a Shift tap — keydown then keyup — while the
    // mouse is still holding a slider's pointer drag open.
    const { on, write } = gesture()

    on().onPointerDown()
    write()
    on().onKeyDown({ repeat: false, key: 'Shift' })
    on().onKeyUp({ key: 'Shift' })

    expect(write()).toBe(true)
  })

  it('keeps one identity for the listeners across renders', () => {
    const { result, rerender } = renderHook(() => useSliderGesture())
    const first = result.current

    rerender()

    // The sections spread these onto their inputs; a fresh object per render
    // would make every slider's props change on every render of the panel.
    expect(result.current.handlers).toBe(first.handlers)
    expect(result.current.commit).toBe(first.commit)
  })
})
