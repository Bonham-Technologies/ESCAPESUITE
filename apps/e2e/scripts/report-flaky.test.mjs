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
import {
  findAnnotatedTests,
  findFlakyTests,
  toAnnotatedSummary,
  toAnnotations,
  toNotices,
  toSummary,
} from './report-flaky.mjs'

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
  assert.deepEqual(JSON.parse(readFileSync(outPath, 'utf8')), { reportMissing: true, flaky: [], annotated: [] })
})

test('the CLI treats a truncated report like a missing one and exits 0', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'report-flaky-'))
  const reportPath = path.join(dir, 'results.json')
  const outPath = path.join(dir, 'flaky.json')
  const summaryPath = path.join(dir, 'summary.md')
  writeFileSync(reportPath, JSON.stringify(report).slice(0, 100))
  writeFileSync(summaryPath, '')
  // execFileSync throws on a non-zero exit, so returning at all proves exit 0.
  const stdout = execFileSync(process.execPath, [script, reportPath, outPath], {
    env: { ...process.env, GITHUB_STEP_SUMMARY: summaryPath },
    encoding: 'utf8',
  })
  assert.match(stdout, /::warning title=Flaky e2e report missing::.*could not be parsed/)
  assert.match(readFileSync(summaryPath, 'utf8'), /could not be parsed/)
  assert.deepEqual(JSON.parse(readFileSync(outPath, 'utf8')), { reportMissing: true, flaky: [], annotated: [] })
})

// ESCSUITE-450: tests that carry a reported annotation (such as journey 01's
// `reload-fired`, from utils/consoleAnnotation.ts) are listed whatever their status.

const reload = 'Export: "e2e-recording.webm" stopped completing seeks; reloaded it from a fresh copy'

/** A journey that passed but logged the reload, beside unrelated annotations. */
const annotatedReport = {
  config: { rootDir: '/repo/apps/e2e/tests' },
  suites: [
    {
      title: 'journeys/01-record-edit-export.spec.ts',
      file: 'journeys/01-record-edit-export.spec.ts',
      suites: [
        {
          title: 'Journey: Record, Edit, Export',
          file: 'journeys/01-record-edit-export.spec.ts',
          specs: [
            {
              title: 'record in ESCAPECRAFT, edit in ESCAPEARTIST, export a file',
              file: 'journeys/01-record-edit-export.spec.ts',
              line: 60,
              tests: [
                {
                  projectName: 'chromium-strict',
                  status: 'expected',
                  // Playwright copies the last attempt's runtime annotations to the
                  // test, so the same entry shows up twice; it is listed once.
                  annotations: [{ type: 'reload-fired', description: reload }],
                  results: [
                    {
                      retry: 0,
                      status: 'passed',
                      annotations: [
                        { type: 'note', description: 'not reported' },
                        { type: 'reload-fired', description: reload },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      title: 'escapeartist/soak.spec.ts',
      file: 'escapeartist/soak.spec.ts',
      specs: [
        {
          title: 'soaks',
          file: 'escapeartist/soak.spec.ts',
          line: 9,
          tests: [
            {
              projectName: 'chromium-strict',
              status: 'expected',
              annotations: [{ type: 'live counts', description: '1 | 2' }],
              results: [{ retry: 0, status: 'passed', annotations: [{ type: 'live counts', description: '1 | 2' }] }],
            },
          ],
        },
      ],
    },
  ],
}

test('finds tests with a reported annotation, once each, with the attempt that logged it', () => {
  assert.deepEqual(findAnnotatedTests(annotatedReport), [
    {
      file: 'journeys/01-record-edit-export.spec.ts',
      line: 60,
      title: 'Journey: Record, Edit, Export › record in ESCAPECRAFT, edit in ESCAPEARTIST, export a file',
      project: 'chromium-strict',
      status: 'expected',
      retry: 0,
      type: 'reload-fired',
      description: reload,
    },
  ])
  assert.equal(findAnnotatedTests(annotatedReport, { repoRoot: '/repo' })[0].file,
    'apps/e2e/tests/journeys/01-record-edit-export.spec.ts')
  assert.deepEqual(findAnnotatedTests(annotatedReport, { types: ['live counts'] }).map((t) => t.description), ['1 | 2'])
  assert.deepEqual(findAnnotatedTests(report), [])
  assert.deepEqual(findAnnotatedTests({}), [])
})

test('a test-level annotation with no matching attempt is still listed', () => {
  const r = structuredClone(annotatedReport)
  r.suites[0].suites[0].specs[0].tests[0].results = [{ retry: 0, status: 'passed' }]
  const [only] = findAnnotatedTests(r)
  assert.equal(only.description, reload)
  assert.equal(only.retry, null)
})

test('notices and the summary section name the test and the message; nothing when none', () => {
  const annotated = findAnnotatedTests(annotatedReport, { repoRoot: '/repo' })
  const [notice] = toNotices(annotated)
  assert.match(notice, /^::notice file=apps\/e2e\/tests\/journeys\/01-record-edit-export.spec.ts,line=60,title=e2e annotation%3A reload-fired::/)
  assert.match(notice, /stopped completing seeks; reloaded it from a fresh copy/)
  const md = toAnnotatedSummary(annotated)
  assert.match(md, /### E2E reported annotations \(1\)/)
  assert.match(md, /\| reload-fired \| Export: "e2e-recording.webm" stopped completing seeks; reloaded it from a fresh copy \|/)
  assert.equal(toAnnotatedSummary([]), '')
})

test('the CLI writes annotated tests to the summary and to flaky.json', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'report-flaky-'))
  const reportPath = path.join(dir, 'results.json')
  const outPath = path.join(dir, 'flaky.json')
  const summaryPath = path.join(dir, 'summary.md')
  writeFileSync(reportPath, JSON.stringify(annotatedReport))
  writeFileSync(summaryPath, '')
  const stdout = execFileSync(process.execPath, [script, reportPath, outPath], {
    env: { ...process.env, GITHUB_STEP_SUMMARY: summaryPath, GITHUB_WORKSPACE: '/repo' },
    encoding: 'utf8',
  })
  assert.equal(stdout.match(/^::notice /gm)?.length, 1)
  const summary = readFileSync(summaryPath, 'utf8')
  assert.match(summary, /None: every test passed on its first attempt/)
  assert.match(summary, /E2E reported annotations \(1\)/)
  const out = JSON.parse(readFileSync(outPath, 'utf8'))
  assert.deepEqual(out.flaky, [])
  assert.equal(out.annotated.length, 1)
  assert.equal(out.annotated[0].type, 'reload-fired')
  assert.equal(out.annotated[0].file, 'apps/e2e/tests/journeys/01-record-edit-export.spec.ts')
})
