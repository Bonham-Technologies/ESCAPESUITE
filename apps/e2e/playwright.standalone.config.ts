import { defineConfig, devices } from '@playwright/test'
import { CHROMIUM_TEST_ARGS } from './utils/chromiumLaunch'

const isCI = !!process.env.CI

/**
 * Playwright configuration for testing standalone builds.
 *
 * The offline build is a single self-contained HTML file with no backend.
 * This config serves the pre-built dist files and runs smoke tests.
 */
export default defineConfig({
  testDir: './tests/standalone',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: [['html', { outputFolder: 'playwright-report-standalone' }]],

  use: {
    trace: 'on-first-retry',
    video: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      // See utils/chromiumLaunch.ts (ESCSUITE-404).
      use: { ...devices['Desktop Chrome'], launchOptions: { args: CHROMIUM_TEST_ARGS } },
    },
    // Cross-browser projects only run locally (not in CI)
    ...(isCI
      ? []
      : [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        ]),
  ],

  // Serve the pre-built standalone HTML files with Vite's own static preview
  // server (ESCSUITE-410: replaces `npx serve -s`, whose serve-handler pins
  // minimatch 3.x, GHSA-g3hv-75wg-m249). Run from apps/e2e, which has no Vite
  // config, so neither app's config (base, plugins, preview port) applies;
  // unknown paths fall back to index.html the way `serve -s` did.
  webServer: [
    {
      command: 'pnpm exec vite preview --outDir ../craft/dist --port 5184 --strictPort',
      port: 5184,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    {
      command: 'pnpm exec vite preview --outDir ../artist/dist --port 5185 --strictPort',
      port: 5185,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
})
