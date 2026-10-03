/**
 * Unit tests for `perf-report.mjs`'s merge: `parseBenchmarkResult` and
 * `mergeBenchmarks`, plus the Markdown it feeds into `toMarkdown`.
 *
 * `perf-report.mjs` decides which numbers get published, how a missing
 * benchmark is presented, and how a malformed result is handled — and until
 * now it had no test at all (K-12). These four cases are the ones that
 * matter because every input here is optional: `apps/e2e/perf-results/*.json`
 * is produced per browser benchmark, and `services/headless-artist/perf-report.json`
 * by the kit's own benchmark, so a `pnpm perf` run that only exercised some
 * of them — or crashed partway through one — is the normal case, not an edge
 * case. The one thing none of them may do is throw: this script is the last
 * thing `pnpm perf` runs, and it is not worth failing an informational job
 * over a result it merely could not parse.
 *
 * Node's built-in runner, no dependencies:
 *
 *   pnpm --filter @escapesuite/e2e run test:scripts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { headline, mergeBenchmarks, parseBenchmarkResult, toMarkdown } from './perf-report.mjs'

const validResult = (overrides = {}) =>
  JSON.stringify({ name: 'export-mp4', runs: 3, wallMs: 1200, framesEncoded: 300, ...overrides })

// ---------------------------------------------------------------------------
// (a) a missing browser result file
// ---------------------------------------------------------------------------

test('mergeBenchmarks: a benchmark with no result file is simply absent, not a fabricated row', () => {
  // Only one of the ten arms "ran" — the rest never produced a file, which is
  // exactly what a `perf-results/` directory looks like after a partial run.
  const benchmarks = mergeBenchmarks(
    [{ label: 'perf-results/export-mp4.json', raw: validResult() }],
    undefined // the kit never ran either
  )

  assert.equal(benchmarks.length, 1)
  assert.equal(benchmarks[0].name, 'export-mp4')

  const markdown = toMarkdown(benchmarks, [])
  // No row, placeholder or otherwise, for any of the nine arms that did not run.
  assert.ok(!markdown.includes('export-webm'))
  assert.ok(!markdown.includes('headless-kit-render'))
})

test('mergeBenchmarks: every input missing produces an empty list, not a throw', () => {
  const benchmarks = mergeBenchmarks([], undefined)
  assert.deepEqual(benchmarks, [])

  const markdown = toMarkdown(benchmarks, [])
  assert.ok(markdown.includes('_No benchmark results were produced._'))
})

test('headline: a present benchmark missing every rate-bearing field is the documented placeholder, never a number', () => {
  // A benchmark object that parsed fine but reports none of the fields
  // `headline()` knows how to read — the gesture-less, rate-less case.
  assert.equal(headline({ name: 'some-arm', runs: 1 }), '—')
})

// ---------------------------------------------------------------------------
// (b) a malformed JSON result
// ---------------------------------------------------------------------------

test('parseBenchmarkResult: invalid JSON text is skipped, not thrown', () => {
  assert.equal(parseBenchmarkResult('{not valid json', 'perf-results/broken.json'), null)
  assert.equal(parseBenchmarkResult('', 'perf-results/empty.json'), null)
})

test('mergeBenchmarks: a malformed browser result is dropped and the rest still merge', () => {
  const benchmarks = mergeBenchmarks(
    [
      { label: 'perf-results/broken.json', raw: '{not valid json' },
      { label: 'perf-results/export-mp4.json', raw: validResult() },
    ],
    undefined
  )
  assert.equal(benchmarks.length, 1)
  assert.equal(benchmarks[0].name, 'export-mp4')

  // Never throws when fed straight into the formatter either.
  assert.doesNotThrow(() => toMarkdown(benchmarks, []))
})

// ---------------------------------------------------------------------------
// (c) a kit result of an unexpected shape
// ---------------------------------------------------------------------------

test('parseBenchmarkResult: a kit result that parses to null, a primitive, or an array is rejected', () => {
  assert.equal(parseBenchmarkResult('null', 'kit'), null)
  assert.equal(parseBenchmarkResult('42', 'kit'), null)
  assert.equal(parseBenchmarkResult('"oops"', 'kit'), null)
  assert.equal(parseBenchmarkResult('true', 'kit'), null)
  assert.equal(parseBenchmarkResult('[1,2,3]', 'kit'), null)
})

test('parseBenchmarkResult: an object with no string "name" is rejected', () => {
  assert.equal(parseBenchmarkResult('{"runs":5}', 'kit'), null)
  assert.equal(parseBenchmarkResult('{"name":42,"runs":5}', 'kit'), null)
})

test('parseBenchmarkResult: a well-shaped object is accepted', () => {
  assert.deepEqual(parseBenchmarkResult(validResult(), 'perf-results/export-mp4.json'), {
    name: 'export-mp4',
    runs: 3,
    wallMs: 1200,
    framesEncoded: 300,
  })
})

test('mergeBenchmarks: a kit result of an unexpected shape never reaches the formatter, and nothing throws', () => {
  for (const kitRaw of ['null', '42', '"oops"', 'true', '[1,2,3]', '{"runs":5}']) {
    const benchmarks = mergeBenchmarks(
      [{ label: 'perf-results/export-mp4.json', raw: validResult() }],
      kitRaw
    )
    // The one real browser benchmark survives; the malformed kit result does not.
    assert.equal(benchmarks.length, 1)
    assert.equal(benchmarks[0].name, 'export-mp4')
    assert.doesNotThrow(() => toMarkdown(benchmarks, []))
  }
})

test('mergeBenchmarks: a well-shaped kit result merges alongside the browser benchmarks', () => {
  const benchmarks = mergeBenchmarks(
    [{ label: 'perf-results/export-mp4.json', raw: validResult() }],
    JSON.stringify({ name: 'headless-kit-render', runs: 3, wallMs: 900, framesEncoded: 30 })
  )
  assert.equal(benchmarks.length, 2)
  assert.deepEqual(
    benchmarks.map((b) => b.name),
    ['export-mp4', 'headless-kit-render']
  )
})

// ---------------------------------------------------------------------------
// (d) a complete run
// ---------------------------------------------------------------------------

test('mergeBenchmarks: a complete run orders every arm the documented way, kit last', () => {
  const names = [
    'craft-mp4-conversion',
    'export-webm',
    'headless-kit-render',
    'preview-playback',
    'craft-screen-recording',
    'timeline-interaction',
    'export-mp4',
    'craft-composite-mp4-conversion',
    'craft-pip-recording',
    'craft-separate-tracks-recording',
  ]
  const browserResults = names
    .filter((name) => name !== 'headless-kit-render')
    .map((name) => ({ label: `perf-results/${name}.json`, raw: validResult({ name }) }))
  const kitRaw = JSON.stringify({ name: 'headless-kit-render', runs: 3, wallMs: 900 })

  const benchmarks = mergeBenchmarks(browserResults, kitRaw)

  assert.deepEqual(
    benchmarks.map((b) => b.name),
    [
      'preview-playback',
      'timeline-interaction',
      'export-mp4',
      'export-webm',
      'craft-screen-recording',
      'craft-pip-recording',
      'craft-separate-tracks-recording',
      'craft-mp4-conversion',
      'craft-composite-mp4-conversion',
      'headless-kit-render',
    ]
  )
})

test('mergeBenchmarks: the JSON report shape for the present arms keeps every field the result carried', () => {
  const benchmarks = mergeBenchmarks(
    [
      {
        label: 'perf-results/export-mp4.json',
        raw: validResult({ format: 'mp4', resolution: '720p', heapDeltaBytes: 1024 }),
      },
    ],
    undefined
  )

  assert.deepEqual(benchmarks, [
    {
      name: 'export-mp4',
      runs: 3,
      wallMs: 1200,
      framesEncoded: 300,
      format: 'mp4',
      resolution: '720p',
      heapDeltaBytes: 1024,
    },
  ])
})

test('toMarkdown: a complete run renders a real headline and a per-benchmark table, not placeholders', () => {
  const benchmarks = mergeBenchmarks(
    [
      {
        label: 'perf-results/export-mp4.json',
        raw: validResult({ framesPerSecond: 30 }),
      },
    ],
    JSON.stringify({ name: 'headless-kit-render', runs: 3, wallMs: 900, framesPerSecond: 12 })
  )

  const markdown = toMarkdown(benchmarks, [])
  assert.ok(markdown.includes('| `export-mp4` | 3 | 30 frames/s (1200 ms) |'))
  assert.ok(markdown.includes('| `headless-kit-render` | 3 | 12 frames/s (900 ms) |'))
  assert.ok(markdown.includes('### `export-mp4`'))
  assert.ok(!markdown.includes('_No benchmark results were produced._'))
})
