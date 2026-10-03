import { describe, it, expect, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import type { ReadStream } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Readable } from 'node:stream'
import { getSink } from './sinks'
import { splitPrefix, keyFor } from './s3'
import type { VerificationManifest } from './manifest'

/**
 * `createReadStream`'s fd-open is scheduled asynchronously and can settle at an arbitrary
 * later point no matter what reads the stream (or doesn't) -- the whole shape of ESCSUITE-186.
 * Reproducing *that* deterministically by racing real disk I/O against real cleanup is not
 * reliable (it depends on which the OS happens to schedule first; see report-186.md's 0/20
 * local reproductions). Capturing the real stream `deliver()` creates lets a test fire its
 * `'error'` event on demand -- the same event the real fd-open would eventually emit on
 * failure -- without needing the race to actually land. Every other `node:fs` export passes
 * through untouched, so the rest of this file's real-filesystem tests are unaffected.
 */
const fsControl = vi.hoisted(() => ({ lastReadStream: undefined as ReadStream | undefined }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    createReadStream: (...args: Parameters<typeof actual.createReadStream>) => {
      const stream = actual.createReadStream(...args)
      fsControl.lastReadStream = stream
      return stream
    },
  }
})

// A function boundary, rather than a direct `fsControl.lastReadStream = undefined` in each
// test, so TypeScript's control-flow narrowing doesn't treat every later read of the property
// within that test as statically `undefined` (it cannot see across the `vi.mock` factory's own
// assignment into the same property).
function resetCapturedReadStream(): void {
  fsControl.lastReadStream = undefined
}

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

describe('splitPrefix', () => {
  it('splits a bare "bucket/key-prefix"', () => {
    expect(splitPrefix('bucket/prefix')).toEqual({ bucket: 'bucket', keyPrefix: 'prefix' })
  })

  it('strips an "s3://" scheme before splitting', () => {
    expect(splitPrefix('s3://bucket/prefix')).toEqual({ bucket: 'bucket', keyPrefix: 'prefix' })
  })

  it('accepts a bucket-only prefix (no key prefix)', () => {
    expect(splitPrefix('bucket')).toEqual({ bucket: 'bucket', keyPrefix: '' })
    expect(splitPrefix('s3://bucket')).toEqual({ bucket: 'bucket', keyPrefix: '' })
  })

  it('trims a trailing slash on the key prefix', () => {
    expect(splitPrefix('bucket/renders/')).toEqual({ bucket: 'bucket', keyPrefix: 'renders' })
    expect(splitPrefix('s3://bucket/renders/')).toEqual({ bucket: 'bucket', keyPrefix: 'renders' })
  })

  it('trims a leading slash on the key prefix', () => {
    expect(splitPrefix('bucket//renders')).toEqual({ bucket: 'bucket', keyPrefix: 'renders' })
  })
})

describe('keyFor', () => {
  it('joins a non-empty key prefix with the file name', () => {
    expect(keyFor('renders', 'job-1.mp4')).toBe('renders/job-1.mp4')
  })

  it('does not double a slash when the key prefix was trimmed', () => {
    const { keyPrefix } = splitPrefix('bucket/renders/')
    expect(keyFor(keyPrefix, 'job-1.mp4')).toBe('renders/job-1.mp4')
  })

  it('returns just the file name when the key prefix is empty (bucket-only prefix)', () => {
    expect(keyFor('', 'job-1.mp4')).toBe('job-1.mp4')
  })

  it('builds the expected output and manifest keys for both formats', () => {
    const { keyPrefix } = splitPrefix('bucket/renders')
    expect(keyFor(keyPrefix, 'job-1.mp4')).toBe('renders/job-1.mp4')
    expect(keyFor(keyPrefix, 'job-1.webm')).toBe('renders/job-1.webm')
    expect(keyFor(keyPrefix, 'job-1.manifest.json')).toBe('renders/job-1.manifest.json')
  })
})

/**
 * A stand-in for the AWS client that records what `deliver` asks it to send. Injecting it
 * exercises the real upload path -- keys, metadata and returned locations -- without the SDK
 * and without a live endpoint, neither of which CI has.
 */
interface RecordedCommand {
  name: string
  input: Record<string, unknown>
}

/**
 * Fully reads a `Readable` body the way a real upload would. `deliver()` hands `Body` a
 * `createReadStream(outputPath)` whose underlying file descriptor is opened asynchronously,
 * on a later tick, regardless of whether anything ever reads from it; a double that records
 * the command without draining the stream lets that open race the test's own `afterEach`,
 * which removes the temp directory as soon as the test function returns. Losing that race
 * surfaces as an ENOENT with nothing listening for the stream's `error` event -- an uncaught
 * exception on an unrelated later tick, misattributed to whatever test is running when it
 * fires (ESCSUITE-186). Draining here forces the open-and-read to finish before `send()`
 * resolves, so the file is never touched after the test (and its cleanup) is done with it.
 */
async function drain(body: unknown): Promise<void> {
  if (body instanceof Readable) {
    for await (const chunk of body) {
      void chunk // consumed for the side effect only
    }
  }
}

function stubClient(): { commands: RecordedCommand[]; send(command: unknown): Promise<unknown> } {
  const commands: RecordedCommand[] = []
  return {
    commands,
    async send(command: unknown) {
      const { input } = command as RecordedCommand
      await drain(input.Body)
      commands.push(command as RecordedCommand)
      return {}
    },
  }
}

describe('s3Sink deliver (injected client)', () => {
  it('puts the render then the manifest under the key prefix, and reports both locations', async () => {
    const { s3Sink } = await import('./s3')
    const dir = await makeTempDir()
    const outputPath = path.join(dir, 'render-output.mp4')
    await fs.writeFile(outputPath, Buffer.from('mp4 bytes'))
    const client = stubClient()

    const sink = await s3Sink({ prefix: 'bucket/renders' }, client)
    const result = await sink.deliver('job-1', outputPath, fakeManifest({ jobId: 'job-1' }))

    expect(client.commands).toHaveLength(2)

    const [video, manifest] = client.commands
    expect(video.name).toBe('PutObject')
    expect(video.input).toMatchObject({
      Bucket: 'bucket',
      Key: 'renders/job-1.mp4',
      ContentType: 'video/mp4',
      ContentLength: 9,
    })
    // Streamed off disk rather than buffered: a render is far too big to hold in memory.
    expect(video.input.Body).toBeInstanceOf(Readable)
    // Fully read by the time deliver() resolves (ESCSUITE-186) -- an unconsumed stream's file
    // descriptor opens on a later tick that this test's own afterEach (which removes the temp
    // dir) would otherwise be racing.
    expect((video.input.Body as Readable).readableEnded).toBe(true)

    expect(manifest.name).toBe('PutObject')
    expect(manifest.input).toMatchObject({
      Bucket: 'bucket',
      Key: 'renders/job-1.manifest.json',
      ContentType: 'application/json',
    })
    const manifestBody = manifest.input.Body as Buffer
    expect(manifest.input.ContentLength).toBe(manifestBody.byteLength)
    expect(JSON.parse(manifestBody.toString())).toMatchObject({ jobId: 'job-1', format: 'mp4' })

    expect(result).toEqual({
      outputLocation: 's3://bucket/renders/job-1.mp4',
      manifestLocation: 's3://bucket/renders/job-1.manifest.json',
    })
  })

  it('writes at the bucket root, with webm metadata, for a bucket-only prefix', async () => {
    const { s3Sink } = await import('./s3')
    const dir = await makeTempDir()
    const outputPath = path.join(dir, 'render-output.webm')
    await fs.writeFile(outputPath, Buffer.from('webm'))
    const client = stubClient()

    const sink = await s3Sink({ prefix: 's3://bucket/' }, client)
    const result = await sink.deliver('job-1', outputPath, fakeManifest({ jobId: 'job-1', format: 'webm' }))

    expect(client.commands[0].input).toMatchObject({
      Bucket: 'bucket',
      Key: 'job-1.webm',
      ContentType: 'video/webm',
      ContentLength: 4,
    })
    expect((client.commands[0].input.Body as Readable).readableEnded).toBe(true)
    expect(client.commands[1].input).toMatchObject({ Key: 'job-1.manifest.json' })
    expect(result).toEqual({
      outputLocation: 's3://bucket/job-1.webm',
      manifestLocation: 's3://bucket/job-1.manifest.json',
    })
  })
})

describe('deliver() stream-error hardening (ESCSUITE-186)', () => {
  // These two guard the production-side half of ESCSUITE-186: run.ts's own `finally`
  // unconditionally removes the job's work directory (which holds outputPath) right after
  // `deliver()` settles, win or lose. A client that rejects or resolves `send()` without ever
  // reading `Body` leaves `createReadStream`'s asynchronously-scheduled fd open free to land
  // after that removal -- and with nothing listening for the stream's own 'error' event, that
  // surfaces as an uncaught exception (a process crash in `serve` mode), not the `{ ok: false }`
  // result runJob's "never throws" contract promises. The injected-client doubles above drain
  // the body the way a real upload does, which is why they alone wouldn't have caught this.

  it('surfaces a client rejection as the sink error, not an uncaught exception, when the body is never read', async () => {
    const { s3Sink } = await import('./s3')
    const dir = await makeTempDir()
    const outputPath = path.join(dir, 'render-output.mp4')
    await fs.writeFile(outputPath, Buffer.from('mp4 bytes'))
    resetCapturedReadStream()

    const uncaught: unknown[] = []
    const onUncaught = (err: unknown) => uncaught.push(err)
    process.on('uncaughtException', onUncaught)

    try {
      const client = {
        // Rejects before ever touching `input.Body` -- a validation failure, or an
        // embedder-supplied client that fails fast, per s3.ts's own doc comment on what a
        // `client` parameter is for.
        async send(): Promise<unknown> {
          throw new Error('client rejected before reading the body')
        },
      }
      const sink = await s3Sink({ prefix: 'bucket/renders' }, client)

      await expect(
        sink.deliver('job-1', outputPath, fakeManifest({ jobId: 'job-1' })),
      ).rejects.toThrow('client rejected before reading the body')

      const body = fsControl.lastReadStream
      expect(body).toBeDefined()

      // Mirrors run.ts's unconditional `finally`: the work directory (containing outputPath)
      // is gone the instant deliver() settles, whether it succeeded or not.
      await fs.rm(dir, { recursive: true, force: true })

      // Racing the real, asynchronously-scheduled fd open against real cleanup isn't
      // reliable (see the comment on fsControl above) -- fire the failure this stream's own
      // deferred open would eventually emit on its own, deterministically, standing in for
      // whatever later tick it would otherwise land on.
      body?.emit('error', Object.assign(new Error('ENOENT: simulated, post-cleanup'), { code: 'ENOENT' }))
      // Let that event's listeners (or, pre-fix, its absence) actually run.
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(uncaught).toEqual([])
    } finally {
      process.off('uncaughtException', onUncaught)
    }
  })

  it('destroys the body stream when the client resolves without ever reading it', async () => {
    const { s3Sink } = await import('./s3')
    const dir = await makeTempDir()
    const outputPath = path.join(dir, 'render-output.mp4')
    await fs.writeFile(outputPath, Buffer.from('mp4 bytes'))

    let capturedBody: Readable | undefined
    const client = {
      // Resolves without ever reading `Body` -- the same shape a stub/embedder double that
      // merely records the command (rather than draining it) produces.
      async send(command: unknown): Promise<unknown> {
        const { input } = command as RecordedCommand
        if (input.Body instanceof Readable) capturedBody = input.Body
        return {}
      },
    }
    const sink = await s3Sink({ prefix: 'bucket/renders' }, client)
    await sink.deliver('job-1', outputPath, fakeManifest({ jobId: 'job-1' }))

    expect(capturedBody).toBeDefined()
    // Released as soon as send() settles, rather than left open for whatever runs next (a
    // caller's own cleanup, in production) to race.
    expect(capturedBody?.destroyed).toBe(true)
  })
})

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
