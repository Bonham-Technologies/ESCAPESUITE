import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SERVICE_ROOT = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(SERVICE_ROOT, '../..')

/**
 * Builds the headless bundle + kit ONCE, before any test file runs, instead of each
 * `*.chromium.test.ts` file rebuilding it in its own `beforeAll`. With three chromium test
 * files and `fileParallelism: false` serializing them, that used to mean three full builds
 * back-to-back before a single test ran.
 *
 * `pnpm --filter=@escapesuite/headless-artist run build` runs the kit assembler, which itself
 * builds `apps/artist/dist-headless/headless.html` (via the artist's own `build:headless`
 * script) and then bundles `dist/cli.js` and writes `dist/kit.json` — one run produces
 * everything all three chromium test files read: `renderDriver.chromium.test.ts` and
 * `run.chromium.test.ts` only need the bundle, `cli.chromium.test.ts` also needs `dist/cli.js`.
 *
 * `globalSetup` runs for every vitest invocation in this package, including the plain unit
 * suite (`test:run`), which never touches Chromium or the bundle and must not pay for this
 * build. `test:e2e` sets `HEADLESS_BUILD=1` specifically to opt in; everything else is a no-op.
 */
export default function setup(): void {
  if (process.env.HEADLESS_BUILD !== '1') return

  execSync('pnpm --filter=@escapesuite/headless-artist run build', {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
}
