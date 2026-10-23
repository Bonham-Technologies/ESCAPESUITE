#!/usr/bin/env node
/**
 * List every e2e test that passed only on a retry (ESCSUITE-352).
 *
 * Usage (from apps/e2e, after a CI run of `playwright test`):
 *   node scripts/report-flaky.mjs [playwright-results.json] [flaky.json]
 *
 * CI retries the default projects twice, so a test that fails once and then
 * passes counts as passed and the job goes green. Playwright's JSON reporter
 * still marks it `flaky`. This script reads that report and, for every flaky
 * test:
 *
 * - prints a `::warning` workflow command (an annotation on the run, with the
 *   spec file and test title);
 * - appends a table to `$GITHUB_STEP_SUMMARY` when it is set;
 * - writes the list to `flaky.json` (uploaded as the `e2e-flaky` artifact, which
 *   is what the steward reads; see docs/reference/ci-cd-pipeline.md).
 *
 * It never fails the job: the strict project is what turns a pass-on-retry red,
 * and a missing report (the run died before writing it) is noted, not fatal.
 *
 * Node built-ins only, like every other script here. Tests: report-flaky.test.mjs.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Walk a Playwright JSON report and return its flaky tests.
 *
 * @param {object} report parsed JSON reporter output
 * @param {{ repoRoot?: string }} [options] when given, `file` is made relative to it
 *   (annotations need repo-relative paths); otherwise it stays relative to the
 *   report's rootDir
 * @returns {{ file: string, line: number, title: string, project: string, retries: number }[]}
 */
export function findFlakyTests(report, { repoRoot } = {}) {
  const rootDir = report?.config?.rootDir ?? ''
  const flaky = []

  const fileFor = (file) => {
    if (!repoRoot || !rootDir) return file
    return path.relative(repoRoot, path.resolve(rootDir, file)).split(path.sep).join('/')
  }

  const visit = (suite, titles) => {
    // The top-level suites are files; their title is the file name, not a describe.
    const ownTitles = suite.title && suite.title !== suite.file ? [...titles, suite.title] : titles
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (test.status !== 'flaky') continue
        const results = test.results ?? []
        flaky.push({
          file: fileFor(spec.file ?? suite.file ?? ''),
          line: spec.line ?? 0,
          title: [...ownTitles, spec.title].join(' › '),
          project: test.projectName ?? '',
          retries: results.length ? Math.max(...results.map((r) => r.retry ?? 0)) : 0,
        })
      }
    }
    for (const child of suite.suites ?? []) visit(child, ownTitles)
  }

  for (const suite of report?.suites ?? []) visit(suite, [])
  return flaky
}

/** Escape a workflow-command message (GitHub's `escapeData`). */
const escapeData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
/** Escape a workflow-command property (GitHub's `escapeProperty`). */
const escapeProperty = (s) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C')

/** One `::warning` line per flaky test. */
export function toAnnotations(flaky) {
  return flaky.map(
    (t) =>
      `::warning file=${escapeProperty(t.file)},line=${t.line},title=${escapeProperty('Flaky e2e test')}::` +
      escapeData(`${t.file} › ${t.title} [${t.project}] failed, then passed on retry ${t.retries}`)
  )
}

/** Markdown for the job summary. Always says something, so a clean run is visible too. */
export function toSummary(flaky) {
  if (flaky.length === 0) return '### E2E flaky tests\n\nNone: every test passed on its first attempt.\n'
  const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const rows = flaky.map(
    (t) => `| \`${cell(t.file)}:${t.line}\` | ${cell(t.title)} | ${cell(t.project)} | ${t.retries} |`
  )
  return [
    `### E2E flaky tests (${flaky.length})`,
    '',
    'These failed at least once and passed on a retry, so the job stayed green. Fix them or file a ticket.',
    '',
    '| Spec | Test | Project | Passed on retry |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}

function main(argv) {
  const reportPath = argv[2] ?? 'playwright-results.json'
  const outPath = argv[3] ?? 'flaky.json'
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  const repoRoot = process.env.GITHUB_WORKSPACE

  if (!existsSync(reportPath)) {
    const note = `No Playwright JSON report at ${reportPath}; the e2e run ended before writing it, so flaky tests could not be listed.`
    console.log(`::warning title=Flaky e2e report missing::${escapeData(note)}`)
    if (summaryPath) appendFileSync(summaryPath, `### E2E flaky tests\n\n${note}\n`)
    writeFileSync(outPath, JSON.stringify({ reportMissing: true, flaky: [] }, null, 2) + '\n')
    return
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  const flaky = findFlakyTests(report, { repoRoot })
  for (const line of toAnnotations(flaky)) console.log(line)
  if (summaryPath) appendFileSync(summaryPath, toSummary(flaky))
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        sha: process.env.GITHUB_SHA ?? null,
        ref: process.env.GITHUB_REF ?? null,
        runId: process.env.GITHUB_RUN_ID ?? null,
        flaky,
      },
      null,
      2
    ) + '\n'
  )
  console.log(`${flaky.length} flaky test(s) written to ${outPath}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv)
}
