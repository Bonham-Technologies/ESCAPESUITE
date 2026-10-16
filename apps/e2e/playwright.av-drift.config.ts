import { defineConfig, devices } from '@playwright/test'
import { PERF_LAUNCH_ARGS } from './utils/perf'

/**
 * Playwright configuration for the ESCAPECRAFT A/V drift rig
 * (`tests/perf/craft-av-drift.spec.ts`, ESCSUITE-296/297) — and nothing else.
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
 * Chromium only, one worker, no retries — a retried arm would overwrite its
 * own result directory with a take made under different conditions — and the
 * same launch args as the benchmarks. Only ESCAPECRAFT's dev server is started.
 * The timeout scales with the take: a take, its save, and two conversions that
 * each run at playback speed.
 */
const seconds = Number(process.env.AV_DRIFT_SECONDS ?? 180)
const takeSeconds = Number.isFinite(seconds) ? seconds : 180

export default defineConfig({
  testDir: './tests/perf',
  testMatch: 'craft-av-drift.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],

  // `test.slow()` in the spec triples this.
  timeout: (takeSeconds * 3 + 300) * 1000,
  expect: { timeout: 30_000 },

  use: {
    ...devices['Desktop Chrome'],
    launchOptions: { args: PERF_LAUNCH_ARGS },
    acceptDownloads: true,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
  },

  projects: [{ name: 'chromium' }],

  webServer: [
    {
      command: 'pnpm exec vite --port 5174 --strictPort',
      cwd: '../craft',
      port: 5174,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
})
