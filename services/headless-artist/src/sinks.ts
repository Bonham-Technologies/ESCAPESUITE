import { openAsBlob, promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
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

function requireString(config: Record<string, unknown>, field: string, sinkName: string): string {
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

function validateVolumeConfig(config: Record<string, unknown>): VolumeConfig {
  return { dir: requireString(config, 'dir', 'volume') }
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

      try {
        await fs.rename(outputPath, destOutputPath)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
          try {
            await fs.copyFile(outputPath, destOutputPath)
          } catch (copyErr) {
            // A failed copy (ENOSPC, most likely) leaves a truncated file at the destination,
            // which a consumer watching the directory would happily pick up as a finished
            // render. Removing it unconditionally is safe: the path is `<dir>/<jobId>.<ext>`,
            // so the most this can delete is an earlier render of the same jobId — which this
            // delivery was overwriting anyway.
            // Take it away before the failure propagates, and never let a cleanup failure
            // mask the copy failure that caused it.
            await fs.rm(destOutputPath, { force: true }).catch(() => undefined)
            throw copyErr
          }
          await fs.rm(outputPath, { force: true })
        } else {
          throw err
        }
      }

      await fs.writeFile(destManifestPath, manifestJson(manifest))

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

function validateCommandConfig(config: Record<string, unknown>): CommandConfig {
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

function validateWebhookConfig(config: Record<string, unknown>): WebhookConfig {
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
          signal: AbortSignal.timeout(config.timeoutMs),
        })
      } catch (err) {
        if (isTimeoutError(err)) {
          throw new Error(`webhook sink timed out after ${config.timeoutMs} ms`, { cause: err })
        }
        throw err
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
      const prefix = requireString(config, 'prefix', 's3')
      // s3.ts loads `@aws-sdk/client-s3` itself, lazily, and throws the "optional
      // dependency" error from inside s3Sink() when it can't — nothing to catch here.
      const { s3Sink } = await import('./s3')
      return s3Sink({
        prefix,
        endpoint: typeof config.endpoint === 'string' ? config.endpoint : undefined,
        region: typeof config.region === 'string' ? config.region : undefined,
      })
    }
    default:
      throw new Error(`Unknown output sink: ${kind}`)
  }
}
