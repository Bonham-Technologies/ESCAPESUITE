import { test, expect } from '@playwright/test'
import { readdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * ESCSUITE-153: `playwright.standalone.config.ts` serves each app's `dist/`
 * with `npx serve -s`, which happily serves a second file sitting next to
 * `index.html` — so the standalone ESCAPEARTIST build shipping
 * `index.html` *and* a separate `decodeWorker-*.js` chunk passed every
 * browser-driven standalone test here, even though `standalone-release.yml`
 * only ever attaches the HTML to the GitHub Release: a user who downloads it
 * gets no worker file at all, and an MP4 export hangs forever trying to
 * start one (ESCSUITE-29 Mechanism 2).
 *
 * These assertions run against the built `dist/` directories on disk, before
 * any browser opens, so a regression here fails fast instead of only
 * surfacing as a silent hang in a downloaded file nothing here exercises.
 * Build first: `pnpm build:standalone` (root) or, per app,
 * `pnpm --filter=@escapesuite/<app> run build:standalone`.
 */
function assertSingleFileDist(appLabel: string, distDir: string) {
  if (!existsSync(distDir)) {
    throw new Error(
      `${distDir} does not exist. Run the STANDALONE build first — ` +
      `"pnpm build:standalone" (repo root) or ` +
      `"pnpm --filter=@escapesuite/<app> run build:standalone" — before this test.`
    )
  }
  const files = readdirSync(distDir).sort()
  // A custom message rather than relying on toEqual's default diff: a plain
  // `pnpm build` (or `build:deploy`) leaves dist/ with index.html *and* a
  // separate decodeWorker-*.js chunk, which is exactly what the bug this
  // guards against looks like — so a failure here should say which build
  // mode was expected, not just report two array lengths that differ.
  const message =
    `${appLabel}'s dist/ (${distDir}) must contain exactly one file, index.html, ` +
    `which only the STANDALONE build produces — found [${files.join(', ')}]. ` +
    `If this ran against a hosted/plain build, run the standalone build first: ` +
    `"pnpm build:standalone" (repo root) or ` +
    `"pnpm --filter=@escapesuite/<app> run build:standalone".`
  expect(files, message).toEqual(['index.html'])
}

test.describe('standalone dist/ is exactly one file (ESCSUITE-153)', () => {
  test('ESCAPEARTIST', () => {
    assertSingleFileDist('ESCAPEARTIST', resolve(__dirname, '../../../artist/dist'))
  })

  test('ESCAPECRAFT', () => {
    assertSingleFileDist('ESCAPECRAFT', resolve(__dirname, '../../../craft/dist'))
  })
})
