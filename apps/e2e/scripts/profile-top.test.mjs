/**
 * Unit tests for `profile-top.mjs` — the two things about folding a
 * `.cpuprofile` that are easy to get silently wrong, plus the source-map
 * lookup that decides whether the report's line numbers mean anything.
 *
 * Node's built-in runner, no dependencies:
 *
 *   pnpm --filter @escapesuite/e2e run test:scripts
 *
 * Silently wrong is the operative risk. A profile summary that is off by one
 * sample still produces a plausible-looking table; it just credits every
 * function's cost to whatever ran before it, and a hotspot report built on it
 * sends the next optimisation at the wrong code.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildSourceMapIndex,
  locationOf,
  resolvePosition,
  summariseProfile,
} from './profile-top.mjs'

const frame = (functionName, url = '', lineNumber = 0, columnNumber = 0) => ({
  functionName,
  url,
  lineNumber,
  columnNumber,
})

const find = (summary, name) => summary.code.find((stat) => stat.name === name)

test('charges each sample the interval that follows it, not the one before', () => {
  // timeDeltas[i] is the gap BEFORE samples[i], so samples[0] owns
  // timeDeltas[1]. A is on top for the first three samples and B for the last
  // two: A gets 200+300+400 = 900, B gets 500 plus whatever is left of the
  // window (nothing here — endTime matches the deltas).
  const profile = {
    startTime: 0,
    endTime: 1500,
    nodes: [
      { id: 1, callFrame: frame('(root)'), children: [2, 3] },
      { id: 2, callFrame: frame('A', 'http://x/src/a.ts', 10) },
      { id: 3, callFrame: frame('B', 'http://x/src/b.ts', 20) },
    ],
    samples: [2, 2, 2, 3, 3],
    timeDeltas: [100, 200, 300, 400, 500],
  }

  const summary = summariseProfile(profile)

  assert.equal(find(summary, 'A').self, 900)
  assert.equal(find(summary, 'B').self, 500)
  // The 100 µs before the first sample belongs to no sample and is dropped.
  assert.equal(summary.attributedUs, 1400)
  assert.equal(summary.measuredUs, 1500)
})

test('gives the last sample the remainder of the window', () => {
  const profile = {
    startTime: 0,
    endTime: 1000,
    nodes: [
      { id: 1, callFrame: frame('(root)'), children: [2] },
      { id: 2, callFrame: frame('A', 'http://x/src/a.ts', 10) },
    ],
    samples: [2, 2],
    timeDeltas: [100, 200],
  }

  // 200 for the first sample, then 1000 - 300 = 700 left for the last.
  assert.equal(find(summariseProfile(profile), 'A').self, 900)
})

test('counts recursion once per sample in total time', () => {
  // A calls itself: the stack is root → A → A. Without the per-sample de-dupe
  // A's total would be 2x the window.
  const profile = {
    startTime: 0,
    endTime: 300,
    nodes: [
      { id: 1, callFrame: frame('(root)'), children: [2] },
      { id: 2, callFrame: frame('A', 'http://x/src/a.ts', 10, 4), children: [3] },
      // Same function, same position — a recursive call, not a second function.
      { id: 3, callFrame: frame('A', 'http://x/src/a.ts', 10, 4), children: [4] },
      { id: 4, callFrame: frame('B', 'http://x/src/b.ts', 20, 2) },
    ],
    samples: [4, 4],
    timeDeltas: [0, 100, 200],
  }

  const summary = summariseProfile(profile)
  const a = find(summary, 'A')
  const b = find(summary, 'B')

  assert.equal(b.self, 300)
  assert.equal(a.self, 0)
  // 300, not 600: the two A frames on one stack are one charge.
  assert.equal(a.total, 300)
  assert.equal(b.total, 300)
})

test('keeps two different functions on one generated line apart', () => {
  const profile = {
    startTime: 0,
    endTime: 300,
    nodes: [
      { id: 1, callFrame: frame('(root)'), children: [2, 3] },
      { id: 2, callFrame: frame('(anonymous)', 'http://x/src/a.ts', 5, 10) },
      { id: 3, callFrame: frame('(anonymous)', 'http://x/src/a.ts', 5, 90) },
    ],
    samples: [2, 3],
    timeDeltas: [0, 100, 200],
  }

  const anonymous = summariseProfile(profile).code.filter((s) => s.name === '(anonymous)')
  assert.equal(anonymous.length, 2)
  assert.deepEqual(
    anonymous.map((s) => s.self).sort((a, b) => a - b),
    [100, 200]
  )
})

test('excludes synthetic frames from the percentage denominator', () => {
  const profile = {
    startTime: 0,
    endTime: 300,
    nodes: [
      { id: 1, callFrame: frame('(root)'), children: [2, 3] },
      { id: 2, callFrame: frame('A', 'http://x/src/a.ts', 1) },
      { id: 3, callFrame: frame('(idle)') },
    ],
    samples: [2, 3],
    timeDeltas: [0, 100, 200],
  }

  const summary = summariseProfile(profile)
  assert.equal(summary.codeSelfUs, 100)
  assert.equal(summary.synthetic.find((s) => s.name === '(idle)').self, 200)
})

test('resolves a generated position to its original file and line', () => {
  // One generated line, two mappings. VLQ fields are [genCol, srcIdx, srcLine,
  // srcCol] as deltas: "AAAA" is all zeros (generated col 0 → source 0, line 0),
  // and "SAgBA" steps the generated column by 9 and the source line by 16.
  const indexed = buildSourceMapIndex({
    sources: ['../../src/core/canvasRenderer.ts'],
    mappings: 'AAAA,SAgBA',
  })

  assert.deepEqual(resolvePosition(indexed, 0, 0), {
    source: '../../src/core/canvasRenderer.ts',
    line: 1,
  })
  assert.deepEqual(resolvePosition(indexed, 0, 20), {
    source: '../../src/core/canvasRenderer.ts',
    line: 17,
  })
  // No mapping for that generated line at all.
  assert.equal(resolvePosition(indexed, 4, 0), null)
})

test('labels an unresolved location as served, and a resolved one as source', () => {
  const profile = {
    startTime: 0,
    endTime: 200,
    nodes: [
      { id: 1, callFrame: frame('(root)'), children: [2] },
      { id: 2, callFrame: frame('drawClipToCanvas', 'http://localhost:5175/src/core/r.ts', 237, 0) },
    ],
    samples: [2],
    timeDeltas: [0],
  }

  const unmapped = find(summariseProfile(profile), 'drawClipToCanvas')
  assert.equal(locationOf(unmapped), '(served) src/core/r.ts:238')

  const mapped = find(
    summariseProfile(profile, {
      // 237 generated lines of nothing, then a mapping to source line 310
      // (VLQ "qT" is 309, the 0-based line).
      'http://localhost:5175/src/core/r.ts': {
        sources: ['/repo/apps/artist/src/core/canvasRenderer.ts'],
        mappings: ';'.repeat(237) + 'AAqTA',
      },
    }),
    'drawClipToCanvas'
  )
  assert.equal(locationOf(mapped), 'src/core/canvasRenderer.ts:310')
})
