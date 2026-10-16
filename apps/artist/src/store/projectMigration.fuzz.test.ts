// Seeded mutation fuzz for `parseProject` (ESCSUITE-294). The contract is the
// one its doc comment states: a project file, a host's LOAD_PROJECT payload
// and a headless job all arrive here unvalidated, so a malformed shape is
// answered with `{ ok: false, reason }` — never a thrown exception — and what
// parses is a project the editor can walk.
//
// A failure prints the seed, the iteration and the mutation; rerun this file
// to reproduce it (every choice comes from the seed), or build the input by
// hand from the mutation's words. See src/test/fuzz.ts.
import { describe, it, expect, vi } from 'vitest'
import { parseProject, type ParseProjectResult } from './projectMigration'
import {
  createRng,
  expectNamedRefusal,
  expectTallyAtLeast,
  fuzzFailure,
  mutateJson,
  nestDeep,
  setAt,
  type FuzzContext,
} from '../test/fuzz'

const SEED = 0x5eed0294
const ITERATIONS = 600
// Outcomes on the committed seed, measured 2026-10-15 (after the ESCSUITE-294
// guards): 354 parsed, 246 refused. The floors ARE those counts: the seed is
// fixed, so a check dropped anywhere lowers `refused` and a new over-strict one
// lowers `accepted`. A change that moves an input across the line on purpose
// updates the numbers here and says why.
//
// Re-measured 2026-10-16 for ESCSUITE-300: still 354 / 246. The 11 inputs
// whose legacy overlay window the migration now repairs parsed before too,
// into a NaN-length clip; they move from "parsed but unexportable" to
// "parsed and sound", which the duration check in `assertShape` now asserts,
// not across the parsed / refused line.
const FLOORS = { accepted: 354, refused: 246 }

const transform = { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }

/** A modern project, an editor block and a legacy project's overlay arrays, in one value to mutate. */
const baseInput = () => ({
  project: {
    id: 'p',
    name: 'Fuzz',
    created: 0,
    modified: 0,
    resolution: { width: 1280, height: 720 },
    timeline: {
      tracks: [
        { id: 't1', name: 'Track 1', index: 0, visible: true, locked: false, muted: false, volume: 1, height: 60 },
        { id: 't2', name: 'Track 2', index: 1, visible: true, locked: false, muted: false, volume: 1, height: 60 },
      ],
      clips: [
        {
          id: 'c1',
          sourceVideoId: 'v1',
          name: 'Clip 1',
          startTime: 0,
          endTime: 4,
          duration: 4,
          trackId: 't1',
          timelinePosition: 0,
          blendMode: 'normal',
          transform,
          effects: { blur: 0 },
          transition: { type: 'none', duration: 0.5 },
          crop: { left: 0.1, top: 0, right: 0.1, bottom: 0 },
        },
        {
          id: 'c2',
          sourceVideoId: '',
          name: 'Title',
          startTime: 0,
          endTime: 2,
          duration: 2,
          trackId: 't2',
          timelinePosition: 1,
          blendMode: 'normal',
          transform,
          effects: { blur: 0 },
          transition: { type: 'none', duration: 0.5 },
          overlayType: 'text',
          textData: { text: 'Hi', x: 0.5, y: 0.5 },
        },
      ],
      // Legacy arrays, so a mutation can reach the overlay conversion too.
      textOverlays: [
        {
          id: 'lt',
          text: 'Legacy',
          x: 0.5,
          y: 0.2,
          fontFamily: 'Arial',
          fontSize: 32,
          fontWeight: 'normal',
          fontStyle: 'normal',
          color: '#fff',
          backgroundColor: '#0000',
          textAlign: 'center',
          startTime: 0,
          endTime: 2,
          opacity: 1,
        },
      ],
      shapeOverlays: [
        {
          id: 'ls',
          type: 'rectangle',
          x: 0.1,
          y: 0.1,
          width: 0.2,
          height: 0.2,
          fillColor: '#f00',
          strokeColor: '#000',
          strokeWidth: 1,
          startTime: 0,
          endTime: 3,
          opacity: 1,
          rotation: 0,
        },
      ],
      duration: 4,
    },
  },
  editor: { inPoint: 1, outPoint: 3, markers: [{ id: 'm1', time: 2, label: 'Mark', color: '#fff' }] },
})

type Wrapper = { project?: unknown; editor?: unknown } | null | undefined

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** What parsed must be a project the editor can walk; what was refused must say why. */
function assertShape(result: ParseProjectResult, context: FuzzContext): void {
  if (!isRecord(result) || typeof result.ok !== 'boolean') {
    throw fuzzFailure(context, `returned ${JSON.stringify(result)}, not { ok, ... }`)
  }
  if (!result.ok) {
    if (typeof result.reason !== 'string' || result.reason.length === 0) {
      throw fuzzFailure(context, `refused with no reason (${JSON.stringify(result.reason)})`)
    }
    return
  }
  const { timeline } = result.project
  if (!isRecord(timeline) || !Array.isArray(timeline.tracks) || !Array.isArray(timeline.clips)) {
    throw fuzzFailure(context, 'parsed a project whose timeline has no tracks or clips list')
  }
  const trackIds = new Set(timeline.tracks.map((track) => isRecord(track) && track.id))
  for (const clip of timeline.clips) {
    if (!isRecord(clip) || !trackIds.has(clip.trackId as string)) {
      throw fuzzFailure(context, `parsed a clip on no track: ${JSON.stringify(clip)}`)
    }
    // ESCSUITE-300: the ESCSUITE-257 rule holds after migration too, for the
    // clips a legacy overlay converts into as well as the file's own.
    if (typeof clip.duration !== 'number' || !Number.isFinite(clip.duration) || clip.duration <= 0) {
      throw fuzzFailure(context, `parsed clip ${String(clip.id)} with a duration of ${String(clip.duration)}`)
    }
  }
  if (result.editor !== undefined && !Array.isArray(result.editor.markers)) {
    throw fuzzFailure(context, 'parsed an editor block with no markers list')
  }
}

describe('parseProject under seeded mutation (ESCSUITE-294)', () => {
  it('parses the unmutated input, so every mutation starts from a real project', () => {
    const { project, editor } = baseInput()
    const result = parseProject(project, editor)
    expect(result.ok).toBe(true)
  })

  it(`answers ${ITERATIONS} mutated projects with a project or a reason, and never throws`, async () => {
    // The ESCSUITE-300 repair warns once per parse it repairs; quiet here.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rng = createRng(SEED)
    const tally = { accepted: 0, refused: 0 }
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      const { value, description } = mutateJson(rng, baseInput())
      const context = { seed: SEED, iteration, mutation: description }
      const input = value as Wrapper
      // parseProject refuses by return value, so no thrown error is expected at all.
      const outcome = await expectNamedRefusal(
        () => parseProject(input?.project, input?.editor),
        () => false,
        context
      )
      if (outcome.ok) {
        assertShape(outcome.value, context)
        tally[outcome.value.ok ? 'accepted' : 'refused']++
      }
    }
    warn.mockRestore()
    expectTallyAtLeast(tally, FLOORS, SEED)
  })
})

// The defects this fuzzer found, each one input pinned on its own so it reads
// without the loop. Fixed in the same ticket (ESCSUITE-294) and kept as
// regression tests. Each asserts exactly the fuzz contract above.
describe('defects the parseProject fuzz found (ESCSUITE-294)', () => {
  const check = async (input: unknown, context: FuzzContext) => {
    const { project, editor } = input as { project: unknown; editor: unknown }
    const outcome = await expectNamedRefusal(() => parseProject(project, editor), () => false, context)
    if (outcome.ok) assertShape(outcome.value, context)
    // And refused, not quietly accepted.
    expect(outcome.ok && !outcome.value.ok).toBe(true)
  }

  it('a legacy shapeOverlays entry that is not an overlay is answered, not thrown (seed 0x5eed0294, iteration 23)', async () => {
    await check(setAt(baseInput(), ['project', 'timeline', 'shapeOverlays', 0], nestDeep(116)), {
      seed: SEED,
      iteration: 23,
      mutation: 'nestDeep project.timeline.shapeOverlays[0] -> depth 116',
    })
  })

  it('a timeline.tracks entry that is null is answered, not thrown (exploratory seed 0xabc123, iteration 1624)', async () => {
    await check(setAt(baseInput(), ['project', 'timeline', 'tracks', 0], null), {
      seed: 0xabc123,
      iteration: 1624,
      // Found by an exploratory 20,000-iteration run, not this file's SEED, so
      // rerunning the file does not replay it; this case is the reproduction.
      mutation: 'swapType project.timeline.tracks[0] -> null (exploratory seed, not this file\'s)',
    })
  })
})

// ESCSUITE-300, found by the duration check `assertShape` gained in that
// ticket: a legacy overlay with no usable start and end time parsed into a
// NaN-length clip. It is repaired, not refused, so this asserts the repair.
describe('defects the parseProject fuzz found (ESCSUITE-300)', () => {
  it('a legacy shape overlay whose endTime is a list converts into a clip of finite length (seed 0x5eed0294, iteration 159)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const context = {
      seed: SEED,
      iteration: 159,
      mutation: 'growArray project.timeline.shapeOverlays[0].endTime -> 211 entries',
    }
    const input = setAt(baseInput(), ['project', 'timeline', 'shapeOverlays', 0, 'endTime'], Array(211).fill(3)) as {
      project: unknown
      editor: unknown
    }
    const outcome = await expectNamedRefusal(() => parseProject(input.project, input.editor), () => false, context)
    if (outcome.ok) assertShape(outcome.value, context)
    expect(outcome.ok && outcome.value.ok).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
