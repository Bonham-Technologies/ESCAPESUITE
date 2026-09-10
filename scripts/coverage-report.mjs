#!/usr/bin/env node
// Prints a table of measured coverage vs. configured thresholds for every package.
// Reads each package's coverage/coverage-summary.json (produced by the vitest
// `json-summary` reporter after `pnpm test:coverage`). Never throws or exits non-zero —
// thresholds are enforced by vitest itself; this is a human-readable summary only.
//
// When $GITHUB_STEP_SUMMARY is set (i.e. running inside a GitHub Actions step), the
// same table is also appended to that file as GitHub-flavored Markdown, so it shows
// up in the job's Summary tab. No-op locally, where the var is unset.

import { readFileSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))

// keep in sync with each package's vitest config `coverage.thresholds`
const packages = [
  {
    name: '@escapesuite/plan',
    dir: 'apps/plan',
    thresholds: { lines: 52, statements: 53, branches: 29, functions: 45 },
  },
  {
    name: '@escapesuite/craft',
    dir: 'apps/craft',
    thresholds: { lines: 99, statements: 99, branches: 94, functions: 98 },
  },
  {
    name: '@escapesuite/artist',
    dir: 'apps/artist',
    thresholds: { lines: 61, statements: 60, branches: 45, functions: 64 },
  },
  {
    name: '@escapesuite/shared',
    dir: 'packages/shared',
    thresholds: { lines: 27, statements: 28, branches: 33, functions: 20 },
  },
  {
    name: '@escapesuite/headless-artist',
    dir: 'services/headless-artist',
    thresholds: { lines: 91, statements: 91, branches: 83, functions: 94 },
  },
]

const metrics = ['lines', 'statements', 'branches', 'functions']

function readSummary(dir) {
  const summaryPath = join(rootDir, dir, 'coverage', 'coverage-summary.json')
  try {
    const raw = readFileSync(summaryPath, 'utf8')
    return JSON.parse(raw).total
  } catch {
    return null
  }
}

function fmtConsoleCell(actualPct, threshold) {
  if (actualPct === undefined || actualPct === null) return 'n/a'
  const rounded = actualPct.toFixed(2)
  const marker = actualPct >= threshold ? '' : ' !'
  return `${rounded}% / ${threshold}%${marker}`
}

function fmtMarkdownCell(actualPct, threshold) {
  if (actualPct === undefined || actualPct === null) return 'n/a'
  return `${actualPct.toFixed(2)}% (floor ${threshold})`
}

// One data pass, formatted two ways (console table, Markdown table).
const data = packages.map(({ name, dir, thresholds }) => {
  const summary = readSummary(dir)
  return { name, values: metrics.map((m) => ({ actual: summary?.[m]?.pct, threshold: thresholds[m] })) }
})

const header = ['Package', 'Lines', 'Statements', 'Branches', 'Functions']

function printConsoleTable() {
  const rows = data.map(({ name, values }) => [name, ...values.map((v) => fmtConsoleCell(v.actual, v.threshold))])
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
  const printRow = (cells) => console.log(cells.map((c, i) => c.padEnd(widths[i])).join('  '))

  console.log('Coverage report (actual / threshold; "!" marks a value below its floor)\n')
  printRow(header)
  printRow(widths.map((w) => '-'.repeat(w)))
  for (const row of rows) printRow(row)
}

function appendGithubStepSummary() {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY
  if (!summaryFile) return

  try {
    const rows = data.map(({ name, values }) => [name, ...values.map((v) => fmtMarkdownCell(v.actual, v.threshold))])
    const lines = [
      '## Coverage',
      '',
      `| ${header.join(' | ')} |`,
      `| ${header.map(() => '---').join(' | ')} |`,
      ...rows.map((r) => `| ${r.join(' | ')} |`),
      '',
    ]
    appendFileSync(summaryFile, lines.join('\n'))
  } catch (err) {
    console.error(`coverage-report: failed to write GITHUB_STEP_SUMMARY: ${err.message}`)
  }
}

printConsoleTable()
appendGithubStepSummary()
