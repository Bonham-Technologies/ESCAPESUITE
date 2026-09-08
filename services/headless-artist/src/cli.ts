#!/usr/bin/env node
import { promises as fs, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectUnknownKeys, parseJobSpec } from './jobSpec'
import { runJob } from './run'
import type { RunJobDeps } from './run'

/**
 * Re-exported so brokers can reach it from the packaged kit (`dist/cli.js` is the only JS the
 * tarball ships): downloading a job's inputs from S3 is the caller's job — the job spec only
 * ever names local paths — and this is the helper for it. Costs nothing at CLI startup; `s3.ts`
 * imports node built-ins only and loads the AWS SDK lazily, inside the call.
 */
export { fetchS3ToLocal } from './s3'

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

  // Two sources means one of them is being silently ignored — a typo'd invocation that would
  // otherwise render the wrong job, or the right one twice over across a fleet.
  const assign = (value: string, arg: string): void => {
    if (source !== undefined) {
      throw new UsageError(
        arg === '--job' || arg.startsWith('--job=')
          ? '--job was given more than once'
          : `unexpected extra argument "${arg}"`,
      )
    }
    source = value
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--job') {
      const next = args[i + 1]
      if (next === undefined) throw new UsageError('--job needs a file path (or "-" for stdin)')
      // `--job --gpu` means the path was forgotten, not that a file called "--gpu" is wanted;
      // consuming the flag would leave the CLI reporting a baffling "could not be read".
      if (next.startsWith('-') && next !== '-') {
        throw new UsageError(`--job needs a file path (or "-" for stdin), not the flag "${next}"`)
      }
      assign(next, arg)
      i++
    } else if (arg.startsWith('--job=')) {
      assign(arg.slice('--job='.length), arg)
    } else if (arg.startsWith('-') && arg !== '-') {
      throw new UsageError(`unknown option "${arg}"`)
    } else {
      assign(arg, arg)
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

  // Nothing is being piped in, so reading stdin would block on the keyboard forever and look
  // like a hung render — most often a `--job` whose path was left off.
  if (source === '-' && process.stdin.isTTY) {
    throw new UsageError('no job spec on stdin (pass a file path or pipe JSON)')
  }

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

    // Asking for help is not an error, wherever it appears: usage, exit 0.
    if (rest.includes('--help') || rest.includes('-h')) {
      log(USAGE)
      return EXIT_OK
    }

    const json = await readJobJson(parseJobSource(rest))
    const spec = parseJobSpec(json)
    // A misspelled optional field parses fine and is then ignored, so the render silently
    // does something other than what was asked. Warn, but never refuse the job over it.
    for (const field of collectUnknownKeys(json)) {
      log(`warning: unknown field "${field}"`)
    }

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
 * unequal and the CLI would exit 0 having done nothing at all. When realpath itself fails
 * (an unreadable parent directory, a container mount that refuses it) the lexical comparison
 * is still right for the unsymlinked case, and a wrong `false` here is the worst outcome
 * available: a CLI that exits 0 having rendered nothing.
 */
export function isDirectRun(entry: string | undefined = process.argv[1]): boolean {
  if (entry === undefined) return false
  const modulePath = fileURLToPath(import.meta.url)
  const resolved = path.resolve(entry)
  try {
    return realpathSync(resolved) === modulePath
  } catch {
    return resolved === modulePath
  }
}

if (isDirectRun()) {
  // process.exitCode rather than process.exit, so the stdout line is never truncated.
  void main(process.argv.slice(2), process.env).then((code) => {
    process.exitCode = code
  })
}
