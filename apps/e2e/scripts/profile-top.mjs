#!/usr/bin/env node
/**
 * Summarise a V8 `.cpuprofile` as Markdown: where the time went.
 *
 * Usage:
 *   node apps/e2e/scripts/profile-top.mjs apps/e2e/perf-results/preview.cpuprofile
 *
 * Profiles are written by `PERF_PROFILE=1 pnpm perf` (see `utils/perf.ts`,
 * `withCpuProfile`), together with a `<name>.maps.json` beside each one.
 * `perf-report.mjs` imports {@link renderProfileMarkdown} from here so the same
 * tables land in the merged report.
 *
 * Two tables, because they answer different questions:
 *
 * - **Self time** — which function bodies the sampler actually caught executing.
 *   This is where cycles are spent, and it is what an optimisation removes.
 * - **Total time, app code only** — which of *our* frames were anywhere on the
 *   stack. A frame with no self time but a large total (`drawFrame`, say) is a
 *   subsystem's entry point, and it is the unit a fix is scoped to. Restricting
 *   it to URLs under `/src/` is what keeps the table from being a list of
 *   React and Vite internals wrapping everything.
 *
 * `(program)`, `(idle)` and `(garbage collector)` are V8's synthetic frames,
 * not code anyone can edit. They are excluded from the percentage denominator —
 * so "12% of self time" means 12% of *JavaScript execution*, not 12% of a window
 * that was mostly idle between animation frames — and reported separately
 * underneath, because how much of a window was idle and how much was GC is
 * exactly the sort of thing a hotspot report must not bury.
 *
 * Node built-ins only, like every other script here. `profile-top.test.mjs`
 * covers the two things that are easy to get silently wrong: which delta a
 * sample is charged, and recursion in the total-time fold.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Rows in the self-time table. */
const TOP_SELF = 25
/** Rows in the app-code total-time table. */
const TOP_TOTAL = 15
/** V8's synthetic frames: reported, but never counted as code. */
const SYNTHETIC = new Set(['(program)', '(idle)', '(garbage collector)', '(root)'])
/** What counts as app code in the total-time table. */
const APP_CODE = '/src/'

// ---------------------------------------------------------------------------
// Source maps
// ---------------------------------------------------------------------------

const BASE64 = new Map(
  [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map((char, index) => [
    char,
    index,
  ])
)

/**
 * Decode one Base64-VLQ segment into its signed integer fields.
 *
 * Each field is a run of 6-bit digits, little-endian, bit 5 being "another digit
 * follows" and the low bit of the assembled value being the sign. This is the
 * whole of the source-map wire format that a line lookup needs.
 */
function decodeVlq(segment) {
  const values = []
  let value = 0
  let shift = 0
  for (const char of segment) {
    const digit = BASE64.get(char)
    if (digit === undefined) return null
    value += (digit & 31) * 2 ** shift
    if (digit & 32) {
      shift += 5
      continue
    }
    const negative = value & 1
    value = Math.floor(value / 2)
    values.push(negative ? -value : value)
    value = 0
    shift = 0
  }
  return values
}

/**
 * Index one source map by generated line.
 *
 * `mappings` is `;`-separated generated lines of `,`-separated segments, every
 * field a delta: the generated column resets each line, while the source index,
 * source line and source column accumulate across the whole string. The result
 * is `index[generatedLine] = [[genCol, sourceIndex, sourceLine], ...]`, sorted
 * by column, with `sourceIndex === -1` for a segment that maps to nothing.
 */
export function buildSourceMapIndex(map) {
  if (!map || typeof map.mappings !== 'string' || !Array.isArray(map.sources)) return null

  const index = []
  let sourceIndex = 0
  let sourceLine = 0

  for (const group of map.mappings.split(';')) {
    const segments = []
    let generatedColumn = 0
    if (group) {
      for (const segment of group.split(',')) {
        if (!segment) continue
        const fields = decodeVlq(segment)
        if (!fields || fields.length === 0) continue
        generatedColumn += fields[0]
        if (fields.length >= 4) {
          sourceIndex += fields[1]
          sourceLine += fields[2]
          segments.push([generatedColumn, sourceIndex, sourceLine])
        } else {
          segments.push([generatedColumn, -1, -1])
        }
      }
    }
    segments.sort((a, b) => a[0] - b[0])
    index.push(segments)
  }

  return { index, sources: map.sources, sourceRoot: map.sourceRoot }
}

/**
 * Resolve a generated position to its original file and 1-based line.
 *
 * Both inputs are 0-based, as V8 reports them. The mapping that applies is the
 * last one at or before the column; a position before the line's first mapping
 * takes that first mapping, which is the right answer for a function whose
 * recorded column sits just left of its body.
 */
export function resolvePosition(indexed, line, column) {
  if (!indexed) return null
  const segments = indexed.index[line]
  if (!segments || segments.length === 0) return null

  let best = null
  for (const segment of segments) {
    if (segment[0] <= column) best = segment
    else break
  }
  if (!best) best = segments[0]
  if (best[1] < 0) return null

  const source = indexed.sources[best[1]]
  if (typeof source !== 'string') return null
  return { source, line: best[2] + 1 }
}

// ---------------------------------------------------------------------------
// Folding a profile
// ---------------------------------------------------------------------------

/**
 * One aggregation key per distinct function.
 *
 * Location, not just name: `anonymous` and `onMessage` are each half a dozen
 * different functions in one profile, and merging them would invent a hotspot
 * that does not exist. The column is part of it too — after a bundler's
 * transform, several functions routinely share a generated line, and the column
 * is also what a source-map lookup needs to tell them apart.
 */
function keyOf(callFrame) {
  const name = callFrame.functionName || '(anonymous)'
  const url = callFrame.url || ''
  const line = typeof callFrame.lineNumber === 'number' ? callFrame.lineNumber : -1
  const column = typeof callFrame.columnNumber === 'number' ? callFrame.columnNumber : -1
  return `${name}\u0000${url}\u0000${line}\u0000${column}`
}

/**
 * Turn a source map's `sources` entry into a path worth printing.
 *
 * Vite's dev maps name each source by bare filename — `canvasRenderer.ts`, with
 * no directory — which is ambiguous the moment two files share a name. The
 * directory is recoverable from the module URL the map came with, so resolve
 * one against the other; an absolute source survives unchanged.
 */
function resolveSourcePath(url, source) {
  if (!url) return source
  try {
    return new URL(source, url).pathname
  } catch {
    return source
  }
}

/** Display form of a path: from `/src/` on, or the URL with its origin stripped. */
function shortPath(value) {
  if (!value) return ''
  const index = value.indexOf(APP_CODE)
  const short =
    index === -1 ? value.replace(/^https?:\/\/[^/]+/, '') || value : value.slice(index + 1)
  return short.split('?')[0]
}

/**
 * Fold a profile into per-function self and total time.
 *
 * **Which delta belongs to which sample** is the one thing here that is easy to
 * get backwards. In the CDP format `timeDeltas[i]` is the interval that elapsed
 * *before* `samples[i]` was taken, so the time a sample is responsible for is
 * the interval that follows it — `timeDeltas[i + 1]` — and the final sample owns
 * whatever remains of the window. Charging `timeDeltas[i]` to `samples[i]`
 * shifts every microsecond one sample early, which systematically credits a hot
 * function's cost to whatever ran just before it.
 *
 * Total time sums the same intervals over every sample with that function
 * *anywhere* on its stack, counted once per sample. Counting once is what makes
 * a recursive function's total mean "time inside this function" rather than a
 * multiple of the window.
 */
export function summariseProfile(profile, maps) {
  const nodes = new Map()
  const parent = new Map()
  for (const node of profile.nodes ?? []) {
    nodes.set(node.id, node)
    for (const child of node.children ?? []) parent.set(child, node.id)
  }

  const indexed = new Map()
  const indexFor = (url) => {
    if (!maps || !url) return null
    if (!indexed.has(url)) indexed.set(url, buildSourceMapIndex(maps[url]))
    return indexed.get(url)
  }

  const stats = new Map()
  const statFor = (key, callFrame) => {
    let stat = stats.get(key)
    if (!stat) {
      const url = callFrame.url || ''
      const line = typeof callFrame.lineNumber === 'number' ? callFrame.lineNumber : -1
      const column = typeof callFrame.columnNumber === 'number' ? callFrame.columnNumber : -1
      const original = line >= 0 ? resolvePosition(indexFor(url), line, Math.max(0, column)) : null
      stat = {
        name: callFrame.functionName || '(anonymous)',
        url,
        /** 1-based line in the *served* module — what the profiler recorded. */
        servedLine: line + 1,
        /** 1-based line in the original file, when a source map resolved it. */
        sourceLine: original ? original.line : 0,
        /** Original file path, when a source map resolved it. */
        source: original ? resolveSourcePath(url, original.source) : '',
        self: 0,
        total: 0,
      }
      stats.set(key, stat)
    }
    return stat
  }

  const samples = profile.samples ?? []
  const deltas = profile.timeDeltas ?? []

  // Whatever the window has left after the last recorded delta belongs to the
  // last sample. Clamped at zero: a profile without `endTime` must not make it
  // negative.
  let recordedUs = 0
  for (const delta of deltas) recordedUs += Math.max(0, delta ?? 0)
  const tailUs = Math.max(0, (profile.endTime ?? 0) - (profile.startTime ?? 0) - recordedUs)

  let attributedUs = 0
  // Reused across samples so a long profile does not allocate a Set per sample.
  const seen = new Set()

  for (let i = 0; i < samples.length; i++) {
    const node = nodes.get(samples[i])
    // A negative delta happens when the profiler's clock is adjusted; treat it
    // as zero rather than letting it subtract from a hot function's total.
    const deltaUs = i + 1 < deltas.length ? Math.max(0, deltas[i + 1] ?? 0) : tailUs
    if (!node) continue
    attributedUs += deltaUs

    const key = keyOf(node.callFrame)
    statFor(key, node.callFrame).self += deltaUs

    seen.clear()
    for (let id = samples[i]; id !== undefined; id = parent.get(id)) {
      const ancestor = nodes.get(id)
      if (!ancestor) break
      const ancestorKey = keyOf(ancestor.callFrame)
      if (!seen.has(ancestorKey)) {
        seen.add(ancestorKey)
        statFor(ancestorKey, ancestor.callFrame).total += deltaUs
      }
    }
  }

  const all = [...stats.values()]
  const synthetic = all.filter((stat) => SYNTHETIC.has(stat.name))
  const code = all.filter((stat) => !SYNTHETIC.has(stat.name))
  const codeSelfUs = code.reduce((sum, stat) => sum + stat.self, 0)
  const windowUs = (profile.endTime ?? 0) - (profile.startTime ?? 0)

  return {
    /** Wall time the window covers, µs. */
    measuredUs: windowUs > 0 ? windowUs : attributedUs,
    /** Time actually charged to a sample, µs. */
    attributedUs,
    /** Self time attributed to real JavaScript, µs — the percentage denominator. */
    codeSelfUs,
    /** Every non-synthetic frame, self-time descending. */
    code: code.sort((a, b) => b.self - a.self),
    /** App-code frames (`/src/`), total-time descending. */
    appCode: code.filter((stat) => stat.url.includes(APP_CODE)).sort((a, b) => b.total - a.total),
    /** `(program)` / `(idle)` / `(garbage collector)` / `(root)`, self-time descending. */
    synthetic: synthetic.sort((a, b) => b.self - a.self),
  }
}

/**
 * How a frame's location is printed.
 *
 * A resolved location is a real file and line someone can open. An unresolved
 * one is the served module's line, which after Vite's transform is *not* the
 * line in the `.ts` file — so it is labelled `(served)` rather than passed off
 * as a source location.
 */
export function locationOf(stat) {
  if (stat.source) return `${shortPath(stat.source)}:${stat.sourceLine}`
  if (!stat.url) return '—'
  return `(served) ${shortPath(stat.url)}:${stat.servedLine}`
}

function ms(us) {
  return (us / 1000).toFixed(1)
}

function percent(part, whole) {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—'
}

/** Escape a function name for a Markdown table cell. */
function cell(text) {
  return String(text).replace(/\|/g, '\\|')
}

/**
 * Render one profile's two tables.
 *
 * `label` heads the section; `profile` is the parsed `.cpuprofile`; `maps` is
 * the parsed `<name>.maps.json` beside it, or undefined.
 */
export function renderProfileMarkdown(label, profile, maps) {
  const summary = summariseProfile(profile, maps)
  const lines = [`### ${label}`, '']

  if (summary.code.length === 0) {
    lines.push('_Profile contains no samples._', '')
    return lines.join('\n')
  }

  lines.push(
    `Window ${ms(summary.measuredUs)} ms; ${ms(summary.codeSelfUs)} ms of it executing JavaScript.`,
    'Percentages are of that JavaScript total, not of the window.',
    '',
    `**Top ${TOP_SELF} by self time**`,
    '',
    '| # | Function | Source location | Self ms | Self % |',
    '| --- | --- | --- | --- | --- |'
  )
  summary.code.slice(0, TOP_SELF).forEach((stat, index) => {
    lines.push(
      `| ${index + 1} | \`${cell(stat.name)}\` | ${cell(locationOf(stat))} | ${ms(stat.self)} | ${percent(stat.self, summary.codeSelfUs)} |`
    )
  })

  lines.push(
    '',
    `**Top ${TOP_TOTAL} app-code frames by total time** (URL under \`${APP_CODE}\`)`,
    '',
    '| # | Function | Source location | Total ms | Total % | Self ms |',
    '| --- | --- | --- | --- | --- | --- |'
  )
  if (summary.appCode.length === 0) {
    lines.push('| — | _no app-code frames sampled_ | — | — | — | — |')
  } else {
    summary.appCode.slice(0, TOP_TOTAL).forEach((stat, index) => {
      lines.push(
        `| ${index + 1} | \`${cell(stat.name)}\` | ${cell(locationOf(stat))} | ${ms(stat.total)} | ${percent(stat.total, summary.codeSelfUs)} | ${ms(stat.self)} |`
      )
    })
  }

  lines.push(
    '',
    '**Excluded from the percentages above**',
    '',
    '| Frame | Self ms | % of window |',
    '| --- | --- | --- |'
  )
  for (const stat of summary.synthetic) {
    lines.push(
      `| \`${cell(stat.name)}\` | ${ms(stat.self)} | ${percent(stat.self, summary.measuredUs)} |`
    )
  }
  lines.push('')

  return lines.join('\n')
}

/** Read and parse a JSON file; returns null (with a warning) if it cannot. */
function readJson(file, optional = false) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    if (!optional) console.warn(`profile-top: skipping ${file} — ${error.message}`)
    return null
  }
}

/** Read a `.cpuprofile`. */
export function readProfile(file) {
  return readJson(file)
}

/** The `<name>.maps.json` that belongs to a `.cpuprofile`, or undefined. */
export function readProfileMaps(file) {
  return readJson(file.replace(/\.cpuprofile$/, '') + '.maps.json', true) ?? undefined
}

function main(argv) {
  const files = argv.slice(2)
  if (files.length === 0) {
    console.error('usage: node profile-top.mjs <file.cpuprofile> [...]')
    process.exitCode = 1
    return
  }
  for (const file of files) {
    const profile = readProfile(file)
    if (!profile) {
      process.exitCode = 1
      continue
    }
    process.stdout.write(
      renderProfileMarkdown(path.basename(file), profile, readProfileMaps(file)) + '\n'
    )
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv)
}
