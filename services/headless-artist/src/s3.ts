import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { OutputSink } from './sinks'
import type { VerificationManifest } from './manifest'

export interface S3SinkConfig {
  /**
   * `<bucket>`, `<bucket>/<key-prefix>`, or the same with an `s3://` scheme — objects are
   * written under this prefix. A trailing slash on the key prefix is ignored.
   */
  prefix: string
  endpoint?: string
  region?: string
}

const FORMAT_TO_EXTENSION: Record<VerificationManifest['format'], string> = {
  mp4: 'mp4',
  webm: 'webm',
}

/**
 * The slice of `@aws-sdk/client-s3`'s API this module actually uses, typed locally so this
 * package's typecheck never depends on the SDK's own (optional-dependency) types being
 * installed.
 */
interface MinimalS3Client {
  send(command: unknown): Promise<unknown>
}

interface S3ClientModule {
  S3Client: new (config: { region?: string; endpoint?: string }) => MinimalS3Client
  PutObjectCommand: new (input: Record<string, unknown>) => unknown
  GetObjectCommand: new (input: Record<string, unknown>) => unknown
}

/**
 * Loads the optional `@aws-sdk/client-s3` dependency at call time (never at module load, so
 * importing this file doesn't require the SDK to be installed). Callers should surface the
 * thrown error to users as "the optional dependency is missing".
 */
async function loadS3ClientModule(): Promise<S3ClientModule> {
  try {
    // A non-literal specifier so TypeScript never tries to resolve `@aws-sdk/client-s3`'s own
    // types — this package's typecheck must pass whether or not the optional dependency is
    // installed.
    const moduleName = '@aws-sdk/client-s3'
    return (await import(moduleName)) as unknown as S3ClientModule
  } catch (err) {
    throw new Error('s3 sink requires the optional dependency @aws-sdk/client-s3', { cause: err })
  }
}

/**
 * Splits a `prefix` config value into a bucket and an (optional) key prefix. Accepts both
 * `s3://bucket/key-prefix` and a bare `bucket/key-prefix` (the leading `s3://` scheme, if
 * present, is stripped before splitting). Leading/trailing slashes on the key prefix are
 * trimmed so a trailing slash in config (`bucket/renders/`) can't produce a doubled slash
 * when joined with a file name.
 */
export function splitPrefix(prefix: string): { bucket: string; keyPrefix: string } {
  const withoutScheme = prefix.startsWith('s3://') ? prefix.slice('s3://'.length) : prefix
  const slash = withoutScheme.indexOf('/')
  if (slash === -1) return { bucket: withoutScheme, keyPrefix: '' }
  return {
    bucket: withoutScheme.slice(0, slash),
    keyPrefix: withoutScheme.slice(slash + 1).replace(/^\/+|\/+$/g, ''),
  }
}

/** Joins a (possibly empty) key prefix with a file name into a full S3 object key. */
export function keyFor(keyPrefix: string, fileName: string): string {
  return keyPrefix ? `${keyPrefix}/${fileName}` : fileName
}

/**
 * Builds an S3 output sink. The AWS SDK is loaded lazily (see `loadS3ClientModule`), so
 * `getSink('s3', …)` fails fast with a clear error when the optional dependency isn't
 * installed, before anything else about the config is touched.
 */
export async function s3Sink(config: S3SinkConfig): Promise<OutputSink> {
  const { S3Client, PutObjectCommand } = await loadS3ClientModule()
  const { bucket, keyPrefix } = splitPrefix(config.prefix)

  const client = new S3Client({
    ...(config.region ? { region: config.region } : {}),
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
  })

  return {
    async deliver(jobId, outputPath, manifest) {
      const ext = FORMAT_TO_EXTENSION[manifest.format]
      const stat = await fs.stat(outputPath)

      const outputKey = keyFor(keyPrefix, `${jobId}.${ext}`)
      const manifestKey = keyFor(keyPrefix, `${jobId}.manifest.json`)

      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: outputKey,
          // The SDK needs a length up front for a stream body — read it from disk rather
          // than buffering the whole file in memory.
          Body: createReadStream(outputPath),
          ContentLength: stat.size,
        }),
      )

      const manifestBody = Buffer.from(JSON.stringify(manifest, null, 2) + '\n')
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: manifestKey,
          Body: manifestBody,
          ContentLength: manifestBody.byteLength,
          ContentType: 'application/json',
        }),
      )

      return {
        outputLocation: `s3://${bucket}/${outputKey}`,
        manifestLocation: `s3://${bucket}/${manifestKey}`,
      }
    },
  }
}

function parseS3Uri(uri: string): { bucket: string; key: string } {
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(uri)
  if (!match) {
    throw new Error(`invalid s3 uri: ${uri}`)
  }
  return { bucket: match[1], key: match[2] }
}

/**
 * Downloads an `s3://bucket/key` object to `<destDir>/<basename(key)>`, for use as an
 * optional input adapter (fetching a job's source bundle/manifest from S3 before handing it
 * to the loaders). Returns the local path written.
 */
export async function fetchS3ToLocal(uri: string, destDir: string, cfg: Omit<S3SinkConfig, 'prefix'> = {}): Promise<string> {
  const { GetObjectCommand, S3Client } = await loadS3ClientModule()
  const { bucket, key } = parseS3Uri(uri)

  const client = new S3Client({
    ...(cfg.region ? { region: cfg.region } : {}),
    ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
  })

  const response = (await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))) as {
    Body?: { transformToByteArray?: () => Promise<Uint8Array> } | NodeJS.ReadableStream
  }

  await fs.mkdir(destDir, { recursive: true })
  const destPath = path.join(destDir, path.basename(key))

  const body = response.Body
  if (!body) {
    throw new Error(`s3 object "${uri}" returned an empty body`)
  }

  if (typeof (body as { transformToByteArray?: unknown }).transformToByteArray === 'function') {
    const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray()
    await fs.writeFile(destPath, bytes)
  } else {
    await pipeline(body as NodeJS.ReadableStream, createWriteStream(destPath))
  }

  return destPath
}
