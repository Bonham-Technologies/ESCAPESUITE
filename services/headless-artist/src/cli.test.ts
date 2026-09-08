import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isDirectRun, main } from './cli'
import { runJob } from './run'
import type { RenderOutcome } from './types'

/** Flipped by the one test that needs `realpathSync` to fail; false everywhere else. */
const fsState = vi.hoisted(() => ({ realpathFails: false }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    default: actual,
    realpathSync: (target: string) => {
      if (fsState.realpathFails) throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      return actual.realpathSync(target)
    },
  }
})

// Chromium is out of scope here: these tests are about argv, stderr and exit codes.
vi.mock('./run')

const MODULE_PATH = fileURLToPath(new URL('./cli.ts', import.meta.url))

const OUTCOME: RenderOutcome = {
  ok: true,
  jobId: 'job-1',
  outputLocation: '/tmp/out/job-1.mp4',
  durationMs: 12,
}

const tempDirs: string[] = []
let stderr: string[]
let stdout: string[]

beforeEach(() => {
  stderr = []
  stdout = []
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk))
    return true
  })
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk))
    return true
  })
  vi.mocked(runJob).mockReset()
  vi.mocked(runJob).mockResolvedValue(OUTCOME)
})

afterEach(async () => {
  vi.restoreAllMocks()
  fsState.realpathFails = false
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) await fs.rm(dir, { recursive: true, force: true })
  }
})

async function writeJobSpec(spec: Record<string, unknown>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'headless-artist-cli-unit-'))
  tempDirs.push(dir)
  const jobFile = path.join(dir, 'job.json')
  await fs.writeFile(jobFile, JSON.stringify(spec))
  return jobFile
}

function validSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jobId: 'job-1',
    input: { manifest: { path: '/tmp/manifest.json' } },
    options: { format: 'mp4' },
    output: { sink: 'volume', config: { dir: '/tmp/out' } },
    ...overrides,
  }
}

const stderrText = (): string => stderr.join('')

describe('render argument parsing', () => {
  it('rejects a flag where --job expects a path, rather than swallowing it', async () => {
    expect(await main(['render', '--job', '--verbose'], {})).toBe(2)
    expect(stdout).toEqual([])
    expect(stderrText()).toContain('--job needs a file path')
    expect(stderrText()).toContain('--verbose')
  })

  it('still accepts "-", the one dash-leading value that is a source and not a flag', async () => {
    const original = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
    try {
      // Reaching the stdin check at all proves "-" was taken as the --job value.
      expect(await main(['render', '--job', '-'], {})).toBe(2)
      expect(stderrText()).toContain('no job spec on stdin')
    } finally {
      if (original) Object.defineProperty(process.stdin, 'isTTY', original)
      else delete (process.stdin as unknown as Record<string, unknown>).isTTY
    }
  })

  it('rejects a second bare path instead of silently using the last one', async () => {
    expect(await main(['render', 'first.json', 'second.json'], {})).toBe(2)
    expect(stderrText()).toContain('unexpected extra argument "second.json"')
    expect(runJob).not.toHaveBeenCalled()
  })

  it('rejects a bare path after --job', async () => {
    expect(await main(['render', '--job', 'first.json', 'second.json'], {})).toBe(2)
    expect(stderrText()).toContain('unexpected extra argument "second.json"')
  })

  it('rejects --job given twice', async () => {
    expect(await main(['render', '--job', 'a.json', '--job', 'b.json'], {})).toBe(2)
    expect(stderrText()).toContain('--job was given more than once')
  })

  it('prints usage and exits 0 for "render --help"', async () => {
    expect(await main(['render', '--help'], {})).toBe(0)
    // Usage is a diagnostic; stdout carries the outcome line and nothing else, ever.
    expect(stdout).toEqual([])
    expect(stderrText()).toContain('Usage: headless-artist render')
    expect(runJob).not.toHaveBeenCalled()
  })

  it('prints usage and exits 0 for "render -h"', async () => {
    expect(await main(['render', '-h'], {})).toBe(0)
    expect(stderrText()).toContain('Usage: headless-artist render')
  })

  it('exits 2 for "render -" on an interactive terminal, instead of waiting on stdin forever', async () => {
    const original = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
    try {
      expect(await main(['render', '-'], {})).toBe(2)
      expect(stderrText()).toContain('no job spec on stdin (pass a file path or pipe JSON)')
    } finally {
      if (original) Object.defineProperty(process.stdin, 'isTTY', original)
      else delete (process.stdin as unknown as Record<string, unknown>).isTTY
    }
  })
})

describe('unknown job-spec fields', () => {
  it('warns on stderr for an unknown top-level key and an unknown options key, then still runs', async () => {
    const jobFile = await writeJobSpec(
      validSpec({ qualitiy: 'high', options: { format: 'mp4', resoluton: '720p' } }),
    )

    expect(await main(['render', '--job', jobFile], {})).toBe(0)

    expect(stderrText()).toContain('warning: unknown field "qualitiy"')
    expect(stderrText()).toContain('warning: unknown field "options.resoluton"')
    expect(runJob).toHaveBeenCalledTimes(1)
    expect(stdout).toEqual([JSON.stringify(OUTCOME) + '\n'])
  })

  it('says nothing for a spec that uses only known fields', async () => {
    const jobFile = await writeJobSpec(validSpec())

    expect(await main(['render', '--job', jobFile], {})).toBe(0)
    expect(stderrText()).not.toContain('warning:')
  })

  it('routes the warning through the json logger when HEADLESS_LOG=json', async () => {
    const jobFile = await writeJobSpec(validSpec({ extra: 1 }))

    expect(await main(['render', '--job', jobFile], { HEADLESS_LOG: 'json' })).toBe(0)

    const entry = JSON.parse(stderr.map((line) => line.trim()).find((line) => line.includes('unknown field')) as string)
    expect(entry).toMatchObject({ level: 'info', msg: 'warning: unknown field "extra"' })
  })
})

describe('isDirectRun', () => {
  it('recognises the module path itself', () => {
    expect(isDirectRun(MODULE_PATH)).toBe(true)
  })

  it('rejects another file in the same directory', () => {
    expect(isDirectRun(path.join(path.dirname(MODULE_PATH), 'run.ts'))).toBe(false)
  })

  it('returns false when node was given no entry file', () => {
    expect(isDirectRun(undefined)).toBe(false)
  })

  it('falls back to a lexical compare when realpathSync throws', () => {
    // An unreadable parent directory (or a container mount that refuses realpath) must not
    // silently turn the CLI into a no-op that exits 0 having rendered nothing.
    fsState.realpathFails = true
    expect(isDirectRun(MODULE_PATH)).toBe(true)
    expect(isDirectRun(path.join(path.dirname(MODULE_PATH), 'run.ts'))).toBe(false)
  })
})
