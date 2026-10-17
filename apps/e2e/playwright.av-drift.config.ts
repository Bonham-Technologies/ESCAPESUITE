import { defineConfig, devices } from '@playwright/test'
import { PERF_LAUNCH_ARGS } from './utils/perf'

/**
 * Playwright configuration for the A/V drift rig — the ESCAPECRAFT arm
 * (`tests/perf/craft-av-drift.spec.ts`, ESCSUITE-296/297) and the ESCAPEARTIST
 * export arm (`tests/perf/artist-av-drift.spec.ts`, ESCSUITE-297) — and nothing
 * else.
 *
 * Its own config so neither `pnpm test:e2e` (`playwright.config.ts` ignores
 * `tests/perf/`) nor `pnpm perf` (`playwright.perf.config.ts` ignores this
 * spec by name) ever starts one of its multi-minute takes; the spec also skips
 * itself unless `AV_DRIFT=1`. Run one arm per invocation:
 *
 *     AV_DRIFT=1 AV_DRIFT_MODE=screen AV_DRIFT_LOAD=idle AV_DRIFT_SECONDS=180 \
 *       pnpm --filter @escapesuite/e2e run test:av-drift
 *
 * then `node apps/e2e/scripts/av-drift-report.mjs`.
 *
 * The ESCAPEARTIST arm imports a raw WebM an ESCAPECRAFT arm left behind and
 * exports it; it runs only when `AV_DRIFT_SOURCE` names that file (which also
 * makes the ESCAPECRAFT arm skip itself), and `AV_DRIFT_EXPORT=webm|mp4`
 * restricts it to one format:
 *
 *     AV_DRIFT=1 AV_DRIFT_SOURCE=/abs/path/recording_….webm \
 *       pnpm --filter @escapesuite/e2e run test:av-drift artist-av-drift --project=firefox
 *
 * One worker, no retries — a retried arm would overwrite its own result
 * directory with a take made under different conditions. The ESCAPECRAFT arm
 * is Chromium only, with the same launch args as the benchmarks; the
 * ESCAPEARTIST arm also has a `firefox` project (it needs no CDP). Both dev
 * servers are started (or reused). The timeout scales with the take: a take,
 * its save, and two conversions that each run at playback speed — or an
 * import and two exports of it.
 */
const seconds = Number(process.env.AV_DRIFT_SECONDS ?? 180)
const takeSeconds = Number.isFinite(seconds) ? seconds : 180

export default defineConfig({
  testDir: './tests/perf',
  testMatch: ['craft-av-drift.spec.ts', 'artist-av-drift.spec.ts'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],

  // `test.slow()` in the spec triples this.
  timeout: (takeSeconds * 3 + 300) * 1000,
  expect: { timeout: 30_000 },

  use: {
    acceptDownloads: true,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: { args: PERF_LAUNCH_ARGS } },
    },
    {
      name: 'firefox',
      testMatch: 'artist-av-drift.spec.ts',
      use: { ...devices['Desktop Firefox'] },
    },
  ],

  webServer: [
    {
      command: 'pnpm exec vite --port 5174 --strictPort',
      cwd: '../craft',
      port: 5174,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'pnpm exec vite --port 5175 --strictPort',
      cwd: '../artist',
      port: 5175,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
})
