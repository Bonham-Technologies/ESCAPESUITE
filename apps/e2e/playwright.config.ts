import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/standalone/**'], // Standalone tests use separate config
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

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
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
      testMatch: '**/responsive/**',
    },
    {
      name: 'mobile-firefox',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 393, height: 851 },
        hasTouch: true,
      },
      testMatch: '**/responsive/**',
    },
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 12'] },
      testMatch: '**/responsive/**',
    },
    {
      name: 'tablet-chromium',
      use: {
        viewport: { width: 768, height: 1024 },
        isMobile: false,
        hasTouch: true,
      },
      testMatch: '**/responsive/**',
    },
    {
      name: 'tablet-firefox',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 768, height: 1024 },
        hasTouch: true,
      },
      testMatch: '**/responsive/**',
    },
    {
      name: 'tablet-webkit',
      use: {
        ...devices['iPad (gen 7)'],
        isMobile: false,
      },
      testMatch: '**/responsive/**',
    },
  ],

  webServer: [
    {
      command: 'pnpm run dev',
      cwd: '../plan',
      port: 5173,
      reuseExistingServer: true,
      timeout: 120000,
      env: {
        // Use test key if not provided - our route mocking intercepts all Clerk API calls
        VITE_CLERK_PUBLISHABLE_KEY:
          process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_mock_key_for_e2e_testing',
      },
    },
    {
      command: 'pnpm run dev',
      cwd: '../craft',
      port: 5174,
      reuseExistingServer: true,
      timeout: 120000,
      env: {
        VITE_CLERK_PUBLISHABLE_KEY:
          process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_mock_key_for_e2e_testing',
      },
    },
    {
      command: 'pnpm run dev',
      cwd: '../artist',
      port: 5175,
      reuseExistingServer: true,
      timeout: 120000,
      env: {
        VITE_CLERK_PUBLISHABLE_KEY:
          process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_mock_key_for_e2e_testing',
      },
    },
  ],
})
