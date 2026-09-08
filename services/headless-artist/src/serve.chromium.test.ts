import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startServer } from './serve'
import type { ServeHandle } from './serve'
import type { RenderOutcome } from './types'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SERVICE_ROOT = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(SERVICE_ROOT, '../..')
const BUNDLE = path.join(REPO_ROOT, 'apps/artist/dist-headless/headless.html')
const MANIFEST = path.join(SERVICE_ROOT, 'test/fixtures/manifest/manifest.json')

/** Long enough for a Chromium launch plus a real (tiny) encode on a cold machine. */
const RENDER_TIMEOUT_MS = 180_000

const VERSIONS = { engineVersion: 'engine-test', kitVersion: 'kit-test' }

/** What the CLI hands the server by default: everything except the command sink. */
const ALLOWED_SINKS = ['volume', 'webhook', 's3']

let tmpRoot: string
let workDir: string
let outDir: string
let server: ServeHandle
let base: string

// The headless bundle is built once for the whole chromium suite by test/globalSetup.ts.
beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'headless-artist-serve-e2e-'))
  workDir = path.join(tmpRoot, 'work')
  outDir = path.join(tmpRoot, 'out')
  await fs.mkdir(workDir, { recursive: true })

  server = await startServer({
    port: 0,
    host: '127.0.0.1',
    concurrency: 1,
    deps: { bundlePath: BUNDLE, workDir, versions: VERSIONS, log: () => {} },
    allowedSinks: ALLOWED_SINKS,
    versions: VERSIONS,
    log: () => {},
  })
  base = `http://127.0.0.1:${server.port}`
})

afterAll(async () => {
  if (server) await server.close()
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
})

describe('startServer (real Chromium)', () => {
  it('reports healthy before any job has run', async () => {
    const res = await fetch(`${base}/healthz`)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      versions: VERSIONS,
      inFlight: 0,
      queued: 0,
      maxQueue: 64,
      allowedSinks: ALLOWED_SINKS,
    })
  })

  it('renders a manifest job posted to /render and writes it to the volume sink', async () => {
    const res = await fetch(`${base}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jobId: 'serve-e2e-1',
        input: { manifest: { path: MANIFEST } },
        options: { format: 'mp4', quality: 'medium' },
        output: { sink: 'volume', config: { dir: outDir } },
      }),
    })

    expect(res.status).toBe(200)
    const outcome = (await res.json()) as RenderOutcome
    expect(outcome.ok).toBe(true)
    expect(outcome.error).toBeUndefined()
    expect(outcome.jobId).toBe('serve-e2e-1')
    expect(outcome.meta).toMatchObject({ format: 'mp4', width: 64, height: 48 })

    const outputPath = path.join(outDir, 'serve-e2e-1.mp4')
    expect(outcome.outputLocation).toBe(outputPath)
    const bytes = await fs.readFile(outputPath)
    // Every ISO-BMFF file starts with an ftyp box within its first 12 bytes.
    expect(bytes.subarray(0, 12).toString('latin1')).toContain('ftyp')

    // The scratch dir the job rendered into is gone, exactly as for the one-shot CLI.
    expect(await fs.readdir(workDir)).toEqual([])
  }, RENDER_TIMEOUT_MS)

  it('refuses a command-sink job, because serve does not enable that sink by default', async () => {
    const res = await fetch(`${base}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jobId: 'serve-e2e-command',
        input: { manifest: { path: MANIFEST } },
        options: { format: 'mp4' },
        output: { sink: 'command', config: { command: '/usr/bin/true' } },
      }),
    })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: 'sink "command" is not enabled on this server (HEADLESS_SINKS)',
    })
  })

  it('is back to idle afterwards', async () => {
    const health = (await (await fetch(`${base}/healthz`)).json()) as Record<string, number>

    expect(health).toMatchObject({ inFlight: 0, queued: 0 })
  })
})
