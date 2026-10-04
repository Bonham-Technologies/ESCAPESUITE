import { describe, it, expect, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import crypto from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { getSink } from './sinks'
import type { VerificationManifest } from './manifest'
import { MAX_TIMEOUT_MS } from './timeouts'

// A handle to the real, unmocked fs.promises so a test that spies on fs.rename can still
// delegate the calls it does not want to intercept.
const fsOriginal = { rename: fs.rename.bind(fs) }

function sha256Of(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

const cleanupPaths: string[] = []
const cleanupServers: http.Server[] = []

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const p = cleanupPaths.pop()
    if (p) await fs.rm(p, { recursive: true, force: true })
  }
  while (cleanupServers.length > 0) {
    const server = cleanupServers.pop()
    if (server) await new Promise((resolve) => server.close(resolve))
  }
})

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'headless-artist-sinks-test-'))
  cleanupPaths.push(dir)
  return dir
}

async function makeOutputFile(dir: string, bytes: Buffer, name = 'render-output.mp4'): Promise<string> {
  const filePath = path.join(dir, name)
  await fs.writeFile(filePath, bytes)
  return filePath
}

/** `kill -0` — true while the pid is still alive (any signal would do; 0 sends none). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Polls until `check` stops throwing, so a death check never depends on a fixed delay. */
async function waitFor(check: () => void, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      check()
      return
    } catch (err) {
      if (Date.now() > deadline) throw err
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
}

/** Reads a pid a stubborn-child script wrote via `config.env.PID_FILE`, retrying briefly in
 * case the write hasn't landed on disk yet by the time the caller looks for it. */
async function readPidFile(pidFile: string): Promise<number> {
  let lastErr: unknown
  const deadline = Date.now() + 2000
  for (;;) {
    try {
      return Number((await fs.readFile(pidFile, 'utf8')).trim())
    } catch (err) {
      lastErr = err
      if (Date.now() > deadline) throw lastErr
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
}

function fakeManifest(overrides: Partial<VerificationManifest> = {}): VerificationManifest {
  return {
    jobId: 'job-abc',
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

describe('getSink', () => {
  it('throws a clear error for an unknown sink kind', async () => {
    await expect(getSink('carrier-pigeon', {})).rejects.toThrow('Unknown output sink: carrier-pigeon')
  })
})

describe('s3 sink selection', () => {
  it('validates config.prefix before the optional AWS SDK is even loaded', async () => {
    await expect(getSink('s3', {})).rejects.toThrow(/s3 sink requires config\.prefix \(string\)/)
    await expect(getSink('s3', { prefix: '' })).rejects.toThrow(/s3 sink requires config\.prefix \(string\)/)
  })

  it('builds a deliverable sink from a prefix, region and endpoint', async () => {
    // s3.ts imports the SDK itself, lazily, inside this call; the upload path (keys, metadata,
    // locations) is driven against a recording client in s3.sdk.test.ts.
    const sink = await getSink('s3', {
      prefix: 's3://bucket/renders',
      region: 'us-west-2',
      endpoint: 'https://minio.internal',
    })

    expect(typeof sink.deliver).toBe('function')
  })

  it('builds one from a bare prefix with no region or endpoint at all', async () => {
    const sink = await getSink('s3', { prefix: 'bucket' })

    expect(typeof sink.deliver).toBe('function')
  })

  // ESCSUITE-192 (hunt-j J-4): region/endpoint of the wrong type used to be dropped silently
  // (read only if typeof === 'string', ignored otherwise) instead of refused by name, unlike
  // every other sink's config.
  it('refuses a non-string region or endpoint by name, rather than dropping it silently', async () => {
    await expect(getSink('s3', { prefix: 'bucket', region: 42 })).rejects.toThrow(
      /s3 sink requires config\.region \(string\) when provided/,
    )
    await expect(getSink('s3', { prefix: 'bucket', endpoint: null })).rejects.toThrow(
      /s3 sink requires config\.endpoint \(string\) when provided/,
    )
  })

  // ESCSUITE-192 (hunt-j J-4): "s3://" and "/" both pass requireString's "non-empty string"
  // check and split to an empty bucket, which used to reach the SDK as Bucket: "" instead of
  // being refused up front.
  it('refuses a prefix that names no bucket', async () => {
    await expect(getSink('s3', { prefix: 's3://' })).rejects.toThrow(
      /s3 sink requires config\.prefix to name a bucket/,
    )
    await expect(getSink('s3', { prefix: '/' })).rejects.toThrow(
      /s3 sink requires config\.prefix to name a bucket/,
    )
  })
})

describe('volume sink', () => {
  it('validates config.dir is required', async () => {
    await expect(getSink('volume', {})).rejects.toThrow(/volume sink requires config\.dir \(string\)/)
    await expect(getSink('volume', { dir: 42 })).rejects.toThrow(/volume sink requires config\.dir \(string\)/)
  })

  it('moves the output file into place (rename) and writes a manifest sidecar', async () => {
    const srcDir = await makeTempDir()
    const destDir = path.join(await makeTempDir(), 'nested', 'dest')
    const outputPath = await makeOutputFile(srcDir, Buffer.from('hello world'))
    const manifest = fakeManifest()

    const sink = await getSink('volume', { dir: destDir })
    const result = await sink.deliver(manifest.jobId, outputPath, manifest)

    const expectedOutput = path.join(destDir, `${manifest.jobId}.mp4`)
    const expectedManifest = path.join(destDir, `${manifest.jobId}.manifest.json`)

    expect(result.outputLocation).toBe(expectedOutput)
    expect(result.manifestLocation).toBe(expectedManifest)

    await expect(fs.access(expectedOutput)).resolves.toBeUndefined()
    // Source file was moved (renamed), not copied.
    await expect(fs.access(outputPath)).rejects.toThrow()

    const movedBytes = await fs.readFile(expectedOutput)
    expect(movedBytes.toString()).toBe('hello world')

    const manifestRaw = await fs.readFile(expectedManifest, 'utf8')
    expect(manifestRaw.endsWith('\n')).toBe(true)
    const parsed = JSON.parse(manifestRaw)
    expect(parsed.jobId).toBe('job-abc')
    expect(parsed.sha256).toBe('deadbeef')
  })

  it('overwrites existing files on a second delivery for the same jobId', async () => {
    const destDir = await makeTempDir()

    const srcDir1 = await makeTempDir()
    const outputPath1 = await makeOutputFile(srcDir1, Buffer.from('first version'))
    const manifest1 = fakeManifest({ sha256: 'first-hash' })
    const sink = await getSink('volume', { dir: destDir })
    await sink.deliver(manifest1.jobId, outputPath1, manifest1)

    const srcDir2 = await makeTempDir()
    const outputPath2 = await makeOutputFile(srcDir2, Buffer.from('second version, longer'))
    const manifest2 = fakeManifest({ sha256: 'second-hash' })
    const result2 = await sink.deliver(manifest2.jobId, outputPath2, manifest2)

    const expectedOutput = path.join(destDir, `${manifest1.jobId}.mp4`)
    expect(result2.outputLocation).toBe(expectedOutput)

    const finalBytes = await fs.readFile(expectedOutput)
    expect(finalBytes.toString()).toBe('second version, longer')

    const expectedManifest = path.join(destDir, `${manifest1.jobId}.manifest.json`)
    const parsed = JSON.parse(await fs.readFile(expectedManifest, 'utf8'))
    expect(parsed.sha256).toBe('second-hash')
  })

  it('uses the .webm extension when manifest.format is webm', async () => {
    const srcDir = await makeTempDir()
    const destDir = await makeTempDir()
    const outputPath = await makeOutputFile(srcDir, Buffer.from('webm bytes'), 'render-output.webm')
    const manifest = fakeManifest({ format: 'webm', jobId: 'job-webm' })

    const sink = await getSink('volume', { dir: destDir })
    const result = await sink.deliver(manifest.jobId, outputPath, manifest)

    expect(result.outputLocation).toBe(path.join(destDir, 'job-webm.webm'))
  })

  it('resolves a relative dir to an absolute path', async () => {
    const srcDir = await makeTempDir()
    const outputPath = await makeOutputFile(srcDir, Buffer.from('relative dir bytes'))
    const manifest = fakeManifest({ jobId: 'job-relative' })

    const cwdParent = await makeTempDir()
    const originalCwd = process.cwd()
    process.chdir(cwdParent)
    try {
      const sink = await getSink('volume', { dir: 'relative-out' })
      const result = await sink.deliver(manifest.jobId, outputPath, manifest)

      // process.chdir()/process.cwd() resolve symlinks (e.g. macOS's /tmp -> /private/tmp),
      // so compare against the realpath of the temp dir rather than its original string form.
      const expectedDir = path.join(await fs.realpath(cwdParent), 'relative-out')
      expect(path.isAbsolute(result.outputLocation)).toBe(true)
      expect(result.outputLocation).toBe(path.join(expectedDir, 'job-relative.mp4'))
      expect(path.isAbsolute(result.manifestLocation!)).toBe(true)
      expect(result.manifestLocation).toBe(path.join(expectedDir, 'job-relative.manifest.json'))
    } finally {
      process.chdir(originalCwd)
    }
  })
})

/** Mocks `fs.rename` so a move that crosses out of its destination's own directory (the
 * video's `outputPath -> temp-in-dir` move) fails with EXDEV, simulating `dir` living on a
 * different filesystem from the job's own scratch dir, while every same-directory rename (a
 * temp name onto its final published name) passes through to the real implementation
 * unaffected -- exactly as it would on a real filesystem. */
function mockCrossDeviceRename(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(fs, 'rename').mockImplementation(async (...args) => {
    const [oldPath, newPath] = args as [string, string]
    if (path.dirname(oldPath) !== path.dirname(newPath)) {
      throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' })
    }
    return fsOriginal.rename(...(args as Parameters<typeof fsOriginal.rename>))
  })
}

describe('volume sink failures', () => {
  it('propagates a rename failure that is not a cross-device link', async () => {
    const destDir = await makeTempDir()
    const srcDir = await makeTempDir()
    const manifest = fakeManifest({ jobId: 'job-gone' })

    const sink = await getSink('volume', { dir: destDir })

    // The render is not where the sink was told it would be: an ENOENT, so there is nothing
    // to copy either, and the failure must surface as it is.
    await expect(
      sink.deliver(manifest.jobId, path.join(srcDir, 'never-written.mp4'), manifest),
    ).rejects.toThrow(/ENOENT/)

    // Rolled back: the manifest published fine before the missing video was ever attempted.
    expect(await fs.readdir(destDir)).toEqual([])
  })

  it('never lets a failed cleanup mask the real publish failure that caused it', async () => {
    const srcDir = await makeTempDir()
    const destDir = await makeTempDir()
    // A directory where the sink expects a file: createReadStream on it fails with EISDIR
    // once the stream copy actually starts reading -- a genuine failure, not a mocked one.
    const outputPath = path.join(srcDir, 'not-actually-a-file')
    await fs.mkdir(outputPath)
    const manifest = fakeManifest({ jobId: 'job-exdev' })

    const renameSpy = mockCrossDeviceRename()
    const rmSpy = vi
      .spyOn(fs, 'rm')
      .mockRejectedValue(Object.assign(new Error('read-only file system'), { code: 'EROFS' }))

    try {
      const sink = await getSink('volume', { dir: destDir })
      // The EISDIR that actually caused the failure, not the EROFS from either of the two
      // (now-futile) cleanup attempts it triggers.
      await expect(sink.deliver(manifest.jobId, outputPath, manifest)).rejects.toThrow(/EISDIR/)
      expect(rmSpy).toHaveBeenCalled()
    } finally {
      renameSpy.mockRestore()
      rmSpy.mockRestore()
    }
  })
})

describe('volume sink cross-device success', () => {
  it('streams the render across the device boundary, never via fs.copyFile, and removes the source', async () => {
    const srcDir = await makeTempDir()
    const destDir = await makeTempDir()
    const outputPath = await makeOutputFile(srcDir, Buffer.from('hello world'))
    const manifest = fakeManifest({ jobId: 'job-exdev-ok' })

    const renameSpy = mockCrossDeviceRename()
    const copySpy = vi.spyOn(fs, 'copyFile')

    try {
      const sink = await getSink('volume', { dir: destDir })
      const result = await sink.deliver(manifest.jobId, outputPath, manifest)

      expect(result.outputLocation).toBe(path.join(destDir, 'job-exdev-ok.mp4'))
      expect(await fs.readFile(result.outputLocation, 'utf8')).toBe('hello world')
      expect(copySpy).not.toHaveBeenCalled()
      // Nothing but the two published files survives -- no stray temp names.
      expect((await fs.readdir(destDir)).sort()).toEqual(
        ['job-exdev-ok.manifest.json', 'job-exdev-ok.mp4'].sort(),
      )
    } finally {
      renameSpy.mockRestore()
      copySpy.mockRestore()
    }

    // A copy that leaves the original behind fills the scratch volume one render at a time.
    await expect(fs.access(outputPath)).rejects.toThrow()
  })
})

// ESCSUITE-190 (hunt-j J-3 / verify V-4): the video was renamed into place before the sidecar
// was written, so a manifest failure left a finished-looking video with nothing beside it; and
// the EXDEV fallback copied straight into the shared destination path, so two concurrent
// deliveries under one jobId could interleave at the byte level. Publication is now sidecar
// first, both files staged at a private, unique temp name inside `dir` and published with one
// same-directory rename each -- which a reader can only ever see as the old file or the new
// one, never a half-written one -- and the `fs.copyFile` fallback is gone outright.
describe('volume sink atomic publication (ESCSUITE-190)', () => {
  it('leaves no <jobId>.<ext> behind when the sidecar fails to publish', async () => {
    const srcDir = await makeTempDir()
    const destDir = await makeTempDir()
    const outputPath = await makeOutputFile(srcDir, Buffer.from('the whole render'))
    const manifest = fakeManifest({ jobId: 'job-1' })
    // Anything that makes the sidecar's own publish fail: here the final name is already a
    // directory, so the rename that would publish it rejects with EISDIR.
    await fs.mkdir(path.join(destDir, 'job-1.manifest.json'))

    const sink = await getSink('volume', { dir: destDir })
    await expect(sink.deliver(manifest.jobId, outputPath, manifest)).rejects.toThrow()

    // The video must never be published while the manifest beside it is not -- a consumer
    // watching the directory must never see a finished-looking render with nothing to verify
    // it against.
    await expect(fs.access(path.join(destDir, 'job-1.mp4'))).rejects.toThrow()
    // No stray temp file left behind either.
    const leftover = (await fs.readdir(destDir)).filter((name) => !name.endsWith('.manifest.json'))
    expect(leftover).toEqual([])
  })

  it('rolls back an already-published sidecar when the video fails to publish', async () => {
    const srcDir = await makeTempDir()
    const destDir = await makeTempDir()
    const outputPath = await makeOutputFile(srcDir, Buffer.from('the whole render'))
    const manifest = fakeManifest({ jobId: 'job-2' })

    // The sidecar publishes fine; only the *video*'s own final rename fails (its name is
    // already a directory).
    const renameSpy = vi.spyOn(fs, 'rename').mockImplementation(async (...args) => {
      const [, newPath] = args as [unknown, string]
      if (newPath === path.join(destDir, 'job-2.mp4')) {
        throw Object.assign(new Error('is a directory'), { code: 'EISDIR' })
      }
      return fsOriginal.rename(...(args as Parameters<typeof fsOriginal.rename>))
    })

    try {
      const sink = await getSink('volume', { dir: destDir })
      await expect(sink.deliver(manifest.jobId, outputPath, manifest)).rejects.toThrow(/is a directory/)
    } finally {
      renameSpy.mockRestore()
    }

    // The manifest that landed before the video failed must not be left signing a render
    // that was never actually delivered.
    await expect(fs.access(path.join(destDir, 'job-2.manifest.json'))).rejects.toThrow()
  })

  it('never calls fs.copyFile, and delivers exactly one job whole rather than a blend, when two deliveries race under one jobId across a filesystem boundary', async () => {
    const destDir = await makeTempDir()
    const srcDirA = await makeTempDir()
    const srcDirB = await makeTempDir()

    const bytesA = 'A'.repeat(64 * 1024)
    const bytesB = 'B'.repeat(96 * 1024)
    const outputPathA = await makeOutputFile(srcDirA, Buffer.from(bytesA), 'render-a.mp4')
    const outputPathB = await makeOutputFile(srcDirB, Buffer.from(bytesB), 'render-b.mp4')
    const manifestA = fakeManifest({ jobId: 'job-race', sha256: sha256Of(bytesA) })
    const manifestB = fakeManifest({ jobId: 'job-race', sha256: sha256Of(bytesB) })

    // Simulates `dir` living on a different filesystem from each job's own scratch dir: the
    // move of the render *into* dir hits EXDEV; a rename that stays entirely inside `dir`
    // (the private temp name to its final published name) is unaffected and passes through.
    const renameSpy = mockCrossDeviceRename()
    const copySpy = vi.spyOn(fs, 'copyFile')

    try {
      const sinkA = await getSink('volume', { dir: destDir })
      const sinkB = await getSink('volume', { dir: destDir })
      const results = await Promise.all([
        sinkA.deliver('job-race', outputPathA, manifestA),
        sinkB.deliver('job-race', outputPathB, manifestB),
      ])

      expect(new Set(results.map((r) => r.outputLocation)).size).toBe(1)
      expect(copySpy).not.toHaveBeenCalled()

      const delivered = await fs.readFile(path.join(destDir, 'job-race.mp4'), 'utf8')
      const deliveredManifest = JSON.parse(
        await fs.readFile(path.join(destDir, 'job-race.manifest.json'), 'utf8'),
      ) as VerificationManifest
      const deliveredSha = sha256Of(delivered)

      // Each job wrote to its own private temp name while EXDEV forced a stream copy, so the
      // slow part never shared a destination path -- the only thing that could race is the
      // final same-directory rename, and a rename replaces a name outright. The result must
      // be exactly one job's bytes next to that same job's manifest, never a mix of both.
      expect([bytesA, bytesB]).toContain(delivered)
      expect(deliveredManifest.sha256).toBe(deliveredSha)
      expect([manifestA.sha256, manifestB.sha256]).toContain(deliveredManifest.sha256)
    } finally {
      renameSpy.mockRestore()
      copySpy.mockRestore()
    }
  })
})

describe('command sink', () => {
  it('validates config.command is required', async () => {
    await expect(getSink('command', {})).rejects.toThrow(/command sink requires config\.command \(string\)/)
  })

  it('rejects config.args that is not an array of strings', async () => {
    await expect(getSink('command', { command: 'echo', args: 'one two' })).rejects.toThrow(
      'command sink requires config.args (string[]) when provided',
    )
    await expect(getSink('command', { command: 'echo', args: ['one', 2] })).rejects.toThrow(
      'command sink requires config.args (string[]) when provided',
    )
  })

  it('rejects a non-object config.env', async () => {
    await expect(getSink('command', { command: 'echo', env: ['PORT=1'] })).rejects.toThrow(
      /command sink requires config\.env \(object\) when provided/,
    )
  })

  it('rejects config.env values that are not strings', async () => {
    await expect(getSink('command', { command: 'echo', env: { PORT: 8080 } })).rejects.toThrow(
      'command sink config.env values must be strings',
    )
    await expect(getSink('command', { command: 'echo', env: { FLAG: null } })).rejects.toThrow(
      'command sink config.env values must be strings',
    )
  })

  it('accepts a string-valued config.env', async () => {
    await expect(getSink('command', { command: 'echo', env: { TOKEN: 'abc' } })).resolves.toBeTruthy()
  })

  it('invokes the command with output/manifest paths appended and the env vars set', async () => {
    const srcDir = await makeTempDir()
    const outputPath = await makeOutputFile(srcDir, Buffer.from('command sink bytes'))
    const manifest = fakeManifest({ jobId: 'job-cmd' })
    const markerPath = path.join(srcDir, 'marker.json')

    const script = `
      const fs = require('fs')
      fs.writeFileSync(${JSON.stringify(markerPath)}, JSON.stringify({
        argv: process.argv.slice(1),
        HEADLESS_OUTPUT_PATH: process.env.HEADLESS_OUTPUT_PATH,
        HEADLESS_MANIFEST_PATH: process.env.HEADLESS_MANIFEST_PATH,
      }))
    `

    const sink = await getSink('command', {
      command: process.execPath,
      args: ['-e', script],
    })

    const result = await sink.deliver(manifest.jobId, outputPath, manifest)

    const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'))
    const expectedManifestPath = path.join(path.dirname(outputPath), `${manifest.jobId}.manifest.json`)

    // node -e "<script>" consumes "-e" and the script itself; only trailing args remain.
    expect(marker.argv).toEqual([outputPath, expectedManifestPath])
    expect(marker.HEADLESS_OUTPUT_PATH).toBe(outputPath)
    expect(marker.HEADLESS_MANIFEST_PATH).toBe(expectedManifestPath)

    expect(result.outputLocation).toBe(`command:${process.execPath}`)
    // The sidecar is scratch handed to the command, not a durable location the caller can
    // report — the runner deletes it with the rest of the job's work dir.
    expect(result.manifestLocation).toBeUndefined()

    // manifest sidecar must actually exist before the command runs
    const writtenManifest = JSON.parse(await fs.readFile(expectedManifestPath, 'utf8'))
    expect(writtenManifest.jobId).toBe('job-cmd')
  })

  it('succeeds even when the command writes megabytes to stdout', async () => {
    const srcDir = await makeTempDir()
    const outputPath = await makeOutputFile(srcDir, Buffer.from('chatty bytes'))
    const manifest = fakeManifest({ jobId: 'job-chatty' })

    // A delivery script that logs a lot: execFile's 1 MiB maxBuffer used to kill it *after*
    // it had already delivered, reporting a failed job.
    const script = `
      const chunk = 'x'.repeat(64 * 1024)
      for (let i = 0; i < 48; i++) process.stdout.write(chunk)
    `

    const sink = await getSink('command', { command: process.execPath, args: ['-e', script] })

    await expect(sink.deliver(manifest.jobId, outputPath, manifest)).resolves.toEqual({
      outputLocation: `command:${process.execPath}`,
    })
  })

  it('throws a clear error when the command does not exist', async () => {
    const srcDir = await makeTempDir()
    const outputPath = await makeOutputFile(srcDir, Buffer.from('bytes'))
    const manifest = fakeManifest({ jobId: 'job-missing' })
    const missing = path.join(srcDir, 'no-such-delivery-command')

    const sink = await getSink('command', { command: missing })

    await expect(sink.deliver(manifest.jobId, outputPath, manifest)).rejects.toThrow(
      `command sink "${missing}" could not be run: command not found`,
    )
  })

  it('names the signal when the command is killed rather than exiting', async () => {
    const srcDir = await makeTempDir()
    const outputPath = await makeOutputFile(srcDir, Buffer.from('killed bytes'))
    const manifest = fakeManifest({ jobId: 'job-killed' })

    const sink = await getSink('command', {
      command: process.execPath,
      args: ['-e', 'process.kill(process.pid, "SIGTERM")'],
    })

    // "exited with code null" would be the alternative, which says nothing about what happened.
    await expect(sink.deliver(manifest.jobId, outputPath, manifest)).rejects.toThrow(
      /was killed by SIGTERM/,
    )
  })

  it('reports a spawn failure that is not a missing command', async () => {
    const srcDir = await makeTempDir()
    const outputPath = await makeOutputFile(srcDir, Buffer.from('bytes'))
    const manifest = fakeManifest({ jobId: 'job-noexec' })

    // A delivery script somebody forgot to chmod +x: it exists, so "command not found" would
    // send the operator looking in the wrong place.
    const notExecutable = path.join(srcDir, 'deliver.sh')
    await fs.writeFile(notExecutable, '#!/bin/sh\nexit 0\n', { mode: 0o644 })

    const sink = await getSink('command', { command: notExecutable })

    await expect(sink.deliver(manifest.jobId, outputPath, manifest)).rejects.toThrow(
      /could not be run: (?!command not found).*EACCES/,
    )
  })

  it('throws with the exit code and stderr tail when the command fails', async () => {
    const srcDir = await makeTempDir()
    const outputPath = await makeOutputFile(srcDir, Buffer.from('fail bytes'))
    const manifest = fakeManifest({ jobId: 'job-fail' })

    const script = `
      process.stderr.write('boom line 1\\n')
      process.stderr.write('boom line 2\\n')
      process.exit(7)
    `

    const sink = await getSink('command', {
      command: process.execPath,
      args: ['-e', script],
    })

    await expect(sink.deliver(manifest.jobId, outputPath, manifest)).rejects.toThrow(
      new RegExp(`command sink "${process.execPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" exited with code 7`),
    )
  })
})

// ESCSUITE-189 (hunt J-2): the command sink waited on `child.on('close')` with no timeout of
// its own, so a delivery command that never exits held the worker slot forever — HEADLESS_TIMEOUT_MS
// bounds only the render phase. It now gets the same kind of delivery budget the webhook sink
// has, validated the same way and defaulted to five minutes.
describe('command sink delivery timeout', () => {
  it('validates config.timeoutMs is a positive integer when provided', async () => {
    await expect(getSink('command', { command: 'echo', timeoutMs: 0 })).rejects.toThrow(
      /command sink requires config\.timeoutMs \(positive integer\) when provided/,
    )
    await expect(getSink('command', { command: 'echo', timeoutMs: 1.5 })).rejects.toThrow(
      /command sink requires config\.timeoutMs \(positive integer\) when provided/,
    )
    await expect(getSink('command', { command: 'echo', timeoutMs: '10' })).rejects.toThrow(
      /command sink requires config\.timeoutMs \(positive integer\) when provided/,
    )
  })

  it('refuses a timeoutMs above the 32-bit timer bound, naming it', async () => {
    await expect(getSink('command', { command: 'echo', timeoutMs: MAX_TIMEOUT_MS + 1 })).rejects.toThrow(
      `command sink requires config.timeoutMs (positive integer, at most ${MAX_TIMEOUT_MS}) when provided`,
    )
  })

  it('accepts exactly the bound', async () => {
    await expect(getSink('command', { command: 'echo', timeoutMs: MAX_TIMEOUT_MS })).resolves.toBeTruthy()
  })

  it('kills a delivery command that outlives its budget and rejects with the timeout message', async () => {
    const srcDir = await makeTempDir()
    const outputPath = await makeOutputFile(srcDir, Buffer.from('bytes'))
    const manifest = fakeManifest({ jobId: 'job-cmd-timeout' })

    const sink = await getSink('command', {
      command: '/bin/sh',
      args: ['-c', 'sleep 4'],
      timeoutMs: 200,
    })

    const startedAt = Date.now()
    await expect(sink.deliver(manifest.jobId, outputPath, manifest)).rejects.toThrow(
      'command sink timed out after 200 ms',
    )
    // Settling at all, well short of the 4 s sleep, is itself proof the child was killed rather
    // than merely abandoned. The bound is the design's own: SIGTERM at the budget, SIGKILL
    // COMMAND_KILL_GRACE_MS later, and the rejection no later than that second timer — a loaded
    // CI runner has been seen taking the full escalation (2206 ms) where a quiet machine settles
    // on `close` at ~250 ms, so the assertion allows the escalation plus a second of slack.
    expect(Date.now() - startedAt).toBeLessThan(200 + 2000 + 1000)
  }, 10_000)

  it('does not time out a command that finishes well inside its budget', async () => {
    const srcDir = await makeTempDir()
    const outputPath = await makeOutputFile(srcDir, Buffer.from('bytes'))
    const manifest = fakeManifest({ jobId: 'job-cmd-fast' })

    const sink = await getSink('command', {
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      timeoutMs: 5000,
    })

    await expect(sink.deliver(manifest.jobId, outputPath, manifest)).resolves.toEqual({
      outputLocation: `command:${process.execPath}`,
    })
  })

  it('escalates to SIGKILL when the child ignores SIGTERM', async () => {
    const srcDir = await makeTempDir()
    const outputPath = await makeOutputFile(srcDir, Buffer.from('bytes'))
    const manifest = fakeManifest({ jobId: 'job-cmd-stubborn' })
    const pidFile = path.join(srcDir, 'pid')

    // A generous timeoutMs (well past the freshly-spawned process's own startup) so the
    // SIGTERM handler is registered before the signal arrives — otherwise the child dies to
    // the ordinary default action instead of ever getting the chance to ignore it. Review
    // finding 7: 500 ms still lost that race on a loaded runner often enough to flake.
    const timeoutMs = 2000
    const script = `
      require('fs').writeFileSync(process.env.PID_FILE, String(process.pid))
      process.on('SIGTERM', () => {})
      setInterval(() => {}, 1000)
    `
    const sink = await getSink('command', {
      command: process.execPath,
      args: ['-e', script],
      env: { PID_FILE: pidFile },
      timeoutMs,
    })

    let pid: number | undefined
    try {
      const startedAt = Date.now()
      await expect(sink.deliver(manifest.jobId, outputPath, manifest)).rejects.toThrow(
        `command sink timed out after ${timeoutMs} ms`,
      )
      // The rejection now fires from the escalation timer itself, right after the SIGKILL call
      // — so settling proves only that the *timer* fired, not that the signal landed. Read the
      // pid the child wrote at startup and wait for it to actually be gone (re-review N2).
      const elapsed = Date.now() - startedAt
      expect(elapsed).toBeGreaterThanOrEqual(timeoutMs + 1800)
      expect(elapsed).toBeLessThan(timeoutMs + 5000)

      pid = await readPidFile(pidFile)
      await waitFor(() => expect(isAlive(pid as number)).toBe(false))
    } finally {
      // A survivor would otherwise run setInterval forever; this is the net under the pin
      // above, not a substitute for it.
      if (pid !== undefined && isAlive(pid)) process.kill(pid, 'SIGKILL')
    }
  }, 10_000)

  // Review finding 1: the budget rejected only from child.on('close'), which waits for the
  // stdio pipes rather than the child itself. A child that exits while leaving a backgrounded
  // grandchild holding the inherited stderr pipe open never emits 'close' until the grandchild
  // also exits, so the timers were killing a process that was already gone and deliver() never
  // settled.
  it('settles even when the direct child leaves a grandchild holding stderr open', async () => {
    const srcDir = await makeTempDir()
    const outputPath = await makeOutputFile(srcDir, Buffer.from('bytes'))
    const manifest = fakeManifest({ jobId: 'job-cmd-grandchild' })
    const pidFile = path.join(srcDir, 'grandchild-pid')

    const sink = await getSink('command', {
      command: '/bin/sh',
      // The direct child backgrounds a grandchild that inherits its stderr pipe, writes the
      // grandchild's own pid (not the direct child's) via $! so the test can reap it, then
      // exits itself — 'close' on the direct child cannot fire until the grandchild also
      // exits, 6 seconds from now. The 6 s is load-bearing for red-first (re-review: it must
      // clear timeoutMs + the kill grace period by a wide margin, or the pre-fix code would
      // settle on 'close' inside the assertion window and this case would pass on the bug) and
      // is kept as-is; only the grandchild's own lingering is cleaned up, in the finally below.
      args: ['-c', 'sh -c "sleep 6" & echo $! > "$PID_FILE"; exit 0'],
      env: { PID_FILE: pidFile },
      timeoutMs: 300,
    })

    let pid: number | undefined
    try {
      const startedAt = Date.now()
      await expect(sink.deliver(manifest.jobId, outputPath, manifest)).rejects.toThrow(
        'command sink timed out after 300 ms',
      )
      // The bound is timeoutMs + COMMAND_KILL_GRACE_MS (2 s), regardless of whether 'close' ever
      // fires — well short of the 6 s grandchild sleep.
      expect(Date.now() - startedAt).toBeLessThan(2500)

      pid = await readPidFile(pidFile)
    } finally {
      if (pid !== undefined && isAlive(pid)) process.kill(pid, 'SIGKILL')
    }
  }, 10_000)
})

describe('webhook sink', () => {
  it('validates config.url is required', async () => {
    await expect(getSink('webhook', {})).rejects.toThrow(/webhook sink requires config\.url \(string\)/)
  })

  it('rejects config.headers that is not an object', async () => {
    await expect(getSink('webhook', { url: 'http://x/', headers: ['authorization: x'] })).rejects.toThrow(
      'webhook sink requires config.headers (object) when provided',
    )
    await expect(getSink('webhook', { url: 'http://x/', headers: 'authorization: x' })).rejects.toThrow(
      'webhook sink requires config.headers (object) when provided',
    )
  })

  it('posts a multipart body containing the manifest JSON and file bytes', async () => {
    const srcDir = await makeTempDir()
    const fileBytes = Buffer.from('webhook file contents')
    const outputPath = await makeOutputFile(srcDir, fileBytes)
    const manifest = fakeManifest({ jobId: 'job-hook' })

    let receivedBody = Buffer.alloc(0)
    let receivedContentType = ''
    const server = http.createServer((req, res) => {
      receivedContentType = req.headers['content-type'] ?? ''
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        receivedBody = Buffer.concat(chunks)
        res.writeHead(200)
        res.end('ok')
      })
    })
    cleanupServers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const port = (server.address() as AddressInfo).port
    const url = `http://127.0.0.1:${port}/upload`

    const sink = await getSink('webhook', { url })
    const result = await sink.deliver(manifest.jobId, outputPath, manifest)

    expect(result.outputLocation).toBe(url)
    expect(receivedContentType).toMatch(/multipart\/form-data/)
    expect(receivedBody.includes(Buffer.from('"jobId":"job-hook"'))).toBe(true)
    expect(receivedBody.includes(fileBytes)).toBe(true)
  })

  it('ignores a caller-supplied Content-Type so the multipart boundary survives', async () => {
    const srcDir = await makeTempDir()
    const outputPath = await makeOutputFile(srcDir, Buffer.from('boundary bytes'))
    const manifest = fakeManifest({ jobId: 'job-ct' })

    let receivedContentType = ''
    let receivedAuth = ''
    const server = http.createServer((req, res) => {
      receivedContentType = req.headers['content-type'] ?? ''
      receivedAuth = (req.headers['authorization'] as string) ?? ''
      req.on('data', () => {})
      req.on('end', () => {
        res.writeHead(200)
        res.end('ok')
      })
    })
    cleanupServers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const port = (server.address() as AddressInfo).port

    const sink = await getSink('webhook', {
      url: `http://127.0.0.1:${port}/upload`,
      headers: { 'content-type': 'application/json', Authorization: 'Bearer t' },
    })
    await sink.deliver(manifest.jobId, outputPath, manifest)

    expect(receivedContentType).toMatch(/^multipart\/form-data; boundary=/)
    // Every other header still goes through.
    expect(receivedAuth).toBe('Bearer t')
  })

  it('validates config.timeoutMs is a positive integer when provided', async () => {
    await expect(getSink('webhook', { url: 'http://x/', timeoutMs: 0 })).rejects.toThrow(
      /webhook sink requires config\.timeoutMs \(positive integer\) when provided/,
    )
    await expect(getSink('webhook', { url: 'http://x/', timeoutMs: 1.5 })).rejects.toThrow(
      /webhook sink requires config\.timeoutMs \(positive integer\) when provided/,
    )
    await expect(getSink('webhook', { url: 'http://x/', timeoutMs: '10' })).rejects.toThrow(
      /webhook sink requires config\.timeoutMs \(positive integer\) when provided/,
    )
  })

  // ESCSUITE-188 (hunt J-1): timeoutMs had no upper bound, so a value past what setTimeout can
  // represent overflowed to a ~1 ms timeout (aborting the delivery instantly) or, past 2^32-1,
  // threw ERR_OUT_OF_RANGE from inside deliver. Both must now be refused at validation time,
  // before any request is sent.
  describe('config.timeoutMs upper bound', () => {
    it('refuses a timeoutMs above 2^31-1, naming the bound, rather than overflowing to ~1 ms', async () => {
      await expect(getSink('webhook', { url: 'http://127.0.0.1:1/x', timeoutMs: 2_147_483_648 })).rejects.toThrow(
        `webhook sink requires config.timeoutMs (positive integer, at most ${MAX_TIMEOUT_MS}) when provided`,
      )
    })

    it('refuses a timeoutMs above 2^32-1 the same way, rather than throwing ERR_OUT_OF_RANGE from inside deliver', async () => {
      await expect(getSink('webhook', { url: 'http://127.0.0.1:1/x', timeoutMs: 2 ** 40 })).rejects.toThrow(
        `webhook sink requires config.timeoutMs (positive integer, at most ${MAX_TIMEOUT_MS}) when provided`,
      )
    })

    it('accepts exactly the bound, 2^31-1', async () => {
      const sink = await getSink('webhook', { url: 'http://127.0.0.1:1/x', timeoutMs: MAX_TIMEOUT_MS })
      expect(sink).toBeDefined()
    })

    it('refuses one past the bound', async () => {
      await expect(
        getSink('webhook', { url: 'http://127.0.0.1:1/x', timeoutMs: MAX_TIMEOUT_MS + 1 }),
      ).rejects.toThrow(
        `webhook sink requires config.timeoutMs (positive integer, at most ${MAX_TIMEOUT_MS}) when provided`,
      )
    })
  })

  it('gives up on a server that accepts the request and never responds', async () => {
    const srcDir = await makeTempDir()
    const outputPath = await makeOutputFile(srcDir, Buffer.from('hanging bytes'))
    const manifest = fakeManifest({ jobId: 'job-hang' })

    const server = http.createServer((req) => {
      // Read the body and then simply never reply.
      req.on('data', () => {})
    })
    cleanupServers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const port = (server.address() as AddressInfo).port

    const sink = await getSink('webhook', { url: `http://127.0.0.1:${port}/upload`, timeoutMs: 250 })
    await expect(sink.deliver(manifest.jobId, outputPath, manifest)).rejects.toThrow(
      'webhook sink timed out after 250 ms',
    )
  })

  it('throws when the webhook responds with a non-2xx status', async () => {
    const srcDir = await makeTempDir()
    const outputPath = await makeOutputFile(srcDir, Buffer.from('bytes'))
    const manifest = fakeManifest()

    const server = http.createServer((req, res) => {
      req.on('data', () => {})
      req.on('end', () => {
        res.writeHead(500, 'Internal Server Error')
        res.end('nope')
      })
    })
    cleanupServers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const port = (server.address() as AddressInfo).port
    const url = `http://127.0.0.1:${port}/upload`

    const sink = await getSink('webhook', { url })
    await expect(sink.deliver(manifest.jobId, outputPath, manifest)).rejects.toThrow(
      /webhook sink failed: 500/,
    )
  })
})

// ESCSUITE-205 (hunt-j unverified / verify V-1): the response was checked for `ok` and
// dropped without ever being read or cancelled, so undici could not return the connection to
// its keep-alive pool -- every delivery opened a fresh TCP connection to the intake endpoint
// instead of reusing one.
describe('webhook sink drains the response body (ESCSUITE-205)', () => {
  it('reuses the keep-alive connection across deliveries instead of opening one per delivery', async () => {
    const srcDir = await makeTempDir()
    const outputPath = await makeOutputFile(srcDir, Buffer.from('bytes'))
    const manifest = fakeManifest()

    // A large keep-alive body: big enough that undici cannot have it buffered and done with,
    // so an unread body is what blocks the connection from going back to the pool.
    const body = 'x'.repeat(256 * 1024)
    let connections = 0
    const server = http.createServer((req, res) => {
      req.on('data', () => {})
      req.on('end', () => {
        res.writeHead(200, {
          'content-type': 'text/plain',
          'content-length': String(body.length),
          connection: 'keep-alive',
        })
        res.end(body)
      })
    })
    server.keepAliveTimeout = 30_000
    server.on('connection', () => {
      connections++
    })
    cleanupServers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const port = (server.address() as AddressInfo).port
    const url = `http://127.0.0.1:${port}/upload`

    const sink = await getSink('webhook', { url })
    const N = 8
    for (let i = 0; i < N; i++) {
      await sink.deliver(`job-${i}`, outputPath, manifest)
    }

    // A sink that reads or cancels the body reuses undici's pooled connection; the defect was
    // one socket per delivery.
    expect(connections).toBeLessThan(4)
  }, 30_000)

  it('drains the body on a failure response too', async () => {
    const srcDir = await makeTempDir()
    const outputPath = await makeOutputFile(srcDir, Buffer.from('bytes'))
    const manifest = fakeManifest()

    const body = 'x'.repeat(256 * 1024)
    let connections = 0
    const server = http.createServer((req, res) => {
      req.on('data', () => {})
      req.on('end', () => {
        res.writeHead(500, { 'content-length': String(body.length), connection: 'keep-alive' })
        res.end(body)
      })
    })
    server.keepAliveTimeout = 30_000
    server.on('connection', () => {
      connections++
    })
    cleanupServers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const port = (server.address() as AddressInfo).port
    const url = `http://127.0.0.1:${port}/upload`

    const sink = await getSink('webhook', { url })
    for (let i = 0; i < 4; i++) {
      await expect(sink.deliver(`job-${i}`, outputPath, manifest)).rejects.toThrow(/webhook sink failed: 500/)
    }

    expect(connections).toBeLessThan(4)
  }, 30_000)
})

// ESCSUITE-205 (hunt-j unverified / verify V-2): `fetch` followed a redirect by default, so a
// 307/308 from the configured intake endpoint re-POSTed the whole render and the caller's own
// headers to a host the operator never named.
describe('webhook sink refuses a redirect (ESCSUITE-205)', () => {
  it('fails the delivery naming the Location, and the render never reaches the redirect target', async () => {
    const srcDir = await makeTempDir()
    const outputPath = await makeOutputFile(srcDir, Buffer.from('THE-WHOLE-RENDER-BYTES'))
    const manifest = fakeManifest({ jobId: 'job-redirect' })

    let targetHits = 0
    const target = http.createServer((req, res) => {
      targetHits++
      req.on('data', () => {})
      req.on('end', () => {
        res.writeHead(200)
        res.end('ok')
      })
    })
    cleanupServers.push(target)
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', () => resolve()))
    const targetPort = (target.address() as AddressInfo).port
    const targetUrl = `http://127.0.0.1:${targetPort}/stolen`

    let redirectHits = 0
    const intake = http.createServer((req, res) => {
      redirectHits++
      req.on('data', () => {})
      req.on('end', () => {
        res.writeHead(307, { location: targetUrl })
        res.end()
      })
    })
    cleanupServers.push(intake)
    await new Promise<void>((resolve) => intake.listen(0, '127.0.0.1', () => resolve()))
    const intakePort = (intake.address() as AddressInfo).port

    const sink = await getSink('webhook', { url: `http://127.0.0.1:${intakePort}/intake` })
    await expect(sink.deliver(manifest.jobId, outputPath, manifest)).rejects.toThrow(
      new RegExp(`refused to follow a redirect.*${targetUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    )

    expect(redirectHits).toBe(1)
    // The render never reached the host the operator never configured.
    expect(targetHits).toBe(0)
  })
})

describe('webhook sink transport failures', () => {
  /** A port nothing is listening on: bind one, read it back, then give it up. */
  async function closedPort(): Promise<number> {
    const server = http.createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const port = (server.address() as AddressInfo).port
    await new Promise((resolve) => server.close(resolve))
    return port
  }

  it('surfaces a connection failure as itself, not as a timeout', async () => {
    const srcDir = await makeTempDir()
    const outputPath = await makeOutputFile(srcDir, Buffer.from('bytes'))
    const manifest = fakeManifest({ jobId: 'job-refused' })
    const port = await closedPort()

    const sink = await getSink('webhook', { url: `http://127.0.0.1:${port}/upload`, timeoutMs: 30_000 })

    // The whole point: a refused connection reports itself in seconds. Calling it a timeout
    // would tell an operator to look at a slow receiver that is not even running.
    await expect(sink.deliver(manifest.jobId, outputPath, manifest)).rejects.toThrow(
      /fetch failed|ECONNREFUSED/,
    )
    await expect(sink.deliver(manifest.jobId, outputPath, manifest)).rejects.not.toThrow(/timed out/)
  })
})
