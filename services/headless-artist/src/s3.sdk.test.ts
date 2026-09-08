import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Readable } from 'node:stream'
import type { VerificationManifest } from './manifest'

/**
 * The AWS SDK, replaced with a recorder. `s3.ts` loads it through a *dynamic* import so the
 * dependency stays optional; these tests exist because the shape of the object the real SDK
 * hands back (`Body` is a Node `Readable` that ALSO carries `transformToByteArray`) is exactly
 * what the download path has to branch on, and the round-trip test only runs against a live
 * endpoint (`S3_TEST_ENDPOINT`), which CI has none of.
 */
const sdk = vi.hoisted(() => {
  const state: {
    commands: { name: string; input: Record<string, unknown> }[]
    clientConfigs: Record<string, unknown>[]
    body: unknown
  } = { commands: [], clientConfigs: [], body: undefined }

  class GetObjectCommand {
    readonly name = 'GetObject'
    constructor(readonly input: Record<string, unknown>) {}
  }
  class PutObjectCommand {
    readonly name = 'PutObject'
    constructor(readonly input: Record<string, unknown>) {}
  }
  class S3Client {
    constructor(config: Record<string, unknown>) {
      state.clientConfigs.push(config)
    }
    async send(command: { name: string; input: Record<string, unknown> }): Promise<unknown> {
      state.commands.push({ name: command.name, input: command.input })
      return command.name === 'GetObject' ? { Body: state.body } : {}
    }
  }

  return { state, GetObjectCommand, PutObjectCommand, S3Client }
})

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: sdk.S3Client,
  PutObjectCommand: sdk.PutObjectCommand,
  GetObjectCommand: sdk.GetObjectCommand,
}))

const cleanupPaths: string[] = []

beforeEach(() => {
  sdk.state.commands = []
  sdk.state.clientConfigs = []
  sdk.state.body = undefined
})

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const p = cleanupPaths.pop()
    if (p) await fs.rm(p, { recursive: true, force: true })
  }
})

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'headless-artist-s3-sdk-test-'))
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

describe('s3Sink object metadata', () => {
  it('sets a video content type on the uploaded render', async () => {
    const { s3Sink } = await import('./s3')
    const srcDir = await makeTempDir()
    const outputPath = path.join(srcDir, 'render.mp4')
    await fs.writeFile(outputPath, Buffer.from('mp4 bytes'))

    const sink = await s3Sink({ prefix: 'bucket/renders' })
    await sink.deliver('job-s3', outputPath, fakeManifest())

    const [video, manifest] = sdk.state.commands
    expect(video.input).toMatchObject({
      Bucket: 'bucket',
      Key: 'renders/job-s3.mp4',
      ContentType: 'video/mp4',
      ContentLength: 9,
    })
    expect(manifest.input).toMatchObject({ ContentType: 'application/json' })
  })

  it('never constructs an SDK client when a client is injected', async () => {
    const { s3Sink } = await import('./s3')
    const srcDir = await makeTempDir()
    const outputPath = path.join(srcDir, 'render.mp4')
    await fs.writeFile(outputPath, Buffer.from('mp4 bytes'))

    const sent: unknown[] = []
    const sink = await s3Sink({ prefix: 'bucket/renders' }, {
      async send(command: unknown) {
        sent.push(command)
        return {}
      },
    })
    await sink.deliver('job-s3', outputPath, fakeManifest())

    expect(sent).toHaveLength(2)
    // The injected client is the whole transport: the optional dependency is never reached.
    expect(sdk.state.clientConfigs).toEqual([])
    expect(sdk.state.commands).toEqual([])
  })

  it('sets video/webm for a webm render', async () => {
    const { s3Sink } = await import('./s3')
    const srcDir = await makeTempDir()
    const outputPath = path.join(srcDir, 'render.webm')
    await fs.writeFile(outputPath, Buffer.from('webm bytes'))

    const sink = await s3Sink({ prefix: 'bucket' })
    await sink.deliver('job-s3', outputPath, fakeManifest({ format: 'webm' }))

    expect(sdk.state.commands[0].input).toMatchObject({
      Key: 'job-s3.webm',
      ContentType: 'video/webm',
    })
  })
})

describe('fetchS3ToLocal', () => {
  it('streams a Readable body to disk instead of buffering it', async () => {
    const { fetchS3ToLocal } = await import('./s3')
    const destDir = await makeTempDir()

    // Exactly what the real SDK returns: a Node stream that also carries
    // `transformToByteArray`. Calling that would pull the whole object into memory, so it
    // blows up here rather than quietly passing.
    const body = Object.assign(Readable.from([Buffer.from('chunk one '), Buffer.from('chunk two')]), {
      transformToByteArray: () => {
        throw new Error('buffered the whole object instead of streaming it')
      },
    })
    sdk.state.body = body

    const local = await fetchS3ToLocal('s3://bucket/renders/job-s3.mp4', destDir)

    expect(local).toBe(path.join(destDir, 'job-s3.mp4'))
    expect(await fs.readFile(local, 'utf8')).toBe('chunk one chunk two')
    expect(sdk.state.commands).toEqual([
      { name: 'GetObject', input: { Bucket: 'bucket', Key: 'renders/job-s3.mp4' } },
    ])
  })

  it('falls back to transformToByteArray for a non-stream body', async () => {
    const { fetchS3ToLocal } = await import('./s3')
    const destDir = await makeTempDir()
    sdk.state.body = {
      transformToByteArray: async () => new TextEncoder().encode('byte array body'),
    }

    const local = await fetchS3ToLocal('s3://bucket/manifest.json', destDir)

    expect(await fs.readFile(local, 'utf8')).toBe('byte array body')
  })

  it('passes region and endpoint through to the client', async () => {
    const { fetchS3ToLocal } = await import('./s3')
    const destDir = await makeTempDir()
    sdk.state.body = { transformToByteArray: async () => new Uint8Array([1]) }

    await fetchS3ToLocal('s3://bucket/a.mp4', destDir, {
      region: 'us-east-1',
      endpoint: 'https://minio.internal',
    })

    expect(sdk.state.clientConfigs[0]).toEqual({
      region: 'us-east-1',
      endpoint: 'https://minio.internal',
    })
  })

  it('rejects a key that names a prefix rather than an object, before any request', async () => {
    const { fetchS3ToLocal } = await import('./s3')
    const destDir = await makeTempDir()

    await expect(fetchS3ToLocal('s3://bucket/renders/', destDir)).rejects.toThrow(
      's3 uri "s3://bucket/renders/" names a key prefix, not an object',
    )
    expect(sdk.state.commands).toEqual([])
  })

  it('rejects an empty body', async () => {
    const { fetchS3ToLocal } = await import('./s3')
    const destDir = await makeTempDir()
    sdk.state.body = undefined

    await expect(fetchS3ToLocal('s3://bucket/a.mp4', destDir)).rejects.toThrow(
      's3 object "s3://bucket/a.mp4" returned an empty body',
    )
  })
})
