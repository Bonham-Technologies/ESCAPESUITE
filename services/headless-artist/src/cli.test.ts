import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { isDirectRun, main } from './cli'
import { runJob } from './run'
import { startServer } from './serve'
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
// Ditto sockets: serve.test.ts drives the real server; here only the wiring is under test.
vi.mock('./serve')

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
let closeSpy: Mock<() => Promise<void>>

beforeEach(() => {
  stderr = []
  stdout = []
  closeSpy = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
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
  vi.mocked(startServer).mockReset()
  vi.mocked(startServer).mockImplementation(async ({ port }) => {
    // main() blocks until a signal arrives; fire one as soon as it is listening. A timer,
    // not a microtask, so the signal handlers are registered by the time it lands.
    setTimeout(() => process.emit('SIGINT', 'SIGINT'), 0)
    return { port: port === 0 ? 45678 : port, close: closeSpy }
  })
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

describe('the text logger', () => {
  /** A key carrying a newline, an ANSI escape and a NUL — the three shapes of log forgery. */
  const NASTY_KEY = 'ev\nil\u001b[31m\u0000'

  it('strips control characters, so a job spec cannot forge a log line or paint the terminal', async () => {
    const jobFile = await writeJobSpec(validSpec({ [NASTY_KEY]: 1 }))

    expect(await main(['render', '--job', jobFile], {})).toBe(0)

    const line = stderr.find((written) => written.includes('unknown field'))
    expect(line).toBe('warning: unknown field "ev il [31m "\n')
  })

  it('leaves the json logger alone — JSON.stringify already escapes them', async () => {
    const jobFile = await writeJobSpec(validSpec({ [NASTY_KEY]: 1 }))

    expect(await main(['render', '--job', jobFile], { HEADLESS_LOG: 'json' })).toBe(0)

    const written = stderr.find((entry) => entry.includes('unknown field')) as string
    // One line out, whatever the field contained; the control characters survive, escaped.
    expect(written.split('\n').filter(Boolean)).toHaveLength(1)
    expect((JSON.parse(written) as { msg: string }).msg).toBe(`warning: unknown field "${NASTY_KEY}"`)
  })
})

describe('serve', () => {
  const serveOptions = () => vi.mocked(startServer).mock.calls[0][0]

  it('binds loopback on 8787 with concurrency 1 by default', async () => {
    expect(await main(['serve'], {})).toBe(0)

    expect(startServer).toHaveBeenCalledTimes(1)
    expect(serveOptions()).toMatchObject({
      port: 8787,
      host: '127.0.0.1',
      concurrency: 1,
      maxQueue: 64,
      // The command sink runs arbitrary programs, so serve leaves it off unless asked.
      allowedSinks: ['volume', 'webhook', 's3'],
    })
    // stdout stays clean even for the long-running command.
    expect(stdout).toEqual([])
    expect(stderrText()).toContain('listening on http://127.0.0.1:8787 (concurrency 1)')
  })

  it('reads port, host and concurrency from the environment', async () => {
    expect(
      await main(['serve'], {
        HEADLESS_PORT: '9000',
        HEADLESS_HOST: '0.0.0.0',
        HEADLESS_CONCURRENCY: '4',
      }),
    ).toBe(0)

    expect(serveOptions()).toMatchObject({ port: 9000, host: '0.0.0.0', concurrency: 4 })
    expect(stderrText()).toContain('listening on http://0.0.0.0:9000 (concurrency 4)')
  })

  it('reads the queue bound from the environment and lets --max-queue win', async () => {
    expect(await main(['serve'], { HEADLESS_MAX_QUEUE: '32' })).toBe(0)
    expect(serveOptions()).toMatchObject({ maxQueue: 32 })

    vi.mocked(startServer).mockClear()
    expect(await main(['serve', '--max-queue', '8'], { HEADLESS_MAX_QUEUE: '32' })).toBe(0)
    expect(serveOptions()).toMatchObject({ maxQueue: 8 })
  })

  it('exits 2 for a non-positive --max-queue', async () => {
    expect(await main(['serve', '--max-queue', '0'], {})).toBe(2)
    expect(stderrText()).toContain('--max-queue must be a positive integer')
    expect(startServer).not.toHaveBeenCalled()
  })

  it('exits 2 for a bad HEADLESS_MAX_QUEUE', async () => {
    expect(await main(['serve'], { HEADLESS_MAX_QUEUE: 'lots' })).toBe(2)
    expect(stderrText()).toContain('HEADLESS_MAX_QUEUE must be a positive integer')
  })

  it('lets flags win over the environment', async () => {
    expect(
      await main(['serve', '--port', '1234', '--host', '::1'], {
        HEADLESS_PORT: '9000',
        HEADLESS_HOST: '0.0.0.0',
      }),
    ).toBe(0)

    expect(serveOptions()).toMatchObject({ port: 1234, host: '::1' })
  })

  it('accepts --port=N form', async () => {
    expect(await main(['serve', '--port=1234'], {})).toBe(0)
    expect(serveOptions()).toMatchObject({ port: 1234 })
  })

  it('reports the port the OS chose for --port 0', async () => {
    expect(await main(['serve', '--port', '0'], {})).toBe(0)

    expect(serveOptions()).toMatchObject({ port: 0 })
    expect(stderrText()).toContain('listening on http://127.0.0.1:45678')
  })

  it('leaves signal handling to Playwright for a one-shot render', async () => {
    const jobFile = await writeJobSpec(validSpec())

    expect(await main(['render', '--job', jobFile], {})).toBe(0)

    expect(vi.mocked(runJob).mock.calls[0][1].handleSignals).toBeUndefined()
  })

  it('reads the sink allow-list from the environment', async () => {
    expect(await main(['serve'], { HEADLESS_SINKS: 'volume,command' })).toBe(0)
    expect(serveOptions()).toMatchObject({ allowedSinks: ['volume', 'command'] })
  })

  it('lets --sinks win over HEADLESS_SINKS', async () => {
    expect(await main(['serve', '--sinks', 'volume'], { HEADLESS_SINKS: 'volume,command' })).toBe(0)
    expect(serveOptions()).toMatchObject({ allowedSinks: ['volume'] })
  })

  it('accepts --sinks=N form and trims the names', async () => {
    expect(await main(['serve', '--sinks=volume, s3'], {})).toBe(0)
    expect(serveOptions()).toMatchObject({ allowedSinks: ['volume', 's3'] })
  })

  it('exits 2 for a sink name that does not exist', async () => {
    expect(await main(['serve', '--sinks', 'volume,ftp'], {})).toBe(2)
    expect(stderrText()).toContain('--sinks must be a comma-separated subset of')
    expect(stderrText()).toContain('"ftp"')
    expect(startServer).not.toHaveBeenCalled()
  })

  it('exits 2 for a bad HEADLESS_SINKS', async () => {
    expect(await main(['serve'], { HEADLESS_SINKS: 'volume,,s3' })).toBe(2)
    expect(stderrText()).toContain('HEADLESS_SINKS must be a comma-separated subset of')
    expect(startServer).not.toHaveBeenCalled()
  })

  it('passes the run deps through, same as render', async () => {
    expect(await main(['serve'], { HEADLESS_BUNDLE_PATH: '/opt/headless.html', HEADLESS_NO_SANDBOX: 'true' })).toBe(0)

    expect(serveOptions().deps).toMatchObject({ bundlePath: '/opt/headless.html', noSandbox: true })
  })

  it('closes the server on SIGINT before returning', async () => {
    expect(await main(['serve'], {})).toBe(0)
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('closes the server on SIGTERM too', async () => {
    vi.mocked(startServer).mockImplementation(async ({ port }) => {
      setTimeout(() => process.emit('SIGTERM', 'SIGTERM'), 0)
      return { port, close: closeSpy }
    })

    expect(await main(['serve'], {})).toBe(0)
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('closes the server on SIGHUP too — a closed terminal is not a reason to drop a render', async () => {
    vi.mocked(startServer).mockImplementation(async ({ port }) => {
      setTimeout(() => process.emit('SIGHUP', 'SIGHUP'), 0)
      return { port, close: closeSpy }
    })

    expect(await main(['serve'], {})).toBe(0)
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('exits 1 when the drain itself fails', async () => {
    closeSpy.mockRejectedValue(new Error('socket stuck'))

    expect(await main(['serve'], {})).toBe(1)

    expect(stdout).toEqual([])
    expect(stderrText()).toContain('error: shutdown failed: socket stuck')
  })

  it('force-quits with 130 when a second signal arrives during the drain', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    let releaseClose: () => void = () => {}
    closeSpy.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseClose = resolve
        }),
    )
    vi.mocked(startServer).mockImplementation(async ({ port }) => {
      setTimeout(() => {
        process.emit('SIGINT', 'SIGINT')
        // Still draining: an operator who signals again means "stop waiting".
        process.emit('SIGINT', 'SIGINT')
        releaseClose()
      }, 0)
      return { port, close: closeSpy }
    })

    expect(await main(['serve'], {})).toBe(0)

    expect(exit).toHaveBeenCalledWith(130)
    // The drain was started exactly once; the second signal did not restart it.
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('leaves no signal listeners behind once it has stopped', async () => {
    const count = (): number =>
      process.listenerCount('SIGINT') + process.listenerCount('SIGTERM') + process.listenerCount('SIGHUP')
    const before = count()

    expect(await main(['serve'], {})).toBe(0)

    expect(count()).toBe(before)
  })

  it('exits 1 when the port cannot be bound — not 2, which means "your arguments are wrong"', async () => {
    vi.mocked(startServer).mockRejectedValue(
      Object.assign(new Error('listen EADDRINUSE: address already in use 127.0.0.1:8787'), {
        code: 'EADDRINUSE',
      }),
    )

    expect(await main(['serve'], {})).toBe(1)

    expect(stdout).toEqual([])
    expect(stderrText()).toContain('error: cannot listen on 127.0.0.1:8787: listen EADDRINUSE')
    // Not a usage problem, so no usage dump.
    expect(stderrText()).not.toContain('Usage: headless-artist render')
  })

  it('exits 1 when the port is privileged', async () => {
    vi.mocked(startServer).mockRejectedValue(new Error('listen EACCES: permission denied 0.0.0.0:80'))

    expect(await main(['serve', '--port', '80', '--host', '0.0.0.0'], {})).toBe(1)
    expect(stderrText()).toContain('error: cannot listen on 0.0.0.0:80: listen EACCES')
  })

  it('exits 2 for a non-numeric port', async () => {
    expect(await main(['serve', '--port', 'http'], {})).toBe(2)
    expect(stderrText()).toContain('--port must be an integer between 0 and 65535')
    expect(startServer).not.toHaveBeenCalled()
  })

  it('exits 2 for a port outside the valid range', async () => {
    expect(await main(['serve', '--port', '70000'], {})).toBe(2)
    expect(startServer).not.toHaveBeenCalled()
  })

  it('exits 2 for a bad HEADLESS_PORT', async () => {
    expect(await main(['serve'], { HEADLESS_PORT: 'nope' })).toBe(2)
    expect(stderrText()).toContain('HEADLESS_PORT must be an integer between 0 and 65535')
  })

  it('exits 2 for a non-positive HEADLESS_CONCURRENCY', async () => {
    expect(await main(['serve'], { HEADLESS_CONCURRENCY: '0' })).toBe(2)
    expect(stderrText()).toContain('HEADLESS_CONCURRENCY must be a positive integer')
    expect(startServer).not.toHaveBeenCalled()
  })

  it('exits 2 for an empty --host', async () => {
    expect(await main(['serve', '--host', ''], {})).toBe(2)
    expect(stderrText()).toContain('--host needs a value')
  })

  it('exits 2 for an unknown option', async () => {
    expect(await main(['serve', '--workers', '4'], {})).toBe(2)
    expect(stderrText()).toContain('unknown option "--workers"')
  })

  it('exits 2 for a bare argument', async () => {
    expect(await main(['serve', 'job.json'], {})).toBe(2)
    expect(stderrText()).toContain('unexpected extra argument "job.json"')
  })

  it('exits 2 when --port is given twice', async () => {
    expect(await main(['serve', '--port', '1', '--port', '2'], {})).toBe(2)
    expect(stderrText()).toContain('--port was given more than once')
  })

  it('prints usage and exits 0 for "serve --help"', async () => {
    expect(await main(['serve', '--help'], {})).toBe(0)
    expect(stdout).toEqual([])
    expect(stderrText()).toContain('headless-artist serve')
    expect(startServer).not.toHaveBeenCalled()
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
