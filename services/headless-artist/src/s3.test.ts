import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { getSink } from './sinks'
import type { VerificationManifest } from './manifest'

const cleanupPaths: string[] = []

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const p = cleanupPaths.pop()
    if (p) await fs.rm(p, { recursive: true, force: true })
  }
})

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'headless-artist-s3-test-'))
  cleanupPaths.push(dir)
  return dir
}

function fakeManifest(overrides: Partial<VerificationManifest> = {}): VerificationManifest {
  return {
    jobId: 'job-s3',
    format: 'mp4',
    byteLength: 11,
    durationSec: 3.5,
    width: 640,
    height: 480,
    gpu: false,
    sha256: 'deadbeef',
    chromiumVersion: '120.0.0',
    engineVersion: '1.0.0',
    kitVersion: '1.0.0',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

let sdkAvailable = true
try {
  await import('@aws-sdk/client-s3')
} catch {
  sdkAvailable = false
}

describe.skipIf(!process.env.S3_TEST_ENDPOINT)('s3 sink (round trip against S3_TEST_ENDPOINT)', () => {
  it('uploads the output and manifest, then fetchS3ToLocal reads the output back', async () => {
    const { fetchS3ToLocal } = await import('./s3')

    const endpoint = process.env.S3_TEST_ENDPOINT as string
    const region = process.env.S3_TEST_REGION ?? 'us-east-1'
    const bucket = process.env.S3_TEST_BUCKET ?? 'headless-artist-test'

    const srcDir = await makeTempDir()
    const outputPath = path.join(srcDir, 'render-output.mp4')
    await fs.writeFile(outputPath, Buffer.from('s3 sink round trip bytes'))
    const manifest = fakeManifest()

    const sink = await getSink('s3', { prefix: `${bucket}/it`, endpoint, region })
    const result = await sink.deliver(manifest.jobId, outputPath, manifest)

    expect(result.outputLocation).toBe(`s3://${bucket}/it/${manifest.jobId}.mp4`)
    expect(result.manifestLocation).toBe(`s3://${bucket}/it/${manifest.jobId}.manifest.json`)

    const destDir = await makeTempDir()
    const localPath = await fetchS3ToLocal(result.outputLocation, destDir, { endpoint, region })
    const roundTripBytes = await fs.readFile(localPath)
    expect(roundTripBytes.toString()).toBe('s3 sink round trip bytes')
  })
})

describe('getSink("s3", …) missing optional dependency', () => {
  it.skipIf(sdkAvailable)('fails with a clear error when @aws-sdk/client-s3 cannot load', async () => {
    await expect(getSink('s3', { prefix: 'bucket/prefix' })).rejects.toThrow(
      's3 sink requires the optional dependency @aws-sdk/client-s3',
    )
  })
})
