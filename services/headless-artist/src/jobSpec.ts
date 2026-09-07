import type { JobSpec } from './types'

const JOB_ID_RE = /^[A-Za-z0-9._-]{1,128}$/
const FORMATS = ['mp4', 'webm']
const QUALITIES = ['low', 'medium', 'high']
const RESOLUTIONS = ['project', 'original', '1080p', '720p', '480p']
const SINKS = ['volume', 's3', 'webhook', 'command']

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
    throw new Error('options.format must be one of "mp4" or "webm"')
  }

  const quality = value.quality === undefined ? 'high' : value.quality
  if (typeof quality !== 'string' || !QUALITIES.includes(quality)) {
    throw new Error('options.quality must be one of "low", "medium", or "high"')
  }

  const options: JobSpec['options'] = {
    format: format as JobSpec['options']['format'],
    quality: quality as JobSpec['options']['quality'],
  }

  if (value.resolution !== undefined) {
    if (typeof value.resolution !== 'string' || !RESOLUTIONS.includes(value.resolution)) {
      throw new Error(
        'options.resolution must be one of "project", "original", "1080p", "720p", or "480p"',
      )
    }
    options.resolution = value.resolution as NonNullable<JobSpec['options']['resolution']>
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

export function parseJobSpec(json: unknown): JobSpec {
  if (!isRecord(json)) {
    throw new Error('job spec must be an object')
  }

  const jobId = json.jobId
  if (typeof jobId !== 'string' || !JOB_ID_RE.test(jobId)) {
    throw new Error('jobId must be a non-empty string matching /^[A-Za-z0-9._-]{1,128}$/')
  }

  return {
    jobId,
    input: parseInput(json.input),
    options: parseOptions(json.options),
    output: parseOutput(json.output),
  }
}
