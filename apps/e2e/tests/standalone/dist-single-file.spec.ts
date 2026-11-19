import { test, expect } from '@playwright/test'
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { findCspMetas, findScripts, networkSources, parseCsp, scriptHash } from '../../../../scripts/offline-csp.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * ESCSUITE-153: `playwright.standalone.config.ts` serves each app's `dist/`
 * with a static server (`vite preview` since ESCSUITE-410, `npx serve -s`
 * before), which happily serves a second file sitting next to
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

/**
 * ESCSUITE-467: each offline file carries exactly one Content-Security-Policy
 * `<meta>`, ahead of every script, whose policy admits no network scheme or
 * host and lets in exactly the file's own inline scripts. The release workflow
 * copies `dist/index.html` byte for byte to the versioned and `-latest.html`
 * assets, so this is the check for the files users download. The browser side
 * (an injected fetch, WebSocket and remote image all refused) is
 * `offline-csp.spec.ts`; the policy builder's own rules are
 * `scripts/offline-csp.test.mjs`.
 */
function assertOfflinePolicy(distDir: string) {
  const html = readFileSync(resolve(distDir, 'index.html'), 'utf8')

  const metas = findCspMetas(html)
  expect(metas, 'exactly one Content-Security-Policy <meta>').toHaveLength(1)
  const [meta] = metas

  const scripts = findScripts(html)
  expect(scripts.length, 'the build has scripts to protect').toBeGreaterThan(0)
  expect(meta.index, 'the policy <meta> comes before every <script>').toBeLessThan(scripts[0].index)

  const directives = new Map(parseCsp(meta.policy).map((d) => [d.name, d.sources]))
  expect(directives.get('default-src')).toEqual(["'none'"])
  expect(directives.get('base-uri')).toEqual(["'none'"])
  expect(directives.get('form-action')).toEqual(["'none'"])
  expect(networkSources(meta.policy), `no directive may admit the network: ${meta.policy}`).toEqual([])

  // Inline scripts run by hash, never by 'unsafe-inline', and every hash is
  // one of this file's own scripts.
  const scriptSrc = directives.get('script-src') ?? []
  expect(scriptSrc).not.toContain("'unsafe-inline'")
  const ownHashes = scripts.filter((s) => s.executable).map((s) => scriptHash(s.text))
  expect(scriptSrc.filter((source) => source.startsWith("'sha256-")).sort()).toEqual([...ownHashes].sort())
}

test.describe('standalone dist/ carries the offline Content-Security-Policy (ESCSUITE-467)', () => {
  test('ESCAPEARTIST', () => {
    assertOfflinePolicy(resolve(__dirname, '../../../artist/dist'))
  })

  test('ESCAPECRAFT', () => {
    assertOfflinePolicy(resolve(__dirname, '../../../craft/dist'))
  })
})

/**
 * ESCSUITE-469: the hosted deployment's service worker, web manifest and
 * their registration are written by `scripts/offline.mjs` into the combined
 * `dist/` only. The offline file runs from `file://`, where a service worker
 * cannot exist and a manifest link would be a request for a file that is not
 * there, so neither may ever reach the standalone HTML.
 */
function assertNoOfflineRegistration(appLabel: string, distDir: string) {
  const html = readFileSync(resolve(distDir, 'index.html'), 'utf8')
  // No bundled library mentions the API either, so any mention is a registration.
  expect(html, `${appLabel}'s standalone HTML registers a service worker`).not.toContain('serviceWorker')
  expect(html, `${appLabel}'s standalone HTML links a web manifest`).not.toMatch(/rel=["']?manifest/)
  expect(html).not.toContain('escapesuite-offline')
}

test.describe('standalone HTML has no service worker registration (ESCSUITE-469)', () => {
  test('ESCAPEARTIST', () => {
    assertNoOfflineRegistration('ESCAPEARTIST', resolve(__dirname, '../../../artist/dist'))
  })

  test('ESCAPECRAFT', () => {
    assertNoOfflineRegistration('ESCAPECRAFT', resolve(__dirname, '../../../craft/dist'))
  })
})
