import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { LoadedJob } from './loaders'
import { renderInChromium } from './renderDriver'
import type { RenderFileInput } from './types'

/**
 * Benchmark: the headless kit rendering the shared fixture project.
 *
 * The third leg of `pnpm perf`. The browser benchmarks in `apps/e2e/tests/perf`
 * measure the editor; this measures the same export engine driven from a
 * server, launch included — which is the number an operator sizing a render box
 * actually cares about.
 *
 * It asserts only that the renders produced bytes. The numbers go to
 * `perf-report.json` beside this package, which `apps/e2e/scripts/perf-report.mjs`
 * merges into the repo-root report; a CPU-speed threshold would fail on a slow
 * runner and pass on a fast one regardless of the code.
 *
 * Named `*.chromium.test.ts` so `test:run` (and CI's `test` job, and coverage)
 * skip it: it launches a real browser and encodes real video.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SERVICE_ROOT = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(SERVICE_ROOT, '../..')
const BUNDLE = path.join(REPO_ROOT, 'apps/artist/dist-headless/headless.html')
const FIXTURE_DIR = path.join(REPO_ROOT, 'apps/e2e/fixtures/headless')
const REPORT_PATH = path.join(SERVICE_ROOT, 'perf-report.json')

/** Runs per benchmark, matching the browser benchmarks. Wall time is the median. */
const RUNS = 3

/** The export engine renders at a fixed 30 fps (see apps/artist/src/core/exportMP4.ts). */
const EXPORT_FPS = 30

/** Chromium launch plus three real encodes on a cold machine. */
const TIMEOUT_MS = 300_000

/** Silences the driver's progress chatter; the report is the output that matters. */
const quiet = () => {}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

let job: LoadedJob
let outDir: string

beforeAll(async () => {
  // The same project.json the browser benchmarks build their scene's source from,
  // loaded straight rather than through a manifest: the fixture already *is* a
  // RenderInput payload, and its one source sits beside it on disk.
  const fixture = JSON.parse(
    await fs.readFile(path.join(FIXTURE_DIR, 'project.json'), 'utf8')
  ) as Pick<RenderFileInput, 'project' | 'sourceVideos'>

  job = {
    project: fixture.project,
    sourceVideos: fixture.sourceVideos,
    sourceFiles: { 'src-0': path.join(FIXTURE_DIR, 'source.mp4') },
    cleanup: async () => {},
  }
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'headless-perf-'))
})

afterAll(async () => {
  if (outDir) await fs.rm(outDir, { recursive: true, force: true })
})

describe('perf: headless kit render', () => {
  it(
    `renders the fixture project ${RUNS} times and reports the median`,
    async () => {
      const wallMs: number[] = []
      let byteLength = 0
      let durationSec = 0

      for (let run = 0; run < RUNS; run++) {
        const outputPath = path.join(outDir, `perf-${run}.mp4`)
        const startedAt = Date.now()
        const result = await renderInChromium(
          BUNDLE,
          job,
          { format: 'mp4', quality: 'medium' },
          outputPath,
          { log: quiet }
        )
        wallMs.push(Date.now() - startedAt)
        byteLength = result.meta.byteLength
        durationSec = result.meta.durationSec
        expect(byteLength).toBeGreaterThan(0)
      }

      const medianWallMs = median(wallMs)
      const frames = Math.ceil(durationSec * EXPORT_FPS)
      const report = {
        name: 'headless-kit-render',
        runs: RUNS,
        // Whole `renderInChromium` call: Chromium launch, page load, source
        // upload, encode and download. That is what the CLI costs per job, and
        // for a one-second fixture the launch dominates it — the number tracks
        // the kit's fixed overhead as much as its throughput.
        wallMs: medianWallMs,
        framesEncoded: frames,
        framesPerSecond: Math.round((frames / (medianWallMs / 1000)) * 100) / 100,
        format: 'mp4',
        outputBytes: byteLength,
      }

      await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + '\n')
      // One JSON line to stdout, so a bare `test:perf` run is readable on its own.
      console.log(JSON.stringify(report))
    },
    TIMEOUT_MS
  )
})
