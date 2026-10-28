#!/usr/bin/env node
/**
 * Write the nightly run's job summary (ESCSUITE-353).
 *
 * Usage (from apps/e2e, after the nightly's `playwright test`):
 *   node scripts/report-nightly.mjs [playwright-results.json]
 *
 * Environment (set by `.github/workflows/nightly.yml`):
 *   ARTIST_FUZZ_SEED, ARTIST_FUZZ_RUNS  the property tests' seed and run count
 *   PROPERTY_OUTCOME                   the property-test step's outcome
 *                                      (success, failure, skipped, cancelled)
 *   GITHUB_STEP_SUMMARY                where the Markdown goes (stdout when unset)
 *
 * The summary always names the property tests' seed, with the command that
 * replays it, and lists every e2e test Playwright marked `unexpected` (it
 * failed on every attempt). A missing report is noted, never fatal: the steps
 * that ran the tests are what fail the job.
 *
 * Node built-ins only, like every other script here. Tests: report-nightly.test.mjs.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Walk a Playwright JSON report and return its failed tests.
 *
 * @param {object} report parsed JSON reporter output
 * @returns {{ file: string, line: number, title: string, project: string, status: string }[]}
 */
export function findFailedTests(report) {
  const failed = []
  const visit = (suite, titles) => {
    // The top-level suites are files; their title is the file name, not a describe.
    const ownTitles = suite.title && suite.title !== suite.file ? [...titles, suite.title] : titles
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (test.status !== 'unexpected') continue
        const results = test.results ?? []
        failed.push({
          file: spec.file ?? suite.file ?? '',
          line: spec.line ?? 0,
          title: [...ownTitles, spec.title].join(' › '),
          project: test.projectName ?? '',
          status: results.length ? (results[results.length - 1].status ?? 'failed') : 'failed',
        })
      }
    }
    for (const child of suite.suites ?? []) visit(child, ownTitles)
  }
  for (const suite of report?.suites ?? []) visit(suite, [])
  return failed
}

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')

/**
 * Markdown for the job summary.
 *
 * @param {{ failed: ReturnType<typeof findFailedTests> | null, seed?: string, runs?: string, propertyOutcome?: string, reportNote?: string }} input
 *   `failed` is null when there was no report to read; `reportNote` says why.
 */
export function toSummary({ failed, seed, runs, propertyOutcome, reportNote }) {
  const lines = ['### Nightly: property tests (ESCSUITE-349)', '']
  lines.push(`Seed **${seed || 'unknown'}**, ${runs || 'unknown'} runs: ${propertyOutcome || 'unknown'}.`)
  lines.push('')
  lines.push('Replay this seed locally:')
  lines.push('')
  lines.push('```bash')
  lines.push(
    `ARTIST_FUZZ_SEED=${seed || '<seed>'} ARTIST_FUZZ_RUNS=${runs || 5000} pnpm --filter=@escapesuite/artist exec vitest run src/store/__tests__/timelineInvariants.property.test.ts`
  )
  lines.push('```')
  lines.push('')
  lines.push('### Nightly: e2e (Chromium, Firefox, WebKit)')
  lines.push('')
  if (failed === null) {
    lines.push(reportNote ?? 'No Playwright JSON report: the e2e run ended before writing it.')
  } else if (failed.length === 0) {
    lines.push('No failing tests.')
  } else {
    lines.push(`${failed.length} failing test(s):`)
    lines.push('')
    lines.push('| Spec | Test | Project | Result |')
    lines.push('|---|---|---|---|')
    for (const t of failed) {
      lines.push(`| \`${cell(t.file)}:${t.line}\` | ${cell(t.title)} | ${cell(t.project)} | ${cell(t.status)} |`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

function main(argv) {
  const reportPath = argv[2] ?? 'playwright-results.json'
  let failed = null
  let reportNote
  if (!existsSync(reportPath)) {
    reportNote = `No Playwright JSON report at ${reportPath}: the e2e run ended (or was skipped) before writing it.`
  } else {
    try {
      failed = findFailedTests(JSON.parse(readFileSync(reportPath, 'utf8')))
    } catch (error) {
      reportNote = `The Playwright JSON report at ${reportPath} could not be parsed (${error.message}).`
    }
  }
  const markdown = toSummary({
    failed,
    reportNote,
    seed: process.env.ARTIST_FUZZ_SEED,
    runs: process.env.ARTIST_FUZZ_RUNS,
    propertyOutcome: process.env.PROPERTY_OUTCOME,
  })
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (summaryPath) appendFileSync(summaryPath, markdown)
  else process.stdout.write(markdown)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv)
}
