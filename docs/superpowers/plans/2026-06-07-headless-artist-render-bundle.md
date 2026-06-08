# Headless ARTIST — Render Bundle (Plan 1 of 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a no-UI "headless" build of ESCAPEARTIST that exposes `window.__renderProject(input)` and runs the *real* export engine inside headless Chromium, producing video bytes from a project + injected sources.

**Architecture:** A new single-file Vite entry (`headless.html` → `src/headless/main.ts`) reuses the existing export engine **verbatim** (`exportToMP4`/`exportToWebM`). The one adaptation is *source injection*: the runner hands in source bytes, the bundle seeds them into IndexedDB via the existing `storeVideo()` so the engine's `getVideoBlob()` resolves unchanged. No React/editor UI is mounted. Validation runs the built single-file in real headless Chromium via Playwright. This plan delivers a working, testable headless renderer; Plan 2 wraps it in the Node CLI/kit.

**Tech Stack:** TypeScript, Vite + `vite-plugin-singlefile`, the ARTIST core (`apps/artist/src/core`), `@escapesuite/shared` storage, Playwright (real Chromium), Vitest.

---

## Scope

This is **Plan 1 of 2** (see `docs/superpowers/specs/2026-06-07-headless-artist-design.md`). It covers Component A (the headless render bundle) only. Plan 2 (`services/headless-artist`: CLI, license gate, loaders, sinks, kit/Dockerfile) builds on the `window.__renderProject` contract this plan establishes.

## File structure

- `apps/artist/headless.html` — **create.** Minimal HTML entry that loads `src/headless/main.ts`. No `#root`, no app.
- `apps/artist/src/headless/main.ts` — **create.** Defines + attaches `window.__renderProject`. The headless entry's only job.
- `apps/artist/src/headless/renderProject.ts` — **create.** The pure mapping `RenderInput → { bytes, meta }`: seeds sources, calls the engine, returns bytes. Unit-testable in isolation (jsdom-friendly parts) + the integration test exercises it in Chromium.
- `apps/artist/src/headless/types.ts` — **create.** `RenderInput`, `RenderMeta` interfaces (the cross-process contract Plan 2 consumes).
- `apps/artist/vite.config.ts` — **modify.** Add an env-gated headless entry/output so `build:headless` emits a single-file `dist-headless/headless.html`.
- `apps/artist/package.json` — **modify.** Add the `build:headless` script.
- `apps/e2e/tests/headless/render-bundle.spec.ts` — **create.** Playwright test: load the built single-file via `file://`, call `__renderProject`, assert valid output bytes.
- `apps/e2e/fixtures/headless/` — **create.** A tiny fixture project + a tiny source clip used by the test.

---

## Task 1: Define the render contract types

**Files:**
- Create: `apps/artist/src/headless/types.ts`
- Test: `apps/artist/src/headless/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/artist/src/headless/types.test.ts
import { describe, it, expect } from 'vitest'
import type { RenderInput, RenderMeta } from './types'

describe('headless render contract', () => {
  it('RenderInput composes a Project, sources, and options', () => {
    // Compile-time contract check executed as a trivial runtime assertion.
    const input: RenderInput = {
      project: { id: 'p', name: 'n', resolution: { width: 2, height: 2 },
        timeline: { tracks: [], clips: [], textOverlays: [], shapeOverlays: [], duration: 0 } } as RenderInput['project'],
      sourceVideos: [],
      sourceBlobs: {},
      options: { format: 'mp4' } as RenderInput['options'],
    }
    expect(input.options.format).toBe('mp4')
    const meta: RenderMeta = { format: 'mp4', byteLength: 0, durationSec: 0, width: 2, height: 2, gpu: false }
    expect(meta.format).toBe('mp4')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter=@escapesuite/artist exec vitest run src/headless/types.test.ts`
Expected: FAIL — `Cannot find module './types'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/artist/src/headless/types.ts
import type { Project, SourceVideo, ExportOptions, WatermarkConfig } from '../store/types'

/** Everything the headless renderer needs to produce a video, with no browser storage preloaded. */
export interface RenderInput {
  project: Project
  /** Source metadata exactly as the editor store holds it (state.sourceVideos). */
  sourceVideos: SourceVideo[]
  /** Raw bytes for each source, keyed by SourceVideo.id. Seeded into IndexedDB before render. */
  sourceBlobs: Record<string, ArrayBuffer>
  options: ExportOptions
  watermark?: WatermarkConfig | null
}

/** Returned alongside the encoded bytes for the verification manifest (Plan 2). */
export interface RenderMeta {
  format: 'mp4' | 'webm'
  byteLength: number
  durationSec: number
  width: number
  height: number
  gpu: boolean
}

export interface RenderResult {
  meta: RenderMeta
  /** base64 of the encoded video — transferred across the Chromium boundary. */
  base64: string
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter=@escapesuite/artist exec vitest run src/headless/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/artist/src/headless/types.ts apps/artist/src/headless/types.test.ts
git commit -m "feat(artist): headless render contract types"
```

---

## Task 2: Source injection helper (seed IndexedDB from injected bytes)

**Files:**
- Create: `apps/artist/src/headless/seedSources.ts`
- Test: `apps/artist/src/headless/seedSources.test.ts`

The engine reads sources via `getVideoBlob(id)` (IndexedDB). This helper writes injected bytes via the existing `storeVideo(id, blob, metadata)` so the engine is untouched. `fake-indexeddb` (already a dev dep, used in setup) backs the unit test.

- [ ] **Step 1: Write the failing test**

```ts
// apps/artist/src/headless/seedSources.test.ts
import { describe, it, expect } from 'vitest'
import { getVideoBlob } from '@escapesuite/shared/storage'
import { seedSources } from './seedSources'
import type { SourceVideo } from '../store/types'

describe('seedSources', () => {
  it('stores each injected source so getVideoBlob resolves it', async () => {
    const meta = { id: 'src-1', name: 'a.mp4', mimeType: 'video/mp4' } as SourceVideo
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer
    await seedSources([meta], { 'src-1': bytes })
    const blob = await getVideoBlob('src-1')
    expect(blob).toBeDefined()
    expect(blob!.size).toBe(4)
    expect(blob!.type).toBe('video/mp4')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter=@escapesuite/artist exec vitest run src/headless/seedSources.test.ts`
Expected: FAIL — `Cannot find module './seedSources'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/artist/src/headless/seedSources.ts
import { storeVideo } from '@escapesuite/shared/storage'
import type { SourceVideo } from '../store/types'

/**
 * Seed injected source bytes into IndexedDB (video-editor-db) so the export
 * engine's getVideoBlob(id) resolves them unchanged. Keeps the engine untouched.
 */
export async function seedSources(
  sourceVideos: SourceVideo[],
  sourceBlobs: Record<string, ArrayBuffer>,
): Promise<void> {
  for (const meta of sourceVideos) {
    const buf = sourceBlobs[meta.id]
    if (!buf) throw new Error(`Missing source bytes for id "${meta.id}"`)
    const blob = new Blob([buf], { type: meta.mimeType })
    await storeVideo(meta.id, blob, meta)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter=@escapesuite/artist exec vitest run src/headless/seedSources.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/artist/src/headless/seedSources.ts apps/artist/src/headless/seedSources.test.ts
git commit -m "feat(artist): headless source injection (seed IndexedDB)"
```

---

## Task 3: renderProject — map input to the real engine

**Files:**
- Create: `apps/artist/src/headless/renderProject.ts`
- Test: covered by the Chromium integration test (Task 6); a thin unit test guards the arg mapping with a stubbed engine.
- Test: `apps/artist/src/headless/renderProject.test.ts`

`renderProject` mirrors the editor's exact engine call
(`ExportDialog.tsx`: `exportToMP4(clips, sourceVideos, options, onProgress, tracks, watermark, signal, projectResolution)`).

- [ ] **Step 1: Write the failing test (engine mapping, with the engine mocked)**

```ts
// apps/artist/src/headless/renderProject.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const exportToMP4 = vi.fn(async () => new Blob([new Uint8Array([9, 9, 9])], { type: 'video/mp4' }))
const exportToWebM = vi.fn(async () => new Blob([new Uint8Array([8, 8])], { type: 'video/webm' }))
vi.mock('../core/exporter', () => ({ exportToMP4, exportToWebM }))
vi.mock('./seedSources', () => ({ seedSources: vi.fn(async () => {}) }))

import { renderProject } from './renderProject'
import type { RenderInput } from './types'

const baseInput = (): RenderInput => ({
  project: {
    id: 'p', name: 'n', resolution: { width: 64, height: 48 },
    timeline: { tracks: [{ id: 't0' }], clips: [{ id: 'c0', sourceVideoId: 's0' }], textOverlays: [], shapeOverlays: [], duration: 1 },
  } as unknown as RenderInput['project'],
  sourceVideos: [{ id: 's0', name: 's.mp4', mimeType: 'video/mp4' } as RenderInput['sourceVideos'][number]],
  sourceBlobs: { s0: new Uint8Array([1]).buffer },
  options: { format: 'mp4' } as RenderInput['options'],
})

beforeEach(() => { exportToMP4.mockClear(); exportToWebM.mockClear() })

describe('renderProject', () => {
  it('routes mp4 to exportToMP4 with editor arg order and returns base64 + meta', async () => {
    const res = await renderProject(baseInput())
    expect(exportToMP4).toHaveBeenCalledTimes(1)
    const args = exportToMP4.mock.calls[0]
    expect(args[0]).toHaveLength(1)              // clips
    expect(args[1]).toHaveLength(1)              // sourceVideos
    expect(args[4]).toEqual([{ id: 't0' }])      // tracks
    expect(args[7]).toEqual({ width: 64, height: 48 }) // projectResolution
    expect(res.meta.format).toBe('mp4')
    expect(res.meta.width).toBe(64)
    expect(res.meta.byteLength).toBe(3)
    expect(typeof res.base64).toBe('string')
  })

  it('routes webm to exportToWebM', async () => {
    const input = baseInput(); input.options = { format: 'webm' } as RenderInput['options']
    const res = await renderProject(input)
    expect(exportToWebM).toHaveBeenCalledTimes(1)
    expect(res.meta.format).toBe('webm')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter=@escapesuite/artist exec vitest run src/headless/renderProject.test.ts`
Expected: FAIL — `Cannot find module './renderProject'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/artist/src/headless/renderProject.ts
import { exportToMP4, exportToWebM } from '../core/exporter'
import { seedSources } from './seedSources'
import type { RenderInput, RenderResult } from './types'

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * Headless render entry. Seeds sources, then calls the SAME engine the editor
 * uses (identical arg order to ExportDialog), and returns base64 bytes + meta.
 */
export async function renderProject(
  input: RenderInput,
  onProgress?: (p: number) => void,
): Promise<RenderResult> {
  const { project, sourceVideos, sourceBlobs, options, watermark = null } = input
  await seedSources(sourceVideos, sourceBlobs)

  const clips = project.timeline.clips
  const tracks = project.timeline.tracks
  const resolution = project.resolution
  const progress = onProgress ?? (() => {})

  const format = options.format === 'webm' ? 'webm' : 'mp4'
  const blob = format === 'webm'
    ? await exportToWebM(clips, sourceVideos, options, progress, tracks, watermark, undefined, resolution)
    : await exportToMP4(clips, sourceVideos, options, progress, tracks, watermark, undefined, resolution)

  const durationSec = clips.reduce((max, c) => Math.max(max, (c.startTime ?? 0) + ((c.endTime ?? 0) - (c.startTime ?? 0))), 0)

  return {
    base64: await blobToBase64(blob),
    meta: {
      format,
      byteLength: blob.size,
      durationSec,
      width: resolution.width,
      height: resolution.height,
      gpu: false, // set by the runner based on launch flags (Plan 2)
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter=@escapesuite/artist exec vitest run src/headless/renderProject.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add apps/artist/src/headless/renderProject.ts apps/artist/src/headless/renderProject.test.ts
git commit -m "feat(artist): renderProject maps input to the real export engine"
```

---

## Task 4: Headless entry + `window.__renderProject`

**Files:**
- Create: `apps/artist/headless.html`
- Create: `apps/artist/src/headless/main.ts`

- [ ] **Step 1: Create the HTML entry**

```html
<!-- apps/artist/headless.html -->
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>ESCAPEARTIST headless render</title></head>
  <body>
    <script type="module" src="/src/headless/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Create the entry script that exposes the binding**

```ts
// apps/artist/src/headless/main.ts
import { renderProject } from './renderProject'
import type { RenderInput } from './types'

declare global {
  interface Window {
    __renderProject: (input: RenderInput, onProgress?: (p: number) => void) => ReturnType<typeof renderProject>
    __headlessReady: boolean
  }
}

window.__renderProject = renderProject
window.__headlessReady = true
```

- [ ] **Step 3: Commit**

```bash
git add apps/artist/headless.html apps/artist/src/headless/main.ts
git commit -m "feat(artist): headless entry exposing window.__renderProject"
```

---

## Task 5: `build:headless` single-file build

**Files:**
- Modify: `apps/artist/vite.config.ts`
- Modify: `apps/artist/package.json`

The default build emits `index.html` (the editor). A `VITE_HEADLESS=true` build instead emits a single-file `dist-headless/headless.html`. `vite-plugin-singlefile` + `inlineDynamicImports` requires a single input, so we swap input/outDir by env.

- [ ] **Step 1: Modify `vite.config.ts` build block**

Replace the `build: { ... }` object with:

```ts
  build: {
    target: 'esnext',
    assetsInlineLimit: 100000000, // Required for vite-plugin-singlefile
    chunkSizeWarningLimit: 5000,
    cssCodeSplit: false,
    // Headless render bundle: single-file headless.html in dist-headless/.
    outDir: process.env.VITE_HEADLESS === 'true' ? 'dist-headless' : 'dist',
    rollupOptions: {
      input: process.env.VITE_HEADLESS === 'true' ? 'headless.html' : 'index.html',
      output: { inlineDynamicImports: true },
    },
  },
```

- [ ] **Step 2: Add the script to `package.json`**

In `"scripts"`, after `"build:standalone"`, add:

```json
    "build:headless": "cross-env VITE_HEADLESS=true vite build",
```

(No `tsc` prefix — type errors are caught by the editor's `build`/CI; this script only emits the bundle.)

- [ ] **Step 3: Build and verify the single file exists**

Run: `pnpm --filter=@escapesuite/artist run build:headless`
Expected: completes; `apps/artist/dist-headless/headless.html` exists and is a single self-contained file.

Run: `test -f apps/artist/dist-headless/headless.html && grep -c "<script" apps/artist/dist-headless/headless.html`
Expected: file exists; inlined script present (count ≥ 1, no external `src=` module).

- [ ] **Step 4: Ignore the build output**

Add to `apps/artist/.gitignore` (create if missing): `dist-headless`

- [ ] **Step 5: Commit**

```bash
git add apps/artist/vite.config.ts apps/artist/package.json apps/artist/.gitignore
git commit -m "build(artist): build:headless single-file render bundle"
```

---

## Task 6: Real-Chromium integration test (the proof it renders)

**Files:**
- Create: `apps/e2e/fixtures/headless/make-fixture.md` (how the fixture was produced — see Step 1)
- Create: `apps/e2e/fixtures/headless/project.json` + `apps/e2e/fixtures/headless/source.mp4`
- Create: `apps/e2e/tests/headless/render-bundle.spec.ts`

This loads the built single-file in real headless Chromium (no dev server) and renders a one-clip project to a valid MP4.

- [ ] **Step 1: Create a tiny fixture (a 1-second MP4 + a minimal project)**

Generate a tiny H.264 MP4 and a project referencing it:

Run:
```bash
mkdir -p apps/e2e/fixtures/headless
ffmpeg -f lavfi -i color=c=red:s=64x48:d=1 -c:v libx264 -pix_fmt yuv420p -y apps/e2e/fixtures/headless/source.mp4
```
(If `ffmpeg` is unavailable on the build host, commit a pre-made 64x48 1s MP4 at that path instead.)

Create `apps/e2e/fixtures/headless/project.json` (a minimal valid Project + the source metadata; field names match `apps/artist/src/store/types.ts`):

```json
{
  "project": {
    "id": "fixture", "name": "fixture", "created": 0, "modified": 0,
    "resolution": { "width": 64, "height": 48 },
    "timeline": {
      "tracks": [{ "id": "track-0", "name": "V1", "index": 0, "visible": true, "locked": false, "muted": false, "volume": 1, "height": 64 }],
      "clips": [{ "id": "clip-0", "sourceVideoId": "src-0", "trackId": "track-0", "startTime": 0, "endTime": 1, "sourceStartTime": 0, "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1 }],
      "textOverlays": [], "shapeOverlays": [], "duration": 1
    }
  },
  "sourceVideos": [{ "id": "src-0", "name": "source.mp4", "mimeType": "video/mp4", "duration": 1, "width": 64, "height": 48 }]
}
```

> NOTE for the implementer: open `apps/artist/src/store/types.ts` and make `clips[0]`,
> `tracks[0]`, and `sourceVideos[0]` satisfy the real `Clip`, `Track`, and `SourceVideo`
> interfaces — add any required fields they declare. The test will surface missing fields
> as a render error, so iterate until it renders.

- [ ] **Step 2: Write the failing test**

```ts
// apps/e2e/tests/headless/render-bundle.spec.ts
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ARTIST = resolve(__dirname, '../../../artist')
const FIX = resolve(__dirname, '../../fixtures/headless')

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
```

- [ ] **Step 3: Build the bundle, then run the test to verify it fails first if bundle stale**

Run: `pnpm --filter=@escapesuite/artist run build:headless`
Run: `pnpm --filter=@escapesuite/e2e exec playwright test tests/headless/render-bundle.spec.ts --project=chromium`
Expected: initially may FAIL if fixture fields are incomplete — read the error, complete `project.json` per the Task-6 note, rebuild is not needed (only the fixture changed), re-run.

- [ ] **Step 4: Iterate the fixture until the test passes**

Re-run the Playwright command until: PASS — `result.meta.byteLength > 0` and the `ftyp` assertion holds.

- [ ] **Step 5: Commit**

```bash
git add apps/e2e/fixtures/headless apps/e2e/tests/headless/render-bundle.spec.ts
git commit -m "test(e2e): headless render bundle produces a valid MP4 in real Chromium"
```

---

## Task 7: WebM path + progress callback coverage

**Files:**
- Modify: `apps/e2e/tests/headless/render-bundle.spec.ts`

- [ ] **Step 1: Add a WebM render assertion**

Append to the spec file:

```ts
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
```

- [ ] **Step 2: Build (if not already) and run both headless tests**

Run: `pnpm --filter=@escapesuite/artist run build:headless`
Run: `pnpm --filter=@escapesuite/e2e exec playwright test tests/headless/render-bundle.spec.ts --project=chromium`
Expected: PASS — both MP4 and WebM render; progress callback fired.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/tests/headless/render-bundle.spec.ts
git commit -m "test(e2e): headless WebM render + progress coverage"
```

---

## Task 8: Wire `build:headless` into the monorepo build/CI surface

**Files:**
- Modify: `apps/artist/package.json` (already has the script from Task 5 — this task verifies the lint/typecheck path)

- [ ] **Step 1: Typecheck the new headless sources**

Run: `pnpm --filter=@escapesuite/artist exec tsc --noEmit`
Expected: PASS (no type errors in `src/headless/*`).

- [ ] **Step 2: Lint**

Run: `pnpm --filter=@escapesuite/artist run lint`
Expected: 0 errors.

- [ ] **Step 3: Full unit test run for artist**

Run: `pnpm --filter=@escapesuite/artist run test:run`
Expected: PASS, including the new `src/headless/*.test.ts`.

- [ ] **Step 4: Commit any fixups**

```bash
git add -A
git commit -m "chore(artist): headless bundle typecheck/lint clean" || echo "nothing to commit"
```

---

## Done criteria (Plan 1)

- `pnpm --filter=@escapesuite/artist run build:headless` emits a single-file `dist-headless/headless.html`.
- Loading that file in real headless Chromium and calling `window.__renderProject(input)` returns valid **MP4 and WebM** bytes for a fixture project, with a working progress callback.
- The editor build (`index.html`) is unchanged; the engine source is shared (no fork).
- Unit + Playwright tests green; typecheck + lint clean.

**Next:** Plan 2 — `services/headless-artist` (Node one-shot CLI driving this bundle in Chromium via Playwright, license gate, input loaders, output sinks, verification manifest, kit + reference Dockerfile, MinIO e2e).
