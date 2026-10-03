// `skipHistory` on the two keyframe actions the keyframe graph writes through.
//
// The flag exists so a *held* arrow key is one undo step rather than one per
// auto-repeat: the first keydown pushes the snapshot taken before the run, and
// every repeat after it edits the project without spending another of
// MAX_HISTORY_SIZE's 50 slots. It is the same mechanism — and deliberately the
// same shape — as `updateClipTransform`'s flag, which keeps a preview drag to
// one entry.
//
// A separate file from projectStore.keyframes.test.ts so that suite stays as it
// was; this one is only about what reaches `history`.
import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './projectStore'
import { addClip, resetStoreForTest, store } from '../test/fixtures/projectStore'
import type { Clip } from './types'

const opacityKeyframes = () =>
  (store().project.timeline.clips[0] as Clip).animation!.keyframes.opacity!

/**
 * An empty undo stack and an unstamped project, so "pushed one entry" and
 * "stamped modified" are both assertable without depending on the clock: the
 * actions write `Date.now()`, which is only ever greater than zero.
 */
function clearHistoryAndModified(): void {
  useEditorStore.setState((state) => ({
    history: { past: [], future: [] },
    project: { ...state.project, modified: 0 },
  }))
}

describe('keyframe actions and the undo stack', () => {
  beforeEach(() => {
    resetStoreForTest()
    addClip('clip1', 0, 4)
  })

  describe('setClipKeyframe', () => {
    it('pushes exactly one history entry without the flag', () => {
      clearHistoryAndModified()

      store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'linear' })

      expect(store().history.past).toHaveLength(1)
    })

    it('writes the keyframe and stamps modified, but pushes nothing, with skipHistory', () => {
      clearHistoryAndModified()

      store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'linear' }, true)

      expect(store().history.past).toHaveLength(0)
      // The edit itself is untouched, auto-created 0s keyframe included.
      expect(opacityKeyframes()).toEqual([
        { time: 0, value: 1, easing: 'ease-out' },
        { time: 1, value: 0.5, easing: 'linear' },
      ])
      expect(store().project.modified).toBeGreaterThan(0)
    })
  })

  describe('moveClipKeyframe', () => {
    beforeEach(() => {
      store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'linear' })
      clearHistoryAndModified()
    })

    it('pushes exactly one history entry without the flag', () => {
      store().moveClipKeyframe('clip1', 'opacity', 1, 2)

      expect(store().history.past).toHaveLength(1)
      expect(opacityKeyframes().map((kf) => kf.time)).toEqual([0, 2])
    })

    it('moves the keyframe and stamps modified, but pushes nothing, with skipHistory', () => {
      store().moveClipKeyframe('clip1', 'opacity', 1, 2, true)

      expect(store().history.past).toHaveLength(0)
      expect(opacityKeyframes().map((kf) => kf.time)).toEqual([0, 2])
      expect(store().project.modified).toBeGreaterThan(0)
    })
  })

  describe('a locked track (ESCSUITE-84)', () => {
    const past = () => useEditorStore.getState().history.past.length
    const clipsRef = () => useEditorStore.getState().project.timeline.clips

    const lock = () => {
      const trackId = store().project.timeline.clips[0].trackId
      store().updateTrack(trackId, { locked: true })
    }

    /** Assert the action wrote nothing: same clips array, no history entry. */
    const refuses = (act: () => void) => {
      const before = clipsRef(); const entries = past()
      act()
      expect(clipsRef()).toBe(before)
      expect(past()).toBe(entries)
    }

    it('refuses to set a keyframe on a clip on it, and says so', () => {
      lock()

      // ESCSUITE-87: `false` back to the caller. The keyframe graph's keyboard
      // threads `skipHistory` into its later writes, so it has to be able to
      // tell a refusal from a write.
      refuses(() => expect(
        store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'linear' })
      ).toBe(false))
    })

    it('refuses to remove a keyframe on a clip on it, and says so', () => {
      store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'linear' })
      lock()

      // ESCSUITE-88 brought this one into ESCSUITE-87's contract: the keyframe
      // graph's Delete key announces the removal, so it has to be able to tell a
      // refusal from a write.
      refuses(() => expect(store().removeClipKeyframe('clip1', 'opacity', 1)).toBe(false))
      expect(opacityKeyframes().map((kf) => kf.time)).toEqual([0, 1])
    })

    it('refuses to move a keyframe on a clip on it, and says so', () => {
      store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'linear' })
      lock()

      refuses(() => expect(store().moveClipKeyframe('clip1', 'opacity', 1, 2)).toBe(false))
      expect(opacityKeyframes().map((kf) => kf.time)).toEqual([0, 1])
    })

    it('reports true for the three that wrote (ESCSUITE-87, ESCSUITE-88)', () => {
      expect(
        store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'linear' })
      ).toBe(true)
      expect(store().moveClipKeyframe('clip1', 'opacity', 1, 2)).toBe(true)
      expect(store().removeClipKeyframe('clip1', 'opacity', 2)).toBe(true)
    })

    it('refuses to clear the keyframes of a clip on it, and says so', () => {
      store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'linear' })
      lock()

      // Fix round 1: clearClipKeyframes now reports ESCSUITE-87's boolean too.
      refuses(() => expect(store().clearClipKeyframes('clip1')).toBe(false))
      expect(opacityKeyframes().map((kf) => kf.time)).toEqual([0, 1])
    })
  })

  describe('removeClipKeyframe with nothing to remove (ESCSUITE-101)', () => {
    const past = () => useEditorStore.getState().history.past.length
    const clipsRef = () => useEditorStore.getState().project.timeline.clips

    beforeEach(() => {
      store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'linear' })
      clearHistoryAndModified()
    })

    /** Assert the call answered false and wrote nothing: same clips array, no history entry. */
    const refusesFalse = (act: () => boolean) => {
      const before = clipsRef(); const entries = past()
      expect(act()).toBe(false)
      expect(clipsRef()).toBe(before)
      expect(past()).toBe(entries)
    }

    it('refuses for an unknown clip id', () => {
      refusesFalse(() => store().removeClipKeyframe('no-such-clip', 'opacity', 1))
    })

    it('refuses for a clip that exists but has no animation at all', () => {
      addClip('clip2', 6, 2) // never had setClipKeyframe called on it — animation is undefined
      refusesFalse(() => store().removeClipKeyframe('clip2', 'opacity', 0))
    })

    it('refuses for a property the clip has no keyframes on', () => {
      refusesFalse(() => store().removeClipKeyframe('clip1', 'scaleX', 1))
    })

    it('refuses for a time with no keyframe (outside KEYFRAME_TIME_EPSILON)', () => {
      refusesFalse(() => store().removeClipKeyframe('clip1', 'opacity', 5))
      // The keyframes that DO exist are untouched.
      expect(opacityKeyframes().map((kf) => kf.time)).toEqual([0, 1])
    })

    it('still removes, and reports true, for a keyframe that actually exists', () => {
      expect(store().removeClipKeyframe('clip1', 'opacity', 1)).toBe(true)
      expect(opacityKeyframes().map((kf) => kf.time)).toEqual([0])
      expect(past()).toBe(1)
    })
  })

  describe('moveClipKeyframe with nothing to move (ESCSUITE-163 / m2)', () => {
    const past = () => useEditorStore.getState().history.past.length
    const clipsRef = () => useEditorStore.getState().project.timeline.clips

    beforeEach(() => {
      store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'linear' })
      clearHistoryAndModified()
    })

    /** Assert the call answered false and wrote nothing: same clips array, no history entry. */
    const refusesFalse = (act: () => boolean) => {
      const before = clipsRef(); const entries = past()
      expect(act()).toBe(false)
      expect(clipsRef()).toBe(before)
      expect(past()).toBe(entries)
    }

    it('refuses for an unknown clip id', () => {
      refusesFalse(() => store().moveClipKeyframe('no-such-clip', 'opacity', 1, 2))
    })

    it('refuses for a clip that exists but has no animation at all', () => {
      addClip('clip2', 6, 2) // never had setClipKeyframe called on it — animation is undefined
      refusesFalse(() => store().moveClipKeyframe('clip2', 'opacity', 0, 1))
    })

    it('refuses for a property the clip has no keyframes on', () => {
      refusesFalse(() => store().moveClipKeyframe('clip1', 'scaleX', 1, 2))
    })

    it('refuses for an originalTime with no keyframe (outside KEYFRAME_TIME_EPSILON)', () => {
      refusesFalse(() => store().moveClipKeyframe('clip1', 'opacity', 5, 6))
      // The keyframes that DO exist are untouched.
      expect(opacityKeyframes().map((kf) => kf.time)).toEqual([0, 1])
    })

    it('still moves, and reports true, for a keyframe that actually exists', () => {
      expect(store().moveClipKeyframe('clip1', 'opacity', 1, 2)).toBe(true)
      expect(opacityKeyframes().map((kf) => kf.time)).toEqual([0, 2])
      expect(past()).toBe(1)
    })
  })

  // ESCSUITE-172: `setClipKeyframe` is the same map-and-set shape as the two
  // actions above, and an id that names no clip used to match nothing in the
  // `map` while the `set` ran anyway — a stamped `modified` and an undo entry
  // for an edit that touched nothing. (`moveClipKeyframe`'s unknown-id refusal
  // is pinned in the ESCSUITE-163 block above.)
  describe('setClipKeyframe with an unknown clip id (ESCSUITE-172)', () => {
    const past = () => useEditorStore.getState().history.past.length
    const clipsRef = () => useEditorStore.getState().project.timeline.clips

    beforeEach(() => {
      clearHistoryAndModified()
    })

    it('refuses, writes nothing and pushes no undo entry', () => {
      const before = clipsRef(); const entries = past()
      expect(store().setClipKeyframe('no-such-clip', 'opacity', { time: 1, value: 0.5, easing: 'linear' })).toBe(false)
      expect(clipsRef()).toBe(before)
      expect(past()).toBe(entries)
    })
  })


  // Fix round 1: clearClipKeyframes had the identical map-and-set shape with
  // NO existence check at all — not even splitClip/duplicateClip's
  // `if (!clip) return state`. It now refuses for the same two reasons
  // removeClipKeyframe does (ESCSUITE-101): an unknown clip, and a clip that
  // exists but has no animation at all — there is nothing to clear either way.
  describe('clearClipKeyframes with nothing to clear (ESCSUITE-172)', () => {
    const past = () => useEditorStore.getState().history.past.length
    const clipsRef = () => useEditorStore.getState().project.timeline.clips

    beforeEach(() => {
      clearHistoryAndModified()
    })

    /** Assert the call answered false and wrote nothing: same clips array, no history entry. */
    const refusesFalse = (act: () => boolean) => {
      const before = clipsRef(); const entries = past()
      expect(act()).toBe(false)
      expect(clipsRef()).toBe(before)
      expect(past()).toBe(entries)
    }

    it('refuses for an unknown clip id', () => {
      refusesFalse(() => store().clearClipKeyframes('no-such-clip'))
    })

    it('refuses for a clip that exists but has no animation at all', () => {
      addClip('clip2', 6, 2) // never had setClipKeyframe called on it — animation is undefined
      refusesFalse(() => store().clearClipKeyframes('clip2'))
    })

    it('still clears, and reports true, for a clip that has keyframes', () => {
      store().setClipKeyframe('clip1', 'opacity', { time: 1, value: 0.5, easing: 'linear' })
      clearHistoryAndModified()

      expect(store().clearClipKeyframes('clip1')).toBe(true)
      expect(store().project.timeline.clips[0].animation?.keyframes.opacity).toBeUndefined()
      expect(past()).toBe(1)
    })
  })
})
