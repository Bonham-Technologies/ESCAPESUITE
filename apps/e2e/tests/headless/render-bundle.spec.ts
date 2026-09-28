import { test, expect } from '@playwright/test'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ARTIST = resolve(__dirname, '../../../artist')
const FIX = resolve(__dirname, '../../fixtures/headless')

// Both tests share one built bundle. Run them in one worker so beforeAll builds
// once — two workers building into the same dist-headless/ concurrently would race.
test.describe.configure({ mode: 'serial' })

// Build the headless single-file bundle so the file:// loads below resolve.
// CI runs the e2e suite without a separate headless build step, so build here
// (fast: a no-UI Vite single-file build) to keep this spec self-contained.
test.beforeAll(() => {
  execSync('pnpm --filter=@escapesuite/artist run build:headless', { stdio: 'inherit' })
})

test('headless bundle renders a one-clip project to a valid MP4', async ({ page }) => {
  const bundleUrl = 'file://' + resolve(ARTIST, 'dist-headless/headless.html')
  await page.goto(bundleUrl)
  await page.waitForFunction(() => (window as unknown as { __headlessReady?: boolean }).__headlessReady === true)

  const project = JSON.parse(readFileSync(resolve(FIX, 'project.json'), 'utf8'))
  const sourceB64 = readFileSync(resolve(FIX, 'source.mp4')).toString('base64')

  const result = await page.evaluate(async ({ project, sourceB64 }) => {
    const bin = atob(sourceB64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const input = {
      project: project.project,
      sourceVideos: project.sourceVideos,
      sourceBlobs: { 'src-0': bytes.buffer },
      options: { format: 'mp4', quality: 'high' },
    }
    // @ts-expect-error injected global
    return await window.__renderProject(input)
  }, { project, sourceB64 })

  expect(result.meta.format).toBe('mp4')
  expect(result.meta.byteLength).toBeGreaterThan(0)
  expect(result.meta.width).toBe(64)
  // base64 → bytes; MP4 has an 'ftyp' box near the start.
  const out = Buffer.from(result.base64, 'base64')
  expect(out.length).toBeGreaterThan(0)
  expect(out.subarray(0, 12).includes(Buffer.from('ftyp'))).toBe(true)
})

test('headless bundle renders WebM and reports progress', async ({ page }) => {
  const bundleUrl = 'file://' + resolve(ARTIST, 'dist-headless/headless.html')
  await page.goto(bundleUrl)
  await page.waitForFunction(() => (window as unknown as { __headlessReady?: boolean }).__headlessReady === true)

  const project = JSON.parse(readFileSync(resolve(FIX, 'project.json'), 'utf8'))
  const sourceB64 = readFileSync(resolve(FIX, 'source.mp4')).toString('base64')

  const result = await page.evaluate(async ({ project, sourceB64 }) => {
    const bin = atob(sourceB64); const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const progress: number[] = []
    const input = {
      project: project.project, sourceVideos: project.sourceVideos,
      sourceBlobs: { 'src-0': bytes.buffer }, options: { format: 'webm', quality: 'high' },
    }
    // @ts-expect-error injected global
    const r = await window.__renderProject(input, (p: number) => progress.push(p))
    return { meta: r.meta, progressCount: progress.length, base64Len: r.base64.length }
  }, { project, sourceB64 })

  expect(result.meta.format).toBe('webm')
  expect(result.base64Len).toBeGreaterThan(0)
  expect(result.progressCount).toBeGreaterThan(0)
})

test('headless bundle renders above 1080p (H.264 Level 5.1 fallback)', async ({ page }) => {
  const bundleUrl = 'file://' + resolve(ARTIST, 'dist-headless/headless.html')
  await page.goto(bundleUrl)
  await page.waitForFunction(() => (window as unknown as { __headlessReady?: boolean }).__headlessReady === true)

  const project = JSON.parse(readFileSync(resolve(FIX, 'project.json'), 'utf8'))
  project.project.resolution = { width: 2560, height: 1440 }
  const sourceB64 = readFileSync(resolve(FIX, 'source.mp4')).toString('base64')

  const result = await page.evaluate(async ({ project, sourceB64 }) => {
    const bin = atob(sourceB64); const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const input = {
      project: project.project, sourceVideos: project.sourceVideos,
      sourceBlobs: { 'src-0': bytes.buffer }, options: { format: 'mp4', quality: 'medium' },
    }
    // @ts-expect-error injected global
    const r = await window.__renderProject(input)
    return { meta: r.meta, base64Len: r.base64.length }
  }, { project, sourceB64 })

  expect(result.meta).toMatchObject({ format: 'mp4', width: 2560, height: 1440, durationSec: 1 })
  expect(result.base64Len).toBeGreaterThan(0)
})

test('headless bundle rejects a clip whose source was not supplied', async ({ page }) => {
  const bundleUrl = 'file://' + resolve(ARTIST, 'dist-headless/headless.html')
  await page.goto(bundleUrl)
  await page.waitForFunction(() => (window as unknown as { __headlessReady?: boolean }).__headlessReady === true)

  const project = JSON.parse(readFileSync(resolve(FIX, 'project.json'), 'utf8'))
  const error = await page.evaluate(async ({ project }) => {
    const input = { project: project.project, sourceVideos: project.sourceVideos, sourceBlobs: {}, options: { format: 'mp4', quality: 'high' } }
    // @ts-expect-error injected global
    return await window.__renderProject(input).then(() => null, (e: Error) => e.message)
  }, { project })

  expect(error).toMatch(/no bytes in sourceBlobs/)
})

test('headless bundle streams sources in from the file input and the result out as a download', async ({ page }) => {
  const bundleUrl = 'file://' + resolve(ARTIST, 'dist-headless/headless.html')
  await page.goto(bundleUrl)
  await page.waitForFunction(() => (window as unknown as { __headlessReady?: boolean }).__headlessReady === true)

  const project = JSON.parse(readFileSync(resolve(FIX, 'project.json'), 'utf8'))
  // The runner supplies identity only — width/height/duration are probed from the bytes.
  for (const source of project.sourceVideos) {
    delete source.width
    delete source.height
    delete source.duration
  }

  await page.setInputFiles('#__sources', [resolve(FIX, 'source.mp4')])

  const [download, meta] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(async ({ project }) => {
      const input = {
        project: project.project,
        sourceVideos: project.sourceVideos,
        sourceFiles: { 'src-0': 'source.mp4' },
        options: { format: 'mp4', quality: 'high' },
        outputName: 'job-1',
      }
      // @ts-expect-error injected global
      return await window.__renderProjectToFile(input)
    }, { project }),
  ])

  expect(meta).toMatchObject({ format: 'mp4', width: 64, height: 48 })
  expect(meta.byteLength).toBeGreaterThan(0)
  expect(download.suggestedFilename()).toBe('job-1.mp4')

  const out = resolve(mkdtempSync(join(tmpdir(), 'headless-download-')), 'job-1.mp4')
  await download.saveAs(out)
  const bytes = readFileSync(out)
  expect(bytes.length).toBe(meta.byteLength)
  expect(bytes.subarray(0, 12).includes(Buffer.from('ftyp'))).toBe(true)
})

test('headless bundle reports a missing streamed file instead of rendering', async ({ page }) => {
  const bundleUrl = 'file://' + resolve(ARTIST, 'dist-headless/headless.html')
  await page.goto(bundleUrl)
  await page.waitForFunction(() => (window as unknown as { __headlessReady?: boolean }).__headlessReady === true)

  const project = JSON.parse(readFileSync(resolve(FIX, 'project.json'), 'utf8'))
  await page.setInputFiles('#__sources', [resolve(FIX, 'source.mp4')])

  const error = await page.evaluate(async ({ project }) => {
    const input = {
      project: project.project, sourceVideos: project.sourceVideos,
      sourceFiles: { 'src-0': 'absent.mp4' },
      options: { format: 'mp4', quality: 'high' }, outputName: 'job-2',
    }
    // @ts-expect-error injected global
    return await window.__renderProjectToFile(input).then(() => null, (e: Error) => e.message)
  }, { project })

  expect(error).toMatch(/no file named "absent\.mp4"/)
})

test('headless bundle probes an identity-only source for the dimensions sizing depends on', async ({ page }) => {
  const bundleUrl = 'file://' + resolve(ARTIST, 'dist-headless/headless.html')
  await page.goto(bundleUrl)
  await page.waitForFunction(() => (window as unknown as { __headlessReady?: boolean }).__headlessReady === true)

  const project = JSON.parse(readFileSync(resolve(FIX, 'project.json'), 'utf8'))
  project.sourceVideos = [{ id: 'src-0', name: 'source.mp4', mimeType: 'video/mp4' }]
  await page.setInputFiles('#__sources', [resolve(FIX, 'source.mp4')])

  // This project's own resolution (64x48) happens to equal source.mp4's real
  // pixel size (also 64x48), so the render's OUTPUT size can no longer tell us
  // whether the bytes were actually probed — every resolution option left
  // (ESCSUITE-111 dropped 'original', which used to size the output from the
  // source specifically to prove this) sizes from the project when one is
  // given. Read the probe's own result back from the shared IndexedDB
  // `videos` store instead: seedSources() completes an identity-only source
  // by decoding its bytes and stores that completed metadata under the
  // source's id, so a correct width/height/duration there (rather than
  // undefined, or whatever a failed probe would leave behind) is direct
  // evidence the probe ran and read the real file.
  await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(async ({ project }) => {
      const input = {
        project: project.project, sourceVideos: project.sourceVideos,
        sourceFiles: { 'src-0': 'source.mp4' },
        options: { format: 'mp4', quality: 'high' },
        outputName: 'job-3',
      }
      // @ts-expect-error injected global
      return await window.__renderProjectToFile(input)
    }, { project }),
  ])

  const probed = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('video-editor-db', 1)
    request.onerror = () => reject(new Error('Failed to open video-editor-db'))
    request.onsuccess = () => {
      const db = request.result
      const getRequest = db.transaction('videos', 'readonly').objectStore('videos').get('src-0')
      getRequest.onsuccess = () => resolve(getRequest.result?.metadata ?? null)
      getRequest.onerror = () => reject(new Error('Failed to read the "src-0" video record'))
    }
  }))

  expect(probed).toMatchObject({ width: 64, height: 48 })
  // A failed or skipped probe would leave duration undefined/0, never a
  // positive number — width/height alone can't rule that out here since the
  // fixture's real pixel size happens to equal the project's own resolution.
  expect((probed as { duration: number }).duration).toBeGreaterThan(0)
})
