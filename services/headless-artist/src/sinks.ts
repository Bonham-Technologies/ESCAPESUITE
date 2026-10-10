import { createReadStream, createWriteStream, openAsBlob, promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import type { VerificationManifest } from './manifest'
import { MAX_TIMEOUT_MS } from './timeouts'

export interface OutputSink {
  deliver(
    jobId: string,
    outputPath: string,
    manifest: VerificationManifest,
  ): Promise<{ outputLocation: string; manifestLocation?: string }>
}

const FORMAT_TO_EXTENSION: Record<VerificationManifest['format'], string> = {
  mp4: 'mp4',
  webm: 'webm',
  gif: 'gif',
}

const FORMAT_TO_MIME: Record<VerificationManifest['format'], string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  gif: 'image/gif',
}

/** Pretty JSON with a trailing newline, the shape every sink writes its manifest sidecar as. */
function manifestJson(manifest: VerificationManifest): string {
  return JSON.stringify(manifest, null, 2) + '\n'
}

export function requireString(config: Record<string, unknown>, field: string, sinkName: string): string {
  const value = config[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${sinkName} sink requires config.${field} (string)`)
  }
  return value
}

// ---------------------------------------------------------------------------
// volume
// ---------------------------------------------------------------------------

interface VolumeConfig {
  dir: string
}

export function validateVolumeConfig(config: Record<string, unknown>): VolumeConfig {
  return { dir: requireString(config, 'dir', 'volume') }
}

/** A private, unique name inside `finalPath`'s own directory — never shared with any other
 * delivery, including a concurrent one for the same jobId. */
function tempNameFor(finalPath: string): string {
  const unique = crypto.randomBytes(8).toString('hex')
  return path.join(path.dirname(finalPath), `.${path.basename(finalPath)}.tmp-${unique}`)
}

/**
 * Moves `sourcePath` to `tempPath` (a name inside the sink's target directory). Tries a
 * rename first — free, and the common case when the job's scratch dir and the sink's `dir`
 * share a filesystem — and falls back to a stream copy across a filesystem boundary.
 *
 * Never `fs.copyFile`: that call writes straight to the destination path it is given, so two
 * concurrent deliveries racing the *same* destination (one jobId, one dir) can interleave at
 * the byte level (hunt-j V-4b). `tempPath` is unique per call, so no concurrent delivery ever
 * shares a destination during this slower part — only the final, same-directory renames in
 * `deliver` below can race, and a rename replaces a name outright; it cannot blend two files'
 * bytes.
 */
async function moveIntoDir(sourcePath: string, tempPath: string): Promise<void> {
  try {
    await fs.rename(sourcePath, tempPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await pipeline(createReadStream(sourcePath), createWriteStream(tempPath))
    await fs.rm(sourcePath, { force: true })
  }
}

/**
 * Removes `path` and swallows any failure to do so — used only for best-effort cleanup of a
 * temp file this module itself created, where the failure that triggered the cleanup is
 * always the one that matters. One shared function (rather than a `.catch(() => undefined)`
 * repeated at every call site) so the "resolves" and "rejects" shapes of that swallow are each
 * exercised once, not five times (review finding 2).
 */
async function removeQuietly(path: string): Promise<void> {
  await fs.rm(path, { force: true }).catch(() => undefined)
}

/** Renames `tempPath` onto `finalPath` — one atomic, same-directory rename. On failure the
 * temp name is removed and the original error propagates, never masked by a cleanup failure. */
async function publishTemp(tempPath: string, finalPath: string): Promise<void> {
  try {
    await fs.rename(tempPath, finalPath)
  } catch (err) {
    await removeQuietly(tempPath)
    throw err
  }
}

/**
 * Pre-flight for the volume sink (ESCSUITE-236): creates the directory the way `deliver` will,
 * then proves it is writable by creating and removing a private temp file in it -- never by
 * `fs.access`, which cannot see ACLs or a read-only mount. Rejects with the directory and the
 * uid the process runs as, because "EACCES" alone does not tell an operator whom to chown to.
 */
export async function probeVolumeDir(configuredDir: string): Promise<void> {
  const dir = path.resolve(configuredDir)
  const probePath = tempNameFor(path.join(dir, 'preflight'))
  try {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(probePath, '', { flag: 'wx' })
    await fs.rm(probePath, { force: true })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'unknown error'
    throw new Error(
      `volume sink directory "${dir}" is not writable by uid ${process.getuid?.()} (${code}); ` +
        'make it writable by that user',
      { cause: err },
    )
  }
}

function createVolumeSink(config: VolumeConfig): OutputSink {
  // Resolved once at construction so the returned locations are always absolute, regardless
  // of the process's current working directory at delivery time (or later).
  const dir = path.resolve(config.dir)
  return {
    async deliver(jobId, outputPath, manifest) {
      await fs.mkdir(dir, { recursive: true })
      const ext = FORMAT_TO_EXTENSION[manifest.format]
      const destOutputPath = path.join(dir, `${jobId}.${ext}`)
      const destManifestPath = path.join(dir, `${jobId}.manifest.json`)

      // Stage everything at private temp names first — the video's move/copy included, which
      // is the slow, possibly cross-filesystem part — before anything is published. That way
      // the two publishing renames below happen back to back with nothing but each other in
      // between, keeping the window in which a *concurrent* delivery for the same jobId could
      // interleave its own publish as small as it already was on the plain same-filesystem
      // rename path (hunt-j V-4 found 0 mismatches in 240 trials there). It is narrowed, not
      // closed: two deliveries of the same jobId overlapping in time can still publish one
      // job's manifest beside the other's video (see README §volume).
      const videoTemp = tempNameFor(destOutputPath)
      try {
        await moveIntoDir(outputPath, videoTemp)
      } catch (err) {
        await removeQuietly(videoTemp)
        throw err
      }

      const manifestTemp = tempNameFor(destManifestPath)
      try {
        await fs.writeFile(manifestTemp, manifestJson(manifest))
      } catch (err) {
        await removeQuietly(manifestTemp)
        await removeQuietly(videoTemp)
        throw err
      }

      // Publish: the sidecar first — if this fails, the video must never be published either,
      // so a consumer watching `dir` never sees a finished-looking video with no manifest
      // beside it to verify it against (hunt-j J-3).
      try {
        await publishTemp(manifestTemp, destManifestPath)
      } catch (err) {
        await removeQuietly(videoTemp)
        throw err
      }

      // No rollback of the sidecar if this fails: a manifest with no video beside it is
      // harmless to a consumer watching for the finished render, while deleting it here could
      // itself delete the *previous*, still-valid delivery for this jobId (if this is a
      // re-run) or a concurrent delivery's just-published manifest — strictly worse than
      // leaving a name that might not be this call's to remove.
      await publishTemp(videoTemp, destOutputPath)

      return { outputLocation: destOutputPath, manifestLocation: destManifestPath }
    },
  }
}

// ---------------------------------------------------------------------------
// command
// ---------------------------------------------------------------------------

interface CommandConfig {
  command: string
  args: string[]
  env: Record<string, string>
  timeoutMs: number
}

/**
 * Delivery budget when `config.timeoutMs` is not given. `HEADLESS_TIMEOUT_MS` bounds only the
 * render phase, so without one of these a delivery command that never exits would hold the
 * worker slot forever.
 */
const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60_000

export function validateCommandConfig(config: Record<string, unknown>): CommandConfig {
  const command = requireString(config, 'command', 'command')

  const rawArgs = config.args
  if (rawArgs !== undefined && (!Array.isArray(rawArgs) || !rawArgs.every((a) => typeof a === 'string'))) {
    throw new Error('command sink requires config.args (string[]) when provided')
  }
  const args = (rawArgs as string[] | undefined) ?? []

  const rawEnv = config.env
  if (rawEnv !== undefined && (typeof rawEnv !== 'object' || rawEnv === null || Array.isArray(rawEnv))) {
    throw new Error('command sink requires config.env (object) when provided')
  }
  const env = (rawEnv as Record<string, unknown> | undefined) ?? {}
  // spawn's env must be strings; a number or null here reaches the child as "8080"/"null" at
  // best and throws at worst, so say so while the config is still in view.
  if (!Object.values(env).every((value) => typeof value === 'string')) {
    throw new Error('command sink config.env values must be strings')
  }

  const rawTimeout = config.timeoutMs
  if (
    rawTimeout !== undefined &&
    (typeof rawTimeout !== 'number' || !Number.isInteger(rawTimeout) || rawTimeout <= 0)
  ) {
    throw new Error('command sink requires config.timeoutMs (positive integer) when provided')
  }
  // Same 32-bit timer bound as the webhook sink's — see MAX_TIMEOUT_MS.
  if (typeof rawTimeout === 'number' && rawTimeout > MAX_TIMEOUT_MS) {
    throw new Error(
      `command sink requires config.timeoutMs (positive integer, at most ${MAX_TIMEOUT_MS}) when provided`,
    )
  }
  const timeoutMs = (rawTimeout as number | undefined) ?? DEFAULT_COMMAND_TIMEOUT_MS

  return { command, args, env: env as Record<string, string>, timeoutMs }
}

/** How long a child is given to exit after SIGTERM before SIGKILL follows. */
const COMMAND_KILL_GRACE_MS = 2000

/** Last ~20 lines of stderr, for a useful failure message without dumping megabytes. */
function tailLines(text: string, count: number): string {
  const lines = text.split('\n')
  return lines.slice(Math.max(0, lines.length - count)).join('\n').trim()
}

const STDERR_TAIL_LINES = 20
/** Hard cap on the stderr we hold, so a command that fails *noisily* can't exhaust memory. */
const STDERR_TAIL_CHARS = 64 * 1024

function createCommandSink(config: CommandConfig): OutputSink {
  return {
    async deliver(jobId, outputPath, manifest) {
      const manifestPath = path.join(path.dirname(outputPath), `${jobId}.manifest.json`)
      await fs.writeFile(manifestPath, manifestJson(manifest))

      const fullArgs = [...config.args, outputPath, manifestPath]

      await new Promise<void>((resolve, reject) => {
        // spawn, not execFile: execFile buffers both streams and kills the child once either
        // passes `maxBuffer` (1 MiB by default) — so a chatty delivery command was killed
        // *after* it had already delivered, and the job was reported as failed. stdout is
        // discarded outright and stderr is kept only as a bounded tail for the error message.
        const child = spawn(config.command, fullArgs, {
          stdio: ['ignore', 'ignore', 'pipe'],
          env: {
            ...process.env,
            ...config.env,
            HEADLESS_OUTPUT_PATH: outputPath,
            HEADLESS_MANIFEST_PATH: manifestPath,
          },
        })

        let stderr = ''
        child.stderr.setEncoding('utf8')
        child.stderr.on('data', (chunk: string) => {
          stderr = (stderr + chunk).slice(-STDERR_TAIL_CHARS)
        })

        // The delivery's own budget — HEADLESS_TIMEOUT_MS only covers the render, so without
        // this a command that never exits would hold the worker slot forever. SIGTERM first,
        // then SIGKILL after a grace period for a child that ignores it. The rejection fires
        // from the escalation timer itself, right after the SIGKILL, rather than waiting on
        // 'close' — 'close' waits for the stdio pipes, not the child, so a direct child that
        // backgrounds a grandchild inheriting the stderr pipe and then exits would otherwise
        // never emit it, leaving deliver() unsettled long after both timers have fired.
        let timedOut = false
        let killTimer: NodeJS.Timeout | undefined
        const timeoutTimer = setTimeout(() => {
          timedOut = true
          child.kill('SIGTERM')
          killTimer = setTimeout(() => {
            child.kill('SIGKILL')
            reject(new Error(`command sink timed out after ${config.timeoutMs} ms`))
          }, COMMAND_KILL_GRACE_MS)
        }, config.timeoutMs)
        const clearTimers = (): void => {
          clearTimeout(timeoutTimer)
          if (killTimer !== undefined) clearTimeout(killTimer)
        }

        child.on('error', (err) => {
          clearTimers()
          const why =
            (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'command not found' : err.message
          reject(new Error(`command sink "${config.command}" could not be run: ${why}`, { cause: err }))
        })

        child.on('close', (code, signal) => {
          clearTimers()
          if (timedOut) {
            // Already rejected from the escalation timer above (or will be, if the child's own
            // pipes close before the kill timer fires) — a second reject on a settled promise
            // is a no-op. Kept so a child that dies in the same instant the timer fires still
            // reports a timeout rather than falling through to the exit-code branch below.
            reject(new Error(`command sink timed out after ${config.timeoutMs} ms`))
            return
          }
          if (code === 0) {
            resolve()
            return
          }
          // A spawn failure already rejected above; `close` still fires, and a second reject
          // on a settled promise is a no-op.
          const how = signal !== null ? `was killed by ${signal}` : `exited with code ${code}`
          reject(
            new Error(`command sink "${config.command}" ${how}: ${tailLines(stderr, STDERR_TAIL_LINES)}`),
          )
        })
      })

      // No manifestLocation: the sidecar is a transport artifact living beside the render in
      // the runner's scratch dir, which is torn down as soon as the command returns. Where the
      // command actually put it is the command's business, so only durable sinks report one.
      return { outputLocation: `command:${config.command}` }
    },
  }
}

// ---------------------------------------------------------------------------
// webhook
// ---------------------------------------------------------------------------

interface WebhookConfig {
  url: string
  headers?: Record<string, string>
  timeoutMs: number
}

/**
 * A whole delivery — connect, upload the video, read the response — with no ceiling of its own:
 * `HEADLESS_TIMEOUT_MS` only bounds the render phase, so without this a server that accepts the
 * POST and never answers holds the worker forever.
 */
const DEFAULT_WEBHOOK_TIMEOUT_MS = 10 * 60_000

/**
 * `fetch` generates the multipart boundary itself and puts it in Content-Type; a caller-supplied
 * one would replace it and leave the server unable to parse the body. Every other header stands.
 */
function withoutContentType(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'content-type'))
}

export function validateWebhookConfig(config: Record<string, unknown>): WebhookConfig {
  const url = requireString(config, 'url', 'webhook')

  const rawHeaders = config.headers
  if (
    rawHeaders !== undefined &&
    (typeof rawHeaders !== 'object' || rawHeaders === null || Array.isArray(rawHeaders))
  ) {
    throw new Error('webhook sink requires config.headers (object) when provided')
  }

  const rawTimeout = config.timeoutMs
  if (
    rawTimeout !== undefined &&
    (typeof rawTimeout !== 'number' || !Number.isInteger(rawTimeout) || rawTimeout <= 0)
  ) {
    throw new Error('webhook sink requires config.timeoutMs (positive integer) when provided')
  }
  // AbortSignal.timeout clamps any delay above 2^31-1 to 1 ms rather than refusing it (and
  // throws ERR_OUT_OF_RANGE above 2^32-1), so a value past this bound would abort the delivery
  // almost instantly instead of giving it the long budget that was asked for.
  if (typeof rawTimeout === 'number' && rawTimeout > MAX_TIMEOUT_MS) {
    throw new Error(
      `webhook sink requires config.timeoutMs (positive integer, at most ${MAX_TIMEOUT_MS}) when provided`,
    )
  }

  return {
    url,
    headers: rawHeaders === undefined ? undefined : withoutContentType(rawHeaders as Record<string, string>),
    timeoutMs: (rawTimeout as number | undefined) ?? DEFAULT_WEBHOOK_TIMEOUT_MS,
  }
}

/** `AbortSignal.timeout`'s reason reaches us as the cause of fetch's own TypeError. */
function isTimeoutError(err: unknown): boolean {
  for (let cursor: unknown = err, hops = 0; cursor instanceof Error && hops < 8; hops++) {
    if (cursor.name === 'TimeoutError') return true
    cursor = (cursor as { cause?: unknown }).cause
  }
  return false
}

/**
 * Reads `response`'s body to completion without accumulating it anywhere, so undici can
 * return the connection to its keep-alive pool (ESCSUITE-205 / hunt-j unverified / verify V-1)
 * without buffering a misconfigured or hostile intake's response into memory first the way
 * `response.arrayBuffer()` would. A response with no body (a 204, say) has `body: null` and
 * needs nothing drained; a body that errors mid-read has nothing further to drain either way —
 * the delivery's own status/redirect checks below still decide success or failure from the
 * response already in hand, not from whether the drain itself finished cleanly.
 */
async function drainBody(response: Response): Promise<void> {
  if (!response.body) return
  try {
    // DOM's ReadableStream type (this package's lib) does not declare Symbol.asyncIterator,
    // but Node's actual implementation (and the one this runs on) supports it.
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      void chunk
    }
  } catch {
    // See the doc comment above: nothing left to drain, and nothing this function decides.
  }
}

function createWebhookSink(config: WebhookConfig): OutputSink {
  return {
    async deliver(jobId, outputPath, manifest) {
      const ext = FORMAT_TO_EXTENSION[manifest.format]
      const mime = FORMAT_TO_MIME[manifest.format]

      const form = new FormData()
      form.set('manifest', JSON.stringify(manifest))
      const blob = await openAsBlob(outputPath, { type: mime })
      form.set('file', blob, `${jobId}.${ext}`)

      let response: Response
      try {
        response = await fetch(config.url, {
          method: 'POST',
          headers: config.headers,
          body: form,
          // Never follow a redirect: the default (`follow`) would re-POST the whole render
          // and every caller header except Content-Type to whatever host a 307/308 names,
          // which is not the one the operator configured or reviewed (ESCSUITE-205 / hunt-j
          // unverified / verify V-2). `manual` (rather than `error`) is what gets this sink a
          // real response object with the status and the Location header still readable, so
          // the failure below can name where the intake tried to send it.
          redirect: 'manual',
          signal: AbortSignal.timeout(config.timeoutMs),
        })
      } catch (err) {
        if (isTimeoutError(err)) {
          throw new Error(`webhook sink timed out after ${config.timeoutMs} ms`, { cause: err })
        }
        throw err
      }

      // Drain the response body on every path -- success or failure -- so undici can return
      // the connection to its keep-alive pool instead of holding it (and whatever bytes it
      // buffered) open until GC. An unread body meant one fresh TCP connection per delivery
      // (ESCSUITE-205 / hunt-j unverified / verify V-1).
      await drainBody(response)

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        throw new Error(
          `webhook sink refused to follow a redirect (${response.status}` +
            `${location ? ` to ${location}` : ''})`,
        )
      }

      if (!response.ok) {
        throw new Error(`webhook sink failed: ${response.status} ${response.statusText}`)
      }

      return { outputLocation: config.url }
    },
  }
}

// ---------------------------------------------------------------------------
// getSink
// ---------------------------------------------------------------------------

export async function getSink(kind: string, config: Record<string, unknown>): Promise<OutputSink> {
  switch (kind) {
    case 'volume':
      return createVolumeSink(validateVolumeConfig(config))
    case 'command':
      return createCommandSink(validateCommandConfig(config))
    case 'webhook':
      return createWebhookSink(validateWebhookConfig(config))
    case 's3': {
      // This dynamic import is no longer what keeps `@aws-sdk/client-s3` out of the module
      // graph (`jobSpec.ts` already imports `./s3` statically, for `validateS3Config` and
      // `ensureSinkReady`) — what actually does is `s3.ts` never importing the SDK itself at
      // the top level: `loadS3ClientModule` loads it at call time, and throws the "optional
      // dependency" error from inside `s3Sink()` when it can't — nothing to catch here.
      const { s3Sink, validateS3Config } = await import('./s3')
      return s3Sink(validateS3Config(config))
    }
    default:
      throw new Error(`Unknown output sink: ${kind}`)
  }
}
