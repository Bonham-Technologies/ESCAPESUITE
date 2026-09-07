import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadManifest } from './loaders'
import type { LoadedJob } from './loaders'
import { renderInChromium } from './renderDriver'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SERVICE_ROOT = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(SERVICE_ROOT, '../..')
const BUNDLE = path.join(REPO_ROOT, 'apps/artist/dist-headless/headless.html')
const MANIFEST = path.join(SERVICE_ROOT, 'test/fixtures/manifest/manifest.json')

/** Long enough for a Chromium launch plus a real (tiny) encode on a cold machine. */
const RENDER_TIMEOUT_MS = 180_000

/** Silences the driver's own progress/launch chatter; the assertions cover behaviour, not logs. */
const quiet = () => {}

let job: LoadedJob
let outDir: string

// The headless bundle is built once for the whole chromium suite by test/globalSetup.ts.
beforeAll(async () => {
  job = await loadManifest(MANIFEST)
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'headless-driver-test-'))
})

afterAll(async () => {
  await job?.cleanup()
  if (outDir) await fs.rm(outDir, { recursive: true, force: true })
})

describe('renderInChromium', () => {
  it('renders the manifest fixture to a real MP4', async () => {
    const outputPath = path.join(outDir, 'out.mp4')
    const progress: number[] = []

    const result = await renderInChromium(
      BUNDLE,
      job,
      { format: 'mp4', quality: 'medium' },
      outputPath,
      { onProgress: (p) => progress.push(p), log: quiet },
    )

    const bytes = await fs.readFile(outputPath)
    // Every ISO-BMFF file starts with an ftyp box within its first 12 bytes.
    expect(bytes.subarray(0, 12).toString('latin1')).toContain('ftyp')
    expect(bytes.byteLength).toBeGreaterThan(0)
    expect(result.outputPath).toBe(outputPath)
    expect(result.meta.format).toBe('mp4')
    expect(result.meta.width).toBe(64)
    expect(result.meta.height).toBe(48)
    expect(result.meta.gpu).toBe(false)
    expect(progress.length).toBeGreaterThanOrEqual(1)
    expect(result.chromiumVersion.length).toBeGreaterThan(0)
  }, RENDER_TIMEOUT_MS)

  it('renders the manifest fixture to a real WebM', async () => {
    const outputPath = path.join(outDir, 'out.webm')

    const result = await renderInChromium(
      BUNDLE,
      job,
      { format: 'webm', quality: 'medium' },
      outputPath,
      { log: quiet },
    )

    const bytes = await fs.readFile(outputPath)
    // EBML magic — the first four bytes of every Matroska/WebM file.
    expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3])
    expect(result.meta.format).toBe('webm')
  }, RENDER_TIMEOUT_MS)

  it('rejects when a clip references a source the page never received', async () => {
    const broken: LoadedJob = { ...job, sourceVideos: [], sourceFiles: {} }

    await expect(
      renderInChromium(BUNDLE, broken, { format: 'mp4', quality: 'medium' }, path.join(outDir, 'never.mp4'), {
        log: quiet,
      }),
    ).rejects.toThrow(/references unknown source "src-0"/)
  }, RENDER_TIMEOUT_MS)

  it('rejects when the bundle is missing, before launching Chromium', async () => {
    const missing = path.join(outDir, 'no-such-bundle.html')

    await expect(
      renderInChromium(missing, job, { format: 'mp4', quality: 'medium' }, path.join(outDir, 'never.mp4'), {
        log: quiet,
      }),
    ).rejects.toThrow(`headless bundle not found at ${missing}`)
  })

  it('times out and closes the browser rather than hanging', async () => {
    const startedAt = Date.now()

    await expect(
      renderInChromium(BUNDLE, job, { format: 'mp4', quality: 'medium' }, path.join(outDir, 'never.mp4'), {
        timeoutMs: 1,
        log: quiet,
      }),
    ).rejects.toThrow('render timed out after 1 ms')

    // A hung browser would keep this pending for the whole render; it settles as soon as it closes.
    expect(Date.now() - startedAt).toBeLessThan(15_000)
  }, 60_000)
})
