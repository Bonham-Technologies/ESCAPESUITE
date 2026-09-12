#!/usr/bin/env node
/**
 * Merge every benchmark's JSON into one report.
 *
 * Inputs, all optional — a benchmark that did not run is simply absent:
 *   apps/e2e/perf-results/*.json          (one file per browser benchmark)
 *   services/headless-artist/perf-report.json
 *
 * Outputs:
 *   <repo root>/perf-report.json          the merged numbers
 *   stdout                                a Markdown table
 *   $GITHUB_STEP_SUMMARY                  the same table, appended, when set
 *
 * Never exits non-zero. The perf job is informational: a missing or malformed
 * result is worth saying out loud, but it is not worth failing a build over,
 * and this script is the last thing `pnpm perf` runs.
 *
 * Node built-ins only, deliberately — it has to run in a job that installed
 * nothing beyond the workspace.
 */
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const E2E_ROOT = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(E2E_ROOT, '../..')

const BROWSER_RESULTS_DIR = path.join(E2E_ROOT, 'perf-results')
const KIT_RESULT = path.join(REPO_ROOT, 'services/headless-artist/perf-report.json')
const OUTPUT = path.join(REPO_ROOT, 'perf-report.json')

/** Order benchmarks appear in, whichever of them ran. */
const ORDER = ['preview-playback', 'export-mp4', 'export-webm', 'headless-kit-render']

/** Metric key → how the table labels and formats it. */
const METRICS = {
  scene: { label: 'Scene' },
  format: { label: 'Format' },
  resolution: { label: 'Resolution' },
  windowSeconds: { label: 'Measured window', unit: 's' },
  renderedFps: { label: 'Rendered fps' },
  longTaskCount: { label: 'Long tasks' },
  longTaskTotalMs: { label: 'Long-task total', unit: 'ms' },
  taskDurationMs: { label: 'Renderer task duration', unit: 'ms' },
  layoutCount: { label: 'Layouts' },
  recalcStyleCount: { label: 'Style recalcs' },
  wallMs: { label: 'Wall time', unit: 'ms' },
  framesEncoded: { label: 'Frames encoded' },
  framesPerSecond: { label: 'Frames/s' },
  encoderQueueHighWater: { label: 'Encoder queue high-water' },
  heapDeltaBytes: { label: 'Heap delta', bytes: true },
  outputBytes: { label: 'Output size', bytes: true },
}

function warn(message) {
  console.warn(`perf-report: ${message}`)
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    warn(`skipping ${path.relative(REPO_ROOT, file)} — ${error.message}`)
    return null
  }
}

function collect() {
  const benchmarks = []

  let files = []
  try {
    files = readdirSync(BROWSER_RESULTS_DIR).filter((name) => name.endsWith('.json'))
  } catch {
    warn(`no browser results in ${path.relative(REPO_ROOT, BROWSER_RESULTS_DIR)}`)
  }
  for (const name of files.sort()) {
    const result = readJson(path.join(BROWSER_RESULTS_DIR, name))
    if (result) benchmarks.push(result)
  }

  const kit = readJson(KIT_RESULT)
  if (kit) benchmarks.push(kit)

  return benchmarks.sort((a, b) => {
    const rank = (x) => {
      const index = ORDER.indexOf(x.name)
      return index === -1 ? ORDER.length : index
    }
    return rank(a) - rank(b) || String(a.name).localeCompare(String(b.name))
  })
}

function formatBytes(value) {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs < 1024) return `${sign}${abs} B`
  if (abs < 1024 * 1024) return `${sign}${(abs / 1024).toFixed(1)} KB`
  return `${sign}${(abs / (1024 * 1024)).toFixed(2)} MB`
}

function formatValue(key, value) {
  const spec = METRICS[key]
  if (!spec) return String(value)
  if (spec.bytes && typeof value === 'number') return formatBytes(value)
  if (typeof value === 'number') {
    const rendered = Number.isInteger(value) ? String(value) : value.toFixed(2)
    return spec.unit ? `${rendered} ${spec.unit}` : rendered
  }
  return String(value)
}

/** The one number each benchmark is really about, for the summary table. */
function headline(benchmark) {
  if (typeof benchmark.renderedFps === 'number') return `${benchmark.renderedFps} rendered fps`
  if (typeof benchmark.framesPerSecond === 'number') {
    return `${benchmark.framesPerSecond} frames/s (${benchmark.wallMs} ms)`
  }
  return '—'
}

function toMarkdown(benchmarks) {
  const lines = ['## Performance benchmarks', '']

  if (benchmarks.length === 0) {
    lines.push('_No benchmark results were produced._', '')
    return lines.join('\n')
  }

  lines.push(
    '_Chromium, medians over repeated runs. Informational only — nothing here gates CI,',
    'and numbers are comparable between runs on the same machine, not across machines._',
    '',
    '| Benchmark | Runs | Headline |',
    '| --- | --- | --- |'
  )
  for (const benchmark of benchmarks) {
    lines.push(`| \`${benchmark.name}\` | ${benchmark.runs ?? '—'} | ${headline(benchmark)} |`)
  }

  for (const benchmark of benchmarks) {
    lines.push('', `### \`${benchmark.name}\``, '', '| Metric | Value |', '| --- | --- |')
    for (const [key, spec] of Object.entries(METRICS)) {
      if (!(key in benchmark)) continue
      lines.push(`| ${spec.label} | ${formatValue(key, benchmark[key])} |`)
    }
  }

  lines.push('')
  return lines.join('\n')
}

function main() {
  const benchmarks = collect()
  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    benchmarks,
  }

  try {
    mkdirSync(path.dirname(OUTPUT), { recursive: true })
    writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + '\n')
  } catch (error) {
    warn(`could not write ${path.relative(REPO_ROOT, OUTPUT)} — ${error.message}`)
  }

  const markdown = toMarkdown(benchmarks)
  process.stdout.write(markdown + '\n')

  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) {
    try {
      appendFileSync(summary, markdown + '\n')
    } catch (error) {
      warn(`could not append to GITHUB_STEP_SUMMARY — ${error.message}`)
    }
  }
}

try {
  main()
} catch (error) {
  warn(`report generation failed — ${error?.message ?? error}`)
}
