import { openAsBlob, promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import type { VerificationManifest } from './manifest'

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
}

const FORMAT_TO_MIME: Record<VerificationManifest['format'], string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
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
          await fs.copyFile(outputPath, destOutputPath)
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
}

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
  const env = (rawEnv as Record<string, string> | undefined) ?? {}

  return { command, args, env }
}

/** Last ~20 lines of stderr, for a useful failure message without dumping megabytes. */
function tailLines(text: string, count: number): string {
  const lines = text.split('\n')
  return lines.slice(Math.max(0, lines.length - count)).join('\n').trim()
}

function createCommandSink(config: CommandConfig): OutputSink {
  return {
    async deliver(jobId, outputPath, manifest) {
      const manifestPath = path.join(path.dirname(outputPath), `${jobId}.manifest.json`)
      await fs.writeFile(manifestPath, manifestJson(manifest))

      const fullArgs = [...config.args, outputPath, manifestPath]

      await new Promise<void>((resolve, reject) => {
        execFile(
          config.command,
          fullArgs,
          {
            env: {
              ...process.env,
              ...config.env,
              HEADLESS_OUTPUT_PATH: outputPath,
              HEADLESS_MANIFEST_PATH: manifestPath,
            },
          },
          (error, _stdout, stderr) => {
            if (error) {
              const code = error.code
              reject(
                new Error(
                  `command sink "${config.command}" exited with code ${code}: ${tailLines(String(stderr ?? ''), 20)}`,
                ),
              )
              return
            }
            resolve()
          },
        )
      })

      return { outputLocation: `command:${config.command}`, manifestLocation: manifestPath }
    },
  }
}

// ---------------------------------------------------------------------------
// webhook
// ---------------------------------------------------------------------------

interface WebhookConfig {
  url: string
  headers?: Record<string, string>
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

  return { url, headers: rawHeaders as Record<string, string> | undefined }
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

      const response = await fetch(config.url, {
        method: 'POST',
        headers: config.headers,
        body: form,
      })

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
