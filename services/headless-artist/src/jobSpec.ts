import type { JobSpec } from './types'

const JOB_ID_RE = /^[A-Za-z0-9._-]{1,128}$/
const FORMATS = ['mp4', 'webm', 'gif']
const QUALITIES = ['low', 'medium', 'high']
const RESOLUTIONS = ['project', '1080p', '720p', '480p', '360p']
const SINKS = ['volume', 's3', 'webhook', 'command']
/** GIF only. The three rates ESCAPEARTIST's own export offers (ESCSUITE-34). */
const GIF_FPS = [10, 15, 20]

/** Every key `parseJobSpec` reads; anything else is a typo worth warning about. */
const TOP_LEVEL_KEYS = ['jobId', 'input', 'options', 'output']
const OPTIONS_KEYS = ['format', 'quality', 'resolution', 'timeRange', 'fps']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseInput(value: unknown): JobSpec['input'] {
  if (!isRecord(value)) {
    throw new Error('input must be an object with exactly one of "bundle" or "manifest"')
  }

  const hasBundle = value.bundle !== undefined
  const hasManifest = value.manifest !== undefined
  if (hasBundle === hasManifest) {
    throw new Error('input must have exactly one of "bundle" or "manifest"')
  }

  if (hasBundle) {
    const bundle = value.bundle
    if (!isRecord(bundle) || typeof bundle.path !== 'string' || bundle.path.length === 0) {
      throw new Error('input.bundle.path must be a non-empty string')
    }
    return { bundle: { path: bundle.path } }
  }

  const manifest = value.manifest
  if (!isRecord(manifest) || typeof manifest.path !== 'string' || manifest.path.length === 0) {
    throw new Error('input.manifest.path must be a non-empty string')
  }
  return { manifest: { path: manifest.path } }
}

function parseOptions(value: unknown): JobSpec['options'] {
  if (!isRecord(value)) {
    throw new Error('options must be an object')
  }

  const format = value.format
  if (typeof format !== 'string' || !FORMATS.includes(format)) {
    throw new Error('options.format must be one of "mp4", "webm", or "gif"')
  }

  const quality = value.quality === undefined ? 'high' : value.quality
  if (typeof quality !== 'string' || !QUALITIES.includes(quality)) {
    throw new Error('options.quality must be one of "low", "medium", or "high"')
  }

  const options: JobSpec['options'] = {
    format: format as JobSpec['options']['format'],
    quality: quality as JobSpec['options']['quality'],
  }

  // All five heights are accepted for every format. `getResolution` answers each
  // of them whatever is being encoded, and an MP4 at 640x360 is a legitimate — if
  // unusual — thing to ask a render farm for; ESCAPEARTIST's own export dialog
  // offers 360p for GIF alone, which is a choice about what to offer rather than
  // about what works. A validator's job is to refuse what cannot work.
  if (value.resolution !== undefined) {
    if (typeof value.resolution !== 'string' || !RESOLUTIONS.includes(value.resolution)) {
      throw new Error(
        'options.resolution must be one of "project", "1080p", "720p", "480p", or "360p"',
      )
    }
    options.resolution = value.resolution as NonNullable<JobSpec['options']['resolution']>
  }

  // GIF only, and said rather than ignored: a `format: "mp4", fps: 20` job is a
  // caller who misunderstood something, and rendering at 30 fps anyway is
  // exactly the quiet-wrong-output failure `collectUnknownKeys` exists to stop —
  // for a field that is known but inapplicable rather than misspelled. The format
  // check above has already run, so `format` is one of the three here.
  if (value.fps !== undefined) {
    if (format !== 'gif') {
      throw new Error('options.fps applies to "gif" only')
    }
    if (typeof value.fps !== 'number' || !GIF_FPS.includes(value.fps)) {
      throw new Error('options.fps must be one of 10, 15, or 20')
    }
    options.fps = value.fps as NonNullable<JobSpec['options']['fps']>
  }

  if (value.timeRange !== undefined) {
    const timeRange = value.timeRange
    if (
      !isRecord(timeRange) ||
      typeof timeRange.start !== 'number' ||
      typeof timeRange.end !== 'number'
    ) {
      throw new Error('options.timeRange must be an object with numeric "start" and "end"')
    }
    if (!(timeRange.start < timeRange.end)) {
      throw new Error('options.timeRange.start must be less than options.timeRange.end')
    }
    options.timeRange = { start: timeRange.start, end: timeRange.end }
  }

  return options
}

function parseOutput(value: unknown): JobSpec['output'] {
  if (!isRecord(value)) {
    throw new Error('output must be an object')
  }

  const sink = value.sink
  if (typeof sink !== 'string' || !SINKS.includes(sink)) {
    throw new Error('output.sink must be one of "volume", "s3", "webhook", or "command"')
  }

  const config = value.config
  if (!isRecord(config)) {
    throw new Error('output.config must be an object')
  }

  return { sink: sink as JobSpec['output']['sink'], config }
}

/**
 * Dotted paths of fields this parser does not read — `qualitiy`, `options.resoluton` and
 * friends. A misspelled optional field is otherwise invisible: the job renders happily,
 * silently ignoring what the caller asked for. Kept separate from `parseJobSpec` so it stays
 * a warning (never a rejection) and so every entry point — the CLI today, HTTP later — can
 * surface it in whatever way suits it. Only the two levels the parser itself understands are
 * walked; `output.config` is the sink's own vocabulary, not this parser's.
 */
export function collectUnknownKeys(json: unknown): string[] {
  if (!isRecord(json)) return []

  const unknown = Object.keys(json).filter((key) => !TOP_LEVEL_KEYS.includes(key))

  if (isRecord(json.options)) {
    for (const key of Object.keys(json.options)) {
      if (!OPTIONS_KEYS.includes(key)) unknown.push(`options.${key}`)
    }
  }

  return unknown
}

export function parseJobSpec(json: unknown): JobSpec {
  if (!isRecord(json)) {
    throw new Error('job spec must be an object')
  }

  const jobId = json.jobId
  if (typeof jobId !== 'string' || !JOB_ID_RE.test(jobId)) {
    throw new Error('jobId must be a non-empty string matching /^[A-Za-z0-9._-]{1,128}$/')
  }
  // The regex allows dots, so these two slip through — and the job id becomes a directory
  // name, where "." and ".." would point the runner at its own work dir or the parent of it.
  if (jobId === '.' || jobId === '..') {
    throw new Error('jobId must not be "." or ".."; it is used as a directory name')
  }

  return {
    jobId,
    input: parseInput(json.input),
    options: parseOptions(json.options),
    output: parseOutput(json.output),
  }
}
