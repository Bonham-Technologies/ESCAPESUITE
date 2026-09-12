import { rmSync } from 'node:fs'
import { PERF_RESULTS_DIR } from '../utils/perf'

/**
 * Wipe the previous run's benchmark JSON before this one starts.
 *
 * `scripts/perf-report.mjs` merges every file in `perf-results/`, so without
 * this a benchmark that failed (or that was filtered out with `--grep`) would
 * leave its last successful result behind and the report would present a stale
 * number as this run's. Silently wrong beats loudly missing only in the sense
 * that nobody notices — which is why the directory starts empty every time.
 *
 * Wired as the perf project's `globalSetup`, so it also covers a bare
 * `pnpm --filter @escapesuite/e2e run test:perf`, not just `pnpm perf`.
 */
export default function clearPerfResults(): void {
  rmSync(PERF_RESULTS_DIR, { recursive: true, force: true })
}
