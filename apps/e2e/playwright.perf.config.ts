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
 * Only ESCAPEARTIST is started, on a strict 5175 rather than relying on Vite's
 * port auto-increment, because it is the only app the benchmarks touch.
 */
export default defineConfig({
  testDir: './tests/perf',
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
  ],
})
