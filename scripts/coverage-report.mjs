#!/usr/bin/env node
// Prints a table of measured coverage vs. configured thresholds for every package.
// Reads each package's coverage/coverage-summary.json (produced by the vitest
// `json-summary` reporter after `pnpm test:coverage`). Never throws or exits non-zero —
// thresholds are enforced by vitest itself; this is a human-readable summary only.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))

// keep in sync with each package's vitest config `coverage.thresholds`
const packages = [
  {
    name: '@escapesuite/plan',
    dir: 'apps/plan',
    thresholds: { lines: 80, statements: 80, branches: 55, functions: 60 },
  },
  {
    name: '@escapesuite/craft',
    dir: 'apps/craft',
    thresholds: { lines: 42, statements: 42, branches: 45, functions: 47 },
  },
  {
    name: '@escapesuite/artist',
    dir: 'apps/artist',
    thresholds: { lines: 36, statements: 37, branches: 26, functions: 51 },
  },
  {
    name: '@escapesuite/shared',
    dir: 'packages/shared',
    thresholds: { lines: 100, statements: 97, branches: 95, functions: 86 },
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

function fmtCell(actualPct, threshold) {
  if (actualPct === undefined || actualPct === null) return 'n/a'
  const rounded = actualPct.toFixed(2)
  const marker = actualPct >= threshold ? '' : ' !'
  return `${rounded}% / ${threshold}%${marker}`
}

const rows = packages.map(({ name, dir, thresholds }) => {
  const summary = readSummary(dir)
  const cells = metrics.map((m) => fmtCell(summary?.[m]?.pct, thresholds[m]))
  return [name, ...cells]
})

const header = ['Package', 'Lines', 'Statements', 'Branches', 'Functions']
const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))

function printRow(cells) {
  console.log(cells.map((c, i) => c.padEnd(widths[i])).join('  '))
}

console.log('Coverage report (actual / threshold; "!" marks a value below its floor)\n')
printRow(header)
printRow(widths.map((w) => '-'.repeat(w)))
for (const row of rows) printRow(row)
