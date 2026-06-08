import { defineConfig, devices } from '@playwright/test'
import { MOCK_SUPABASE_URL, MOCK_SUPABASE_ANON_KEY } from './utils/auth'

const isCI = !!process.env.CI

// Force the deterministic mock Supabase project for all dev servers so the
// supabase-js client derives the same localStorage key the auth mock seeds
// (see utils/auth.ts). E2E never hits a real Supabase — all calls are mocked.
const devEnv = {
  VITE_SUPABASE_URL: MOCK_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: MOCK_SUPABASE_ANON_KEY,
  // Dummy Stripe key so @stripe/stripe-js doesn't throw on init; checkout is
  // mocked in stripe-mocks.ts and js.stripe.com is aborted there.
  VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_e2e_mock',
}

const crossBrowserProjects = [
  {
    name: 'firefox',
    use: { ...devices['Desktop Firefox'] },
  },
  {
    name: 'webkit',
    use: { ...devices['Desktop Safari'] },
  },
]

const crossBrowserResponsiveProjects = [
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
]

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/standalone/**'], // Standalone tests use separate config
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
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
    // Cross-browser projects only run locally (not in CI)
    ...(isCI ? [] : crossBrowserProjects),
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
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
    // Cross-browser responsive projects only run locally
    ...(isCI ? [] : crossBrowserResponsiveProjects),
  ],

  webServer: [
    {
      command: 'pnpm run dev',
      cwd: '../plan',
      port: 5173,
      reuseExistingServer: true,
      timeout: 120000,
      env: devEnv,
    },
    {
      command: 'pnpm run dev',
      cwd: '../craft',
      port: 5174,
      reuseExistingServer: true,
      timeout: 120000,
      env: devEnv,
    },
    {
      command: 'pnpm run dev',
      cwd: '../artist',
      port: 5175,
      reuseExistingServer: true,
      timeout: 120000,
      env: devEnv,
    },
  ],
})
