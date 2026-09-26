#!/usr/bin/env node
/**
 * `node scripts/perf-paired.mjs [rounds=3]` — ESCSUITE-86's paired measurement.
 *
 * `craft-screen-recording` records 27.97–29.2 fps against a 30 Hz capture
 * rather than a clean 30, and the leading theory is beating between
 * `mockSyntheticMedia`'s 33 ms `setInterval` painter and the 30 Hz
 * `captureStream` sampler — a harness artefact, not a recorder cost. This runs
 * the benchmark's **screen** arm alone, round-robin alternating the interval
 * painter (control) and a `requestAnimationFrame` painter that cannot beat
 * against the sampler the same way, `rounds` times each, and reports both
 * arms' `framesPerSecond` and `taskMsPerFrame` side by side.
 *
 * Round-robin rather than all-interval-then-all-raf so drift over the run
 * (a warming machine, a throttling one) affects both arms rather than being
 * charged to whichever ran second — the same reasoning as the paired
 * before/after in `docs/performance/2026-09-12-profile.md`.
 *
 * Node built-ins only, in the style of `scripts/perf.mjs`.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const E2E_ROOT = path.resolve(HERE, '..')
const RESULT_FILE = path.join(E2E_ROOT, 'perf-results', 'craft-screen-recording.json')

const rounds = Number.parseInt(process.argv[2] ?? '3', 10)
if (!Number.isInteger(rounds) || rounds < 1) {
  console.error(`perf-paired: rounds must be a positive integer, got ${process.argv[2]}`)
  process.exit(1)
}

function median(values) {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const rows = []
let anyFailed = false

for (let i = 0; i < rounds * 2; i++) {
  const painter = i % 2 === 0 ? 'interval' : 'raf'
  const round = Math.floor(i / 2) + 1
  console.log(`\n=== round ${round}/${rounds}, painter=${painter} ===\n`)

  const result = spawnSync(
    'npx',
    [
      'playwright',
      'test',
      '--config',
      'playwright.perf.config.ts',
      'tests/perf/craft-recording.spec.ts',
      '-g',
      'screen takes',
    ],
    { cwd: E2E_ROOT, stdio: 'inherit', env: { ...process.env, PERF_PAINTER: painter } }
  )

  if (result.error || result.status !== 0) {
    anyFailed = true
    console.error(`perf-paired: round ${round} (${painter}) FAILED — no result to read`)
    continue
  }

  // Read right after this invocation: the perf project's globalSetup empties
  // perf-results/ at the start of the *next* invocation, not this one.
  try {
    const data = JSON.parse(readFileSync(RESULT_FILE, 'utf8'))
    rows.push({ round, painter, fps: data.framesPerSecond, taskMsPerFrame: data.taskMsPerFrame })
  } catch (err) {
    anyFailed = true
    console.error(`perf-paired: round ${round} (${painter}) produced no readable result: ${err}`)
  }
}

console.log('\n=== ESCSUITE-86 paired result: craft-screen-recording ===\n')
console.log('| Round | Painter | fps | taskMsPerFrame |')
console.log('|---|---|---|---|')
for (const row of rows) {
  console.log(`| ${row.round} | ${row.painter} | ${row.fps} | ${row.taskMsPerFrame} |`)
}

console.log('\n| Painter | fps min | fps median | fps max | taskMsPerFrame min | taskMsPerFrame median | taskMsPerFrame max |')
console.log('|---|---|---|---|---|---|---|')

const arms = {}
for (const painter of ['interval', 'raf']) {
  const fps = rows.filter((r) => r.painter === painter).map((r) => r.fps)
  const taskMs = rows.filter((r) => r.painter === painter).map((r) => r.taskMsPerFrame)
  arms[painter] = { fps, taskMs }
  const fmt = (values) =>
    values.length === 0
      ? ['-', '-', '-']
      : [Math.min(...values), median(values), Math.max(...values)]
  const [fpsMin, fpsMedian, fpsMax] = fmt(fps)
  const [taskMin, taskMedian, taskMax] = fmt(taskMs)
  console.log(
    `| ${painter} | ${fpsMin} | ${fpsMedian} | ${fpsMax} | ${taskMin} | ${taskMedian} | ${taskMax} |`
  )
}

const intervalFps = arms.interval.fps
const rafFps = arms.raf.fps
let disjoint = 'inconclusive (one arm produced no results)'
if (intervalFps.length > 0 && rafFps.length > 0) {
  const intervalRange = [Math.min(...intervalFps), Math.max(...intervalFps)]
  const rafRange = [Math.min(...rafFps), Math.max(...rafFps)]
  const overlap = intervalRange[0] <= rafRange[1] && rafRange[0] <= intervalRange[1]
  disjoint = overlap ? 'no — fps ranges overlap' : 'yes — fps ranges are disjoint'
}
console.log(`\nfps ranges disjoint: ${disjoint}`)

if (anyFailed) {
  console.error('\nperf-paired: at least one invocation failed; see above.')
  process.exit(1)
}
