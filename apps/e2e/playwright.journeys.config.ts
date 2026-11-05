import { defineConfig, devices } from '@playwright/test'

const isCI = !!process.env.CI

/**
 * Playwright configuration for user journey tests.
 *
 * Journey tests are comprehensive, multi-step tests that simulate real user
 * workflows. They have extended timeouts and run serially to maintain state.
 */
export default defineConfig({
  testDir: './tests/journeys',
  fullyParallel: false, // Journeys run serially for proper flow testing
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1, // Single worker for sequential execution
  reporter: [
    ['html', { outputFolder: 'playwright-report-journeys' }],
    ['list'],
  ],

  // Extended timeouts for multi-step flows
  timeout: 60000, // 60s per test (vs 30s default)
  expect: {
    timeout: 10000, // 10s for assertions
  },

  use: {
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Cross-browser projects only run locally (not in CI)
    ...(isCI
      ? []
      : [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        ]),
  ],

  // Start all three apps for full journey testing
  webServer: [
    {
      command: 'pnpm run dev',
      cwd: '../plan',
      port: 5173,
      reuseExistingServer: true,
      timeout: 120000,
    },
    {
      command: 'pnpm run dev',
      cwd: '../craft',
      port: 5174,
      reuseExistingServer: true,
      timeout: 120000,
    },
    {
      command: 'pnpm run dev',
      cwd: '../artist',
      port: 5175,
      reuseExistingServer: true,
      timeout: 120000,
    },
  ],
})
