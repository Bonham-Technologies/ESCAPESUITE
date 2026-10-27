// Model-based property test for the timeline's edit logic (ESCSUITE-349).
//
// fast-check generates sequences of 1-30 user edits — add a clip with audio,
// split, delete, ripple delete, move (to a time, or onto / next to another
// clip), trim (either edge, with or without the ripple tool, over several
// pointer moves), duplicate, undo, redo, and save -> load through the real
// `.veditor` writer, reader and `parseProject` — and runs each through the
// path the editor's own gesture takes (`src/test/timelineModel.ts`). After
// every step the invariants listed in `checkInvariants`,
// `checkUndoRedoIdentity` and each op's postcondition must hold; see
// docs/reference/testing.md ("Property-based timeline tests").
//
// The seed is fixed, so CI replays the same 200 sequences every run. A failure
// prints fast-check's shrunk counterexample (the op list) and the seed and
// path to replay it; paste the op list into
// `timelineInvariants.counterexamples.test.ts` as `runSequence([...])` to keep
// it. A sequence that reaches a bug already filed throws `KnownBug` from the
// model and is discarded (`fc.pre(false)`) rather than failed; see the guards
// in `src/test/timelineModel.ts`. Locally, `pnpm --filter=@escapesuite/artist
// test:fuzz` runs 5,000 sequences (ARTIST_FUZZ_RUNS); ARTIST_FUZZ_SEED picks
// another seed. The nightly workflow (.github/workflows/nightly.yml,
// ESCSUITE-353) sets both, drawing the seed from the run id; when either is
// set, the seed and run count are printed so a failing night can be replayed.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import { storeVideo, deleteVideo } from '../../core/storage'
import { KnownBug, SOURCES, opCounts, runSequence, type MoveTarget, type Op } from '../../test/timelineModel'

const SEED = Number(process.env.ARTIST_FUZZ_SEED ?? 0x5eed0349)
const NUM_RUNS = Number(process.env.ARTIST_FUZZ_RUNS ?? 200)
if (process.env.ARTIST_FUZZ_SEED !== undefined || process.env.ARTIST_FUZZ_RUNS !== undefined) {
  console.info(`timeline property test: ARTIST_FUZZ_SEED=${SEED} ARTIST_FUZZ_RUNS=${NUM_RUNS}`)
}

/**
 * `n` hundred-thousandths in `[min, max]`: decimal values binary floating
 * point cannot hold exactly. (`fc.double` draws uniformly over the bit
 * patterns, so nearly every value it gives is below 1e-10 — no use as a time.)
 */
const decimal = (min: number, max: number) =>
  fc.integer({ min: min * 100_000, max: max * 100_000 }).map((n) => n / 100_000)

/** A timeline time: quarter seconds (so edges meet exactly) or an inexact decimal. */
const time = fc.oneof(fc.integer({ min: 0, max: 80 }).map((q) => q / 4), decimal(0, 25))
const index = fc.nat({ max: 50 })

const moveTarget: fc.Arbitrary<MoveTarget> = fc.oneof(
  fc.record({ kind: fc.constant('at' as const), track: index, time }),
  fc.record({ kind: fc.constant('beside' as const), other: index, side: fc.constantFrom('before' as const, 'after' as const, 'onto' as const) })
)

/** One edit. Weights favour the edits that build and reshape a timeline. */
const opArbitrary: fc.Arbitrary<Op> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ kind: fc.constant('add' as const), source: index, at: time }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('split' as const), clip: index, frac: decimal(0, 1) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('delete' as const), clip: index }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('rippleDelete' as const), clip: index }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('move' as const), clip: index, to: moveTarget }) },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('trim' as const),
      clip: index,
      edge: fc.constantFrom('start' as const, 'end' as const),
      ripple: fc.boolean(),
      moves: fc.array(decimal(-6, 6), { minLength: 1, maxLength: 3 }),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('duplicate' as const), clip: index }) },
  { weight: 2, arbitrary: fc.constant({ kind: 'undo' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'redo' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'saveLoad' as const }) }
)

beforeAll(async () => {
  // saveProject downloads through an anchor; jsdom would try to navigate.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  // The bytes the library's sources would have in the shared DB, so a save
  // finds them and a load restores them.
  for (const source of SOURCES) {
    await storeVideo(source.id, new Blob([new Uint8Array([1, 2, 3, source.id.length])], { type: source.mimeType }), source)
  }
})

afterAll(async () => {
  for (const source of SOURCES) await deleteVideo(source.id)
  vi.restoreAllMocks()
}, 60_000)

describe('timeline invariants (property-based, ESCSUITE-349)', () => {
  it(
    `hold after every step of ${NUM_RUNS} random edit sequences`,
    async () => {
      const known: Record<string, number> = {}
      opCounts.total = 0
      opCounts.changed = {}
      await fc.assert(
        fc.asyncProperty(fc.array(opArbitrary, { minLength: 1, maxLength: 30, size: 'max' }), async (ops) => {
          try {
            await runSequence(ops)
          } catch (error) {
            if (!(error instanceof KnownBug)) throw error
            known[error.ticket] = (known[error.ticket] ?? 0) + 1
            fc.pre(false)
          }
        }),
        { seed: SEED, numRuns: NUM_RUNS }
      )

      // A floor on real edits: a generator that drifts into no-ops (empty
      // timelines, out-of-range picks) must fail here, not pass vacuously.
      // Measured 2026-10-22 over 13 seeds at 200 runs: 2,670-3,130 ops, 55-60%
      // of them changing state; the rarest kinds were delete (70+) and redo
      // (6+; any edit clears the redo stack, so most redos have nothing to do).
      const changed = Object.values(opCounts.changed).reduce((sum, n) => sum + (n ?? 0), 0)
      expect(changed, `${changed} of ${opCounts.total} ops changed state`).toBeGreaterThanOrEqual(opCounts.total * 0.4)
      for (const kind of ['add', 'split', 'delete', 'rippleDelete', 'move', 'trim', 'duplicate', 'undo', 'redo', 'saveLoad'] as const) {
        const floor = Math.ceil(NUM_RUNS / (kind === 'redo' ? 100 : 20))
        expect(opCounts.changed[kind] ?? 0, `${kind} ops that changed state (known bugs hit: ${JSON.stringify(known)})`).toBeGreaterThanOrEqual(floor)
      }
    },
    Math.max(60_000, NUM_RUNS * 100)
  )
})
