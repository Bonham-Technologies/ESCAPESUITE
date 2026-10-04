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

// ESCSUITE-206 (hunt-j verify V-3a): `createDeadline(timeoutMs)` was built, but
// `await chromium.launch(...)` was not inside the `Promise.race` and had no `timeout` of its
// own, so the launch phase was bounded only by Playwright's own default (measured 180 000 ms
// on Playwright 1.63.0) rather than by `timeoutMs`. A Chromium binary that never prints its
// DevTools line used to hold the call — and, on `serve`, the only worker — for three minutes
// on a budget as small as 3 s, failing with Playwright's own `Timeout … exceeded` rather than
// the driver's `render timed out after <n> ms`.
describe('renderInChromium launch deadline', () => {
  it('is bounded by timeoutMs, not by Playwright default launch timeout', async () => {
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'headless-artist-launch-deadline-'))
    try {
      const hangs = path.join(scratch, 'hangs.sh')
      await fs.writeFile(hangs, '#!/bin/sh\nexec sleep 600\n', { mode: 0o755 })
      const outputPath = path.join(scratch, 'never.mp4')
      const timeoutMs = 2000

      const startedAt = Date.now()
      let message = ''
      try {
        await renderInChromium(BUNDLE, job, { format: 'mp4', quality: 'medium' }, outputPath, {
          chromiumPath: hangs,
          timeoutMs,
          log: quiet,
        })
        throw new Error('expected the launch to fail')
      } catch (err) {
        message = err instanceof Error ? err.message : String(err)
      }
      const elapsed = Date.now() - startedAt

      // Bounded by the render budget, not by Playwright's own (measured 180 000 ms) launch
      // default; kept well under 5 s so this stays a fast test rather than a repeat of V-3a's
      // own 180 s reproduction. `timeout: timeoutMs` (passed to chromium.launch) and the race
      // against deadline.promise both fire at the same configured budget, so either message
      // -- the driver's own "render timed out after 2000 ms" or Playwright's own
      // "Timeout 2000ms exceeded" -- proves the fix; only the OLD unbounded default would fail
      // this assertion.
      expect(elapsed).toBeLessThan(5000)
      expect(message).toMatch(new RegExp(`${timeoutMs}\\s*ms`))
      expect(message).not.toMatch(/180000\s*ms/)
    } finally {
      await fs.rm(scratch, { recursive: true, force: true })
    }
  }, 15_000)
})
