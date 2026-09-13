#!/usr/bin/env node
/**
 * Merge every benchmark's JSON into one report.
 *
 * Inputs, all optional — a benchmark that did not run is simply absent:
 *   apps/e2e/perf-results/*.json          (one file per browser benchmark)
 *   apps/e2e/perf-results/*.cpuprofile    (only when PERF_PROFILE=1 was set)
 *   apps/e2e/perf-results/*.maps.json     (the source maps beside each profile)
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
import {
  readProfile,
  readProfileMaps,
  renderProfileMarkdown,
  summariseProfile,
} from './profile-top.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const E2E_ROOT = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(E2E_ROOT, '../..')

const BROWSER_RESULTS_DIR = path.join(E2E_ROOT, 'perf-results')
const KIT_RESULT = path.join(REPO_ROOT, 'services/headless-artist/perf-report.json')
const OUTPUT = path.join(REPO_ROOT, 'perf-report.json')

/** Order benchmarks appear in, whichever of them ran. */
const ORDER = [
  'preview-playback',
  'timeline-interaction',
  'export-mp4',
  'export-webm',
  'headless-kit-render',
]

/**
 * `timeline-interaction` reports one set of numbers per gesture, keyed
 * `<gesture><Metric>` — it measures three gestures in one benchmark rather than
 * running three benchmarks over three page loads of the same scene. Built here
 * rather than written out so the eleven metrics stay in one order across all
 * three gestures, and so adding a gesture is one line.
 */
function gestureMetrics(gesture, label) {
  return {
    [`${gesture}MoveEvents`]: { label: `${label}: pointer moves` },
    [`${gesture}WallMs`]: { label: `${label}: wall time`, unit: 'ms' },
    [`${gesture}TaskDurationMs`]: { label: `${label}: renderer task duration`, unit: 'ms' },
    [`${gesture}JsMsPerFrame`]: { label: `${label}: renderer task per move`, unit: 'ms' },
    [`${gesture}LayoutCount`]: { label: `${label}: layouts` },
    [`${gesture}LayoutsPerFrame`]: { label: `${label}: layouts per move` },
    [`${gesture}RecalcStyleCount`]: { label: `${label}: style recalcs` },
    [`${gesture}RecalcsPerFrame`]: { label: `${label}: style recalcs per move` },
    [`${gesture}LongTaskCount`]: { label: `${label}: long tasks` },
    [`${gesture}LongTaskTotalMs`]: { label: `${label}: long-task total`, unit: 'ms' },
    [`${gesture}HeapDeltaBytes`]: { label: `${label}: heap delta`, bytes: true },
  }
}

/** Metric key → how the table labels and formats it. */
const METRICS = {
  scene: { label: 'Scene' },
  format: { label: 'Format' },
  resolution: { label: 'Resolution' },
  windowSeconds: { label: 'Measured window', unit: 's' },
  moves: { label: 'Pointer moves per gesture' },
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
  ...gestureMetrics('clipDrag', 'Clip drag'),
  ...gestureMetrics('marquee', 'Marquee'),
  ...gestureMetrics('playheadScrub', 'Playhead scrub'),
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
    files = readdirSync(BROWSER_RESULTS_DIR).filter(
      // `<name>.maps.json` is a profile's source maps, not a benchmark result.
      // It parses as JSON perfectly well, which is exactly why it has to be
      // excluded by name — otherwise it lands in the table as a nameless row.
      (name) => name.endsWith('.json') && !name.endsWith('.maps.json')
    )
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

/** `.cpuprofile` basename → how the report heads its section. */
const PROFILE_LABELS = {
  preview: 'Preview playback',
  'timeline-clipDrag': 'Timeline clip drag',
  'timeline-marquee': 'Timeline marquee',
  'timeline-playheadScrub': 'Timeline playhead scrub',
  'export-mp4': 'MP4 export',
  'export-webm': 'WebM export',
}

/** Order profile sections appear in, whichever of them exist. */
const PROFILE_ORDER = [
  'preview',
  'timeline-clipDrag',
  'timeline-marquee',
  'timeline-playheadScrub',
  'export-mp4',
  'export-webm',
]

/**
 * Read whatever `.cpuprofile` files this run produced.
 *
 * Absent unless `PERF_PROFILE=1` was set — an ordinary `pnpm perf` writes none,
 * and the report simply has no profile section. `perf-results/` is emptied at
 * the start of every run, so a profile found here is always this run's.
 */
function collectProfiles() {
  let files = []
  try {
    files = readdirSync(BROWSER_RESULTS_DIR).filter((name) => name.endsWith('.cpuprofile'))
  } catch {
    return []
  }

  const rank = (name) => {
    const index = PROFILE_ORDER.indexOf(name)
    return index === -1 ? PROFILE_ORDER.length : index
  }

  return files
    .map((file) => {
      const name = path.basename(file, '.cpuprofile')
      const full = path.join(BROWSER_RESULTS_DIR, file)
      const profile = readProfile(full)
      if (!profile) return null
      // Without the maps the tables would report Vite's transformed line
      // numbers, which are not the lines in the `.ts` files.
      return { name, label: PROFILE_LABELS[name] ?? name, profile, maps: readProfileMaps(full) }
    })
    .filter(Boolean)
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
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
  // A gesture benchmark has no single rate. Its headline is what one pointer
  // frame of a clip drag costs — the layout count first, because that is the
  // part that does not depend on the runner's CPU.
  if (typeof benchmark.clipDragLayoutsPerFrame === 'number') {
    return (
      `clip drag: ${benchmark.clipDragLayoutsPerFrame} layouts/move, ` +
      `${benchmark.clipDragJsMsPerFrame} ms/move`
    )
  }
  return '—'
}

function toMarkdown(benchmarks, profiles) {
  const lines = ['## Performance benchmarks', '']

  if (benchmarks.length === 0 && profiles.length === 0) {
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

  if (profiles.length > 0) {
    lines.push(
      '',
      '## CPU profiles',
      '',
      '_Recorded on an extra, profiled run (`PERF_PROFILE=1`) whose measurement is discarded —',
      'the medians above are taken from unprofiled windows. Main thread only: the MP4 export\'s',
      'decode worker has its own isolate and does not appear._',
      ''
    )
    for (const { label, profile, maps } of profiles) {
      lines.push(renderProfileMarkdown(label, profile, maps))
    }
  }

  lines.push('')
  return lines.join('\n')
}

/** The profile numbers that belong in `perf-report.json`, without the samples. */
function profileSummary({ name, label, profile, maps }) {
  const summary = summariseProfile(profile, maps)
  const row = (stat) => ({
    name: stat.name,
    // The original file and line where a source map resolved one; the served
    // module and its transformed line otherwise.
    source: stat.source || '',
    sourceLine: stat.sourceLine || 0,
    url: stat.url,
    servedLine: stat.servedLine,
    selfMs: Math.round(stat.self / 100) / 10,
    totalMs: Math.round(stat.total / 100) / 10,
  })
  return {
    name,
    label,
    windowMs: Math.round(summary.measuredUs / 100) / 10,
    attributedMs: Math.round(summary.attributedUs / 100) / 10,
    jsSelfMs: Math.round(summary.codeSelfUs / 100) / 10,
    topSelf: summary.code.slice(0, 25).map(row),
    topAppCodeTotal: summary.appCode.slice(0, 15).map(row),
    synthetic: summary.synthetic.map(row),
  }
}

function main() {
  const benchmarks = collect()
  const profiles = collectProfiles()
  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    benchmarks,
    ...(profiles.length > 0 ? { profiles: profiles.map(profileSummary) } : {}),
  }

  try {
    mkdirSync(path.dirname(OUTPUT), { recursive: true })
    writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + '\n')
  } catch (error) {
    warn(`could not write ${path.relative(REPO_ROOT, OUTPUT)} — ${error.message}`)
  }

  const markdown = toMarkdown(benchmarks, profiles)
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
