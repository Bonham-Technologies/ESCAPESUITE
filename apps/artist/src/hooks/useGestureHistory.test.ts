// One gesture, one undo entry — and the entry follows the write that LANDED
// (ESCSUITE-87).
//
// The rule ESCSUITE-52/75/77/79 set is that a gesture's first store write
// pushes the undo entry and every write after it passes `skipHistory`. That
// assumed the first write landed. Since ESCSUITE-84 it may not: a clip on a
// locked track refuses the write and pushes nothing, so a gesture that had
// already marked itself "pushed" would hand `skipHistory` to the write that
// does land and leave the whole gesture off the undo stack.
//
// This file is that mechanism's contract, stated without a DOM: which flag a
// given sequence of commits is handed, and what a refusal does to it.
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createGestureHistory, useGestureHistory } from './useGestureHistory'

/** A write that lands, recording the flag it was handed. */
const wrote = (seen: boolean[]) => (skipHistory: boolean) => {
  seen.push(skipHistory)
  return true
}

/** A write the store refused, recording the flag it was handed. */
const refused = (seen: boolean[]) => (skipHistory: boolean) => {
  seen.push(skipHistory)
  return false
}

describe('createGestureHistory', () => {
  it('tells a write outside any gesture to push its own entry', () => {
    const history = createGestureHistory()
    const seen: boolean[] = []

    history.commit(wrote(seen))
    history.commit(wrote(seen))

    expect(seen).toEqual([false, false])
  })

  it('pushes on the first write of a gesture and skips the rest', () => {
    const history = createGestureHistory()
    const seen: boolean[] = []

    history.begin()
    history.commit(wrote(seen))
    history.commit(wrote(seen))
    history.commit(wrote(seen))

    expect(seen).toEqual([false, true, true])
  })

  it('gives the next write the push when the first one was refused', () => {
    const history = createGestureHistory()
    const seen: boolean[] = []

    history.begin()
    // The clip's track is locked: the store wrote nothing and pushed nothing.
    history.commit(refused(seen))
    // So this write is still the gesture's first *landed* one, and the entry
    // is still owed.
    history.commit(wrote(seen))
    history.commit(wrote(seen))

    expect(seen).toEqual([false, false, true])
  })

  it('keeps the entry owed however many writes in a row are refused', () => {
    const history = createGestureHistory()
    const seen: boolean[] = []

    history.begin()
    history.commit(refused(seen))
    history.commit(refused(seen))
    history.commit(refused(seen))
    history.commit(wrote(seen))

    expect(seen).toEqual([false, false, false, false])
  })

  it('does not un-push the entry when a LATER write is refused', () => {
    const history = createGestureHistory()
    const seen: boolean[] = []

    history.begin()
    history.commit(wrote(seen))
    // This one skipped, so it never held the entry: a refusal here leaves the
    // entry the first write pushed exactly where it is.
    history.commit(refused(seen))
    history.commit(wrote(seen))

    expect(seen).toEqual([false, true, true])
  })

  it('returns what the write returned', () => {
    const history = createGestureHistory()

    history.begin()
    expect(history.commit(() => true)).toBe(true)
    expect(history.commit(() => false)).toBe(false)
  })

  it('remembers nothing about a refusal outside a gesture', () => {
    const history = createGestureHistory()
    const seen: boolean[] = []

    history.commit(refused(seen))
    history.commit(wrote(seen))

    expect(seen).toEqual([false, false])
  })

  it('owes the next gesture its own entry', () => {
    const history = createGestureHistory()
    const seen: boolean[] = []

    history.begin()
    history.commit(wrote(seen))
    history.end()
    history.begin()
    history.commit(wrote(seen))

    expect(seen).toEqual([false, false])
  })

  it('leaves a stray write after the end of a gesture pushing its own entry', () => {
    const history = createGestureHistory()
    const seen: boolean[] = []

    history.begin()
    history.commit(wrote(seen))
    history.end()
    history.commit(wrote(seen))

    expect(seen).toEqual([false, false])
  })

  it('carries the pushed mark across a resume', () => {
    const history = createGestureHistory()
    const seen: boolean[] = []

    history.begin()
    history.commit(wrote(seen))
    // A key that is still down: the gesture continues, and the entry it has
    // already pushed is not owed twice.
    history.resume()
    history.commit(wrote(seen))

    expect(seen).toEqual([false, true])
  })

  it('opens a gesture on a resume it never saw the start of', () => {
    const history = createGestureHistory()
    const seen: boolean[] = []

    // Focus can arrive mid-hold, so a resume is also a valid way to start.
    history.resume()
    history.commit(wrote(seen))
    history.commit(wrote(seen))

    expect(seen).toEqual([false, true])
  })

  it('keeps the entry owed when the first write throws', () => {
    const history = createGestureHistory()
    const seen: boolean[] = []
    const boom = () => {
      throw new Error('boom')
    }

    history.begin()
    // A write that threw wrote nothing and pushed nothing, and the throw is on
    // its way out of the gesture rather than ending it — the entry is still
    // owed, exactly as after a refusal.
    expect(() => history.commit(boom)).toThrow('boom')
    history.commit(wrote(seen))

    expect(seen).toEqual([false])
  })

  it('leaves an already-pushed entry alone when a later write throws', () => {
    const history = createGestureHistory()
    const seen: boolean[] = []
    const boom = () => {
      throw new Error('boom')
    }

    history.begin()
    history.commit(wrote(seen))
    expect(() => history.commit(boom)).toThrow('boom')
    history.commit(wrote(seen))

    expect(seen).toEqual([false, true])
  })

  it('runs the write exactly once per commit', () => {
    const history = createGestureHistory()
    const write = vi.fn(() => true)

    history.begin()
    history.commit(write)

    expect(write).toHaveBeenCalledTimes(1)
  })
})

describe('useGestureHistory', () => {
  it('holds one history for the life of the component', () => {
    const { result, rerender } = renderHook(() => useGestureHistory())
    const first = result.current

    rerender()

    // The gesture's state lives in this object; a fresh one per render would
    // forget mid-drag whether the entry had been pushed — and the hooks that
    // hand `commit` to memoised callbacks take its identity as a dependency.
    expect(result.current).toBe(first)
  })

  it('is a gesture history like any other', () => {
    const { result } = renderHook(() => useGestureHistory())
    const seen: boolean[] = []

    result.current.begin()
    result.current.commit(wrote(seen))
    result.current.commit(wrote(seen))

    expect(seen).toEqual([false, true])
  })
})
