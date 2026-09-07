import { execSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runJob } from './run'
import type { JobSpec } from './types'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SERVICE_ROOT = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(SERVICE_ROOT, '../..')
const BUNDLE = path.join(REPO_ROOT, 'apps/artist/dist-headless/headless.html')
const MANIFEST = path.join(SERVICE_ROOT, 'test/fixtures/manifest/manifest.json')

/** Long enough for a Chromium launch plus a real (tiny) encode on a cold machine. */
const RENDER_TIMEOUT_MS = 180_000

const VERSIONS = { engineVersion: 'engine-test', kitVersion: 'kit-test' }

/** Silences the driver's own progress/launch chatter; the assertions cover behaviour, not logs. */
const quiet = () => {}

let tmpRoot: string
let workDir: string
let outDir: string

beforeAll(async () => {
  execSync('pnpm --filter=@escapesuite/artist run build:headless', { cwd: REPO_ROOT, stdio: 'inherit' })
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'headless-artist-run-e2e-'))
  workDir = path.join(tmpRoot, 'work')
  outDir = path.join(tmpRoot, 'out')
  await fs.mkdir(workDir, { recursive: true })
}, RENDER_TIMEOUT_MS)

afterAll(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
})

function makeSpec(jobId: string, manifestPath = MANIFEST): JobSpec {
  return {
    jobId,
    input: { manifest: { path: manifestPath } },
    options: { format: 'mp4', quality: 'medium' },
    output: { sink: 'volume', config: { dir: outDir } },
  }
}

describe('runJob (real Chromium)', () => {
  it('renders a manifest job and delivers it through the volume sink', async () => {
    const progress: number[] = []

    const outcome = await runJob(makeSpec('e2e-1'), {
      bundlePath: BUNDLE,
      workDir,
      versions: VERSIONS,
      onProgress: (p) => progress.push(p),
      log: quiet,
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.error).toBeUndefined()
    expect(outcome.jobId).toBe('e2e-1')
    expect(outcome.durationMs).toBeGreaterThan(0)
    expect(outcome.meta).toMatchObject({ format: 'mp4', width: 64, height: 48, gpu: false })
    expect(progress.length).toBeGreaterThanOrEqual(1)

    const outputPath = path.join(outDir, 'e2e-1.mp4')
    expect(outcome.outputLocation).toBe(outputPath)
    const bytes = await fs.readFile(outputPath)
    // Every ISO-BMFF file starts with an ftyp box within its first 12 bytes.
    expect(bytes.subarray(0, 12).toString('latin1')).toContain('ftyp')

    const manifestPath = path.join(outDir, 'e2e-1.manifest.json')
    expect(outcome.manifestLocation).toBe(manifestPath)
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    expect(manifest.jobId).toBe('e2e-1')
    expect(manifest.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.byteLength).toBe(bytes.byteLength)
    expect(manifest.chromiumVersion.length).toBeGreaterThan(0)
    expect(manifest.engineVersion).toBe('engine-test')
    expect(manifest.kitVersion).toBe('kit-test')

    // The scratch dir this job rendered into is gone.
    expect(await fs.readdir(workDir)).toEqual([])
  }, RENDER_TIMEOUT_MS)

  it('returns ok:false and cleans up when the headless bundle is missing', async () => {
    const missing = path.join(tmpRoot, 'no-such-bundle.html')

    const outcome = await runJob(makeSpec('e2e-no-bundle'), {
      bundlePath: missing,
      workDir,
      versions: VERSIONS,
      log: quiet,
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.error).toBe(`headless bundle not found at ${missing}`)
    expect(await fs.readdir(workDir)).toEqual([])
  }, RENDER_TIMEOUT_MS)
})
