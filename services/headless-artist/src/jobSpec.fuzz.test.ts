// Seeded mutation fuzz for the job spec parser (ESCSUITE-294). A spec arrives
// from a stranger's POST /render body or a CLI argument, so every malformed
// one must be refused with the kit's own validation error -- a plain `Error`
// whose message names the field, which `cli.ts` turns into exit 2 and
// `serve.ts` into a 400 -- and never with a bare TypeError, RangeError or
// SyntaxError leaking out of a property read.
//
// A failure prints the seed, the iteration and the mutation; rerun this file
// to reproduce it. See test/fuzz.ts.
import { describe, it, expect } from 'vitest'
import { collectUnknownKeys, parseJobSpec } from './jobSpec'
import { createRng, expectNamedRefusal, expectTallyAtLeast, fuzzFailure, mutateJson } from '../test/fuzz'

const SEED = 0x5eed0192
const ITERATIONS = 800
// Outcomes on the committed seed, measured 2026-10-15: 59 parsed, 741 refused.
// The floors ARE those counts: the seed is fixed, so a check dropped anywhere
// lowers `refused` and a new over-strict one lowers `accepted`. A change that
// moves an input across the line on purpose updates the numbers and says why.
const FLOORS = { accepted: 59, refused: 741 }

/** One valid spec per sink, so a mutation can reach each sink's own config validator. */
const baseSpecs = (): Record<string, unknown>[] => {
  const head = {
    jobId: 'job-1',
    input: { bundle: { path: '/jobs/project.veditor' } },
    options: { format: 'gif', quality: 'high', resolution: '720p', fps: 15, timeRange: { start: 0, end: 2 } },
  }
  return [
    { ...head, output: { sink: 'volume', config: { dir: '/out' } } },
    { ...head, output: { sink: 's3', config: { prefix: 's3://bucket/renders/', region: 'eu-west-1', endpoint: 'http://minio:9000', timeoutMs: 1000 } } },
    { ...head, output: { sink: 'webhook', config: { url: 'https://host.example/hook', headers: { 'x-a': 'b' }, timeoutMs: 1000 } } },
    {
      ...head,
      input: { manifest: { path: '/jobs/manifest.json' } },
      output: { sink: 'command', config: { command: '/bin/deliver', args: ['--to', 'x'], env: { A: 'b' }, timeoutMs: 1000 } },
    },
  ]
}

/**
 * The kit's validation error: exactly `Error`, not a subclass, so a TypeError
 * from a property read cannot pass for one.
 */
const isValidationError = (error: unknown) =>
  error instanceof Error && Object.getPrototypeOf(error) === Error.prototype

/** Every refusal opens by naming the field or the sink whose config was wrong. */
const NAMES_A_FIELD = /^(job spec|jobId|input|options|output|(volume|s3|webhook|command) sink)[ .]/

describe('parseJobSpec under seeded mutation (ESCSUITE-294)', () => {
  it('parses every unmutated spec, so every mutation starts from a real one', () => {
    for (const spec of baseSpecs()) expect(() => parseJobSpec(spec)).not.toThrow()
  })

  it(`parses or refuses ${ITERATIONS} mutated specs with a named validation error`, async () => {
    const rng = createRng(SEED)
    const tally = { accepted: 0, refused: 0 }
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      const base = rng.pick(baseSpecs())
      const { value, description } = mutateJson(rng, base)
      const context = { seed: SEED, iteration, mutation: `the ${(base.output as { sink: string }).sink} spec, ${description}` }
      const parsed = await expectNamedRefusal(() => parseJobSpec(value), isValidationError, context)
      tally[parsed.ok ? 'accepted' : 'refused']++
      if (!parsed.ok && !NAMES_A_FIELD.test(parsed.error.message)) {
        throw fuzzFailure(context, `refused without naming a field: ${parsed.error.message}`)
      }
      // The warning pass runs on whatever parsed and must never throw either.
      const unknown = await expectNamedRefusal(() => collectUnknownKeys(value), () => false, context)
      if (unknown.ok && !Array.isArray(unknown.value)) {
        throw fuzzFailure(context, 'collectUnknownKeys returned something other than a list')
      }
    }
    expectTallyAtLeast(tally, FLOORS, SEED)
  }, 15_000)
})
