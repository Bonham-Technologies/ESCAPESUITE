import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
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
