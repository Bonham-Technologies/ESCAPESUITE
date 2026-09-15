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
})
