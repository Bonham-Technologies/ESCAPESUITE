#!/usr/bin/env node
/**
 * Pick the e2e specs a pull request must also pass in Firefox and WebKit
 * (ESCSUITE-478).
 *
 * Usage (from anywhere inside the repository's checkout):
 *   node apps/e2e/scripts/changed-specs.mjs --base <base sha> [--head <ref>]
 *
 * PR CI runs Chromium only; Firefox and WebKit run in the Nightly on `main`. A
 * PR that added a regression spec could go green, merge, and turn the next
 * Nightly red in another browser. ci.yml's `e2e-cross-browser` job runs this
 * script first and then runs, in the `firefox` and `webkit` projects:
 *
 * - every spec under `apps/e2e/tests/` that the PR adds or changes (from
 *   `git diff --name-status <base>...<head>`; deleted files are dropped, a
 *   rename counts as its new path, and folders `playwright.config.ts` ignores
 *   — standalone/, production/, perf/ — are left out);
 * - and, when the PR changes the `@playwright/test` or `playwright` line of any
 *   package.json (a Dependabot bump), the accessibility suite too: every spec in
 *   `tests/accessibility/` and every spec that runs axe (imports
 *   `utils/accessibility` or `@axe-core/playwright`). A Playwright bump brings a
 *   new Firefox and WebKit, and Firefox 159's axe crash (ESCSUITE-453) is the
 *   failure that turned the Nightly red last time.
 *
 * Outputs, appended to `$GITHUB_OUTPUT` when it is set (and printed):
 *   specs=<space-separated paths relative to apps/e2e>   (empty: run nothing)
 *   count=<number of specs>
 *   playwright_bump=true|false
 * A short table goes to `$GITHUB_STEP_SUMMARY` when it is set.
 *
 * The paths reach a shell unquoted, so a spec path with anything but letters,
 * digits, `.`, `_`, `-` and `/` is refused (the script exits 1) rather than
 * silently skipped.
 *
 * Node built-ins only, like every other script here. Tests: changed-specs.test.mjs.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const E2E_PREFIX = 'apps/e2e/'
const TESTS_PREFIX = 'apps/e2e/tests/'
// Mirrors `baseIgnore` in playwright.config.ts: these run under other configs.
const IGNORED_DIRS = ['standalone', 'production', 'perf']
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/
const AXE_IMPORT = /utils\/accessibility['"]|@axe-core\/playwright/

/** True for a `tests/…/*.spec.ts` path (relative to apps/e2e) this config runs. */
function isRunnableSpec(relToE2e) {
  if (!relToE2e.startsWith('tests/') || !relToE2e.endsWith('.spec.ts')) return false
  const firstDir = relToE2e.split('/')[1]
  return !IGNORED_DIRS.includes(firstDir)
}

function assertSafe(p) {
  if (!SAFE_PATH.test(p)) {
    throw new Error(`Refusing unsafe spec path (only letters, digits, . _ - / allowed): ${JSON.stringify(p)}`)
  }
}

/** `git diff --name-status` text (tab-separated, one change per line) as entries. */
function parseNameStatus(text) {
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [status, ...paths] = line.split('\t')
      return { status, paths }
    })
}

/**
 * `git diff --name-status -z` output as entries. With -z git never quotes a
 * path, so an odd file name reaches the safety check as itself instead of as a
 * quoted string that would not start with apps/e2e/tests/ and slip past it.
 */
export function parseNameStatusZ(text) {
  const tokens = text.split('\0')
  const entries = []
  for (let i = 0; i < tokens.length; ) {
    const status = tokens[i++]
    if (!status) continue
    const count = status[0] === 'R' || status[0] === 'C' ? 2 : 1
    entries.push({ status, paths: tokens.slice(i, i + count) })
    i += count
  }
  return entries
}

/**
 * The added, modified, renamed or copied spec files in `git diff --name-status`
 * output (text, or entries from parseNameStatusZ), relative to apps/e2e, sorted
 * and unique.
 */
export function selectChangedSpecs(nameStatus) {
  const entries = typeof nameStatus === 'string' ? parseNameStatus(nameStatus) : nameStatus
  const specs = new Set()
  for (const { status, paths } of entries) {
    if (status[0] === 'D') continue
    // R and C list old and new path; the new one is what the PR ships.
    const file = paths[paths.length - 1]
    if (!file || !file.startsWith(TESTS_PREFIX)) continue
    const rel = file.slice(E2E_PREFIX.length)
    if (!isRunnableSpec(rel)) continue
    assertSafe(rel)
    specs.add(rel)
  }
  return [...specs].sort()
}

/**
 * True when a package.json diff adds or removes an `@playwright/test` or
 * `playwright` entry. The key may sit anywhere on the line:
 * services/headless-artist writes `"dependencies": { "playwright": "1.65.0" },`
 * on one line. The opening quote keeps `"@axe-core/playwright":` out.
 */
export function isPlaywrightBump(packageDiff) {
  return packageDiff
    .split('\n')
    .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line))
    .some((line) => /"(@playwright\/test|playwright)"\s*:/.test(line))
}

/** Every runnable spec under `<e2eDir>/tests`, relative to e2eDir. */
// A plain walk rather than readdirSync's `recursive`: CI runs this on the runner's
// preinstalled Node, before setup-node, so it stays clear of newer fs options.
function listSpecs(e2eDir) {
  const found = []
  const walk = (rel) => {
    for (const entry of readdirSync(path.join(e2eDir, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`
      if (entry.isDirectory()) walk(child)
      else if (entry.isFile() && isRunnableSpec(child)) found.push(child)
    }
  }
  walk('tests')
  return found
}

/** The accessibility suite: tests/accessibility plus every spec that runs axe. */
export function findAccessibilitySpecs(e2eDir) {
  return listSpecs(e2eDir)
    .filter(
      (rel) =>
        rel.startsWith('tests/accessibility/') || AXE_IMPORT.test(readFileSync(path.join(e2eDir, rel), 'utf8')),
    )
    .sort()
}

/**
 * What to run: the changed specs, plus the accessibility suite on a Playwright
 * bump. `accessibilitySpecs` is called only when needed.
 */
export function planRun({ nameStatus, packageDiff, accessibilitySpecs }) {
  const changed = selectChangedSpecs(nameStatus)
  const playwrightBump = isPlaywrightBump(packageDiff)
  const extra = playwrightBump ? accessibilitySpecs() : []
  for (const rel of extra) assertSafe(rel)
  const specs = [...new Set([...changed, ...extra])].sort()
  return { specs, changed, playwrightBump }
}

function summaryMarkdown({ specs, changed, playwrightBump }) {
  const lines = ['### E2E in Firefox and WebKit (changed specs)', '']
  if (specs.length === 0) {
    lines.push('This PR adds or changes no e2e spec and bumps no Playwright: nothing to run.')
    return lines.join('\n') + '\n'
  }
  if (playwrightBump) {
    lines.push('This PR bumps Playwright, so the accessibility suite runs too.', '')
  }
  lines.push('| Spec | Why |', '|---|---|')
  for (const rel of specs) {
    lines.push(`| \`${rel}\` | ${changed.includes(rel) ? 'added or changed' : 'accessibility suite'} |`)
  }
  return lines.join('\n') + '\n'
}

function parseArgs(argv) {
  const args = { head: 'HEAD' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') args.base = argv[++i]
    else if (argv[i] === '--head') args.head = argv[++i]
    else throw new Error(`Unknown argument: ${argv[i]}`)
  }
  if (!args.base) throw new Error('Usage: changed-specs.mjs --base <ref> [--head <ref>]')
  return args
}

function main() {
  const { base, head } = parseArgs(process.argv.slice(2))
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const range = `${base}...${head}`
  const repoTop = git('rev-parse', '--show-toplevel').trim()
  const plan = planRun({
    nameStatus: parseNameStatusZ(git('diff', '--name-status', '--no-renames', '-z', range, '--', 'apps/e2e/tests/')),
    packageDiff: git('diff', '-U0', range, '--', ':(glob)**/package.json'),
    accessibilitySpecs: () => findAccessibilitySpecs(path.join(repoTop, 'apps/e2e')),
  })
  const outputs = [
    `specs=${plan.specs.join(' ')}`,
    `count=${plan.specs.length}`,
    `playwright_bump=${plan.playwrightBump}`,
  ]
  console.log(outputs.join('\n'))
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs.join('\n') + '\n')
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown(plan))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (err) {
    console.error(`::error::${err.message}`)
    process.exit(1)
  }
}
