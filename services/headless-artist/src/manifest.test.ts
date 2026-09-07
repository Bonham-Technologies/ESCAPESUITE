import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { buildManifest } from './manifest'
import type { RenderMeta } from './types'

const cleanupPaths: string[] = []

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const p = cleanupPaths.pop()
    if (p) await fs.rm(p, { recursive: true, force: true })
  }
})

async function makeFile(bytes: Buffer): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'headless-artist-manifest-test-'))
  cleanupPaths.push(dir)
  const filePath = path.join(dir, 'output.mp4')
  await fs.writeFile(filePath, bytes)
  return filePath
}

const versions = { chromiumVersion: '120.0.0', engineVersion: '1.2.3', kitVersion: '4.5.6' }

const baseMeta: RenderMeta = {
  format: 'mp4',
  byteLength: 0, // deliberately wrong -- buildManifest must override from disk
  durationSec: 12.5,
  width: 1920,
  height: 1080,
  gpu: true,
}

describe('buildManifest', () => {
  it('computes sha256 of a known byte sequence via streaming', async () => {
    const filePath = await makeFile(Buffer.from('hello world'))
    const manifest = await buildManifest('job-1', filePath, baseMeta, versions)
    // sha256("hello world")
    expect(manifest.sha256).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')
  })

  it('takes byteLength from disk, overriding meta.byteLength', async () => {
    const bytes = Buffer.from('x'.repeat(1234))
    const filePath = await makeFile(bytes)
    const manifest = await buildManifest('job-2', filePath, baseMeta, versions)
    expect(manifest.byteLength).toBe(1234)
  })

  it('passes through meta fields, versions, jobId, and an ISO createdAt', async () => {
    const filePath = await makeFile(Buffer.from('abc'))
    const now = new Date('2026-01-02T03:04:05.000Z')
    const manifest = await buildManifest('job-3', filePath, baseMeta, versions, now)

    expect(manifest.jobId).toBe('job-3')
    expect(manifest.format).toBe('mp4')
    expect(manifest.durationSec).toBe(12.5)
    expect(manifest.width).toBe(1920)
    expect(manifest.height).toBe(1080)
    expect(manifest.gpu).toBe(true)
    expect(manifest.chromiumVersion).toBe('120.0.0')
    expect(manifest.engineVersion).toBe('1.2.3')
    expect(manifest.kitVersion).toBe('4.5.6')
    expect(manifest.createdAt).toBe('2026-01-02T03:04:05.000Z')
  })

  it('defaults createdAt to the current time when not given', async () => {
    const filePath = await makeFile(Buffer.from('abc'))
    const before = Date.now()
    const manifest = await buildManifest('job-4', filePath, baseMeta, versions)
    const after = Date.now()
    const createdAtMs = new Date(manifest.createdAt).getTime()
    expect(createdAtMs).toBeGreaterThanOrEqual(before)
    expect(createdAtMs).toBeLessThanOrEqual(after)
  })
})
