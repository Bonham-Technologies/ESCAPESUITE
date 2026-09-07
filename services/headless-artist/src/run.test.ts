import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderInChromium } from './renderDriver'
import { runJob } from './run'
import type { JobSpec, RenderMeta } from './types'

vi.mock('./renderDriver')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SERVICE_ROOT = path.resolve(HERE, '..')
const MANIFEST = path.join(SERVICE_ROOT, 'test/fixtures/manifest/manifest.json')
const VEDITOR = path.join(SERVICE_ROOT, 'test/fixtures/project.veditor')

const VERSIONS = { engineVersion: 'engine-1.2.3', kitVersion: 'kit-4.5.6' }

const META: RenderMeta = {
  format: 'mp4',
  byteLength: 5,
  durationSec: 1,
  width: 64,
  height: 48,
  gpu: false,
}

const tempDirs: string[] = []
let logLines: string[]

beforeEach(() => {
  logLines = []
  vi.mocked(renderInChromium).mockReset()
})

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) await fs.rm(dir, { recursive: true, force: true })
  }
})

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'headless-artist-run-test-'))
  tempDirs.push(dir)
  return dir
}

const log = (line: string) => {
  logLines.push(line)
}

function makeSpec(overrides: Partial<JobSpec> = {}): JobSpec {
  return {
    jobId: 'job-1',
    input: { manifest: { path: MANIFEST } },
    options: { format: 'mp4', quality: 'high' },
    output: { sink: 'volume', config: { dir: '/nowhere' } },
    ...overrides,
  }
}

/** Stands in for a real render: writes plausible bytes where the driver would have. */
function mockRenderWriting(bytes: string, meta: RenderMeta = META): void {
  vi.mocked(renderInChromium).mockImplementation(async (_bundle, _job, _options, outputPath) => {
    await fs.writeFile(outputPath, bytes)
    return { outputPath, meta, chromiumVersion: '999.0.0' }
  })
}

describe('runJob', () => {
  it('renders, manifests and delivers the output through the sink', async () => {
    const workDir = await makeTempDir()
    const outDir = await makeTempDir()
    mockRenderWriting('hello')

    const outcome = await runJob(
      makeSpec({ output: { sink: 'volume', config: { dir: outDir } } }),
      { bundlePath: '/bundle/headless.html', workDir, versions: VERSIONS, log },
    )

    expect(outcome.ok).toBe(true)
    expect(outcome.jobId).toBe('job-1')
    expect(outcome.error).toBeUndefined()
    expect(outcome.meta).toEqual(META)
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0)
    expect(outcome.outputLocation).toBe(path.join(outDir, 'job-1.mp4'))
    expect(outcome.manifestLocation).toBe(path.join(outDir, 'job-1.manifest.json'))

    expect(await fs.readFile(path.join(outDir, 'job-1.mp4'), 'utf8')).toBe('hello')
    const manifest = JSON.parse(await fs.readFile(path.join(outDir, 'job-1.manifest.json'), 'utf8'))
    expect(manifest.jobId).toBe('job-1')
    expect(manifest.byteLength).toBe(5)
    // sha256 of "hello"
    expect(manifest.sha256).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    expect(manifest.chromiumVersion).toBe('999.0.0')
    expect(manifest.engineVersion).toBe('engine-1.2.3')
    expect(manifest.kitVersion).toBe('kit-4.5.6')
  })

  it('renders into <workDir>/<jobId>/render.<ext> and passes the driver its launch options', async () => {
    const workDir = await makeTempDir()
    const outDir = await makeTempDir()
    mockRenderWriting('hello')

    await runJob(makeSpec({ output: { sink: 'volume', config: { dir: outDir } } }), {
      bundlePath: '/bundle/headless.html',
      workDir,
      gpu: true,
      chromiumPath: '/usr/bin/chromium',
      noSandbox: true,
      timeoutMs: 1234,
      versions: VERSIONS,
      log,
    })

    const call = vi.mocked(renderInChromium).mock.calls[0]
    expect(call[0]).toBe('/bundle/headless.html')
    expect(call[2]).toEqual({ format: 'mp4', quality: 'high' })
    expect(call[3]).toBe(path.join(workDir, 'job-1', 'render.mp4'))
    expect(call[4]).toMatchObject({
      gpu: true,
      chromiumPath: '/usr/bin/chromium',
      noSandbox: true,
      timeoutMs: 1234,
      log,
    })
  })

  it('names the render after the requested format', async () => {
    const workDir = await makeTempDir()
    const outDir = await makeTempDir()
    mockRenderWriting('hello', { ...META, format: 'webm' })

    await runJob(
      makeSpec({
        options: { format: 'webm', quality: 'high' },
        output: { sink: 'volume', config: { dir: outDir } },
      }),
      { bundlePath: '/bundle/headless.html', workDir, versions: VERSIONS, log },
    )

    expect(vi.mocked(renderInChromium).mock.calls[0][3]).toBe(
      path.join(workDir, 'job-1', 'render.webm'),
    )
  })

  it('returns ok:false without launching Chromium when the input file is missing', async () => {
    const workDir = await makeTempDir()

    const outcome = await runJob(
      makeSpec({ input: { manifest: { path: path.join(workDir, 'nope.json') } } }),
      { bundlePath: '/bundle/headless.html', workDir, versions: VERSIONS, log },
    )

    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('could not be read')
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0)
    expect(vi.mocked(renderInChromium)).not.toHaveBeenCalled()
    expect(await fs.readdir(workDir)).toEqual([])
  })

  it('returns ok:false when the driver rejects', async () => {
    const workDir = await makeTempDir()
    const outDir = await makeTempDir()
    vi.mocked(renderInChromium).mockRejectedValue(new Error('render timed out after 1 ms'))

    const outcome = await runJob(
      makeSpec({ output: { sink: 'volume', config: { dir: outDir } } }),
      { bundlePath: '/bundle/headless.html', workDir, versions: VERSIONS, log },
    )

    expect(outcome).toMatchObject({ jobId: 'job-1', ok: false, error: 'render timed out after 1 ms' })
    expect(outcome.outputLocation).toBeUndefined()
    expect(await fs.readdir(workDir)).toEqual([])
  })

  it('returns ok:false when the sink config is invalid', async () => {
    const workDir = await makeTempDir()
    mockRenderWriting('hello')

    const outcome = await runJob(makeSpec({ output: { sink: 'volume', config: {} } }), {
      bundlePath: '/bundle/headless.html',
      workDir,
      versions: VERSIONS,
      log,
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.error).toBe('volume sink requires config.dir (string)')
    expect(await fs.readdir(workDir)).toEqual([])
  })

  it('returns ok:false when the sink kind is unknown', async () => {
    const workDir = await makeTempDir()
    mockRenderWriting('hello')

    const outcome = await runJob(
      makeSpec({
        output: { sink: 'nope' as JobSpec['output']['sink'], config: {} },
      }),
      { bundlePath: '/bundle/headless.html', workDir, versions: VERSIONS, log },
    )

    expect(outcome.ok).toBe(false)
    expect(outcome.error).toBe('Unknown output sink: nope')
  })

  it('returns ok:false when delivery fails', async () => {
    const workDir = await makeTempDir()
    const outDir = await makeTempDir()
    // A file where the sink wants its directory: mkdir fails, so delivery does.
    const blocked = path.join(outDir, 'blocked')
    await fs.writeFile(blocked, 'not a directory')
    mockRenderWriting('hello')

    const outcome = await runJob(
      makeSpec({ output: { sink: 'volume', config: { dir: blocked } } }),
      { bundlePath: '/bundle/headless.html', workDir, versions: VERSIONS, log },
    )

    expect(outcome.ok).toBe(false)
    expect(outcome.error).toBeTruthy()
    expect(await fs.readdir(workDir)).toEqual([])
  })

  it('logs the failure to the log sink and never throws', async () => {
    const workDir = await makeTempDir()
    vi.mocked(renderInChromium).mockRejectedValue(new Error('boom'))

    await expect(
      runJob(makeSpec({ output: { sink: 'volume', config: { dir: workDir } } }), {
        bundlePath: '/bundle/headless.html',
        workDir,
        versions: VERSIONS,
        log,
      }),
    ).resolves.toMatchObject({ ok: false })

    expect(logLines).toContain('error: boom')
  })

  it('removes the loader temp files and the job work dir after a bundle job', async () => {
    const workDir = await makeTempDir()
    const outDir = await makeTempDir()
    mockRenderWriting('hello')

    const outcome = await runJob(
      makeSpec({
        input: { bundle: { path: VEDITOR } },
        output: { sink: 'volume', config: { dir: outDir } },
      }),
      { bundlePath: '/bundle/headless.html', workDir, versions: VERSIONS, log },
    )

    expect(outcome.ok).toBe(true)
    // Both the loader's mkdtemp dir and <workDir>/<jobId> lived here.
    expect(await fs.readdir(workDir)).toEqual([])
  })

  it('cleans up after a bundle job that fails mid-render', async () => {
    const workDir = await makeTempDir()
    vi.mocked(renderInChromium).mockRejectedValue(new Error('Chromium page crashed'))

    const outcome = await runJob(
      makeSpec({
        input: { bundle: { path: VEDITOR } },
        output: { sink: 'volume', config: { dir: workDir } },
      }),
      { bundlePath: '/bundle/headless.html', workDir, versions: VERSIONS, log },
    )

    expect(outcome.error).toBe('Chromium page crashed')
    expect(await fs.readdir(workDir)).toEqual([])
  })

  it('defaults the work dir to the system temp dir', async () => {
    const outDir = await makeTempDir()
    // A unique id, so this never renders into — or cleans up — a path another run may share.
    const jobId = `headless-artist-run-default-${process.pid}-${Date.now()}`
    mockRenderWriting('hello')

    const outcome = await runJob(
      makeSpec({ jobId, output: { sink: 'volume', config: { dir: outDir } } }),
      { bundlePath: '/bundle/headless.html', versions: VERSIONS, log },
    )

    expect(outcome.ok).toBe(true)
    expect(vi.mocked(renderInChromium).mock.calls[0][3]).toBe(
      path.join(os.tmpdir(), jobId, 'render.mp4'),
    )
    await expect(fs.access(path.join(os.tmpdir(), jobId))).rejects.toThrow()
  })

  it('refuses a jobId that would put the work dir outside the work root', async () => {
    const workDir = await makeTempDir()
    const sibling = path.join(workDir, 'keep-me')
    await fs.mkdir(sibling)
    mockRenderWriting('hello')

    for (const jobId of ['.', '..']) {
      const outcome = await runJob(makeSpec({ jobId }), {
        bundlePath: '/bundle/headless.html',
        workDir,
        versions: VERSIONS,
        log,
      })

      expect(outcome.ok).toBe(false)
      expect(outcome.error).toBe(`jobId "${jobId}" does not name a directory inside the work dir`)
    }

    // Neither the work dir nor its parent was touched.
    expect(vi.mocked(renderInChromium)).not.toHaveBeenCalled()
    expect(await fs.readdir(workDir)).toEqual(['keep-me'])
    await expect(fs.access(workDir)).resolves.toBeUndefined()
  })

  it('leaves a pre-existing job directory alone when the run fails before it creates one', async () => {
    const workDir = await makeTempDir()
    const jobDir = path.join(workDir, 'job-1')
    await fs.mkdir(jobDir)
    await fs.writeFile(path.join(jobDir, 'not-ours.txt'), 'precious')

    const outcome = await runJob(
      makeSpec({ input: { manifest: { path: path.join(workDir, 'nope.json') } } }),
      { bundlePath: '/bundle/headless.html', workDir, versions: VERSIONS, log },
    )

    expect(outcome.ok).toBe(false)
    expect(await fs.readFile(path.join(jobDir, 'not-ours.txt'), 'utf8')).toBe('precious')
  })
})
