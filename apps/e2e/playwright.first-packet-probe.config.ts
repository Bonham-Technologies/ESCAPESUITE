import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright configuration for the ESCSUITE-321 U-1 probe
 * (`tests/perf/first-packet.probe.spec.ts`) and nothing else: one short
 * ESCAPECRAFT take on Chromium (the control) or Firefox, the first Opus
 * packets printed. The spec also skips itself unless `ESCSUITE_321_PROBE` is
 * set, so this config collects it without ever running it by accident:
 *
 *     ESCSUITE_321_PROBE=1 pnpm --filter @escapesuite/e2e exec playwright test \
 *       --config=playwright.first-packet-probe.config.ts --project=firefox
 *
 * One worker, no retries: a retry would overwrite the take it is reporting.
 */
export default defineConfig({
  testDir: './tests/perf',
  testMatch: ['first-packet.probe.spec.ts'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 180_000,
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
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],

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
