import { defineConfig, devices } from '@playwright/test'
import { PERF_LAUNCH_ARGS } from './utils/perf'

/**
 * Playwright configuration for the performance benchmarks (`pnpm perf`).
 *
 * These are measurements, not assertions, so the usual E2E knobs are wrong here:
 *
 * - Chromium only. The preview composites through WebCodecs-backed paths and
 *   export needs `VideoEncoder`, which no other engine implements.
 * - One worker, never parallel. A second browser sharing the CPU would change
 *   the number the first one is reporting.
 * - No retries. A retried run would overwrite `perf-results/` with numbers taken
 *   under different conditions; a failed benchmark should be missing, not wrong.
 * - Fixed launch args (see `PERF_LAUNCH_ARGS`) — `performance.memory` needs
 *   `--enable-precise-memory-info`, and software rasterisation keeps a local
 *   number comparable to a CI one.
 *
 * Both apps are started, each on a strict port rather than relying on Vite's
 * port auto-increment: ESCAPEARTIST on 5175 for the preview, timeline and
 * export benchmarks, ESCAPECRAFT on 5174 for the recording and MP4-conversion
 * ones. `reuseExistingServer` is on, so a dev server already running on either
 * port is used as-is — which is also what makes a warm-server invocation
 * comparable to the numbers in the baseline docs.
 */
export default defineConfig({
  testDir: './tests/perf',
  // Empties perf-results/ first, so a benchmark that fails cannot leave last
  // run's JSON behind for the report to present as this run's.
  globalSetup: './scripts/perf-global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],

  // Three runs of a real encode, twice over, on a cold machine.
  timeout: 15 * 60 * 1000,
  expect: { timeout: 30_000 },

  use: {
    ...devices['Desktop Chrome'],
    launchOptions: { args: PERF_LAUNCH_ARGS },
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },

  projects: [{ name: 'chromium' }],

  webServer: [
    {
      command: 'pnpm exec vite --port 5175 --strictPort',
      cwd: '../artist',
      port: 5175,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'pnpm exec vite --port 5174 --strictPort',
      cwd: '../craft',
      port: 5174,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
})
