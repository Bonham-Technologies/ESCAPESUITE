import { defineConfig, devices } from '@playwright/test'

const isCI = !!process.env.CI

// Standalone, production-layout and perf tests use separate configs. The perf
// benchmarks in particular must never run here: they assert nothing, they take
// minutes of real encoding, and a run under this config's parallel workers
// would publish numbers measured while other browsers fought it for the CPU.
const baseIgnore = ['**/standalone/**', '**/production/**', '**/perf/**']

// ESCSUITE-352: specs whose whole point is catching intermittent breakage run in
// their own `chromium-strict` project with zero retries, so a pass-on-retry there
// fails CI instead of going green. The `chromium` project ignores them, so every
// spec still runs exactly once. Everything else keeps the CI retries below, and
// any pass-on-retry is surfaced by scripts/report-flaky.mjs.
export const strictSpecs = [
  '**/journeys/**',
  '**/escapeartist/soak.spec.ts',
  '**/regressions/**',
]

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
  testIgnore: baseIgnore,
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  // CI adds the list reporter so the job log carries one line per test — a run that hits the
  // job's timeout otherwise leaves no record of which test was running (ESCSUITE-292's #850).
  // The JSON report feeds scripts/report-flaky.mjs, which lists every pass-on-retry in the
  // job summary and as annotations (ESCSUITE-352). It sits outside playwright-report/ because
  // the html reporter empties that folder.
  reporter: isCI
    ? [['html'], ['list'], ['json', { outputFile: 'playwright-results.json' }]]
    : 'html',

  use: {
    trace: 'on-first-retry',
    video: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // A project's testIgnore replaces the top-level one, so repeat it.
      testIgnore: [...baseIgnore, ...strictSpecs],
    },
    {
      name: 'chromium-strict',
      use: { ...devices['Desktop Chrome'] },
      testMatch: strictSpecs,
      testIgnore: baseIgnore,
      retries: 0,
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
