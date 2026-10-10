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

// Two sliders on the panel. The hook is one instance for every slider it is
// spread onto, so which element an event came from — its `currentTarget` — is
// how it tells them apart (ESCSUITE-267). Every case that is about one slider
// uses `A`.
const A = new EventTarget()
const B = new EventTarget()

/** A pointer or focus event from `target`, carrying only what the hook reads. */
const at = (target: EventTarget) => ({ currentTarget: target })

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

    on().onPointerDown(at(A))

    expect(write()).toBe(false)
    expect(write()).toBe(true)
    expect(write()).toBe(true)
  })

  it('gives the next write the push when the first one was refused', () => {
    const { on, write, refusedWrite } = gesture()

    on().onPointerDown(at(A))

    // The clip's track was locked when this write reached the store, so it
    // wrote nothing and pushed nothing — the gesture still owes an entry
    // (ESCSUITE-87).
    expect(refusedWrite()).toBe(false)
    expect(write()).toBe(false)
    expect(write()).toBe(true)
  })

  it('hands the answer of the write back to the caller', () => {
    const { on, commit } = gesture()

    on().onPointerDown(at(A))

    expect(commit(true)).toBe(true)
    expect(commit(false)).toBe(false)
  })

  it('starts a new entry for the next drag, after the release', () => {
    const { on, write } = gesture()

    on().onPointerDown(at(A))
    write()
    write()
    on().onPointerUp(at(A))
    on().onPointerDown(at(A))

    expect(write()).toBe(false)
  })

  it('leaves the gesture closed after a release, so a stray write still pushes', () => {
    const { on, write } = gesture()

    on().onPointerDown(at(A))
    write()
    on().onPointerUp(at(A))

    expect(write()).toBe(false)
  })

  it('treats a key press and its repetitions as one gesture', () => {
    const { on, write } = gesture()

    on().onKeyDown({ repeat: false, key: 'ArrowRight', currentTarget: A })
    expect(write()).toBe(false)

    // The browser fires keydown again for every repetition while the key is
    // held. Each brings one more input event, and all of them belong to the
    // entry the first write pushed.
    on().onKeyDown({ repeat: true, key: 'ArrowRight', currentTarget: A })
    expect(write()).toBe(true)
    on().onKeyDown({ repeat: true, key: 'ArrowRight', currentTarget: A })
    expect(write()).toBe(true)
  })

  it('opens a gesture on a repeat whose first press it never saw', () => {
    const { on, write } = gesture()

    // Focus can arrive mid-hold, so a repeat is also a valid way to start: it
    // opens the gesture and the first write still pushes.
    on().onKeyDown({ repeat: true, key: 'ArrowRight', currentTarget: A })

    expect(write()).toBe(false)
    expect(write()).toBe(true)
  })

  it('ends the gesture on keyup', () => {
    const { on, write } = gesture()

    on().onKeyDown({ repeat: false, key: 'ArrowRight', currentTarget: A })
    write()
    on().onKeyUp({ key: 'ArrowRight', currentTarget: A })

    expect(write()).toBe(false)
  })

  it('ends the gesture when the pointer is cancelled', () => {
    const { on, write } = gesture()

    on().onPointerDown(at(A))
    write()
    // A cancelled touch or pen gesture gets no `pointerup` at all. Without
    // this the gesture stayed open with its entry already pushed, and the next
    // write — which reaches a handler with no press of its own — was told to
    // skip, losing its undo entry.
    on().onPointerCancel(at(A))

    expect(write()).toBe(false)
  })

  it('ends the gesture on blur, for a press whose release never arrives', () => {
    const { on, write } = gesture()

    on().onPointerDown(at(A))
    write()
    on().onBlur(at(A))

    expect(write()).toBe(false)
  })

  it('does not begin a gesture for a key the range input does not act on (ESCSUITE-169)', () => {
    // Shift reaches the input too, but a range input does nothing with it on
    // its own; treating it as the start of a gesture is the bug this fixes —
    // in the full sequence below it reset the "have I pushed?" flag mid an
    // already-open pointer drag.
    const { on, write } = gesture()

    on().onKeyDown({ repeat: false, key: 'Shift', currentTarget: A })

    expect(write()).toBe(false)
  })

  it('does not end a keyboard gesture on a key the range input does not act on (ESCSUITE-169)', () => {
    const { on, write } = gesture()

    on().onKeyDown({ repeat: false, key: 'ArrowRight', currentTarget: A })
    write()
    on().onKeyUp({ key: 'Shift', currentTarget: A })

    // Still part of the arrow key's gesture: Shift's keyup must not have
    // closed it.
    expect(write()).toBe(true)
  })

  it('still ends the gesture on the arrow key that opened it', () => {
    const { on, write } = gesture()

    on().onKeyDown({ repeat: false, key: 'ArrowRight', currentTarget: A })
    write()
    on().onKeyUp({ key: 'ArrowRight', currentTarget: A })

    expect(write()).toBe(false)
  })

  it('ignores a keydown while a pointer drag owns the gesture (ESCSUITE-169)', () => {
    const { on, write } = gesture()

    on().onPointerDown(at(A))
    write()
    // A real arrow key reaching the input while the mouse is still dragging
    // it must not reopen the "have I pushed?" flag the pointer drag is
    // already carrying.
    on().onKeyDown({ repeat: false, key: 'ArrowRight', currentTarget: A })

    expect(write()).toBe(true)
  })

  it('ignores a keyup while a pointer drag owns the gesture (ESCSUITE-169)', () => {
    const { on, write } = gesture()

    on().onPointerDown(at(A))
    write()
    on().onKeyUp({ key: 'ArrowRight', currentTarget: A })

    expect(write()).toBe(true)
  })

  it('leaves a pointer drag open through a full Shift tap mid-drag (ESCSUITE-169)', () => {
    // The exact reported shape: a Shift tap — keydown then keyup — while the
    // mouse is still holding a slider's pointer drag open.
    const { on, write } = gesture()

    on().onPointerDown(at(A))
    write()
    on().onKeyDown({ repeat: false, key: 'Shift', currentTarget: A })
    on().onKeyUp({ key: 'Shift', currentTarget: A })

    expect(write()).toBe(true)
  })

  it('resets the pointer flag on blur, so a later keyboard nudge groups its own held key (ESCSUITE-169 review round 1)', () => {
    // `onBlur` is the substitute for a pointerup that never arrives — but it
    // has to give the gesture back to the keyboard too. Leaving
    // `pointerDownRef` stuck `true` made every later `onKeyDown`/`onKeyUp`
    // short-circuit on the pointer guard before ever reaching `RANGE_KEYS` or
    // `begin`/`resume` — so a held arrow key pressed after the blur pushed one
    // undo entry per repeated keystroke instead of one for the whole hold,
    // the exact regression ESCSUITE-75 exists to prevent.
    const { on, write } = gesture()

    on().onPointerDown(at(A))
    on().onBlur(at(A))

    on().onKeyDown({ repeat: false, key: 'ArrowRight', currentTarget: A })
    expect(write()).toBe(false)
    // The held key's repeat must continue the SAME gesture, not open one of
    // its own.
    on().onKeyDown({ repeat: true, key: 'ArrowRight', currentTarget: A })
    expect(write()).toBe(true)
  })

  describe('a gesture belongs to the slider that opened it (ESCSUITE-267)', () => {
    it('keeps B\'s drag open when A, which still had focus, blurs after it', () => {
      // The reported shape: A holds focus, the user presses B. The browser
      // fires B's pointerdown and THEN A's blur, and A's blur used to end the
      // gesture B had just opened — so B's whole drag ran with no gesture and
      // pushed one entry per move.
      const { on, write } = gesture()

      on().onPointerDown(at(B))
      expect(write()).toBe(false)
      for (let i = 1; i < 20; i++) expect(write()).toBe(true)

      on().onBlur(at(A))

      // Still B's gesture: the 21st write joins the entry the first pushed.
      expect(write()).toBe(true)
    })

    it('keeps B\'s drag open when A\'s blur lands between the press and the first move', () => {
      // The order a browser really delivers: B's pointerdown, A's blur, then
      // B's input events.
      const { on, write } = gesture()

      on().onPointerDown(at(B))
      on().onBlur(at(A))

      expect(write()).toBe(false)
      expect(write()).toBe(true)
      expect(write()).toBe(true)
    })

    it('still ends a drag on the blur of the slider that owns it (ESCSUITE-169)', () => {
      const { on, write } = gesture()

      on().onPointerDown(at(A))
      write()
      on().onBlur(at(A))

      expect(write()).toBe(false)
    })

    it('gives a press on B while A\'s drag is open its own entry', () => {
      const { on, write } = gesture()

      on().onPointerDown(at(A))
      expect(write()).toBe(false)
      expect(write()).toBe(true)

      on().onPointerDown(at(B))
      expect(write()).toBe(false)
      expect(write()).toBe(true)
      on().onPointerUp(at(B))

      // Two drags, two entries: one pushed by each first write.
      expect(write()).toBe(false)
    })

    it('ignores a release from a slider that does not own the gesture', () => {
      const { on, write } = gesture()

      on().onPointerDown(at(B))
      write()
      on().onPointerUp(at(A))

      expect(write()).toBe(true)
    })

    it('ignores a pointer cancel from a slider that does not own the gesture', () => {
      const { on, write } = gesture()

      on().onPointerDown(at(B))
      write()
      on().onPointerCancel(at(A))

      expect(write()).toBe(true)

      // The owner's own cancel still ends it.
      on().onPointerCancel(at(B))
      expect(write()).toBe(false)
    })

    it('closes A\'s arrow-key run and opens B\'s on a keydown on B', () => {
      const { on, write } = gesture()

      on().onKeyDown({ repeat: false, key: 'ArrowRight', currentTarget: A })
      expect(write()).toBe(false)
      on().onKeyDown({ repeat: true, key: 'ArrowRight', currentTarget: A })
      expect(write()).toBe(true)

      on().onKeyDown({ repeat: false, key: 'ArrowLeft', currentTarget: B })
      expect(write()).toBe(false)
      // A's keyup arriving late is not B's: B's run is still open.
      on().onKeyUp({ key: 'ArrowRight', currentTarget: A })
      expect(write()).toBe(true)

      on().onKeyUp({ key: 'ArrowLeft', currentTarget: B })
      expect(write()).toBe(false)
    })

    it('opens B\'s own gesture on a repeat from B while A\'s run is open', () => {
      // A repeat continues the gesture of the slider it repeats on. From a
      // slider that does not own the open gesture it is a press of its own —
      // resuming A's gesture would have folded B's first value into A's entry.
      const { on, write } = gesture()

      on().onKeyDown({ repeat: false, key: 'ArrowRight', currentTarget: A })
      expect(write()).toBe(false)

      on().onKeyDown({ repeat: true, key: 'ArrowRight', currentTarget: B })
      expect(write()).toBe(false)
      on().onKeyDown({ repeat: true, key: 'ArrowRight', currentTarget: B })
      expect(write()).toBe(true)
    })
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
