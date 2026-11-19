/**
 * Unit tests for `changed-specs.mjs` (ESCSUITE-478), plus a weak guard on the
 * `e2e-cross-browser` job in `.github/workflows/ci.yml`: it greps the YAML for
 * the wiring the job depends on (a PR's own CI run is what proves the job).
 *
 *   pnpm --filter @escapesuite/e2e run test:scripts
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  findAccessibilitySpecs,
  isPlaywrightBump,
  parseNameStatusZ,
  planRun,
  selectChangedSpecs,
} from './changed-specs.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(here, 'changed-specs.mjs')
const e2eDir = path.resolve(here, '..')
const repoRoot = path.resolve(here, '../../..')

test('selectChangedSpecs keeps added and modified specs under apps/e2e/tests, relative to apps/e2e', () => {
  const nameStatus = [
    'A\tapps/e2e/tests/regressions/ESCSUITE-900.spec.ts',
    'M\tapps/e2e/tests/escapecraft/recording.spec.ts',
    'M\tapps/e2e/tests/accessibility/core.spec.ts',
  ].join('\n')
  assert.deepEqual(selectChangedSpecs(nameStatus), [
    'tests/accessibility/core.spec.ts',
    'tests/escapecraft/recording.spec.ts',
    'tests/regressions/ESCSUITE-900.spec.ts',
  ])
})

test('selectChangedSpecs ignores deleted files, non-spec files and files outside apps/e2e/tests', () => {
  const nameStatus = [
    'D\tapps/e2e/tests/regressions/ESCSUITE-100.spec.ts',
    'M\tapps/e2e/utils/artist.ts',
    'M\tapps/e2e/tests/regressions/helpers.ts',
    'A\tapps/e2e/tests/fixtures/clip.webm',
    'M\tapps/e2e/playwright.config.ts',
    'M\tapps/artist/src/foo.spec.ts',
    'A\tservices/headless-artist/tests/render.spec.ts',
    'M\tapps/e2e/tests-old/x.spec.ts',
    'M\tapps/e2e/tests/escapeartist/thing.test.ts',
    '',
  ].join('\n')
  assert.deepEqual(selectChangedSpecs(nameStatus), [])
})

test('selectChangedSpecs ignores specs that belong to another Playwright config', () => {
  // playwright.config.ts ignores these folders; naming one of them as a filter
  // would match nothing (and they run in the standalone job or not in CI at all).
  const nameStatus = [
    'M\tapps/e2e/tests/standalone/craft.spec.ts',
    'M\tapps/e2e/tests/production/csp-media.spec.ts',
    'A\tapps/e2e/tests/perf/visual.spec.ts',
    'M\tapps/e2e/tests/escapeplan/perf-hints.spec.ts',
  ].join('\n')
  assert.deepEqual(selectChangedSpecs(nameStatus), ['tests/escapeplan/perf-hints.spec.ts'])
})

test('selectChangedSpecs treats a rename or copy as its new path and drops duplicates', () => {
  const nameStatus = [
    'R100\tapps/e2e/tests/regressions/old.spec.ts\tapps/e2e/tests/regressions/new.spec.ts',
    'C075\tapps/e2e/tests/regressions/a.spec.ts\tapps/e2e/tests/regressions/b.spec.ts',
    'M\tapps/e2e/tests/regressions/new.spec.ts',
    'T\tapps/e2e/tests/regressions/c.spec.ts',
  ].join('\n')
  assert.deepEqual(selectChangedSpecs(nameStatus), [
    'tests/regressions/b.spec.ts',
    'tests/regressions/c.spec.ts',
    'tests/regressions/new.spec.ts',
  ])
})

test('selectChangedSpecs refuses a spec path a shell or GITHUB_OUTPUT could misread', () => {
  // A pull request names its own files; the list reaches a run: step unquoted.
  for (const bad of [
    'apps/e2e/tests/regressions/$(id).spec.ts',
    'apps/e2e/tests/regressions/a b.spec.ts',
    'apps/e2e/tests/regressions/a*.spec.ts',
    'apps/e2e/tests/regressions/a;rm.spec.ts',
    'apps/e2e/tests/regressions/"quoted".spec.ts',
  ]) {
    assert.throws(() => selectChangedSpecs(`A\t${bad}`), /unsafe/i, bad)
  }
})

test('parseNameStatusZ reads git -z output, renames included, so an odd name is checked as itself', () => {
  const z = [
    'M', 'apps/e2e/tests/regressions/a.spec.ts',
    'R090', 'apps/e2e/tests/regressions/old.spec.ts', 'apps/e2e/tests/regressions/new.spec.ts',
    'D', 'apps/e2e/tests/regressions/gone.spec.ts',
    '',
  ].join('\0')
  assert.deepEqual(selectChangedSpecs(parseNameStatusZ(z)), [
    'tests/regressions/a.spec.ts',
    'tests/regressions/new.spec.ts',
  ])
  // Without -z git would print this one quoted ("apps/e2e/…\n…"), which no longer
  // starts with apps/e2e/tests/ and would be skipped without a word.
  const newline = ['A', 'apps/e2e/tests/regressions/a\nb.spec.ts', ''].join('\0')
  assert.throws(() => selectChangedSpecs(parseNameStatusZ(newline)), /unsafe/i)
})

test('isPlaywrightBump spots a changed @playwright/test or playwright line in a package.json diff', () => {
  const bump = [
    'diff --git a/apps/e2e/package.json b/apps/e2e/package.json',
    '--- a/apps/e2e/package.json',
    '+++ b/apps/e2e/package.json',
    '@@ -21 +21 @@',
    '-    "@playwright/test": "^1.65.0",',
    '+    "@playwright/test": "^1.66.0",',
  ].join('\n')
  assert.equal(isPlaywrightBump(bump), true)

  const runtime = [
    '--- a/services/headless-artist/package.json',
    '+++ b/services/headless-artist/package.json',
    '@@ -30 +30 @@',
    '-    "playwright": "1.65.0",',
    '+    "playwright": "1.66.0",',
  ].join('\n')
  assert.equal(isPlaywrightBump(runtime), true)

  // services/headless-artist keeps its one dependency on a single line.
  const oneLine = [
    '--- a/services/headless-artist/package.json',
    '+++ b/services/headless-artist/package.json',
    '@@ -38 +38 @@',
    '-  "dependencies": { "playwright": "1.65.0" },',
    '+  "dependencies": { "playwright": "1.66.0" },',
  ].join('\n')
  assert.equal(isPlaywrightBump(oneLine), true)
})

test('isPlaywrightBump ignores other dependencies, context lines and the axe plugin', () => {
  assert.equal(isPlaywrightBump(''), false)
  const other = [
    '--- a/apps/e2e/package.json',
    '+++ b/apps/e2e/package.json',
    '@@ -20,3 +20,3 @@',
    '-    "@axe-core/playwright": "^4.14.0",',
    '+    "@axe-core/playwright": "^4.15.0",',
    '     "@playwright/test": "^1.65.0",',
    '-    "vite": "^8.3.8",',
    '+    "vite": "^8.4.0",',
    '-    "test:browsers": "playwright test --project=firefox",',
    '+    "test:browsers": "playwright test --project=webkit",',
  ].join('\n')
  assert.equal(isPlaywrightBump(other), false)
})

test('findAccessibilitySpecs lists tests/accessibility and every spec that runs axe', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'changed-specs-a11y-'))
  try {
    const write = (rel, content) => {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
      writeFileSync(path.join(dir, rel), content)
    }
    write('tests/accessibility/dialog-trap.spec.ts', "import { test } from '@playwright/test'\n")
    write('tests/regressions/ESCSUITE-1.spec.ts', "import { runAxeCheck } from '../../utils/accessibility'\n")
    write('tests/escapeartist/raw.spec.ts', "import AxeBuilder from '@axe-core/playwright'\n")
    write('tests/escapeplan/home.spec.ts', "import { test } from '@playwright/test'\n")
    write('tests/standalone/a11y.spec.ts', "import { runAxeCheck } from '../../utils/accessibility'\n")
    write('tests/accessibility/helpers.ts', "import { runAxeCheck } from '../../utils/accessibility'\n")
    assert.deepEqual(findAccessibilitySpecs(dir), [
      'tests/accessibility/dialog-trap.spec.ts',
      'tests/escapeartist/raw.spec.ts',
      'tests/regressions/ESCSUITE-1.spec.ts',
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('findAccessibilitySpecs on the real suite covers the axe specs ESCSUITE-453 broke', () => {
  const specs = findAccessibilitySpecs(e2eDir)
  for (const expected of [
    'tests/accessibility/core.spec.ts',
    'tests/accessibility/keyboard-navigation.spec.ts',
    'tests/escapecraft/float-controls.spec.ts',
  ]) {
    assert.ok(specs.includes(expected), `missing ${expected}`)
  }
})

test('planRun runs only the changed specs, and adds the accessibility suite on a Playwright bump', () => {
  const a11y = ['tests/accessibility/core.spec.ts', 'tests/regressions/ESCSUITE-1.spec.ts']
  const changed = 'A\tapps/e2e/tests/regressions/ESCSUITE-1.spec.ts\nM\tapps/e2e/tests/escapeplan/home.spec.ts'

  const plain = planRun({ nameStatus: changed, packageDiff: '', accessibilitySpecs: () => a11y })
  assert.deepEqual(plain.specs, ['tests/escapeplan/home.spec.ts', 'tests/regressions/ESCSUITE-1.spec.ts'])
  assert.equal(plain.playwrightBump, false)

  const none = planRun({ nameStatus: 'M\tapps/craft/src/a.ts', packageDiff: '', accessibilitySpecs: () => a11y })
  assert.deepEqual(none.specs, [])

  const bump = planRun({
    nameStatus: changed,
    packageDiff: '-    "@playwright/test": "^1.65.0",\n+    "@playwright/test": "^1.66.0",',
    accessibilitySpecs: () => a11y,
  })
  assert.equal(bump.playwrightBump, true)
  assert.deepEqual(bump.specs, [
    'tests/accessibility/core.spec.ts',
    'tests/escapeplan/home.spec.ts',
    'tests/regressions/ESCSUITE-1.spec.ts',
  ])
})

/** A throwaway git repository with an apps/e2e/tests tree, on a base commit. */
function makeRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'changed-specs-git-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  const write = (rel, content) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    writeFileSync(path.join(dir, rel), content)
  }
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'test')
  git('config', 'commit.gpgsign', 'false')
  write('apps/e2e/package.json', '{\n  "devDependencies": {\n    "@playwright/test": "^1.65.0"\n  }\n}\n')
  write('apps/e2e/tests/regressions/ESCSUITE-1.spec.ts', 'old\n')
  write('apps/e2e/tests/regressions/ESCSUITE-2.spec.ts', 'old\n')
  write('apps/e2e/tests/accessibility/core.spec.ts', "import '../../utils/accessibility'\n")
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  const base = git('rev-parse', 'HEAD').trim()
  return { dir, git, write, base }
}

function runCli(dir, base) {
  const outFile = path.join(dir, '.gh-output')
  const summaryFile = path.join(dir, '.gh-summary')
  writeFileSync(outFile, '')
  writeFileSync(summaryFile, '')
  const stdout = execFileSync('node', [script, '--base', base], {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GITHUB_OUTPUT: outFile, GITHUB_STEP_SUMMARY: summaryFile },
  })
  const outputs = Object.fromEntries(
    readFileSync(outFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  )
  return { stdout, outputs, summary: readFileSync(summaryFile, 'utf8') }
}

test('the CLI writes the changed specs to GITHUB_OUTPUT, ignoring deletions', () => {
  const { dir, git, write, base } = makeRepo()
  try {
    write('apps/e2e/tests/regressions/ESCSUITE-1.spec.ts', 'new\n')
    write('apps/e2e/tests/regressions/ESCSUITE-3.spec.ts', 'new\n')
    git('rm', '-q', 'apps/e2e/tests/regressions/ESCSUITE-2.spec.ts')
    write('apps/craft/src/a.ts', 'x\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'pr')
    const { outputs, summary } = runCli(dir, base)
    assert.equal(outputs.specs, 'tests/regressions/ESCSUITE-1.spec.ts tests/regressions/ESCSUITE-3.spec.ts')
    assert.equal(outputs.count, '2')
    assert.equal(outputs.playwright_bump, 'false')
    assert.match(summary, /ESCSUITE-3\.spec\.ts/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the CLI reports zero specs when a PR touches no e2e spec', () => {
  const { dir, git, write, base } = makeRepo()
  try {
    write('apps/craft/src/a.ts', 'x\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'pr')
    const { outputs, summary } = runCli(dir, base)
    assert.equal(outputs.specs, '')
    assert.equal(outputs.count, '0')
    assert.match(summary, /no e2e spec/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the CLI fails, rather than skipping it, on a spec whose name git would quote', () => {
  const { dir, git, write, base } = makeRepo()
  try {
    write('apps/e2e/tests/regressions/quote"d.spec.ts', 'new\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'pr')
    assert.throws(() => runCli(dir, base), (err) => err.status === 1 && /unsafe/i.test(err.stderr))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the CLI adds the accessibility suite when the PR bumps Playwright', () => {
  const { dir, git, write, base } = makeRepo()
  try {
    write('apps/e2e/package.json', '{\n  "devDependencies": {\n    "@playwright/test": "^1.66.0"\n  }\n}\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'bump')
    const { outputs } = runCli(dir, base)
    assert.equal(outputs.playwright_bump, 'true')
    assert.equal(outputs.specs, 'tests/accessibility/core.spec.ts')
    assert.equal(outputs.count, '1')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// --- ci.yml wiring -----------------------------------------------------------

const ciYml = readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8')

/** A top-level job's text, from its `  name:` line to the next job. */
function job(name) {
  const body = ciYml.slice(ciYml.search(/^jobs:\s*$/m))
  const starts = [...body.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)]
  const i = starts.findIndex((m) => m[1] === name)
  if (i < 0) return null
  return body.slice(starts[i].index, i + 1 < starts.length ? starts[i + 1].index : undefined)
}

test('ci.yml runs the e2e-cross-browser job on every event and gates ci-status on it', () => {
  const crossBrowser = job('e2e-cross-browser')
  assert.ok(crossBrowser, 'ci.yml has no e2e-cross-browser job')
  // ci-status fails any need that is not `success`, so a job-level `if:` that skips
  // it would turn every such PR red; the job short-circuits in its steps instead.
  assert.doesNotMatch(crossBrowser, /^ {4}if:/m, 'e2e-cross-browser must not skip itself at job level')
  assert.match(crossBrowser, /scripts\/changed-specs\.mjs/)
  assert.match(crossBrowser, /E2E_CROSS_BROWSER: '1'/)
  assert.match(crossBrowser, /--project=firefox --project=webkit/)
  assert.match(crossBrowser, /playwright install-deps firefox webkit/)
  assert.match(crossBrowser, /module-pipe-sink/, 'Firefox needs the PulseAudio sink (ESCSUITE-389)')

  const ciStatus = job('ci-status')
  assert.ok(ciStatus)
  const needs = ciStatus.match(/^ {4}needs: \[([^\]]*)\]/m)?.[1].split(',').map((s) => s.trim()) ?? []
  assert.ok(needs.includes('e2e-cross-browser'), 'ci-status does not need e2e-cross-browser')
  assert.match(ciStatus, /needs\.e2e-cross-browser\.result \}\}" != "success"/)
})
