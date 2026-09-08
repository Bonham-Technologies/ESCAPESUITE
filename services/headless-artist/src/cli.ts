#!/usr/bin/env node
import { promises as fs, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectUnknownKeys, parseJobSpec } from './jobSpec'
import { runJob } from './run'
import type { RunJobDeps } from './run'
import { startServer } from './serve'
import type { ServeHandle } from './serve'

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
       headless-artist serve [--port N] [--host H] [--max-queue N] [--sinks LIST]
                                              serve renders over HTTP
       headless-artist --version              print the kit versions

render prints one JSON RenderOutcome line to stdout; all logs go to stderr.
Exit codes: 0 rendered, 1 job failed, 2 usage or job-spec error.

serve exposes GET /healthz and POST /render (one job spec per request) and runs
until SIGTERM, SIGINT or SIGHUP. It has no authentication: anyone who can reach
the port chooses the output sink, so keep it on loopback or put your own proxy
in front of it.

Environment:
  HEADLESS_BUNDLE_PATH   headless.html to render with (default: next to this CLI)
  HEADLESS_WORK_DIR      scratch directory (default: the system temp dir)
  HEADLESS_GPU=true      launch Chromium with GPU acceleration
  HEADLESS_CHROMIUM_PATH Chromium binary to use instead of the bundled one
  HEADLESS_NO_SANDBOX=true  add --no-sandbox (needed in most containers)
  HEADLESS_TIMEOUT_MS    overall render budget, a positive integer
  HEADLESS_LOG=json|text stderr log format (default: text)
  HEADLESS_PORT          serve: port to bind (default: 8787)
  HEADLESS_HOST          serve: interface to bind (default: 127.0.0.1)
  HEADLESS_CONCURRENCY   serve: renders allowed at once (default: 1)
  HEADLESS_MAX_QUEUE     serve: jobs allowed to wait before 429 (default: 64)
  HEADLESS_SINKS         serve: output sinks POST /render accepts, comma-separated
                         (default: volume,webhook,s3 — "command" is opt-in)`

/** An argument or job-spec problem: the caller is holding it wrong, so exit 2. */
class UsageError extends Error {}

type Log = (line: string) => void

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Anything that reaches a log line can come from a job spec a stranger POSTed — a field name,
 * a sink error, a path. A newline in one of those forges a whole log entry; an ANSI escape
 * repaints the operator's terminal. In text mode there is no escaping to hide behind, so every
 * C0 control character and DEL becomes a space. JSON mode needs none of this: `JSON.stringify`
 * escapes them, and one entry stays one line.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the entire point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g

function createLogger(mode: string | undefined): Log {
  if (mode !== 'json') {
    return (line) => {
      process.stderr.write(line.replace(CONTROL_CHARS, ' ') + '\n')
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

/**
 * Writes the usage block one line at a time. The text logger turns every control character
 * into a space (see CONTROL_CHARS), newlines included, so handing it the whole block at once
 * would arrive as a single unreadable paragraph.
 */
function printUsage(log: Log): void {
  for (const line of USAGE.split('\n')) log(line)
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

const DEFAULT_PORT = 8787
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_CONCURRENCY = 1
const DEFAULT_MAX_QUEUE = 64

/** Every sink the kit implements. `--sinks`/`HEADLESS_SINKS` name a subset of these. */
const SINK_NAMES = ['volume', 'command', 'webhook', 's3']

/**
 * What `serve` accepts unless told otherwise: everything but `command`.
 *
 * A `POST /render` body chooses its own sink, so on a server the `command` sink is "run this
 * program, with these arguments, as me" exposed to whoever can reach the port. Spec §11 calls
 * the command sink opt-in; this is what opt-in means for the HTTP mode. The one-shot `render`
 * command is unaffected — there the operator wrote the job spec.
 */
const DEFAULT_SINKS = ['volume', 'webhook', 's3']

/** The signals that mean "stop": all three drain, none of them kills a running render. */
const STOP_SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP']

/** Exit status a process gets from an unhandled SIGINT; used for the force-quit path. */
const EXIT_SIGINT = 130

interface ServeArgs {
  port?: number
  host?: string
  maxQueue?: number
  sinks?: string[]
}

function parsePort(raw: string, label: string): number {
  // 0 is legal and useful (let the OS pick, read it back off the listening line); 65535 is the
  // top of the range. Anything else is a typo that would otherwise surface as an EADDRINUSE or
  // an ERR_SOCKET_BAD_PORT stack trace.
  if (!/^\d+$/.test(raw) || Number(raw) > 65535) {
    throw new UsageError(`${label} must be an integer between 0 and 65535, got "${raw}"`)
  }
  return Number(raw)
}

function parsePositiveInt(raw: string, label: string): number {
  if (!/^\d+$/.test(raw) || Number(raw) === 0) {
    throw new UsageError(`${label} must be a positive integer, got "${raw}"`)
  }
  return Number(raw)
}

/**
 * A comma-separated subset of SINK_NAMES. Unknown names are a typo that would otherwise turn
 * into a 403 at render time — or, worse, a `command` the operator thought they had enabled.
 */
function parseSinks(raw: string, label: string): string[] {
  const names = raw.split(',').map((name) => name.trim())
  for (const name of names) {
    if (!SINK_NAMES.includes(name)) {
      throw new UsageError(
        `${label} must be a comma-separated subset of ${SINK_NAMES.join(', ')}, got "${name}"`,
      )
    }
  }
  return names
}

/** `serve` takes four optional flags, each at most once, in either `--flag v` or `--flag=v` form. */
function parseServeArgs(args: string[]): ServeArgs {
  const FLAGS = ['--port', '--host', '--max-queue', '--sinks']
  const seen = new Set<string>()
  const values: Record<string, string> = {}

  const assign = (flag: string, value: string): void => {
    if (seen.has(flag)) throw new UsageError(`${flag} was given more than once`)
    if (value.length === 0) throw new UsageError(`${flag} needs a value`)
    seen.add(flag)
    values[flag] = value
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const inline = FLAGS.find((flag) => arg.startsWith(`${flag}=`))
    if (FLAGS.includes(arg)) {
      const next = args[i + 1]
      if (next === undefined) throw new UsageError(`${arg} needs a value`)
      assign(arg, next)
      i++
    } else if (inline) {
      assign(inline, arg.slice(inline.length + 1))
    } else if (arg.startsWith('-')) {
      throw new UsageError(`unknown option "${arg}"`)
    } else {
      throw new UsageError(`unexpected extra argument "${arg}"`)
    }
  }

  return {
    ...(values['--port'] !== undefined ? { port: parsePort(values['--port'], '--port') } : {}),
    ...(values['--host'] !== undefined ? { host: values['--host'] } : {}),
    ...(values['--max-queue'] !== undefined
      ? { maxQueue: parsePositiveInt(values['--max-queue'], '--max-queue') }
      : {}),
    ...(values['--sinks'] !== undefined ? { sinks: parseSinks(values['--sinks'], '--sinks') } : {}),
  }
}

/**
 * Runs the HTTP service until SIGTERM or SIGINT, then shuts it down gracefully and returns.
 *
 * Flags beat environment variables; both are validated before anything binds, so a typo exits 2
 * instead of leaving a half-configured server listening.
 */
async function serve(args: string[], env: NodeJS.ProcessEnv, log: Log): Promise<number> {
  const flags = parseServeArgs(args)
  const port = flags.port ?? (env.HEADLESS_PORT ? parsePort(env.HEADLESS_PORT, 'HEADLESS_PORT') : DEFAULT_PORT)
  const host = flags.host ?? (env.HEADLESS_HOST || DEFAULT_HOST)
  const concurrency = env.HEADLESS_CONCURRENCY
    ? parsePositiveInt(env.HEADLESS_CONCURRENCY, 'HEADLESS_CONCURRENCY')
    : DEFAULT_CONCURRENCY
  const maxQueue =
    flags.maxQueue ??
    (env.HEADLESS_MAX_QUEUE ? parsePositiveInt(env.HEADLESS_MAX_QUEUE, 'HEADLESS_MAX_QUEUE') : DEFAULT_MAX_QUEUE)
  const allowedSinks =
    flags.sinks ?? (env.HEADLESS_SINKS ? parseSinks(env.HEADLESS_SINKS, 'HEADLESS_SINKS') : DEFAULT_SINKS)

  const kit = await readKitJson()
  const deps = depsFromEnv(env, versionsOf(kit), log)

  let server: ServeHandle
  try {
    server = await startServer({
      port,
      host,
      concurrency,
      maxQueue,
      allowedSinks,
      deps,
      versions: kit ?? versionsOf(kit),
      log,
    })
  } catch (err) {
    // A port already taken or one this user may not bind is an environment problem, not a
    // malformed invocation: exit 1 (the same "it failed, try again elsewhere" a failed render
    // gets), so a supervisor can retry it. Exit 2 would tell it never to bother.
    log(`${ERROR_PREFIX}cannot listen on ${host}:${port}: ${messageOf(err)}`)
    return EXIT_JOB_FAILED
  }

  // The bound port, not the requested one, so `--port 0` is usable.
  log(`listening on http://${host}:${server.port} (concurrency ${concurrency})`)

  return await new Promise<number>((resolve) => {
    let draining = false
    const stop = (signal: NodeJS.Signals): void => {
      if (draining) {
        // Signalling twice is an operator saying "stop waiting for that 30-minute render".
        // Node's own default for an unhandled SIGINT is exit 130; match it, and say so first,
        // because this abandons in-flight jobs and leaves their scratch directories behind.
        log(`${ERROR_PREFIX}${signal} received again, abandoning in-flight renders`)
        process.exit(EXIT_SIGINT)
      } else {
        draining = true
        log(`${signal} received, finishing in-flight renders`)
        const done = (code: number): void => {
          for (const name of STOP_SIGNALS) process.removeListener(name, stop)
          resolve(code)
        }
        void server.close().then(
          () => done(EXIT_OK),
          (err: unknown) => {
            // close() is not supposed to reject; if it does, the listener is in an unknown
            // state and in-flight renders may have been dropped. Exiting 0 would tell a
            // supervisor everything drained cleanly, which is the one thing we do not know.
            log(`${ERROR_PREFIX}shutdown failed: ${messageOf(err)}`)
            done(EXIT_JOB_FAILED)
          },
        )
      }
    }
    for (const name of STOP_SIGNALS) process.on(name, stop)
  })
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
      printUsage(log)
      return EXIT_OK
    }

    if (command === undefined) throw new UsageError('no command given')
    if (command !== 'render' && command !== 'serve') {
      throw new UsageError(`unknown command "${command}"`)
    }

    // Asking for help is not an error, wherever it appears: usage, exit 0.
    if (rest.includes('--help') || rest.includes('-h')) {
      printUsage(log)
      return EXIT_OK
    }

    if (command === 'serve') return await serve(rest, env, log)

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
    // runJob never throws and the server catches its own handler errors, so anything
    // landing here is a usage, job-spec or bind problem.
    log(`${ERROR_PREFIX}${messageOf(err)}`)
    if (err instanceof UsageError) printUsage(log)
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
