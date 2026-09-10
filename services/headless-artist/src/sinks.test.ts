import { describe, it, expect, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { getSink } from './sinks'
import type { VerificationManifest } from './manifest'

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

  it('builds one from a bare prefix, leaving region and endpoint to the SDK', async () => {
    const sink = await getSink('s3', { prefix: 'bucket', region: 42, endpoint: null })

    expect(typeof sink.deliver).toBe('function')
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

describe('volume sink cross-device fallback', () => {
  it('removes the partial destination when the copy fails, rather than leaving a truncated file', async () => {
    const srcDir = await makeTempDir()
    const destDir = await makeTempDir()
    const outputPath = await makeOutputFile(srcDir, Buffer.from('hello world'))
    const manifest = fakeManifest({ jobId: 'job-exdev' })
    const destOutput = path.join(destDir, 'job-exdev.mp4')

    const renameSpy = vi
      .spyOn(fs, 'rename')
      .mockRejectedValue(Object.assign(new Error('cross-device link'), { code: 'EXDEV' }))
    const copySpy = vi.spyOn(fs, 'copyFile').mockImplementation(async () => {
      // What a real interrupted copy leaves behind: a destination with only some of the bytes.
      await fs.writeFile(destOutput, Buffer.from('hel'))
      throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
    })

    try {
      const sink = await getSink('volume', { dir: destDir })
      await expect(sink.deliver(manifest.jobId, outputPath, manifest)).rejects.toThrow(
        'no space left on device',
      )
    } finally {
      renameSpy.mockRestore()
      copySpy.mockRestore()
    }

    // A half-written render must never be left where a consumer would pick it up as finished.
    await expect(fs.access(destOutput)).rejects.toThrow()
  })
})

describe('volume sink failures', () => {
  it('propagates a rename failure that is not a cross-device link', async () => {
    const destDir = await makeTempDir()
    const srcDir = await makeTempDir()
    const manifest = fakeManifest({ jobId: 'job-gone' })

    const sink = await getSink('volume', { dir: destDir })

    // The render is not where the sink was told it would be: an ENOENT, not an EXDEV, so
    // there is nothing to fall back to and the failure must surface as it is.
    await expect(
      sink.deliver(manifest.jobId, path.join(srcDir, 'never-written.mp4'), manifest),
    ).rejects.toThrow(/ENOENT/)

    expect(await fs.readdir(destDir)).toEqual([])
  })

  it('never lets a failed cleanup mask the copy failure that caused it', async () => {
    const srcDir = await makeTempDir()
    const destDir = await makeTempDir()
    const outputPath = await makeOutputFile(srcDir, Buffer.from('hello world'))
    const manifest = fakeManifest({ jobId: 'job-exdev' })

    const renameSpy = vi
      .spyOn(fs, 'rename')
      .mockRejectedValue(Object.assign(new Error('cross-device link'), { code: 'EXDEV' }))
    const copySpy = vi
      .spyOn(fs, 'copyFile')
      .mockRejectedValue(Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }))
    const rmSpy = vi
      .spyOn(fs, 'rm')
      .mockRejectedValue(Object.assign(new Error('read-only file system'), { code: 'EROFS' }))

    try {
      const sink = await getSink('volume', { dir: destDir })
      // The ENOSPC, not the EROFS: the operator needs to know why the delivery failed.
      await expect(sink.deliver(manifest.jobId, outputPath, manifest)).rejects.toThrow(
        'no space left on device',
      )
      expect(rmSpy).toHaveBeenCalled()
    } finally {
      renameSpy.mockRestore()
      copySpy.mockRestore()
      rmSpy.mockRestore()
    }
  })
})

describe('volume sink cross-device success', () => {
  it('copies the render across the device boundary and removes the source', async () => {
    const srcDir = await makeTempDir()
    const destDir = await makeTempDir()
    const outputPath = await makeOutputFile(srcDir, Buffer.from('hello world'))
    const manifest = fakeManifest({ jobId: 'job-exdev-ok' })

    const renameSpy = vi
      .spyOn(fs, 'rename')
      .mockRejectedValue(Object.assign(new Error('cross-device link'), { code: 'EXDEV' }))

    try {
      const sink = await getSink('volume', { dir: destDir })
      const result = await sink.deliver(manifest.jobId, outputPath, manifest)

      expect(result.outputLocation).toBe(path.join(destDir, 'job-exdev-ok.mp4'))
      expect(await fs.readFile(result.outputLocation, 'utf8')).toBe('hello world')
    } finally {
      renameSpy.mockRestore()
    }

    // A copy that leaves the original behind fills the scratch volume one render at a time.
    await expect(fs.access(outputPath)).rejects.toThrow()
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
