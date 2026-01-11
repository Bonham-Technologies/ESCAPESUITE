import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright configuration for testing standalone builds.
 *
 * Standalone builds are single-file HTML apps that don't require auth.
 * This config serves the pre-built dist files and runs smoke tests.
 */
export default defineConfig({
  testDir: './tests/standalone',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { outputFolder: 'playwright-report-standalone' }]],

  use: {
    trace: 'on-first-retry',
    video: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Serve the pre-built standalone HTML files
  webServer: [
    {
      command: 'npx serve -s ../craft/dist -l 5184 --no-clipboard',
      port: 5184,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    {
      command: 'npx serve -s ../artist/dist -l 5185 --no-clipboard',
      port: 5185,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
})
