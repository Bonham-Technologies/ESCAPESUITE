// Property test for "Remove silences" (ESCSUITE-403), on the ESCSUITE-349
// invariants.
//
// fast-check places a take recorded as separate tracks (a screen part and a
// microphone captured up to a second late, both from the timeline model's
// fixture sources), optionally cuts it and puts other clips on its rows and on
// a row of their own, then removes a random set of time ranges from one of the
// take's clips. After the cut every invariant `checkInvariants` holds (no two
// clips on a row overlap, every clip inside its media, the duration the last
// clip end, each clip's own audio in step with its picture) and the undo/redo
// identity, plus what this edit adds:
//
// - the take's parts stay aligned: every piece plays the source it played
//   before, at the timeline time the cut maps that time to, so two linked
//   pieces still play the same instant of the take together;
// - the pieces linked to each other sit between the same two cuts;
// - rows outside the take are untouched;
// - one undo restores the project exactly.
import { beforeEach, describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { useEditorStore } from '../projectStore'
import { SOURCES, checkInvariants, checkUndoRedoIdentity, resetModel } from '../../test/timelineModel'
import { normaliseRanges } from '../rippleRanges'
import type { Clip } from '../types'
import type { TimeRange } from '../../core/silenceDetection'

const state = () => useEditorStore.getState()
const SCREEN = SOURCES.find((s) => s.id === 'pv-a')! // 10 s video with sound
const MIC = SOURCES.find((s) => s.id === 'pv-c')! // 4.5 s audio
const OTHER = SOURCES.find((s) => s.id === 'pv-b')!

/** Quarter seconds (edges meet exactly) or an inexact decimal. */
const time = (max: number) =>
  fc.oneof(
    fc.integer({ min: 0, max: max * 4 }).map((q) => q / 4),
    fc.integer({ min: 0, max: max * 100_000 }).map((n) => n / 100_000)
  )

const scenario = fc.record({
  micOffset: fc.integer({ min: 0, max: 100 }).map((n) => n / 100),
  takeAt: time(4),
  splits: fc.array(fc.integer({ min: 1, max: 99 }).map((n) => n / 100), { maxLength: 2 }),
  /** A clip after the take on its screen row, and one on a row of its own. */
  tail: fc.option(time(6), { nil: undefined }),
  elsewhere: fc.option(time(10), { nil: undefined }),
  target: fc.nat({ max: 20 }),
  ranges: fc.array(fc.tuple(time(16), fc.integer({ min: 1, max: 300 }).map((n) => n / 100)), { minLength: 1, maxLength: 6 }),
})

/** The time `ranges` (normalised) take out before `t`. */
function removedBefore(ranges: TimeRange[], t: number): number {
  return ranges.reduce((sum, r) => (r.start >= t ? sum : sum + Math.min(t, r.end) - r.start), 0)
}

const EPS = 1e-6

describe('Remove silences (property-based, ESCSUITE-403)', () => {
  beforeEach(() => resetModel())

  it('keeps the take aligned and the ESCSUITE-349 invariants true for any set of cuts', () => {
    let cutSomething = 0
    fc.assert(
      fc.property(scenario, (s) => {
        resetModel()
        for (const source of [SCREEN, MIC, OTHER]) state().addSourceVideo(structuredClone(source))
        state().seekTo(s.takeAt)
        state().placeTakeOnTimeline([
          { sourceVideoId: SCREEN.id, name: 'screen', duration: SCREEN.duration, startOffset: 0, width: 64, height: 48 },
          { sourceVideoId: MIC.id, name: 'mic', duration: MIC.duration, startOffset: s.micOffset, width: 0, height: 0, mediaType: 'audio' },
        ])
        const placed = state().project.timeline.clips
        const screen = placed.find((c) => c.name === 'screen')!
        const mic = placed.find((c) => c.name === 'mic')!
        const rows = new Set([screen.trackId, mic.trackId])
        for (const frac of s.splits) {
          const piece = state().project.timeline.clips.find((c) => c.trackId === screen.trackId && c.timelinePosition <= s.takeAt + frac * 10 && c.timelinePosition + c.duration > s.takeAt + frac * 10)
          if (piece) state().splitClip(piece.id, s.takeAt + frac * 10 - piece.timelinePosition)
        }
        if (s.tail !== undefined) {
          const at = s.takeAt + SCREEN.duration + s.tail
          state().addClipToTimeline({ id: 'tail', sourceVideoId: OTHER.id, name: 'tail', startTime: 0, endTime: OTHER.duration, duration: OTHER.duration }, screen.trackId, at)
        }
        if (s.elsewhere !== undefined) {
          state().addTrack()
          const free = state().project.timeline.tracks.find((t) => !rows.has(t.id))!
          state().addClipToTimeline({ id: 'elsewhere', sourceVideoId: OTHER.id, name: 'elsewhere', startTime: 0, endTime: OTHER.duration, duration: OTHER.duration }, free.id, s.elsewhere)
        }

        const before = state().project.timeline.clips.map((c) => ({ ...c }))
        const take = before.filter((c) => rows.has(c.trackId) && c.linkGroupId)
        const target = take[s.target % take.length]
        const ranges = s.ranges.map(([start, length]) => ({ start, end: start + length }))
        const cuts = normaliseRanges(ranges)
        const projectBefore = JSON.stringify(state().project)
        const depth = state().history.past.length

        if (!state().removeTimeRanges(target.id, ranges)) {
          // Every range fell past the take's rows: nothing to cut, nothing recorded.
          expect(JSON.stringify(state().project)).toBe(projectBefore)
          expect(state().history.past.length).toBe(depth)
          return
        }
        cutSomething++
        const after = state().project.timeline.clips

        checkInvariants()

        // Where each piece came from: the clip before the cut that played its
        // source on its row (the first piece keeps the clip's id; every piece
        // is a window on the same anchor, `startTime - timelinePosition`).
        for (const piece of after) {
          if (!rows.has(piece.trackId)) {
            expect(before.find((c) => c.id === piece.id), 'a row outside the take is untouched').toEqual(piece)
            continue
          }
          const origin = before.find(
            (c) =>
              c.trackId === piece.trackId &&
              c.sourceVideoId === piece.sourceVideoId &&
              piece.startTime >= c.startTime - EPS &&
              piece.endTime <= c.endTime + EPS &&
              // The time this piece's first frame played at before the cut maps to where it is now.
              Math.abs(c.timelinePosition + (piece.startTime - c.startTime) - removedBefore(cuts, c.timelinePosition + (piece.startTime - c.startTime)) - piece.timelinePosition) < EPS
          )
          expect(origin, `piece ${piece.id} plays what a clip played before, where the cut moved it`).toBeDefined()
          // Nothing a cut covered is still on the timeline.
          const was = origin!.timelinePosition + (piece.startTime - origin!.startTime)
          for (const cut of cuts) {
            expect(was + piece.duration <= cut.start + EPS || was >= cut.end - EPS, `piece ${piece.id} keeps nothing of a cut`).toBe(true)
          }
        }

        // Linked pieces sit between the same two cuts, so a later drag moves the right partners.
        // Each cut closes up to one point on the timeline; a clip's slot is how many lie at or before it.
        const joins = cuts.map((r) => r.start - removedBefore(cuts, r.start))
        const slotOf = (c: Clip) => joins.filter((q) => q <= c.timelinePosition + EPS).length
        const groups = new Map<string, Set<number>>()
        for (const c of after) {
          if (!c.linkGroupId || !rows.has(c.trackId)) continue
          if (!groups.has(c.linkGroupId)) groups.set(c.linkGroupId, new Set())
          groups.get(c.linkGroupId)!.add(slotOf(c))
        }
        for (const [group, slots] of groups) expect(slots.size, `group ${group} spans one slot between cuts`).toBe(1)

        checkUndoRedoIdentity()
        state().undo()
        expect(JSON.stringify(state().project), 'one undo restores everything the cut took').toBe(projectBefore)
        expect(state().history.past.length).toBe(depth)
      }),
      { seed: 0x5eed0403, numRuns: 150 }
    )
    // Not vacuous: most scenarios have a range that lands on the take.
    expect(cutSomething).toBeGreaterThan(100)
  }, 60_000)
})
