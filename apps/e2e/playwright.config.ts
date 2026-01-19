import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/standalone/**', '**/journeys/**'], // Standalone and journey tests use separate configs
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
  ],

  webServer: [
    {
      command: 'pnpm run dev',
      cwd: '../plan',
      port: 5173,
      reuseExistingServer: true,
      timeout: 120000,
      env: {
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || '',
      },
    },
    {
      command: 'pnpm run dev',
      cwd: '../craft',
      port: 5174,
      reuseExistingServer: true,
      timeout: 120000,
      env: {
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || '',
      },
    },
    {
      command: 'pnpm run dev',
      cwd: '../artist',
      port: 5175,
      reuseExistingServer: true,
      timeout: 120000,
      env: {
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || '',
      },
    },
  ],
})
