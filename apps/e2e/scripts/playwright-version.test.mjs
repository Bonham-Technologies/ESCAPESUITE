/**
 * Pins the one fact `.github/workflows/ci.yml`'s `e2e` job cache-key comment
 * depends on without naming a version: `services/headless-artist`'s
 * `playwright` dependency and `apps/e2e`'s `@playwright/test` devDependency
 * resolve to the same version. The `e2e` job's browser cache is keyed off
 * both package.json files (`hashFiles('apps/e2e/package.json',
 * 'services/headless-artist/package.json')`) precisely so the two share one
 * cached Chromium — if they ever drift, the headless-artist Chromium tests
 * step fails at runtime with "browserType.launch: Executable doesn't exist"
 * rather than silently downloading a second browser. This test catches the
 * drift before that, at the package.json level, so the comment phrased
 * "keep the two package.json entries identical" never goes stale the way the
 * literal version number it replaced did (ESCSUITE-204 / K-11).
 *
 * Node's built-in runner, no dependencies:
 *
 *   pnpm --filter @escapesuite/e2e run test:scripts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../../..')

function readPackageJson(relativePath) {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, relativePath), 'utf8'))
}

/**
 * Strip a semver range operator (`^`, `~`, `>=`, ...) so `^1.63.0` and
 * `1.63.0` compare equal — the two packages pin the version differently
 * (a caret range for the devDependency, an exact pin for the dependency),
 * and the point of this test is that the underlying version matches, not
 * that the two strings are byte-identical.
 */
export function bareVersion(range) {
  return range.replace(/^[^\d]*/, '')
}

test('bareVersion strips a leading range operator', () => {
  assert.equal(bareVersion('^1.63.0'), '1.63.0')
  assert.equal(bareVersion('~1.63.0'), '1.63.0')
  assert.equal(bareVersion('>=1.63.0'), '1.63.0')
})

test('bareVersion leaves an exact version untouched', () => {
  assert.equal(bareVersion('1.63.0'), '1.63.0')
})

test('apps/e2e and services/headless-artist pin the same Playwright version', () => {
  const e2ePkg = readPackageJson('apps/e2e/package.json')
  const kitPkg = readPackageJson('services/headless-artist/package.json')

  const e2eRange = e2ePkg.devDependencies?.['@playwright/test']
  const kitRange = kitPkg.dependencies?.playwright

  assert.ok(typeof e2eRange === 'string', 'apps/e2e/package.json has no @playwright/test devDependency')
  assert.ok(
    typeof kitRange === 'string',
    'services/headless-artist/package.json has no playwright dependency'
  )

  assert.equal(
    bareVersion(kitRange),
    bareVersion(e2eRange),
    'services/headless-artist and apps/e2e pin different Playwright versions — ' +
      'the e2e job shares one browser cache between them and expects them to match'
  )
})
