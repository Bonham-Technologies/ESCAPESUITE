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
 * It also lists every test, whatever its status, that carries an annotation of a
 * type in `REPORTED_ANNOTATION_TYPES` (ESCSUITE-450): a `::notice` per entry, an
 * "E2E reported annotations" table in the summary when there are any, and an
 * `annotated` array in the same `flaky.json`. Specs add such annotations with
 * `utils/consoleAnnotation.ts`; journey 01 adds `reload-fired` when ARTIST logs
 * that an export had to reload a wedged video.
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
  const flaky = []
  forEachTest(report, repoRoot, ({ file, line, title, test }) => {
    if (test.status !== 'flaky') return
    const results = test.results ?? []
    flaky.push({
      file,
      line,
      title,
      project: test.projectName ?? '',
      retries: results.length ? Math.max(...results.map((r) => r.retry ?? 0)) : 0,
    })
  })
  return flaky
}

/** Call `visitTest` with each test in the report, its file, line and full title. */
function forEachTest(report, repoRoot, visitTest) {
  const rootDir = report?.config?.rootDir ?? ''

  const fileFor = (file) => {
    if (!repoRoot || !rootDir) return file
    return path.relative(repoRoot, path.resolve(rootDir, file)).split(path.sep).join('/')
  }

  const visit = (suite, titles) => {
    // The top-level suites are files; their title is the file name, not a describe.
    const ownTitles = suite.title && suite.title !== suite.file ? [...titles, suite.title] : titles
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        visitTest({
          file: fileFor(spec.file ?? suite.file ?? ''),
          line: spec.line ?? 0,
          title: [...ownTitles, spec.title].join(' › '),
          test,
        })
      }
    }
    for (const child of suite.suites ?? []) visit(child, ownTitles)
  }

  for (const suite of report?.suites ?? []) visit(suite, [])
}

/**
 * Annotation types worth surfacing from a passing run. `reload-fired`: ARTIST's
 * export reloaded a video that stopped completing seeks (ESCSUITE-412), recorded
 * by journey 01; ESCSUITE-417 counts these across nightly runs.
 */
export const REPORTED_ANNOTATION_TYPES = ['reload-fired']

/**
 * Walk a Playwright JSON report and return one entry per reported annotation.
 *
 * Runtime annotations sit on each attempt's result, and Playwright also copies
 * them to the test, so the two are merged: an entry on the test that matches one
 * on a result is not listed twice.
 *
 * @param {object} report parsed JSON reporter output
 * @param {{ repoRoot?: string, types?: string[] }} [options] `repoRoot` as for
 *   {@link findFlakyTests}; `types` defaults to {@link REPORTED_ANNOTATION_TYPES}
 * @returns {{ file: string, line: number, title: string, project: string, status: string,
 *   retry: number | null, type: string, description: string }[]}
 */
export function findAnnotatedTests(report, { repoRoot, types = REPORTED_ANNOTATION_TYPES } = {}) {
  const wanted = new Set(types)
  const annotated = []
  forEachTest(report, repoRoot, ({ file, line, title, test }) => {
    const seen = new Set()
    const add = (annotation, retry) => {
      if (!wanted.has(annotation?.type)) return
      const key = `${annotation.type}\n${annotation.description ?? ''}`
      if (retry === null && seen.has(key)) return
      seen.add(key)
      annotated.push({
        file,
        line,
        title,
        project: test.projectName ?? '',
        status: test.status ?? '',
        retry,
        type: annotation.type,
        description: annotation.description ?? '',
      })
    }
    for (const result of test.results ?? []) {
      for (const annotation of result.annotations ?? []) add(annotation, result.retry ?? 0)
    }
    for (const annotation of test.annotations ?? []) add(annotation, null)
  })
  return annotated
}

/** Escape a workflow-command message (GitHub's `escapeData`). */
const escapeData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
/** Escape a workflow-command property (GitHub's `escapeProperty`). */
const escapeProperty = (s) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C')

/** A Markdown table cell: backslashes first, then pipes, and no line breaks. */
const cell = (s) => String(s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')

/** One `::warning` line per flaky test. */
export function toAnnotations(flaky) {
  return flaky.map(
    (t) =>
      `::warning file=${escapeProperty(t.file)},line=${t.line},title=${escapeProperty('Flaky e2e test')}::` +
      escapeData(`${t.file} › ${t.title} [${t.project}] failed, then passed on retry ${t.retries}`)
  )
}

/** One `::notice` line per reported annotation. */
export function toNotices(annotated) {
  return annotated.map(
    (t) =>
      `::notice file=${escapeProperty(t.file)},line=${t.line},title=${escapeProperty(`e2e annotation: ${t.type}`)}::` +
      escapeData(`${t.file} › ${t.title} [${t.project}]: ${t.description}`)
  )
}

/** Markdown for the job summary's annotations section; empty when there are none. */
export function toAnnotatedSummary(annotated) {
  if (annotated.length === 0) return ''
  const rows = annotated.map(
    (t) =>
      `| \`${cell(t.file)}:${t.line}\` | ${cell(t.title)} | ${cell(t.project)} | ${cell(t.type)} | ${cell(t.description)} |`
  )
  return [
    `\n### E2E reported annotations (${annotated.length})`,
    '',
    'Tests that recorded one of the annotation types `scripts/report-flaky.mjs` reports. They do not fail the run.',
    '',
    '| Spec | Test | Project | Type | Message |',
    '|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}

/** Markdown for the job summary. Always says something, so a clean run is visible too. */
export function toSummary(flaky) {
  if (flaky.length === 0) return '### E2E flaky tests\n\nNone: every test passed on its first attempt.\n'
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

  // A missing or unreadable report (the run died before or while writing it) is
  // noted, never fatal: this step must not turn a green job red.
  const giveUp = (note) => {
    console.log(`::warning title=Flaky e2e report missing::${escapeData(note)}`)
    if (summaryPath) appendFileSync(summaryPath, `### E2E flaky tests\n\n${note}\n`)
    writeFileSync(outPath, JSON.stringify({ reportMissing: true, flaky: [], annotated: [] }, null, 2) + '\n')
  }

  if (!existsSync(reportPath)) {
    giveUp(`No Playwright JSON report at ${reportPath}; the e2e run ended before writing it, so flaky tests could not be listed.`)
    return
  }

  let report
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'))
  } catch (error) {
    giveUp(`The Playwright JSON report at ${reportPath} could not be parsed (${error.message}), so flaky tests could not be listed.`)
    return
  }
  const flaky = findFlakyTests(report, { repoRoot })
  const annotated = findAnnotatedTests(report, { repoRoot })
  for (const line of toAnnotations(flaky)) console.log(line)
  for (const line of toNotices(annotated)) console.log(line)
  if (summaryPath) appendFileSync(summaryPath, toSummary(flaky) + toAnnotatedSummary(annotated))
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        sha: process.env.GITHUB_SHA ?? null,
        ref: process.env.GITHUB_REF ?? null,
        runId: process.env.GITHUB_RUN_ID ?? null,
        flaky,
        annotated,
      },
      null,
      2
    ) + '\n'
  )
  console.log(`${flaky.length} flaky test(s) and ${annotated.length} reported annotation(s) written to ${outPath}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv)
}
