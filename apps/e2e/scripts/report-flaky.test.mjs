/**
 * Unit tests for `report-flaky.mjs` (ESCSUITE-352): it must find every test
 * Playwright marked `flaky`, and only those, wherever it sits in the suite tree.
 *
 *   pnpm --filter @escapesuite/e2e run test:scripts
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { findFlakyTests, toAnnotations, toSummary } from './report-flaky.mjs'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'report-flaky.mjs')

const result = (retry, status) => ({ retry, status })

/** Shaped like Playwright's JSON reporter output. */
const report = {
  config: { rootDir: '/repo/apps/e2e/tests' },
  suites: [
    {
      title: 'escapeplan/home.spec.ts',
      file: 'escapeplan/home.spec.ts',
      specs: [
        {
          title: 'loads',
          file: 'escapeplan/home.spec.ts',
          line: 4,
          tests: [{ projectName: 'chromium', status: 'expected', results: [result(0, 'passed')] }],
        },
      ],
      suites: [
        {
          title: 'Hero',
          file: 'escapeplan/home.spec.ts',
          specs: [
            {
              title: 'plays the reel',
              file: 'escapeplan/home.spec.ts',
              line: 12,
              tests: [
                {
                  projectName: 'chromium',
                  status: 'flaky',
                  results: [result(0, 'failed'), result(1, 'timedOut'), result(2, 'passed')],
                },
                {
                  projectName: 'mobile-chromium',
                  status: 'flaky',
                  results: [result(0, 'failed'), result(1, 'passed')],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      title: 'regressions/ESCSUITE-1.spec.ts',
      file: 'regressions/ESCSUITE-1.spec.ts',
      specs: [
        {
          title: 'stays fixed',
          file: 'regressions/ESCSUITE-1.spec.ts',
          line: 7,
          tests: [
            { projectName: 'chromium-strict', status: 'unexpected', results: [result(0, 'failed')] },
            { projectName: 'chromium-strict', status: 'skipped', results: [] },
          ],
        },
      ],
    },
  ],
}

test('finds only flaky tests, with describe titles, project and the retry that passed', () => {
  assert.deepEqual(findFlakyTests(report), [
    {
      file: 'escapeplan/home.spec.ts',
      line: 12,
      title: 'Hero › plays the reel',
      project: 'chromium',
      retries: 2,
    },
    {
      file: 'escapeplan/home.spec.ts',
      line: 12,
      title: 'Hero › plays the reel',
      project: 'mobile-chromium',
      retries: 1,
    },
  ])
})

test('makes file paths repo-relative when given the repo root', () => {
  const [first] = findFlakyTests(report, { repoRoot: '/repo' })
  assert.equal(first.file, 'apps/e2e/tests/escapeplan/home.spec.ts')
})

test('an empty or clean report has no flaky tests', () => {
  assert.deepEqual(findFlakyTests({}), [])
  assert.deepEqual(findFlakyTests({ config: { rootDir: '/x' }, suites: [] }), [])
})

test('annotations carry the spec and title, with workflow-command escaping', () => {
  const [line] = toAnnotations([
    { file: 'a,b:c.spec.ts', line: 3, title: '50% done\nnext', project: 'chromium', retries: 1 },
  ])
  assert.equal(
    line,
    '::warning file=a%2Cb%3Ac.spec.ts,line=3,title=Flaky e2e test::' +
      'a,b:c.spec.ts › 50%25 done%0Anext [chromium] failed, then passed on retry 1'
  )
})

test('the summary lists each flaky test, and says so when there are none', () => {
  const md = toSummary(findFlakyTests(report))
  assert.match(md, /E2E flaky tests \(2\)/)
  assert.match(md, /\| `escapeplan\/home.spec.ts:12` \| Hero › plays the reel \| chromium \| 2 \|/)
  assert.match(toSummary([]), /None: every test passed on its first attempt/)
})

test('the CLI writes annotations, the summary and flaky.json', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'report-flaky-'))
  const reportPath = path.join(dir, 'results.json')
  const outPath = path.join(dir, 'flaky.json')
  const summaryPath = path.join(dir, 'summary.md')
  writeFileSync(reportPath, JSON.stringify(report))
  writeFileSync(summaryPath, '')
  const stdout = execFileSync(process.execPath, [script, reportPath, outPath], {
    env: { ...process.env, GITHUB_STEP_SUMMARY: summaryPath, GITHUB_WORKSPACE: '/repo' },
    encoding: 'utf8',
  })
  assert.equal(stdout.match(/^::warning /gm)?.length, 2)
  assert.match(stdout, /file=apps\/e2e\/tests\/escapeplan\/home.spec.ts,line=12/)
  assert.match(readFileSync(summaryPath, 'utf8'), /E2E flaky tests \(2\)/)
  assert.equal(JSON.parse(readFileSync(outPath, 'utf8')).flaky.length, 2)
})

test('the CLI notes a missing report without failing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'report-flaky-'))
  const outPath = path.join(dir, 'flaky.json')
  const stdout = execFileSync(process.execPath, [script, path.join(dir, 'nope.json'), outPath], {
    env: { ...process.env, GITHUB_STEP_SUMMARY: '' },
    encoding: 'utf8',
  })
  assert.match(stdout, /::warning title=Flaky e2e report missing::/)
  assert.deepEqual(JSON.parse(readFileSync(outPath, 'utf8')), { reportMissing: true, flaky: [] })
})
