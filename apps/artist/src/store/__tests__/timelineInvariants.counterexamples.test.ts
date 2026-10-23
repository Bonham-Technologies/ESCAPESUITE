// The counterexamples `timelineInvariants.property.test.ts` found (ESCSUITE-349),
// each kept as an example test through the same gesture model. Every one is a
// real bug in the app, filed rather than fixed here (the code each points at is
// on the owner-protected editor paths), so each open one is an `it.fails`: it
// asserts the correct behaviour, and passes only while the bug is still there.
//
// They run with the model's known-bug guards OFF (`resetModel({ guards: false })`,
// `runSequence(ops, { guards: false })`), so they keep reaching the bug the
// property test's guards discard. **A fix PR for the ticket flips its test to
// `it` and deletes the matching guard in `src/test/timelineModel.ts`.**
import { beforeAll, describe, expect, it } from 'vitest'
import { useEditorStore } from '../projectStore'
import { storeVideo } from '../../core/storage'
import { SOURCES, applyOp, checkInvariants, resetModel, runSequence, type Op } from '../../test/timelineModel'

const clips = () => useEditorStore.getState().project.timeline.clips

beforeAll(async () => {
  for (const source of SOURCES) {
    await storeVideo(source.id, new Blob([new Uint8Array([1, 2, 3])], { type: source.mimeType }), source)
  }
})

/** Run `ops` without the checks, then hand back the clips by name. */
async function settle(ops: Op[]) {
  resetModel({ guards: false })
  for (const op of ops) await applyOp(op).catch(() => {})
  return new Map(clips().map((c) => [c.name, c]))
}

describe('timeline counterexamples (ESCSUITE-349)', () => {
  // A start trim whose pointer goes left of 0 (over the track headers) on a
  // clip at, or near, the start of the timeline: `computeTrimUpdate` clamps
  // the new `timelinePosition` to 0 but not the `startTime` it derived from
  // the same pointer, so the in point moves further than the clip does. The
  // picture and sound slip against the timeline, the clip's END moves, and it
  // runs into the clip after it. Fixed by ESCSUITE-363: the in point now stops
  // where the clip reaches timeline 0.
  it('ESCSUITE-363: a start trim dragged past 0 keeps the clip end and its sync', async () => {
    const ops: Op[] = [
      { kind: 'add', source: 0, at: 0 },
      { kind: 'trim', clip: 0, edge: 'start', ripple: false, moves: [2] }, // in point 2, at 2
      { kind: 'move', clip: 0, to: { kind: 'at', track: 0, time: 0 } }, // [0, 8), in point 2
      { kind: 'duplicate', clip: 0 }, // the copy at [8, 16)
      { kind: 'trim', clip: 0, edge: 'start', ripple: false, moves: [-1] }, // pointer at -1 s
    ]
    const byName = await settle(ops)
    const trimmed = byName.get('a.mp4')!
    expect(trimmed.timelinePosition + trimmed.duration, 'the end is where it was').toBe(8)
    expect(trimmed.startTime - trimmed.timelinePosition, 'source time 2 still plays at timeline 0').toBe(2)
    expect(() => checkInvariants()).not.toThrow()
    await expect(runSequence(ops, { guards: false })).resolves.toBeUndefined()
  })

  // A ripple end trim after an earlier ripple trim on the same row. The first
  // shift lands the next clip at 0.09999999999999998, a float hair before the
  // trimmed clip's end (0.1). The second ripple trim lengthens the clip
  // (`useTrimDrag` skips the neighbour clamp for a ripple end trim) and then
  // shifts only the clips at or after the old end — strictly, with no
  // tolerance — so the butted neighbour is not moved and the trimmed clip now
  // covers 2 s of it.
  it.fails('ESCSUITE-364: a ripple end trim moves the clip butted against it', async () => {
    const ops: Op[] = [
      { kind: 'add', source: 0, at: 0 },
      { kind: 'split', clip: 0, frac: 0.04944 }, // (1) [0, 0.4944), (2) after it
      { kind: 'trim', clip: 0, edge: 'end', ripple: true, moves: [-0.3944] }, // (1) to 0.1, (2) pulled back
      { kind: 'trim', clip: 0, edge: 'end', ripple: true, moves: [2] }, // (1) to 2.1
    ]
    const byName = await settle(ops)
    const first = byName.get('a.mp4 (1)')!
    const second = byName.get('a.mp4 (2)')!
    expect(second.timelinePosition, 'the ripple pushed the next clip along').toBeGreaterThanOrEqual(
      first.timelinePosition + first.duration - 1e-9
    )
    await expect(runSequence(ops, { guards: false })).resolves.toBeUndefined()
  })

  // A ripple delete of a clip whose computed end (`timelinePosition +
  // endTime - startTime`) lands a float hair past the start of the clip
  // butted after it (16.117000000000004 vs 16.117). That clip is not shifted
  // (`>= clipEnd`, no tolerance), the ones after it are, and the next one
  // slides into it.
  it.fails('ESCSUITE-364: a ripple delete shifts the butted clip after it with the rest', async () => {
    const ops: Op[] = [
      { kind: 'add', source: 0, at: 9.25 },
      { kind: 'split', clip: 0, frac: 0.6867 },
      { kind: 'trim', clip: 0, edge: 'start', ripple: false, moves: [3.14937] },
      { kind: 'split', clip: 3, frac: 0.03192 },
      { kind: 'trim', clip: 0, edge: 'start', ripple: false, moves: [3.61764] },
      { kind: 'rippleDelete', clip: 0 },
    ]
    const byName = await settle(ops)
    const next = byName.get('a.mp4 (2) (1)')!
    const after = byName.get('a.mp4 (2) (2)')!
    expect(after.timelinePosition, 'the clips after the gap keep their order and spacing').toBeGreaterThanOrEqual(
      next.timelinePosition + next.duration - 1e-9
    )
    await expect(runSequence(ops, { guards: false })).resolves.toBeUndefined()
  })
})
