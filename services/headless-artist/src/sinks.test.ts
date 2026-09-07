import { describe, it, expect, afterEach } from 'vitest'
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

describe('command sink', () => {
  it('validates config.command is required', async () => {
    await expect(getSink('command', {})).rejects.toThrow(/command sink requires config\.command \(string\)/)
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
    expect(result.manifestLocation).toBe(expectedManifestPath)

    // manifest sidecar must actually exist before the command runs
    const writtenManifest = JSON.parse(await fs.readFile(expectedManifestPath, 'utf8'))
    expect(writtenManifest.jobId).toBe('job-cmd')
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
