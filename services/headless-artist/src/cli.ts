#!/usr/bin/env node
import { promises as fs, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseJobSpec } from './jobSpec'
import { runJob } from './run'
import type { RunJobDeps } from './run'

const EXIT_OK = 0
const EXIT_JOB_FAILED = 1
const EXIT_USAGE = 2

/** Prefix `runJob` uses for the one line it logs on failure; lifts it to level "error" in JSON mode. */
const ERROR_PREFIX = 'error: '

/** The kit ships `headless.html` and `kit.json` next to the built CLI. */
const HERE = path.dirname(fileURLToPath(import.meta.url))

const USAGE = `Usage: headless-artist render --job <file>   render one job spec
       headless-artist render -               read the job spec from stdin
       headless-artist --version              print the kit versions

Prints one JSON RenderOutcome line to stdout; all logs go to stderr.
Exit codes: 0 rendered, 1 job failed, 2 usage or job-spec error.

Environment:
  HEADLESS_BUNDLE_PATH   headless.html to render with (default: next to this CLI)
  HEADLESS_WORK_DIR      scratch directory (default: the system temp dir)
  HEADLESS_GPU=true      launch Chromium with GPU acceleration
  HEADLESS_CHROMIUM_PATH Chromium binary to use instead of the bundled one
  HEADLESS_NO_SANDBOX=true  add --no-sandbox (needed in most containers)
  HEADLESS_TIMEOUT_MS    overall render budget, a positive integer
  HEADLESS_LOG=json|text stderr log format (default: text)`

/** An argument or job-spec problem: the caller is holding it wrong, so exit 2. */
class UsageError extends Error {}

type Log = (line: string) => void

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function createLogger(mode: string | undefined): Log {
  if (mode !== 'json') {
    return (line) => {
      process.stderr.write(line + '\n')
    }
  }
  return (line) => {
    const isError = line.startsWith(ERROR_PREFIX)
    const entry = {
      ts: new Date().toISOString(),
      level: isError ? 'error' : 'info',
      msg: isError ? line.slice(ERROR_PREFIX.length) : line,
    }
    process.stderr.write(JSON.stringify(entry) + '\n')
  }
}

/** Where the job spec comes from: a file path, or `-` for stdin. */
function parseJobSource(args: string[]): string {
  let source: string | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--job') {
      const next = args[i + 1]
      if (next === undefined) throw new UsageError('--job needs a file path (or "-" for stdin)')
      source = next
      i++
    } else if (arg.startsWith('--job=')) {
      source = arg.slice('--job='.length)
    } else if (arg.startsWith('-') && arg !== '-') {
      throw new UsageError(`unknown option "${arg}"`)
    } else {
      source = arg
    }
  }

  if (source === undefined || source.length === 0) {
    throw new UsageError('render needs a job spec: --job <file> (or "-" for stdin)')
  }
  return source
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

async function readJobJson(source: string): Promise<unknown> {
  const label = source === '-' ? 'stdin' : `"${source}"`

  let raw: string
  try {
    raw = source === '-' ? await readStdin() : await fs.readFile(source, 'utf8')
  } catch {
    throw new UsageError(`job spec ${label} could not be read`)
  }

  try {
    return JSON.parse(raw)
  } catch {
    throw new UsageError(`job spec ${label} is not valid JSON`)
  }
}

/** The kit assembler writes kit.json; a dev build (or a bare checkout) simply has none. */
async function readKitJson(): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path.join(HERE, 'kit.json'), 'utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

function versionsOf(kit: Record<string, unknown> | undefined): RunJobDeps['versions'] {
  const read = (field: string): string =>
    typeof kit?.[field] === 'string' ? (kit[field] as string) : 'unknown'
  return { engineVersion: read('engineVersion'), kitVersion: read('kitVersion') }
}

function parseTimeoutMs(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.length === 0) return undefined
  if (!/^\d+$/.test(raw) || Number(raw) === 0) {
    throw new UsageError(`HEADLESS_TIMEOUT_MS must be a positive integer, got "${raw}"`)
  }
  return Number(raw)
}

function depsFromEnv(
  env: NodeJS.ProcessEnv,
  versions: RunJobDeps['versions'],
  log: Log,
): RunJobDeps {
  const timeoutMs = parseTimeoutMs(env.HEADLESS_TIMEOUT_MS)
  return {
    bundlePath: env.HEADLESS_BUNDLE_PATH || path.join(HERE, 'headless.html'),
    gpu: env.HEADLESS_GPU === 'true',
    noSandbox: env.HEADLESS_NO_SANDBOX === 'true',
    ...(env.HEADLESS_CHROMIUM_PATH ? { chromiumPath: env.HEADLESS_CHROMIUM_PATH } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(env.HEADLESS_WORK_DIR ? { workDir: env.HEADLESS_WORK_DIR } : {}),
    versions,
    log,
  }
}

/**
 * Runs the CLI and returns its exit code. stdout carries exactly one line — the JSON
 * outcome of a job that ran, or the kit versions for `--version` — and nothing else,
 * ever; diagnostics all go to stderr.
 */
export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const log = createLogger(env.HEADLESS_LOG)

  try {
    const [command, ...rest] = argv

    if (command === '--version') {
      const kit = await readKitJson()
      process.stdout.write(JSON.stringify(kit ?? { kitVersion: 'unknown' }) + '\n')
      return EXIT_OK
    }

    if (command === '--help' || command === '-h') {
      log(USAGE)
      return EXIT_OK
    }

    if (command === undefined) throw new UsageError('no command given')
    if (command !== 'render') throw new UsageError(`unknown command "${command}"`)

    const spec = parseJobSpec(await readJobJson(parseJobSource(rest)))
    const deps = depsFromEnv(env, versionsOf(await readKitJson()), log)

    const outcome = await runJob(spec, deps)
    process.stdout.write(JSON.stringify(outcome) + '\n')
    return outcome.ok ? EXIT_OK : EXIT_JOB_FAILED
  } catch (err) {
    // runJob never throws, so anything landing here is a usage or job-spec problem.
    log(`${ERROR_PREFIX}${messageOf(err)}`)
    if (err instanceof UsageError) log(USAGE)
    return EXIT_USAGE
  }
}

/**
 * True when this file was executed, false when a test imported it.
 *
 * `import.meta.url` is already realpath'd, so argv[1] has to be too — otherwise every
 * symlinked entry point (`node_modules/.bin/headless-artist`, most notably) would compare
 * unequal and the CLI would exit 0 having done nothing at all.
 */
function isDirectRun(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    return realpathSync(path.resolve(entry)) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (isDirectRun()) {
  // process.exitCode rather than process.exit, so the stdout line is never truncated.
  void main(process.argv.slice(2), process.env).then((code) => {
    process.exitCode = code
  })
}
