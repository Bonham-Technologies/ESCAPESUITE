import { createReadStream, promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import type { RenderMeta } from './types'

export interface VersionInfo {
  chromiumVersion: string
  engineVersion: string
  kitVersion: string
}

export interface VerificationManifest extends RenderMeta {
  jobId: string
  sha256: string
  chromiumVersion: string
  engineVersion: string
  kitVersion: string
  createdAt: string
}

/** Streams the file through sha256 without ever holding the whole thing in memory. */
async function sha256OfFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })
  return hash.digest('hex')
}

/**
 * Builds the verification manifest for a rendered output already on disk at `outputPath`.
 * `byteLength` is re-read from disk (overriding `meta.byteLength`) and `sha256` is streamed
 * rather than loaded whole, so this stays cheap even for large exports.
 */
export async function buildManifest(
  jobId: string,
  outputPath: string,
  meta: RenderMeta,
  versions: VersionInfo,
  now: Date = new Date(),
): Promise<VerificationManifest> {
  const [stat, sha256] = await Promise.all([fs.stat(outputPath), sha256OfFile(outputPath)])

  return {
    jobId,
    format: meta.format,
    byteLength: stat.size,
    durationSec: meta.durationSec,
    width: meta.width,
    height: meta.height,
    gpu: meta.gpu,
    sha256,
    chromiumVersion: versions.chromiumVersion,
    engineVersion: versions.engineVersion,
    kitVersion: versions.kitVersion,
    createdAt: now.toISOString(),
  }
}
