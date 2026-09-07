import { execFile, execSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RenderOutcome } from './types'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SERVICE_ROOT = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(SERVICE_ROOT, '../..')
const BUNDLE = path.join(REPO_ROOT, 'apps/artist/dist-headless/headless.html')
const MANIFEST = path.join(SERVICE_ROOT, 'test/fixtures/manifest/manifest.json')
const CLI = path.join(SERVICE_ROOT, 'dist/cli.js')

/** Long enough for a Chromium launch plus a real (tiny) encode on a cold machine. */
const RENDER_TIMEOUT_MS = 180_000

/** Building the headless bundle and the CLI from cold is the slow part of this suite. */
const BUILD_TIMEOUT_MS = 300_000

interface CliResult {
  code: number
  stdout: string
  stderr: string
}

let tmpRoot: string

beforeAll(async () => {
  // The kit assembler itself, so these tests exercise the artifact customers actually get:
  // it builds the headless bundle, bundles the CLI, and writes dist/kit.json.
  execSync('pnpm --filter=@escapesuite/headless-artist run build', { cwd: REPO_ROOT, stdio: 'inherit' })
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'headless-artist-cli-test-'))
}, BUILD_TIMEOUT_MS)

afterAll(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
})

function runCli(
  args: string[],
  opts: { env?: Record<string, string>; stdin?: string } = {},
): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [CLI, ...args],
      {
        cwd: SERVICE_ROOT,
        env: { ...process.env, HEADLESS_BUNDLE_PATH: BUNDLE, ...opts.env },
        maxBuffer: 32 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
        resolve({ code, stdout, stderr })
      },
    )
    child.stdin?.end(opts.stdin ?? '')
  })
}

/** Asserts the one-JSON-line stdout contract and hands back the parsed outcome. */
function parseOutcome(stdout: string): RenderOutcome {
  const lines = stdout.split('\n').filter((line) => line.length > 0)
  expect(lines).toHaveLength(1)
  return JSON.parse(lines[0])
}

interface JobFiles {
  jobFile: string
  json: string
  outDir: string
  workDir: string
}

let caseCounter = 0

async function makeJob(
  jobId: string,
  overrides: { manifestPath?: string; format?: string } = {},
): Promise<JobFiles> {
  const caseDir = path.join(tmpRoot, `case-${caseCounter++}`)
  const outDir = path.join(caseDir, 'out')
  const workDir = path.join(caseDir, 'work')
  await fs.mkdir(workDir, { recursive: true })

  const json = JSON.stringify({
    jobId,
    input: { manifest: { path: overrides.manifestPath ?? MANIFEST } },
    options: { format: overrides.format ?? 'mp4', quality: 'medium' },
    output: { sink: 'volume', config: { dir: outDir } },
  })

  const jobFile = path.join(caseDir, 'job.json')
  await fs.writeFile(jobFile, json)
  return { jobFile, json, outDir, workDir }
}

describe('headless-artist CLI', () => {
  it('renders a job and prints one JSON outcome line to stdout', async () => {
    const job = await makeJob('cli-ok')

    const result = await runCli(['render', '--job', job.jobFile], {
      env: { HEADLESS_WORK_DIR: job.workDir },
    })

    expect(result.code).toBe(0)
    const outcome = parseOutcome(result.stdout)
    expect(outcome.ok).toBe(true)
    expect(outcome.jobId).toBe('cli-ok')
    expect(outcome.meta?.format).toBe('mp4')
    expect(outcome.outputLocation).toBe(path.join(job.outDir, 'cli-ok.mp4'))
    expect(outcome.manifestLocation).toBe(path.join(job.outDir, 'cli-ok.manifest.json'))

    const stat = await fs.stat(path.join(job.outDir, 'cli-ok.mp4'))
    expect(stat.size).toBeGreaterThan(0)
    const manifest = JSON.parse(await fs.readFile(path.join(job.outDir, 'cli-ok.manifest.json'), 'utf8'))
    expect(manifest.sha256).toMatch(/^[0-9a-f]{64}$/)

    // Progress and launch diagnostics belong on stderr, never on stdout.
    expect(result.stderr).toMatch(/\[headless\] progress \d+%/)
    // Nothing is left behind in the work dir.
    expect(await fs.readdir(job.workDir)).toEqual([])
  }, RENDER_TIMEOUT_MS)

  it('reads the job spec from stdin when given "-"', async () => {
    const job = await makeJob('cli-stdin')

    const result = await runCli(['render', '-'], {
      env: { HEADLESS_WORK_DIR: job.workDir },
      stdin: job.json,
    })

    expect(result.code).toBe(0)
    expect(parseOutcome(result.stdout).ok).toBe(true)
    await expect(fs.stat(path.join(job.outDir, 'cli-stdin.mp4'))).resolves.toBeTruthy()
  }, RENDER_TIMEOUT_MS)

  it('emits JSON log lines on stderr when HEADLESS_LOG=json', async () => {
    const job = await makeJob('cli-jsonlog')

    const result = await runCli(['render', `--job=${job.jobFile}`], {
      env: { HEADLESS_WORK_DIR: job.workDir, HEADLESS_LOG: 'json' },
    })

    expect(result.code).toBe(0)
    const logLines = result.stderr.split('\n').filter((line) => line.startsWith('{'))
    expect(logLines.length).toBeGreaterThan(0)
    expect(JSON.parse(logLines[0])).toMatchObject({ level: 'info' })
  }, RENDER_TIMEOUT_MS)

  it('exits 1 with an ok:false outcome when the job cannot be rendered', async () => {
    const job = await makeJob('cli-missing-input', {
      manifestPath: path.join(tmpRoot, 'no-such-manifest.json'),
    })

    const result = await runCli(['render', job.jobFile], {
      env: { HEADLESS_WORK_DIR: job.workDir },
    })

    expect(result.code).toBe(1)
    const outcome = parseOutcome(result.stdout)
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('could not be read')
    expect(result.stderr).toContain('could not be read')
  }, RENDER_TIMEOUT_MS)

  it('exits 2 with empty stdout when render is given no job', async () => {
    const result = await runCli(['render'])

    expect(result.code).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Usage')
  })

  it('exits 2 with empty stdout for an invalid job spec', async () => {
    const job = await makeJob('cli-bad-format', { format: 'avi' })

    const result = await runCli(['render', '--job', job.jobFile])

    expect(result.code).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('options.format')
  })

  it('exits 2 with empty stdout for an unreadable job spec', async () => {
    const result = await runCli(['render', '--job', path.join(tmpRoot, 'nope.json')])

    expect(result.code).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('could not be read')
  })

  it('exits 2 for an unknown command', async () => {
    const result = await runCli(['frobnicate'])

    expect(result.code).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('frobnicate')
  })

  it('exits 2 when HEADLESS_TIMEOUT_MS is not a positive integer', async () => {
    const job = await makeJob('cli-bad-timeout')

    const result = await runCli(['render', '--job', job.jobFile], {
      env: { HEADLESS_TIMEOUT_MS: 'soon' },
    })

    expect(result.code).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('HEADLESS_TIMEOUT_MS')
  })

  it('prints the kit versions for --version', async () => {
    const result = await runCli(['--version'])

    expect(result.code).toBe(0)
    const kit = JSON.parse(result.stdout)
    expect(typeof kit.kitVersion).toBe('string')
    // Everything the assembler stamps in, so a kit can always be traced back to its build.
    expect(typeof kit.engineVersion).toBe('string')
    expect(typeof kit.playwrightVersion).toBe('string')
    expect(typeof kit.commit).toBe('string')
    expect(typeof kit.builtAt).toBe('string')
    expect(kit.kitVersion).not.toBe('unknown')
  })

  it('still runs when invoked through a symlink, as the bin entry is', async () => {
    // node_modules/.bin/headless-artist is a symlink; argv[1] is then the link path while
    // import.meta.url is the real one, which a lexical comparison would miss entirely.
    const linkDir = path.join(tmpRoot, 'bin')
    await fs.mkdir(linkDir, { recursive: true })
    const link = path.join(linkDir, 'headless-artist')
    await fs.symlink(CLI, link)

    const result = await new Promise<CliResult>((resolve) => {
      const child = execFile(
        process.execPath,
        [link, '--version'],
        { cwd: SERVICE_ROOT, env: { ...process.env } },
        (error, stdout, stderr) => {
          resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr })
        },
      )
      child.stdin?.end('')
    })

    expect(result.code).toBe(0)
    expect(typeof JSON.parse(result.stdout).kitVersion).toBe('string')
  })
})
