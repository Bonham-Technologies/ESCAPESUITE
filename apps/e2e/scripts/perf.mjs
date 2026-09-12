#!/usr/bin/env node
/**
 * `pnpm perf` — run every benchmark, then always write the report.
 *
 * The report step must not be conditional on the benchmarks succeeding. A run
 * where the MP4 export died is exactly the run whose surviving numbers you want
 * to read, and a `&&` chain would throw them away. So the benchmarks run in
 * sequence, failures are remembered rather than thrown, the report is generated
 * from whatever inputs exist, and the exit code reflects the benchmarks.
 *
 * Sequence matters as much as completeness: two benchmarks sharing a CPU are
 * two benchmarks measuring each other.
 *
 * Node built-ins only — this runs in a CI job that installed nothing beyond the
 * workspace.
 */
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../../..')

/**
 * Benchmarks, in the order they run. Each is a package script, and each names the
 * output it is the only writer of — deleted before it runs, so a benchmark that
 * fails (or fails to even load) leaves nothing behind for the report to present
 * as this run's number. The browser project clears its own directory in
 * `scripts/perf-global-setup.ts`; the kit's single file has no such hook, and
 * this is where it gets one.
 */
const BENCHMARKS = [
  {
    label: 'browser benchmarks',
    args: ['--filter', '@escapesuite/e2e', 'run', 'test:perf'],
    stale: [path.join(REPO_ROOT, 'apps/e2e/perf-results')],
  },
  {
    label: 'headless kit benchmark',
    args: ['--filter', '@escapesuite/headless-artist', 'run', 'test:perf'],
    stale: [path.join(REPO_ROOT, 'services/headless-artist/perf-report.json')],
  },
]

const failed = []

for (const benchmark of BENCHMARKS) {
  console.log(`\n=== ${benchmark.label} ===\n`)
  for (const stalePath of benchmark.stale) {
    rmSync(stalePath, { recursive: true, force: true })
  }
  const result = spawnSync('pnpm', benchmark.args, { cwd: REPO_ROOT, stdio: 'inherit' })
  if (result.error || result.status !== 0) {
    failed.push(benchmark.label)
    console.error(`\n=== ${benchmark.label} FAILED — continuing so the report still runs ===\n`)
  }
}

console.log('\n=== report ===\n')
const report = spawnSync('node', [path.join(HERE, 'perf-report.mjs')], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
})
if (report.error || report.status !== 0) {
  // perf-report.mjs is written never to fail; if it somehow does, say so and
  // still let the benchmark result decide the exit code.
  console.error('perf: report generation failed')
}

if (failed.length > 0) {
  console.error(`\nperf: ${failed.length} benchmark(s) failed: ${failed.join(', ')}`)
  console.error('perf: perf-report.json holds whatever did complete.')
  process.exit(1)
}
