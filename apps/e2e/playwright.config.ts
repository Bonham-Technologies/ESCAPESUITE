import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
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
      command: 'npm run dev',
      cwd: '../ESCAPEPLAN',
      port: 5173,
      reuseExistingServer: true,
      timeout: 120000,
      env: {
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || '',
      },
    },
    {
      command: 'npm run dev',
      cwd: '../ESCAPECRAFT',
      port: 5174,
      reuseExistingServer: true,
      timeout: 120000,
      env: {
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || '',
      },
    },
    {
      command: 'npm run dev',
      cwd: '../ESCAPEARTIST',
      port: 5175,
      reuseExistingServer: true,
      timeout: 120000,
      env: {
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || '',
      },
    },
  ],
})
