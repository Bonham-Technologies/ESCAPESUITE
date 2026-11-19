import { defineConfig, devices } from '@playwright/test'
import { NO_LOCAL_FILE_PICKERS } from './utils/filePickers'

const isCI = !!process.env.CI

/**
 * Playwright configuration for the production (single-origin) layout.
 *
 * `pnpm build:deploy` assembles every app into the root `dist/` folder, exactly
 * as Vercel serves it: ESCAPEPLAN at `/`, ESCAPECRAFT at `/craft/`, ESCAPEARTIST
 * at `/artist/`. Serving that folder on ONE port reproduces production's origin
 * model, so CRAFT and ARTIST share the `video-editor-db` IndexedDB database —
 * something the dev servers (5174 / 5175, two origins) cannot do.
 *
 * `scripts/serve-dist.mjs` mirrors `vercel.json`'s rewrites; `npx serve` cannot
 * (see the comment at the top of that script).
 *
 * Chromium only: the handoff tests record with WebCodecs/MediaRecorder.
 */
export default defineConfig({
  testDir: './tests/production',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: [['html', { outputFolder: 'playwright-report-production' }], ['list']],

  use: {
    trace: 'on-first-retry',
    video: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      // Without the local file pickers, so exports download (`utils/filePickers.ts`).
      use: { ...devices['Desktop Chrome'], launchOptions: { args: [NO_LOCAL_FILE_PICKERS] } },
    },
  ],

  // Serve the pre-built combined dist folder (run `pnpm build:deploy` first)
  webServer: {
    command: 'node scripts/serve-dist.mjs --port 5190',
    port: 5190,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
})
