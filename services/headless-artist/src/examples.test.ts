import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseJobSpec } from './jobSpec'
import { loadManifest } from './loaders'

const EXAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../examples')

async function jobFiles(): Promise<string[]> {
  const entries = await fs.readdir(EXAMPLES)
  return entries.filter((name) => name.startsWith('job-') && name.endsWith('.json')).sort()
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(path.join(EXAMPLES, file), 'utf8'))
}

/**
 * The examples are documentation the customer copies verbatim, so a stale one is a bug the
 * same way a stale README line is. These tests are the thing that keeps them honest as the
 * spec moves.
 */
describe('examples/', () => {
  it('ships one example per sink', async () => {
    expect(await jobFiles()).toEqual([
      'job-command.json',
      'job-manifest-volume.json',
      'job-s3.json',
      'job-veditor-volume.json',
      'job-webhook.json',
    ])
  })

  it('every example job spec is accepted by parseJobSpec', async () => {
    for (const file of await jobFiles()) {
      const spec = parseJobSpec(await readJson(file))
      expect(spec.jobId, file).toMatch(/^[A-Za-z0-9._-]{1,128}$/)
    }
  })

  it('covers every sink the parser accepts', async () => {
    const sinks = new Set<string>()
    for (const file of await jobFiles()) {
      sinks.add(parseJobSpec(await readJson(file)).output.sink)
    }
    expect([...sinks].sort()).toEqual(['command', 's3', 'volume', 'webhook'])
  })

  it('loads the example manifest, media file and all', async () => {
    const job = await loadManifest(path.join(EXAMPLES, 'manifest.json'))

    expect(job.sourceVideos).toEqual([
      { id: 'src-0', name: 'clip.mp4', mimeType: 'video/mp4', width: 64, height: 48, duration: 1 },
    ])
    expect(job.sourceFiles['src-0']).toBe(path.join(EXAMPLES, 'clip.mp4'))
    // loadManifest checks every clip's source, so this passing means the sample project and
    // the sample sources actually agree with each other.
    expect(job.project.timeline.clips).toHaveLength(1)
  })
})
